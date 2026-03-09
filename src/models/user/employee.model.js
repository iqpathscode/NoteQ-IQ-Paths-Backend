import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    emp_id: { type: Number, required: true, unique: true },
    emp_name: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    mobile_number: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    is_active: { type: Boolean, default: true },
    last_login: { type: Date, default: null },
    canReceiveNotesheet: { type: Boolean, default: false },

    dept_id: { type: Number, required: true },

    roles: [
      {
        role_id: { type: Number, required: true },
        role_name: { type: String, required: true },
        _id: false
      }
    ],

    active_role: {
      role_id: { type: Number, default: null },
      role_name: { type: String, default: null },
    },

    assigned_dept_id: { type: Number },
  },
  { timestamps: true }
);

employeeSchema.index({ dept_id: 1, "roles.role_id": 1 });

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;