import Query from "../models/userPowers/query.model.js";
import axios from "axios";

// ─── Brevo email sender ────────────────────────────────────────────────────
const sendBrevoEmail = async ({ toEmail, toName, subject, htmlContent }) => {
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name:  process.env.BREVO_SENDER_NAME,
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: toEmail, name: toName }],
      subject,
      htmlContent,
    },
    {
      headers: {
        "api-key":      process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
};

// ─── Company notification email HTML ──────────────────────────────────────
const companyNotificationHtml = (name, email, phone, message) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e293b,#334155);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🔔 New Query Received</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">NoteSheet Portal — IQ Paths</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.7;">
                A new query has been submitted via the NoteSheet Portal login page.
              </p>

              <!-- User Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:10px 14px;background:#f1f5f9;border-radius:8px 8px 0 0;border-bottom:1px solid #e2e8f0;">
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Name</span><br/>
                    <span style="font-size:14px;color:#1e293b;font-weight:600;">${name}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Email</span><br/>
                    <a href="mailto:${email}" style="font-size:14px;color:#3b82f6;text-decoration:none;">${email}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f1f5f9;border-radius:0 0 8px 8px;">
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Phone</span><br/>
                    <span style="font-size:14px;color:#1e293b;">${phone || "Not provided"}</span>
                  </td>
                </tr>
              </table>

              <!-- Message -->
              <div style="background:#fefce8;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;">
                <p style="margin:0 0 6px;font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
                <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.7;">${message}</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                &copy; ${new Date().getFullYear()} IQ Paths Technologies Pvt. Ltd. &nbsp;|&nbsp;
                <a href="https://iqpaths.com" style="color:#3b82f6;text-decoration:none;">iqpaths.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ─── Controller ────────────────────────────────────────────────────────────
export const raiseQuery = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and message are required.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address.",
      });
    }

    // ── Save to DB ──────────────────────────────────────────────────────────
    const query = await Query.create({
      name:    name.trim(),
      email:   email.trim().toLowerCase(),
      phone:   phone?.trim() || "",
      message: message.trim(),
    });

    // ── Send notification email to company only ─────────────────────────────
    try {
      await sendBrevoEmail({
        toEmail:     process.env.COMPANY_NOTIFY_EMAIL, // .env mein set karo
        toName:      "IQ Paths Support Team",
        subject:     `📩 New Query from ${name.trim()} — NoteSheet Portal`,
        htmlContent: companyNotificationHtml(
          name.trim(),
          email.trim(),
          phone?.trim() || "",
          message.trim()
        ),
      });
    } catch (emailErr) {
      // Email fail hone par bhi success return karo — DB mein save ho chuki hai
      console.error("Brevo email error:", emailErr?.response?.data || emailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Query submitted successfully.",
      data:    { queryId: query._id },
    });
  } catch (error) {
    console.error("raiseQuery error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }
};
