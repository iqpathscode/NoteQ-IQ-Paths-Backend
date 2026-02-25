import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  user_id: {
    type: Number,
    required: true,
  },
  role: {
    type: String,
    enum: ["admin", "employee"],
    required: true,
  },
  status: {
    type: String,
    enum: ["approved", "rejected", "pending"],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  notesheet_id: {
    type: Number,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24, // auto delete after 24 hours
  },
});

export const Notification = mongoose.model("Notification", notificationSchema);
