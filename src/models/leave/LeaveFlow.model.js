import mongoose from "mongoose";

const leaveFlowSchema = new mongoose.Schema(
  {
    leave_id: {
      type: String,
      required: true,
      index: true,
    },

    // ================= FROM =================
    from_emp_id: {
      type: Number,
      required: true,
    },
    from_emp_name: {
      type: String,
    },
    from_role_id: {
      type: Number,
    },
    from_role_name: {
      type: String,
    },

    // ================= TO =================
    to_emp_id: {
      type: Number,
      default: null,
    },
    to_emp_name: {
      type: String,
    },
    to_role_id: {
      type: Number,
    },
    to_role_name: {
      type: String,
    },
    to_dept_id: {
      type: Number,
    },

    // ================= ACTION =================
    action: {
      type: String,
      enum: [
        "CREATED",
        "FORWARDED",
        "APPROVED",
        "REJECTED",
        "QUERY",
        "QUERY_REPLY",
        "CANCELLED",
        "CLOSED",
        "RESUMED_EARLY",
        "DUTY_RESUMED",
      ],
      required: true,
    },

    remark: {
      type: [String],
      trim: true,
      default: [],
    },

    level: {
      type: Number,
      default: 0,
    },

    final_status: {
      type: String,
      enum: [
        "PENDING",
        "QUERY_RAISED",
        "QUERY_REPLIED",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "COMPLETED",
        "DUTY_RESUMED",
      ],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

leaveFlowSchema.index({ leave_id: 1, createdAt: 1 });

const LeaveFlow = mongoose.model("LeaveFlow", leaveFlowSchema);
export default LeaveFlow;
