import Notification from "../models/notification/notification.js";

const MAX_NOTIFICATIONS_PER_USER = 5; // yahan se count control hoga (5/7/10)

export async function sendNotification(io, { emp_id, role_id, type, reference_id, reference_type, title, message }) {
  const notif = await Notification.create({
    emp_id,
    role_id,
    type,
    reference_id,
    reference_type,
    title,
    message,
  });

  // ✅ Purani notifications trim karo — sirf latest N rakho
  const allForUser = await Notification.find({ emp_id })
    .sort({ createdAt: -1 })
    .select("_id");

  if (allForUser.length > MAX_NOTIFICATIONS_PER_USER) {
    const idsToDelete = allForUser
      .slice(MAX_NOTIFICATIONS_PER_USER)
      .map((n) => n._id);
    await Notification.deleteMany({ _id: { $in: idsToDelete } });
  }

  io.to(`emp_${emp_id}`).emit("new_notification", notif);
  return notif;
}