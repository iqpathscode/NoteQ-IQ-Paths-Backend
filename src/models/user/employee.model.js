import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    emp_id: { type: Number, required: true, unique: true },

    emp_name: { type: String, required: true, trim: true },

    designation: { type: String, required: true, trim: true },

    mobile_number: { type: String, required: true, unique: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    password: { type: String, required: true },

    is_active: { type: Boolean, default: true },

    last_login: { type: Date, default: null },

    //  Main department
    dept_id: { type: Number, required: true },

    //  School reference (important for filtering)
    school_id: { type: Number, required: true },

    //  Multiple roles support
    role_ids: {
      type: [Number],
      default: [],
    },

    //  Active role
    active_role_id: {
      type: Number,
      default: null,
    },
    resetToken: {
      type: String,
      default: null,
    },

    resetTokenExpiry: {
      type: Date,
      default: null,
    },

    // optional (if needed)
    assigned_dept_id: { type: Number },
  },
  { timestamps: true },
);

// Indexes
employeeSchema.index({ dept_id: 1 });
employeeSchema.index({ role_ids: 1 });
employeeSchema.index({ active_role_id: 1 });

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;
