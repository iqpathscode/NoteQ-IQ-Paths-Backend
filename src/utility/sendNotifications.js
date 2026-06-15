import  Role  from "../models/userPowers/role.model.js";

export const sendNotification = async ({
  user_id,
  role_id,
  type,
  title,
  message,
  notesheet_id,
}) => {
  try {
    //  strict validation
    if (!user_id || !role_id || !type || !title || !message || !notesheet_id) {
      console.log(" Missing notification fields");
      return;
    }

    // role fetch
    const roleData = await Role.findOne({ role_id });

    if (!roleData) {
      console.log(`❌ Role not found for role_id: ${role_id}`);
      return;
    }

    //  create notification
    await Notification.create({
      user_id,
      role_id,
      role: roleData.role_name, //  always correct
      type,
      title,
      message,
      notesheet_id,
    });

    console.log(` Notification sent to user: ${user_id}`);
  } catch (error) {
    console.error(" Notification Error:", error.message);
  }
};