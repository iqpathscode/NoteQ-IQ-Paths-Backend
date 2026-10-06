import mongoose from "mongoose";

const leaveBulkUploadSchema = new mongoose.Schema(
  {
    upload_id: {
      type: String,
      required: true,
      unique: true, // via Counter, e.g. "LBU_001"
    },
    uploaded_by_emp_id: {
      type: Number,
      required: true,
    },
    file_name: {
      type: String,
      required: true,
    },
    total_rows: {
      type: Number,
      default: 0,
    },
    success_count: {
      type: Number,
      default: 0,
    },
    failed_count: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
      default: "PROCESSING",
    },
    error_log: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

leaveBulkUploadSchema.index({ uploaded_by_emp_id: 1, createdAt: -1 });

const LeaveBulkUpload = mongoose.model("LeaveBulkUpload", leaveBulkUploadSchema);
export default LeaveBulkUpload;
