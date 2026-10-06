import mongoose from "mongoose";

const leaveBalanceSchema = new mongoose.Schema(
  {
    emp_id: {
      type: Number,
      required: true,
      index: true,
    },
    role_id: {
      type: Number,
      default: null, // null means Employee-Wide (Base Profile); positive integer means Role-Specific balance
      index: true,
    },
    leave_type_id: {
      type: Number,
      required: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },
    allocated_days: {
      type: Number,
      required: true,
      default: 0,
    },
    used_days: {
      type: Number,
      default: 0,
    },
    carried_forward_days: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// One balance row per employee per role (or base null) per leave type per year
leaveBalanceSchema.index(
  { emp_id: 1, role_id: 1, leave_type_id: 1, year: 1 },
  { unique: true }
);

const LeaveBalance = mongoose.model("LeaveBalance", leaveBalanceSchema);
export default LeaveBalance;
