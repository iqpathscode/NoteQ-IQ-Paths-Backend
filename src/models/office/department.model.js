import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    dept_id: {
      type: Number,
      required: true,
      unique: true
    },
    dept_name: {
      type: String,
      required: true,
      trim: true
    },
    school_id: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate department in same school
departmentSchema.index(
  { dept_name: 1, school_id: 1 },
  { unique: true }
);

// Important index
departmentSchema.index({ school_id: 1 });

const Department = mongoose.model('Department', departmentSchema);
export default Department;