export const notesheetMailTemplate = ({
  title,
  employeeName,
  message,
  noteId,
  subject,
  actionBy,
  remark,
}) => {
  return `
  <div style="font-family: Arial, sans-serif; background:#f4f6f9; padding:30px;">

    <div style="
      max-width:650px;
      margin:auto;
      background:#ffffff;
      border-radius:10px;
      overflow:hidden;
      box-shadow:0 2px 10px rgba(0,0,0,0.1);
    ">

      <div style="
        background:#1e3a8a;
        color:white;
        padding:20px;
        text-align:center;
      ">
        <h2 style="margin:0;">
          Notesheet Management System
        </h2>
      </div>

      <div style="padding:30px; color:#333;">

        <p>Dear <strong>${employeeName}</strong>,</p>

        <p>${message}</p>

        <table style="
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
          margin-bottom:20px;
        ">
          <tr>
            <td style="padding:10px; border:1px solid #ddd;">
              <strong>Notesheet ID</strong>
            </td>
            <td style="padding:10px; border:1px solid #ddd;">
              ${noteId}
            </td>
          </tr>

          <tr>
            <td style="padding:10px; border:1px solid #ddd;">
              <strong>Subject</strong>
            </td>
            <td style="padding:10px; border:1px solid #ddd;">
              ${subject || "N/A"}
            </td>
          </tr>

          ${
            actionBy
              ? `
            <tr>
              <td style="padding:10px; border:1px solid #ddd;">
                <strong>Action By</strong>
              </td>
              <td style="padding:10px; border:1px solid #ddd;">
                ${actionBy}
              </td>
            </tr>
          `
              : ""
          }

          ${
            remark
              ? `
            <tr>
              <td style="padding:10px; border:1px solid #ddd;">
                <strong>Remark</strong>
              </td>
              <td style="padding:10px; border:1px solid #ddd;">
                ${remark}
              </td>
            </tr>
          `
              : ""
          }
        </table>

        <br/>

        <p style="color:#666;">
          Regards,<br/>
          Notesheet Management System
        </p>

      </div>
    </div>
  </div>
  `;
};