import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    role_id: {
      type: Number,
      required: true,
      unique: true
    },
    role_name: {
      type: String,
      required: true,
      trim: true
    },
    power_level: {
      type: Number,
      required: true,
      default: 0
    },
    dept_id: {
      type: Number,
      default: null
    },
    power_id: {
      type: Number,
      required:true
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate role names in same department 
roleSchema.index({ role_name: 1, dept_id: 1 }, { unique: true }); 

// Fast lookup for approvers 
roleSchema.index({ dept_id: 1, power_id: 1 });

const Role = mongoose.model('Role', roleSchema);
export default Role;
