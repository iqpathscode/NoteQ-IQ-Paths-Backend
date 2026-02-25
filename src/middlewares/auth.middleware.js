// src/middlewares/auth.middleware.js
import jwt from 'jsonwebtoken';
import { env } from '../config/env.config.js';

// Authenticate user from cookie
export const authenticate = (req, res, next) => {
  try {
    const token = req.cookies.token;   // cookie se token uthao

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;     // decoded payload (emp_id, role_id, dept_id, isAdmin)
    next();
  } catch (error) {
    console.error(" verify error:", error.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Check if user is Admin
export const isAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admins only.'
    });
  }
  next();
};

// Role-based access check
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role_id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    next();
  };
};
