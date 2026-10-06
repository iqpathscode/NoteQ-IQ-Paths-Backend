import mongoose from "mongoose";

const leaveTemporaryRoleSchema = new mongoose.Schema(
  {
    leave_id: {
      type: String,
      required: true,
      index: true,
    },
    role_id: {
      type: Number,
      required: true,
      index: true,
    },
    role_name: {
      type: String,
      required: true,
    },
    original_emp_id: {
      type: Number,
      required: true,
      index: true,
    },
    original_emp_name: {
      type: String,
      required: true,
    },
    interim_emp_id: {
      type: Number,
      default: null,
      index: true,
    },
    interim_emp_name: {
      type: String,
      default: null,
    },
    interim_designation: {
      type: String,
      default: null,
    },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING_ADMIN_ASSIGNMENT", // Leave approved, waiting for admin to assign interim role
        "SCHEDULED",                // Approved at final level, scheduled to activate on start_date
        "ACTIVE",                   // Currently in effect
        "EXPIRED_AND_RESTORED",    // Leave ended naturally, role charge returned
        "RECLAIMED_EARLY",         // Authority returned early and reclaimed role
        "REVOKED_BY_ADMIN",        // Admin manually revoked charge early
        "CANCELLED",               // Leave was cancelled before starting
      ],
      default: "PENDING_ADMIN_ASSIGNMENT",
      index: true,
    },
    assigned_by_admin_id: {
      type: Number,
      default: null,
    },
    assigned_by_name: {
      type: String,
      default: null,
    },
    assigned_at: {
      type: Date,
      default: null,
    },
    office_order_no: {
      type: String,
      default: null,
      trim: true,
    },
    admin_notes: {
      type: String,
      default: null,
      trim: true,
    },
    reclaimed_at: {
      type: Date,
      default: null,
    },
    reclaimed_by_emp_id: {
      type: Number,
      default: null,
    },
    reclaimed_reason: {
      type: String,
      default: null,
      trim: true,
    },
    revoked_at: {
      type: Date,
      default: null,
    },
    revoked_reason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

leaveTemporaryRoleSchema.index({ role_id: 1, status: 1 });
leaveTemporaryRoleSchema.index({ interim_emp_id: 1, status: 1 });
leaveTemporaryRoleSchema.index({ original_emp_id: 1, status: 1 });
leaveTemporaryRoleSchema.index({ leave_id: 1, status: 1 });

const LeaveTemporaryRole = mongoose.model("LeaveTemporaryRole", leaveTemporaryRoleSchema);
export default LeaveTemporaryRole;
