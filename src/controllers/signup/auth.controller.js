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

    //  Default password set by admin
    const defaultPassword = "iqpaths@123";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

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
      message: 'User created successfully with default password',
      data: {
        emp_id: employee.emp_id,
        email: employee.email,
        defaultPassword // optional: show admin what password was set
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
