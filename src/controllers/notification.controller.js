import { Notification } from "../models/counter/notification.model.js";
import { sendMail } from "../utility/sendMail.js";
import Employee from "../models/user/employee.model.js";
import Notesheet from "../models/notes/notesheet.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";

//  Create Notification
// export const createNotification = async (req, res) => {
//   try {
//     console.log(" createNotification API HIT");
//     console.log(" Incoming Body:", req.body);

//     const { user_id, role, type, title, message, notesheet_id } = req.body;

//     if (!user_id || !type || !title || !message || !notesheet_id) {
//       console.log("Missing fields");
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }

//     const notification = await Notification.create({
//       user_id,
//       role,
//       type,
//       title,
//       message,
//       notesheet_id,
//     });

//     console.log(" Notification Created:", notification);

//     return res.status(201).json({
//       success: true,
//       message: "Notification created successfully",
//       data: notification,
//     });
//   } catch (error) {
//     console.error(" Error creating notification:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Error creating notification",
//       error: error.message,
//     });
//   }
// };

//  Get Notifications
// export const getNotifications = async (req, res) => {
//   try {
//     const { userId, role, page = 1, limit = 10 } = req.query;

//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: "userId is required",
//       });
//     }

//     const query = { user_id: Number(userId) };
//     if (role) query.role = role;

//     const notifications = await Notification.find(query)
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(Number(limit));

//     const unreadCount = await Notification.countDocuments({
//       user_id: Number(userId),
//       isRead: false,
//     });

//     return res.status(200).json({
//       success: true,
//       data: notifications,
//       unreadCount,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: "Error fetching notifications",
//       error: error.message,
//     });
//   }
// };

//  Mark Single as Read
// export const markAsRead = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const updated = await Notification.findByIdAndUpdate(
//       id,
//       { isRead: true },
//       { new: true },
//     );

//     return res.status(200).json({
//       success: true,
//       message: "Notification marked as read",
//     });
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// Mark All as Read
// export const markAllAsRead = async (req, res) => {
//   try {
//     const { userId } = req.body;

//     const result = await Notification.updateMany(
//       { user_id: Number(userId), isRead: false },
//       { isRead: true },
//     );

//     return res.status(200).json({
//       success: true,
//       message: "All notifications marked as read",
//     });
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

//  Delete Notification
// export const deleteNotification = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const notification = await Notification.findById(id);

//     if (!notification) {
//       return res.status(404).json({
//         success: false,
//         message: "Notification not found",
//       });
//     }

//     await notification.deleteOne();

//     return res.status(200).json({
//       success: true,
//       message: "Notification deleted successfully",
//     });
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };


export const sendNotesheetReceivedMail = async ({
  to_emp_id,
  subject,
  sentBy,
  noteId,
}) => {
  try {
    const employee = await Employee.findOne({ emp_id: to_emp_id });

    if (!employee?.email) return;

    const html = notesheetReceivedTemplate({
      name: employee.emp_name,
      subject,
      sentBy,
      noteId,
    });

    await sendMail({
      to: employee.email,
      name: employee.emp_name || " ",
      subject: `New Notesheet Received - ${noteId}`,
      html,
    });
  } catch (err) {
    console.log("Mail Service Error:", err.message);
  }
};

// ======================================
// FINAL EXECUTION MAIL
// ======================================

export const sendFinalExecutionMailToAll = async ({
  noteId,
}) => {
  try {

    // ================= GET NOTESHEET =================
    const notesheet = await Notesheet.findOne({
      note_id: noteId,
    });

    if (!notesheet) return;

    // ================= GET ALL FLOWS =================
    const flows = await NotesheetFlow.find({
      note_id: noteId,
    }).lean();

    if (!flows.length) return;

    // ================= UNIQUE EMP IDS =================
    const employeeIds = [
      ...new Set(
        flows
          .flatMap((f) => [
            f.from_emp_id,
            f.to_emp_id,
          ])
          .filter(Boolean)
      ),
    ];

    if (!employeeIds.length) return;

    // ================= GET EMPLOYEES =================
    const employees = await Employee.find({
      emp_id: { $in: employeeIds },
      is_active: true,
    }).lean();

    // ================= UNIQUE EMAILS =================
    const sentEmails = new Set();

    // ================= SEND MAIL =================
    for (const emp of employees) {

      // skip invalid email
      if (!emp?.email) continue;

      // skip duplicate email
      if (sentEmails.has(emp.email)) continue;

      sentEmails.add(emp.email);

      const html = `
      <div style="
        font-family: Arial, sans-serif;
        background:#f4f6f9;
        padding:30px;
      ">

        <div style="
          max-width:650px;
          margin:auto;
          background:white;
          border-radius:10px;
          overflow:hidden;
          box-shadow:0 2px 10px rgba(0,0,0,0.1);
        ">

          <div style="
            background:#16a34a;
            color:white;
            padding:20px;
            text-align:center;
          ">
            <h2 style="margin:0;">
              Notesheet Finalized
            </h2>
          </div>

          <div style="padding:30px; color:#333;">

            <p>
              Dear <strong>${emp.emp_name}</strong>,
            </p>

            <p>
              The notesheet on which you performed an action
              has now reached the final execution stage.
            </p>

            <table style="
              width:100%;
              border-collapse:collapse;
              margin-top:20px;
              margin-bottom:20px;
            ">

              <tr>
                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                ">
                  <strong>Note ID</strong>
                </td>

                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                ">
                  ${notesheet.note_id}
                </td>
              </tr>

              <tr>
                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                ">
                  <strong>Subject</strong>
                </td>

                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                ">
                  ${notesheet.subject || "N/A"}
                </td>
              </tr>

              <tr>
                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                ">
                  <strong>Status</strong>
                </td>

                <td style="
                  border:1px solid #ddd;
                  padding:10px;
                  color:green;
                  font-weight:bold;
                ">
                  FINAL EXECUTION COMPLETED
                </td>
              </tr>

            </table>

            <p>
              Thank you for your contribution in the workflow.
            </p>

            <br/>

            <p>
              Regards,<br/>
              Notesheet Management System
            </p>

          </div>
        </div>
      </div>
      `;

      await sendMail({
        to: emp.email,
        name: employee.emp_name || " ",
        subject: `Notesheet Finalized - ${notesheet.note_id}`,
        html,
      });

      console.log(
        ` Final execution mail sent to ${emp.email}`
      );
    }

  } catch (error) {
    console.log(
      " Final Execution Mail Error:",
      error.message
    );
  }
};

