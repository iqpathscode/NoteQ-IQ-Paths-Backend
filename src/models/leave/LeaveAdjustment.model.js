import mongoose from "mongoose";

const leaveAdjustmentSchema = new mongoose.Schema(
  {
    emp_id: {
      type: Number,
      required: true,
      index: true,
    },
    role_id: {
      type: Number,
      default: null, // null for EMPLOYEE_WIDE, or specific role_id for ROLE_BASED
      index: true,
    },
    role_name: {
      type: String,
      default: null,
    },
    scope: {
      type: String,
      enum: ["EMPLOYEE_WIDE", "ROLE_BASED"],
      default: "EMPLOYEE_WIDE",
    },
    leave_type_id: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
      default: () => new Date().getFullYear(),
    },
    target_field: {
      type: String,
      enum: ["USED_DAYS", "ALLOCATED_DAYS"],
      default: "USED_DAYS",
    },
    adjustment_type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },
    days: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    adjusted_by_emp_id: {
      type: Number,
      required: true,
    },
    adjusted_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

leaveAdjustmentSchema.index({ emp_id: 1, adjusted_at: -1 });
leaveAdjustmentSchema.index({ emp_id: 1, role_id: 1, adjusted_at: -1 });

const LeaveAdjustment = mongoose.model("LeaveAdjustment", leaveAdjustmentSchema);
export default LeaveAdjustment;
