import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    emp_id: {
      type: Number,
      required: true,
      unique: true,
    },
    emp_name: {
      type: String,
      required: true,
      trim: true,
    },
    designation: {
      type: String,
      required: true,
      trim: true,
    },
    mobile_number: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    // AUTH FIELDS
    password: {
      type: String,
      required: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    last_login: {
      type: Date,
      default: null,
    },
    canReceiveNotesheet: {
      type: Boolean,
      default: false,
    },

    // RELATIONS
    dept_id: {
      type: Number,
      required: true,
    },
    role_id: {
      type: Number,
      required: true,
    },
    assigned_dept_id: {
      type: Number,
    },
  },
  { timestamps: true },
);

// Indexes for fast lookup
employeeSchema.index({ dept_id: 1, role_id: 1 });

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;
