import mongoose from "mongoose";

const leaveRequestSchema = new mongoose.Schema(
  {
    leave_id: {
      type: String,
      required: true,
      unique: true, // Generated via Counter, e.g. "LV_CSE_041"
    },

    emp_id: {
      type: Number,
      required: true,
      index: true,
    },

    dept_id: {
      type: Number,
      required: true,
      index: true,
    },

    leave_type_id: {
      type: Number,
      required: true,
      index: true,
    },

    from_date: {
      type: Date,
      required: true,
    },

    to_date: {
      type: Date,
      required: true,
    },

    duration_type: {
      type: String,
      enum: ["FULL_DAY", "FIRST_HALF", "SECOND_HALF"],
      default: "FULL_DAY",
    },

    no_of_days: {
      type: Number,
      required: true, // Computed server-side excluding weekends & holidays
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    // ================= WORKFLOW STATUS =================
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },

    lifecycle_status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    // ================= CURRENT HANDOVER =================
    current_holder_emp_id: {
      type: Number,
      default: null,
      index: true,
    },

    forward_to_emp_id: {
      type: Number,
      default: null,
    },

    forward_to_role_id: {
      type: Number,
      default: null,
    },

    forward_to_dept_id: {
      type: Number,
      default: null,
    },

    attachments: {
      type: [String],
      default: [],
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

    current_step_index: {
      type: Number,
      default: 0,
    },

    approval_chain: {
      type: [
        {
          step: { type: Number },
          label: { type: String },
          role_id: { type: Number },
          role_name: { type: String },
          emp_id: { type: Number, default: null },
          emp_name: { type: String, default: null },
          status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED", "UPCOMING", "CANCELLED"],
            default: "UPCOMING",
          },
          action_date: { type: Date, default: null },
          remark: { type: String, default: null },
        },
      ],
      default: [],
    },

    handover: {
      assigned_to_emp_id: { type: Number, default: null },
      assigned_to_emp_name: { type: String, default: null },
      assigned_to_email: { type: String, default: null },
      classes_count: { type: Number, default: 0 },
      notes: { type: String, default: null },
    },

    delegation: {
      delegate_emp_id: { type: Number, default: null, index: true },
      delegate_emp_name: { type: String, default: null },
      delegate_email: { type: String, default: null },
      role_id: { type: Number, default: null },
      role_name: { type: String, default: null },
      instructions: { type: String, default: null },
      status: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED"],
        default: "PENDING",
      },
      approved_at: { type: Date, default: null },
      approved_by_name: { type: String, default: null },
      approved_by_emp_id: { type: Number, default: null },
    },

    created_by_emp_id: {
      type: Number,
      required: true,
    },

    created_by_name: {
      type: String,
      default: null,
    },

    created_by_role_id: {
      type: Number,
      default: null,
    },

    is_hr_entry: {
      type: Boolean,
      default: false,
      index: true,
    },

    received_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    is_deleted: {
      type: Boolean,
      default: false,
    },

    // ================= EARLY DUTY RESUMPTION & HR PAYROLL =================
    is_early_resumed: {
      type: Boolean,
      default: false,
      index: true,
    },
    resumed_duty_date: {
      type: Date,
      default: null,
    },
    original_no_of_days: {
      type: Number,
      default: null,
    },
    actual_days_used: {
      type: Number,
      default: null,
    },
    refunded_days: {
      type: Number,
      default: 0,
    },
    early_resume_reason: {
      type: String,
      default: null,
      trim: true,
    },
    hr_payroll_status: {
      type: String,
      enum: ["NOT_APPLICABLE", "PENDING_HR_VERIFICATION", "RECONCILED"],
      default: "NOT_APPLICABLE",
      index: true,
    },
    hr_reconciled_by_emp_id: {
      type: Number,
      default: null,
    },
    hr_reconciled_by_name: {
      type: String,
      default: null,
    },
    hr_reconciled_at: {
      type: Date,
      default: null,
    },
    hr_payroll_remarks: {
      type: String,
      default: null,
      trim: true,
    },

    deleted_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes matching existing notesheet schema patterns
leaveRequestSchema.index({ dept_id: 1, status: 1 });
leaveRequestSchema.index({ leave_id: 1, level: 1 });
leaveRequestSchema.index({ emp_id: 1, createdAt: -1 });
leaveRequestSchema.index({ current_holder_emp_id: 1, status: 1 });

const LeaveRequest = mongoose.model("LeaveRequest", leaveRequestSchema);
export default LeaveRequest;
