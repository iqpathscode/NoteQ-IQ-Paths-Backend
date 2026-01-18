import mongoose from 'mongoose';
import Department from '../office/department.model';

const employeeSchema = new mongoose.Schema({
  emp_id: {
    type: Number, //always a integer number 
    required: true,
    unique: true,
    trim: true
  }, 
  emp_name: {
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
  },
  dept_id: {  //number
    type : Number,
    required : true,
    trim : true,
    // type: mongoose.Schema.Types.ObjectId,  //_id
    // ref: 'Department',
    // required: true
  },
  role_id: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const Employee = mongoose.model('Employee', employeeSchema);

export default Employee;

