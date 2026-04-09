import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import Employee from "../models/user/employee.model.js";
import Admin from "../models/user/admin.model.js";

// ================= AUTHENTICATE =================
export const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token required",
      });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    // ================= ADMIN =================
    if (decoded.isAdmin) {
      const admin = await Admin.findOne({ admin_id: decoded.admin_id });

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      req.user = {
        admin_id: admin.admin_id,
        isAdmin: true,
      };

      return next();
    }

    // ================= EMPLOYEE =================
    const employee = await Employee.findOne({
      emp_id: decoded.emp_id,
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    req.user = {
      emp_id: employee.emp_id,
      dept_id: employee.dept_id,
      active_role_id: employee.active_role_id,
      isAdmin: false,
    };

    next();
  } catch (error) {
    console.error("verify error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// ================= ADMIN CHECK =================
export const isAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admins only.",
    });
  }
  next();
};