import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema(
  {
    // ================= APPLICATION ID =================
    application_id: {
      type: String,
      required: true,
      unique: true,
    },

    // ================= APPLICANT =================
    emp_id: { type: Number, required: true },
    emp_name: { type: String, required: true },
    dept_id: { type: Number, required: true },

    submitted_by_role_id: { type: Number, default: null },
    submitted_by_role_name: { type: String, default: "Employee" },

    // ================= APPLICATION DETAILS =================
    applicationType: {
      type: String,
      enum: ["Leave Request", "On Duty", "Reimbursement", "Permission", "Other"],
      required: true,
    },

    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },

    // ================= WORKFLOW =================
    mode: {
      type: Number,
      enum: [0, 1],
      default: 1,
    },

    level: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "QUERY_RAISED"],
      default: "PENDING",
      index: true,
    },

    // ================= CURRENT HANDOVER =================
    current_holder_emp_id: { type: Number, default: null, index: true },
    current_holder_emp_name: { type: String, default: "" },

    forward_to_role_id: { type: Number, default: null },
    forward_to_role_name: { type: String, default: "" },
    forward_to_dept_id: { type: Number, default: null },

    // ================= ATTACHMENTS =================
    attachments: [
      {
        url: { type: String },
        publicId: { type: String },
        originalName: { type: String },
      },
    ],

    // ================= AUTHORITY REMARKS =================
    authorityRemarks: { type: String, default: "" },

    // ================= AUDIT =================
    created_by_emp_id: { type: Number, required: true },
    created_by_role_id: { type: Number, default: null },

    received_at: { type: Date, default: Date.now, index: true },

    // ================= SOFT DELETE =================
    is_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: true }
);

applicationSchema.index({ dept_id: 1, status: 1 });
applicationSchema.index({ application_id: 1, level: 1 });

const Application = mongoose.model("Application", applicationSchema);

// Drop old index — runs once on server start
Application.collection.dropIndex("applicationNumber_1").catch(() => {});

export default Application;