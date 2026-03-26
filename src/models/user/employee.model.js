import mongoose from "mongoose";

//  Role subdocument schema (mirror of Role model fields)
const RoleSubSchema = new mongoose.Schema({
  role_id: { type: Number, required: true },
  role_name: { type: String, required: true },
  dept_id: { type: Number },
  power_level: { type: Number },
  power_id: { type: Number },
  canReceiveNotesheet: { type: Boolean, default: false }
}, { _id: false });

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

    dept_id: { type: Number, required: true },

    // roles array with full schema
    roles: [RoleSubSchema],

    // active_role with full schema
    active_role: RoleSubSchema,

    assigned_dept_id: { type: Number },
  },
  { timestamps: true }
);

employeeSchema.index({ dept_id: 1, "roles.role_id": 1 });

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;
