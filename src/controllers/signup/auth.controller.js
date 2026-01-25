import Employee from '../../models/user/employee.model.js';
import bcrypt from 'bcryptjs';

export const signup = async (req, res) => {
  try {
    const {
      emp_id,
      emp_name,
      designation,
      mobile_number,
      email,
      password,
      dept_id,
      role_id
    } = req.body;

    // check existing user
    const existingUser = await Employee.findOne({
      $or: [{ email }, { mobile_number }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const employee = await Employee.create({
      emp_id,
      emp_name,
      designation,
      mobile_number,
      email,
      password: hashedPassword,
      dept_id,
      role_id
    });

    res.status(201).json({
      success: true,
      message: 'Signup successful',
      data: {
        emp_id: employee.emp_id,
        email: employee.email
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Signup failed',
      error: error.message
    });
  }
};
