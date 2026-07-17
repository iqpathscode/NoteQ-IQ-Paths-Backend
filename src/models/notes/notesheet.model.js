import mongoose from "mongoose";

const notesheetSchema = new mongoose.Schema(
  {
    note_id: {
      type: String,
      required: true,
      unique: true,
    },

    emp_id: {
      type: Number,
      required: true,
    },

    dept_id: {
      type: Number,
      required: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    // ================= WORKFLOW STATUS (UPGRADED) =================
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "IN_EXECUTION", "CLOSED"],
      default: "PENDING",
      index: true,
    },

    // ================= CURRENT HANDOVER =================
    current_holder_emp_id: {
      type: Number,
      default: null,
      index: true,
    },

    forward_to_emp_id: { type: Number, default: null },
    forward_to_role_id: { type: Number, default: null },
    forward_to_dept_id: { type: Number, default: null },

    // ================= ATTACHMENTS =================
    attachments: {
      type: [String],
      default: [],
    },

    reference_notesheet_id: {
      type: String,
      default: null,
    },
    mode: {
      type: Number,
      enum: [0, 1], // 0 = chain, 1 = direct
      default: 1,
    },

    level: {
      type: Number,
      default: 0,
    },

    category: {
      type: String,
      required: true,
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      index: true,
    },

    // ================= AUDIT =================
    created_by_emp_id: {
      type: Number,
      required: true,
    },

    created_by_role_id: {
      type: Number,
    },

    updated_by: {
      type: Number,
    },
    received_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // ================= UI HELPER (OPEN / CLOSE LOGIC) =================
    lifecycle_status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    is_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// Indexes
notesheetSchema.index({ dept_id: 1, status: 1 });
notesheetSchema.index({ note_id: 1, level: 1 });

const Notesheet = mongoose.model("Notesheet", notesheetSchema);
export default Notesheet;
