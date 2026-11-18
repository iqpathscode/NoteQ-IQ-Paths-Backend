/**
 * Official Email Templates for NOC and Purchase Orders
 */

export const nocMailTemplate = ({
  noc,
  targetEmail,
  customMessage = "",
  verificationUrl = "",
  orgConfig = null,
}) => {
  const sectionTitle =
    orgConfig?.noc_format?.section_title || orgConfig?.org_name || "OFFICE OF THE REGISTRAR";
  const orgLegalName =
    orgConfig?.org_legal_name || orgConfig?.org_name || "OFFICE OF THE REGISTRAR";
  const issueDateFormatted = noc.issue_date
    ? new Date(noc.issue_date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-IN");

  const validUntilFormatted = noc.valid_until
    ? new Date(noc.valid_until).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Permanent / Specified Period";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>No Objection Certificate - ${noc.noc_number}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:30px 10px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px; background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.06); border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #195de6 0%, #1c64f2 50%, #2575fc 100%); padding:28px 24px; text-align:center; color:#ffffff;">
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; opacity:0.85; margin-bottom:6px;">
                ${orgLegalName} &bull; ${sectionTitle}
              </div>
              <h1 style="margin:0; font-size:22px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">
                No Objection Certificate (NOC)
              </h1>
              <div style="margin-top:8px; font-size:12px; background:rgba(255,255,255,0.18); display:inline-block; padding:4px 12px; border-radius:20px; border:1px solid rgba(255,255,255,0.3);">
                Certificate Ref: <strong>${noc.noc_number}</strong>
              </div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:28px 24px; color:#1e293b;">
              <p style="margin:0 0 16px 0; font-size:15px; line-height:22px; color:#334155;">
                Dear <strong>${noc.recipient_name || "Recipient"}</strong>,
              </p>
              <p style="margin:0 0 20px 0; font-size:14px; line-height:22px; color:#475569;">
                Please be advised that the Competent Authority has issued an official <strong>No Objection Certificate</strong> in your favor for the purpose outlined below.
              </p>

              ${
                customMessage
                  ? `
              <!-- Custom Remark from Registrar -->
              <div style="background-color:#eff6ff; border-left:4px solid #195de6; padding:12px 16px; border-radius:4px; margin-bottom:20px;">
                <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#1e40af; margin-bottom:3px;">
                  Registrar Note
                </div>
                <div style="font-size:13px; color:#1e293b; font-style:italic;">
                  "${customMessage}"
                </div>
              </div>
              `
                  : ""
              }

              <!-- Certificate Summary Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background-color:#f8fafc; border-radius:8px; overflow:hidden; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0; width:38%;">
                    Recipient Name
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:700; color:#0f172a; border-bottom:1px solid #e2e8f0;">
                    ${noc.recipient_name} (${noc.recipient_type || "STUDENT"})
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Enrollment / ID No.
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; font-family:monospace; font-weight:600; border-bottom:1px solid #e2e8f0;">
                    ${noc.recipient_id}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Department / Course
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${noc.department_name} &bull; ${noc.designation_or_course}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Target Organization
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">
                    ${noc.organization_name}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Purpose of NOC
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${noc.purpose}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Issue Date
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${issueDateFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b;">
                    Validity Until
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#059669;">
                    ${validUntilFormatted}
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              ${
                verificationUrl
                  ? `
              <div style="text-align:center; margin:28px 0 20px 0;">
                <a href="${verificationUrl}" target="_blank" style="display:inline-block; background:linear-gradient(135deg, #195de6 0%, #1c64f2 100%); color:#ffffff; font-size:14px; font-weight:700; padding:12px 28px; text-decoration:none; border-radius:8px; box-shadow:0 3px 8px rgba(25,93,230,0.35);">
                  View & Verify Certificate Online &rarr;
                </a>
                <div style="margin-top:8px; font-size:11px; color:#94a3b8;">
                  Or access directly: <a href="${verificationUrl}" style="color:#195de6; word-break:break-all;">${verificationUrl}</a>
                </div>
              </div>
              `
                  : ""
              }

              <!-- Authenticity Notice -->
              <div style="background-color:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:12px 14px; margin-top:20px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td width="22" valign="top" style="font-size:16px;">
                      &#x2705;
                    </td>
                    <td style="font-size:12px; color:#166534; line-height:18px;">
                      <strong>Digitally Signed & QR-Secured:</strong> This certificate is registered in the institutional repository and carries an authorized cryptographic verification signature. External entities can scan the QR code to verify validity.
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Signoff -->
              <div style="margin-top:24px; padding-top:18px; border-top:1px solid #f1f5f9; font-size:13px; color:#475569;">
                <div>Regards,</div>
                <div style="font-weight:700; color:#0f172a; margin-top:3px;">
                  ${noc.issued_by_name || "Office of the Registrar"}
                </div>
                <div style="font-size:12px; color:#64748b;">
                  ${noc.issued_by_designation || "Registrar"} &bull; NoteQ System
                </div>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:16px 24px; text-align:center; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8;">
              This is an automated institutional communication generated by NoteQ Institutional Governance System. Please do not reply directly to this email.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

export const poMailTemplate = ({
  po,
  targetEmail,
  customMessage = "",
  verificationUrl = "",
  orgConfig = null,
}) => {
  const sectionTitle =
    orgConfig?.po_format?.section_title || "CENTRAL PROCUREMENT DIVISION";
  const orgLegalName =
    orgConfig?.org_legal_name || orgConfig?.org_name || "OFFICE OF THE REGISTRAR";
  const orgGstin = orgConfig?.org_gstin || "";
  const orgPan = orgConfig?.org_pan || "";
  const orderDateFormatted = po.order_date
    ? new Date(po.order_date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-IN");

  const deliveryDueFormatted = po.delivery_due_date
    ? new Date(po.delivery_due_date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "As per procurement schedule";

  const grandTotal = Number(po.financials?.grand_total || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Official Purchase Order - ${po.po_number}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:30px 10px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background-color:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.06); border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #195de6 0%, #1c64f2 50%, #2575fc 100%); padding:28px 24px; text-align:center; color:#ffffff;">
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; opacity:0.85; margin-bottom:6px;">
                ${orgLegalName} &bull; ${sectionTitle}
              </div>
              <h1 style="margin:0; font-size:22px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">
                Official Purchase Order (PO)
              </h1>
              <div style="margin-top:8px; font-size:12px; background:rgba(255,255,255,0.18); display:inline-block; padding:4px 12px; border-radius:20px; border:1px solid rgba(255,255,255,0.3);">
                PO Number: <strong>${po.po_number}</strong>
              </div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:28px 24px; color:#1e293b;">
              <p style="margin:0 0 16px 0; font-size:15px; line-height:22px; color:#334155;">
                Dear <strong>${po.vendor?.name || "Authorized Vendor"}</strong>,
              </p>
              <p style="margin:0 0 20px 0; font-size:14px; line-height:22px; color:#475569;">
                Please find enclosed the official <strong>Purchase Order</strong> issued by the University. Kindly confirm receipt and arrange delivery of the contracted goods/services strictly as per the specifications and terms set forth below.
              </p>

              ${
                customMessage
                  ? `
              <!-- Custom Remark from Registrar -->
              <div style="background-color:#eff6ff; border-left:4px solid #195de6; padding:12px 16px; border-radius:4px; margin-bottom:20px;">
                <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#1e40af; margin-bottom:3px;">
                  Instructions / Notes
                </div>
                <div style="font-size:13px; color:#1e293b; font-style:italic;">
                  "${customMessage}"
                </div>
              </div>
              `
                  : ""
              }

              <!-- PO Summary Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; background-color:#f8fafc; border-radius:8px; overflow:hidden; border:1px solid #e2e8f0; margin-bottom:24px;">
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0; width:36%;">
                    Vendor / Supplier
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:700; color:#0f172a; border-bottom:1px solid #e2e8f0;">
                    ${po.vendor?.name}
                    ${po.vendor?.contact_person ? ` (Attn: ${po.vendor.contact_person})` : ""}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Order Date
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${orderDateFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Delivery Due Date
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#b45309; border-bottom:1px solid #e2e8f0;">
                    ${deliveryDueFormatted}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Indenting Department
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${po.department_name}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Delivery Location
                  </td>
                  <td style="padding:10px 14px; font-size:13px; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${po.delivery_location || "Central Store, University Campus"}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px; font-size:12px; font-weight:600; color:#64748b; border-bottom:1px solid #e2e8f0;">
                    Total Line Items
                  </td>
                  <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#1e293b; border-bottom:1px solid #e2e8f0;">
                    ${po.items?.length || 0} Item(s)
                  </td>
                </tr>
                <tr style="background-color:#f1f5f9;">
                  <td style="padding:12px 14px; font-size:13px; font-weight:700; color:#0f172a;">
                    Grand Total (Inc. GST)
                  </td>
                  <td style="padding:12px 14px; font-size:16px; font-weight:800; color:#195de6;">
                    &#8377; ${grandTotal}
                  </td>
                </tr>
                ${
                  po.financials?.amount_in_words
                    ? `
                <tr>
                  <td colspan="2" style="padding:8px 14px; font-size:11px; color:#64748b; font-style:italic; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                    Amount in words: ${po.financials.amount_in_words}
                  </td>
                </tr>
                `
                    : ""
                }
              </table>

              <!-- Payment Terms -->
              <div style="background-color:#f8fafc; border:1px dashed #cbd5e1; border-radius:6px; padding:12px 14px; margin-bottom:24px; font-size:12px; color:#475569;">
                <strong>Payment & Delivery Terms:</strong> ${po.payment_terms || "Standard University Procurement Terms apply."}
              </div>

              <!-- CTA Button -->
              ${
                verificationUrl
                  ? `
              <div style="text-align:center; margin:28px 0 20px 0;">
                <a href="${verificationUrl}" target="_blank" style="display:inline-block; background:linear-gradient(135deg, #195de6 0%, #1c64f2 100%); color:#ffffff; font-size:14px; font-weight:700; padding:12px 28px; text-decoration:none; border-radius:8px; box-shadow:0 3px 8px rgba(25,93,230,0.35);">
                  View & Verify Purchase Order &rarr;
                </a>
                <div style="margin-top:8px; font-size:11px; color:#94a3b8;">
                  Direct verification link: <a href="${verificationUrl}" style="color:#195de6; word-break:break-all;">${verificationUrl}</a>
                </div>
              </div>
              `
                  : ""
              }

              <!-- Authenticity Notice -->
              <div style="background-color:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:12px 14px; margin-top:20px;">
                <table cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td width="22" valign="top" style="font-size:16px;">
                      &#x2705;
                    </td>
                    <td style="font-size:12px; color:#166534; line-height:18px;">
                      <strong>Official Verified Order:</strong> This order is sequenced in the institutional registry and carries cryptographic verification. Dispatch documents and invoices must clearly cite this PO Number.
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Signoff -->
              <div style="margin-top:24px; padding-top:18px; border-top:1px solid #f1f5f9; font-size:13px; color:#475569;">
                <div>Regards,</div>
                <div style="font-weight:700; color:#0f172a; margin-top:3px;">
                  ${po.issued_by_name || "Office of the Registrar"}
                </div>
                <div style="font-size:12px; color:#64748b;">
                  ${po.issued_by_designation || "Registrar"} &bull; NoteQ Procurement Management
                </div>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; padding:16px 24px; text-align:center; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8;">
              This is an automated institutional communication generated by NoteQ Procurement Portal. Please do not reply directly to this email.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};
