import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  dept_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  dept_name: {
    type: String,
    required: true,
    trim: true
  },
  school_id: {
    type: Number,
    required: true,
    trim : true
  }
}, {
  timestamps: true
});

const Department = mongoose.model('Department', departmentSchema);

export default Department;