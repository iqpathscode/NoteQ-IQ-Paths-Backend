import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user_id: {
      type: Number,
      required: true,
      index: true,
    },

    role_id: {
      type: Number,
      required: true,
    },

    role: {
      type: String,
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

    type: {
      type: String,
      enum: [
        "CREATED",
        "FORWARDED",
        "APPROVED",
        "REJECTED",
        "QUERY",
        "QUERY_REPLY",
        "EXECUTION_STARTED",
        "CLOSED",
      ],
      required: true,
      index: true,
    },

    notesheet_id: {
      type: String,
      required: true,
      index: true,
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);
export const Notification = mongoose.model("Notification", notificationSchema);