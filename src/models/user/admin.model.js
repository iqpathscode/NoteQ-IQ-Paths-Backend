import mongoose from 'mongoose';
import Department from '../office/department.model';

const employeeSchema = new mongoose.Schema({
  admin_id: {
    type: Number, //always a integer number 
    required: true,
    unique: true,
    trim: true
  }, 
  admin_name: {
    type: String,
    required: true,
    trim: true
  },
  designation: {
    type: String,
    required: true,
    trim: true
  },
  mobile_number: {
    type: Number,
    required: true,
    trim: true,
  },
    email: {
    type: String,
    required: true,
    trim: true,
  }
}, {
  timestamps: true
});

const Employee = mongoose.model('Employee', employeeSchema);

export default Employee;

