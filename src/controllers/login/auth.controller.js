import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Employee from '../../models/user/employee.model.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../../config/jwt.js';

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Employee.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      {
        emp_id: user.emp_id,
        role_id: user.role_id,
        dept_id: user.dept_id
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    
    user.last_login = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};