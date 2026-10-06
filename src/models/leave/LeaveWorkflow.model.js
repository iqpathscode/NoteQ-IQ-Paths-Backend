import mongoose from "mongoose";

const leaveWorkflowStepSchema = new mongoose.Schema(
  {
    step_number: { type: Number, required: true },
    step_label: { type: String, default: "Approval Authority" },
    role_id: { type: Number, required: true }, // References existing Role.role_id
    specific_emp_id: { type: Number, default: null },
    is_final_step: { type: Boolean, default: false },
  },
  { _id: false }
);

const leaveWorkflowSchema = new mongoose.Schema(
  {
    workflow_id: { type: String, required: true, unique: true, index: true },
    workflow_name: { type: String, required: true },
    applies_to_type: {
      type: String,
      enum: ["ALL_FACULTY", "SPECIFIC_ROLE", "DEPARTMENT", "GLOBAL"],
      default: "ALL_FACULTY",
    },
    target_role_id: { type: Number, default: null }, // References existing Role.role_id (e.g. HOD or HR)
    dept_id: { type: Number, default: null },
    steps: [leaveWorkflowStepSchema],
    is_default: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.LeaveWorkflow || mongoose.model("LeaveWorkflow", leaveWorkflowSchema);
