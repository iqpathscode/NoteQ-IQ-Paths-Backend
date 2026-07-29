import mongoose from "mongoose";
 
const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [120, "Title can't exceed 120 characters"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },
    priority: {
      type: String,
      enum: ["normal", "important", "urgent"],
      default: "normal",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    // Cloudinary public_id, kept so we can destroy() the asset on
    // update/delete instead of leaving orphaned uploads behind.
    imagePublicId: {
      type: String,
      default: null,
    },
    // Optional: who posted it. Swap `ref` to match your existing
    // Employee/User model name.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
  },
  { timestamps: true } // gives us createdAt / updatedAt automatically
);
 
// Speeds up the common "active announcements" query on the user portal
// (not expired, newest first).
announcementSchema.index({ expiresAt: 1, createdAt: -1 });
 
const Announcement = mongoose.model("Announcement", announcementSchema);
 
export default Announcement;