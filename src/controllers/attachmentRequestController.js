import Notesheet from "../models/notes/notesheet.model.js"; 
import NotesheetFlow from "../models/notes/notesheetFlow.model.js"; 
import Role from "../models/userPowers/role.model.js"; 
import Employee from "../models/user/employee.model.js"; 
import { sendNotification } from "../utility/sendNotifications.js"; 

// ═══════════════════════════════════════════════════════════
// 1. Current approver (Dean) attachment request karta hai
// POST /:noteId/request-attachment
// ═══════════════════════════════════════════════════════════
export const requestAttachment = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { message } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet)
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });

    if (notesheet.lifecycle_status !== "OPEN") {
      return res
        .status(400)
        .json({ success: false, message: "Notesheet already closed" });
    }

    // 🔒 Sirf jiske paas ABHI notesheet hai, wahi request raise kare
    const userRoleId = Number(user.active_role_id || user.role_id);   // ✅ sirf ek baar

    if (String(notesheet.forward_to_role_id) !== String(userRoleId)) {
      return res.status(403).json({
        success: false,
        message: "Only the current approver can request an attachment",
      });
    }

    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);

    const newRequest = {
      requested_by_emp_id: user.emp_id,
      requested_by_role_id: userRoleId,
      requested_by_role_name: role?.role_name || "Unknown",
      requested_by_name: employee?.emp_name || "Unknown",
      message: message || "",
      status: "PENDING",
    };

    notesheet.attachmentRequests.push(newRequest);
    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Attachment request raised successfully",
      data: notesheet.attachmentRequests[
        notesheet.attachmentRequests.length - 1
      ],
    });

    const notifyTarget = notesheet.created_by_emp_id || notesheet.emp_id;
    if (notifyTarget) {
      const io = req.app.get("io");
       console.log("🔔 DEBUG: notifyTarget =", notifyTarget, "| io exists =", !!io); 
      sendNotification(io, {
        emp_id: notifyTarget,
        role_id: notesheet.created_by_role_id,
        type: "ATTACHMENT_REQUESTED",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "Attachment Requested",
        message: `${employee?.emp_name ?? "Approver"} (${role?.role_name ?? ""}) has requested an attachment on "${notesheet.subject}"${message ? `: "${message}"` : ""}`,
      }).catch((err) =>
        console.error("Notification error (requestAttachment):", err),
      );
    }
  } catch (error) {
    console.error("requestAttachment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
// ═══════════════════════════════════════════════════════════
// 2. Creator attachment upload karke request fulfil karta hai
// POST /:noteId/fulfill-attachment/:requestId
// (route pe upload.single("attachment") middleware lagega)
// ═══════════════════════════════════════════════════════════
export const fulfillAttachment = async (req, res) => {
  try {
    const { noteId, requestId } = req.params;
    const user = req.user;
    const userRoleId = Number(user.active_role_id || user.role_id);

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet)
      return res.status(404).json({ success: false, message: "Notesheet not found" });

    // 🔄 Creator YA current holder — dono me se koi bhi upload kar sake
    const isCreator = notesheet.created_by_emp_id === user.emp_id;
    const isCurrentHolder =
      notesheet.status === "PENDING" &&
      String(notesheet.forward_to_role_id) === String(userRoleId);

    if (!isCreator && !isCurrentHolder) {
      return res.status(403).json({
        success: false,
        message: "Only the creator or current approver can upload this attachment",
      });
    }

    const attachmentRequest = notesheet.attachmentRequests.id(requestId);
    if (!attachmentRequest)
      return res.status(404).json({ success: false, message: "Attachment request not found" });

    if (attachmentRequest.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `This request is already ${attachmentRequest.status}`,
      });
    }

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ success: false, message: "No files uploaded" });

    // 🔄 multer-storage-cloudinary — har file ka path secure_url hota hai
    const uploadedFiles = req.files.map((f) => ({
      url: f.path,
      name: f.originalname,
    }));

    attachmentRequest.status = "FULFILLED";
    attachmentRequest.fulfilled_attachments = uploadedFiles;
    attachmentRequest.fulfilled_by_emp_id = user.emp_id;
    attachmentRequest.fulfilled_at = new Date();

    // Main attachments array me bhi sab daal do — sabko visible
    notesheet.attachments.push(...uploadedFiles.map((f) => f.url));

    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Attachment(s) uploaded successfully",
      data: attachmentRequest,
    });

    // 🔔 Notifications — fire and forget
    const io = req.app.get("io");
    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);

    // Requester ko (agar khud requester ne nahi upload kiya)
    if (attachmentRequest.requested_by_emp_id !== user.emp_id) {
      sendNotification(io, {
        emp_id: attachmentRequest.requested_by_emp_id,
        role_id: attachmentRequest.requested_by_role_id,
        type: "ATTACHMENT_UPLOADED",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "Attachment Uploaded",
        message: `${employee?.emp_name ?? "Someone"} uploaded the requested attachment on "${notesheet.subject}"`,
      }).catch((err) => console.error("Notification error (fulfillAttachment - requester):", err));
    }

    // Poore flow ke participants ko
    const flowEntries = await NotesheetFlow.find({ note_id: noteId }).lean();
    const participantsMap = new Map();
    flowEntries.forEach((f) => {
      if (f.from_emp_id && f.from_emp_id !== user.emp_id) participantsMap.set(f.from_emp_id, f.from_role_id);
      if (f.to_emp_id && f.to_emp_id !== user.emp_id) participantsMap.set(f.to_emp_id, f.to_role_id);
    });
    participantsMap.delete(attachmentRequest.requested_by_emp_id);

    participantsMap.forEach((roleId, empId) => {
      sendNotification(io, {
        emp_id: empId,
        role_id: roleId,
        type: "ATTACHMENT_UPLOADED",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "New Attachment Added",
        message: `A new attachment was added to "${notesheet.subject}"`,
      }).catch((err) => console.error("Notification error (fulfillAttachment - flow):", err));
    });
  } catch (error) {
    console.error("fulfillAttachment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 3. Sirf jisne request raise ki, wahi disable/cancel kare
// PATCH /:noteId/disable-attachment-request/:requestId
// ═══════════════════════════════════════════════════════════
export const disableAttachmentRequest = async (req, res) => {
  try {
    const { noteId, requestId } = req.params;
    const user = req.user;

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet)
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });

    const attachmentRequest = notesheet.attachmentRequests.id(requestId);
    if (!attachmentRequest)
      return res
        .status(404)
        .json({ success: false, message: "Attachment request not found" });

    // 🔒 CRITICAL: sirf requester hi disable kar sake
    if (attachmentRequest.requested_by_emp_id !== user.emp_id) {
      return res.status(403).json({
        success: false,
        message: "Only the person who raised this request can disable it",
      });
    }

    if (attachmentRequest.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot disable a request that is already ${attachmentRequest.status}`,
      });
    }

    attachmentRequest.status = "DISABLED";
    attachmentRequest.disabled_by_emp_id = user.emp_id;
    attachmentRequest.disabled_at = new Date();

    await notesheet.save();

    return res.status(200).json({
      success: true,
      message: "Attachment request disabled",
      data: attachmentRequest,
    });
  } catch (error) {
    console.error("disableAttachmentRequest error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
