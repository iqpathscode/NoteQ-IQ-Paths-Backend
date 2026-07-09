import mongoose from "mongoose";

const applicationFlowSchema = new mongoose.Schema(
  {
    // ================= APPLICATION REFERENCE =================
    application_id: {
      type: String,
      required: true,
      index: true,
    },

    // ================= FROM =================
    from_emp_id: { type: Number, required: true },
    from_emp_name: { type: String, default: "" },
    from_role_id: { type: Number, default: null },
    from_role_name: { type: String, default: "" },

    // ================= TO =================
    to_emp_id: { type: Number, default: null },
    to_emp_name: { type: String, default: "" },
    to_role_id: { type: Number, default: null },
    to_role_name: { type: String, default: "" },
    to_dept_id: { type: Number, default: null },

    // ================= ACTION =================
    action: {
      type: String,
       enum: [
        'CREATED',
        'FORWARDED',
        'APPROVED',
        'REJECTED',
        'QUERY',
        'QUERY_REPLY',
        'EXECUTION_STARTED',
        'CLOSED'
      ],
      required: true,
    },

    remark: {
      type: String,
      default: "",
    },

    level: {
      type: Number,
      default: 0,
    },

    final_status: {
  type: String,
  enum: [
    'PENDING',
    'QUERY_RAISED',
    'QUERY_REPLIED', // 👈 add kiya
    'RESOLVED',
    'APPROVED',
    'REJECTED',
    'COMPLETED'
  ],
  default: "PENDING",
},
  },
  { timestamps: true }
);

const ApplicationFlow = mongoose.model("ApplicationFlow", applicationFlowSchema);
export default ApplicationFlow;
