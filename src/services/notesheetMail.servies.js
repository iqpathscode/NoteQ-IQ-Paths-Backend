import Employee from "../models/user/employee.model.js";
import { sendMail } from "../utility/sendMail.js";
import { notesheetMailTemplate } from "../utility/notesheetMailTemplate.js";

export const sendNotesheetMail = async ({
  to_emp_id,
  type,
  noteId,
  subject,
  actionBy,
  actionByRole,
  remark, 
}) => {
  try {
    const employee = await Employee.findOne({
      emp_id: to_emp_id,
    });

    if (!employee?.email) return;

    let title = "";
    let message = "";

    switch (type) {
      case "CREATED":
        title = "New Notesheet Received";
        message = "You have received a new notesheet for action.";
        break;

      case "FORWARDED":
        title = "Notesheet Forwarded";
        message = "A notesheet has been forwarded to you.";
        break;

      case "APPROVED":
        title = "Notesheet Approved";
        message = "Your notesheet has been approved.";
        break;

      case "REJECTED":
        title = "Notesheet Rejected";
        message = "Your notesheet has been rejected.";
        break;

      case "QUERY":
        title = "Query Raised";
        message = "A query has been raised on notesheet.";
        break;

      case "QUERY_REPLY":
        title = "Query Reply Received";
        message = "A reply has been received for your query.";
        break;

      case "CLOSED":
        title = "Notesheet Closed";
        message = "Your notesheet has been closed after execution.";
        break;

      default:
        title = "Notesheet Notification";
        message = "You have a new notification.";
    }

    const html = notesheetMailTemplate({
      title,
      employeeName: employee.emp_name,
      message,
      noteId,
      subject,
      actionBy,
      actionByRole, 
      remark,
    });

    await sendMail({
      to: employee.email,
      name: employee.emp_name || " ",
      subject: `${title} - ${noteId}`,
      html,
    });

    console.log(` ${type} mail sent to ${employee.email}`);
  } catch (error) {
    console.log(" Mail Service Error:", error.message);
  }
};