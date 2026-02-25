import { Notification } from "../models/counter/notification.model.js";

// Create notification
export const createNotification = async (req, res) => {
  try {
    const { user_id, role, status, title, message, notesheet_id } = req.body;

    const notification = await Notification.create({
      user_id,
      role,
      status,
      title,
      message,
      notesheet_id,
    });

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      data: notification,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating notification",
      error: error.message,
    });
  }
};

// Get notifications for user
export const getNotifications = async (req, res) => {
  try {
    const { userId, role } = req.query;

    const notifications = await Notification.find({ user_id: userId, role }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: notifications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};

// Delete notification manually
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    await Notification.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting notification",
      error: error.message,
    });
  }
};
