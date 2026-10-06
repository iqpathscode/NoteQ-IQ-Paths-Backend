import mongoose from "mongoose";

const downloadLogSchema = new mongoose.Schema(
  {
    document_type: {
      type: String,
      enum: ["NOTESHEET", "APPLICATION", "LEAVE"],
      required: true,
      index: true,
    },
    document_id: {
      type: String, // note_id (e.g. NS-2026-001) or application_id (e.g. APP-1001)
      required: true,
      index: true,
    },
    document_identifier: {
      type: String,
      trim: true,
      default: "",
    },
    downloaded_by: {
      type: Number, // emp_id
      required: true,
      index: true,
    },
    downloaded_by_name: {
      type: String,
      default: "",
    },
    role_id: {
      type: Number,
      default: null,
      index: true,
    },
    role_name: {
      type: String,
      default: "",
    },
    department_id: {
      type: Number,
      default: null,
      index: true,
    },
    department_name: {
      type: String,
      default: "",
    },
    downloaded_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound indexes for fast aggregations and reporting
downloadLogSchema.index({ document_type: 1, downloaded_at: -1 });
downloadLogSchema.index({ department_id: 1, downloaded_at: -1 });
downloadLogSchema.index({ downloaded_by: 1, downloaded_at: -1 });
downloadLogSchema.index({ document_id: 1, downloaded_at: -1 });

const DownloadLog = mongoose.model("DownloadLog", downloadLogSchema);
export default DownloadLog;
