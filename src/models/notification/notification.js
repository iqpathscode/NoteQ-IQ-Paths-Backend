import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    emp_id: { type: Number, required: true, index: true }, // Employee.emp_id — kisko notification jaani hai

    role_id: { type: Number, required: true }, // konsa role active tha jab notification bani (multi-role support ke liye)

    type: {
      type: String,
      enum: ["RECEIVED", "FOR_CLOSURE", "QUERY", "APPROVED", "REJECTED"],
      required: true,
    },

   reference_id: { type: mongoose.Schema.Types.Mixed, required: true }, 
    reference_type: {
      type: String,
      enum: ["Notesheet", "Application"],
      required: true,
    },

    title: { type: String, required: true },
    message: { type: String, trim: true },

    is_read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Indexes — inbox query fast rahe isliye
notificationSchema.index({ emp_id: 1, is_read: 1, createdAt: -1 });
notificationSchema.index({ reference_id: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;