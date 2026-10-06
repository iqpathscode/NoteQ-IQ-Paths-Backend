import mongoose from "mongoose";

const leaveTypeSchema = new mongoose.Schema(
  {
    leave_type_id: {
      type: Number,
      required: true,
      unique: true,
    },
    code: {
      type: String, // e.g. "CL", "SL", "EL", "OL"
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true, // "Casual Leave", "Sick Leave", "Earned Leave", "Optional Leave"
    },
    annual_quota: {
      type: Number,
      required: true,
      default: 0,
    },
    carry_forward_allowed: {
      type: Boolean,
      default: false,
    },
    max_carry_forward_days: {
      type: Number,
      default: 0,
    },
    allows_half_day: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

leaveTypeSchema.index({ name: 1 });

const LeaveType = mongoose.model("LeaveType", leaveTypeSchema);
export default LeaveType;
