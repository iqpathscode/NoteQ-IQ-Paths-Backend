import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import Employee from "../models/user/employee.model.js";
import Admin from "../models/user/admin.model.js";
import AppConfig from "../models/counter/AppConfig.js";
import redis from "../config/redis.config.js";

import LeaveTemporaryRole from "../models/leave/LeaveTemporaryRole.model.js";

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

    // ✅ Blacklist check — logout hua token toh reject karo
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
      });
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
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

      const isSuper =
        !!admin.is_super_admin ||
        (process.env.SUPER_ADMIN_EMAIL &&
          admin.email?.toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase());

      req.user = {
        admin_id: admin.admin_id,
        email: admin.email,
        isAdmin: true,
        is_super_admin: isSuper,
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

    // Sync scheduled roles due to activate & active roles due to expire for this employee
    const now = new Date();
    const dueScheduled = await LeaveTemporaryRole.find({
      interim_emp_id: employee.emp_id,
      status: "SCHEDULED",
      start_date: { $lte: now },
      end_date: { $gte: now },
    });
    for (const sch of dueScheduled) {
      sch.status = "ACTIVE";
      await sch.save();
      await Employee.updateOne(
        { emp_id: employee.emp_id },
        { $addToSet: { role_ids: sch.role_id, temporary_role_ids: sch.role_id } }
      );
    }

    const expiredActive = await LeaveTemporaryRole.find({
      interim_emp_id: employee.emp_id,
      status: "ACTIVE",
      end_date: { $lt: now },
    });
    for (const exp of expiredActive) {
      exp.status = "EXPIRED_AND_RESTORED";
      await exp.save();
      await Employee.updateOne(
        { emp_id: employee.emp_id },
        { $pull: { role_ids: exp.role_id, temporary_role_ids: exp.role_id } }
      );
      if (exp.original_emp_id) {
        await Employee.updateOne(
          { emp_id: exp.original_emp_id },
          { $addToSet: { role_ids: exp.role_id } }
        );
      }
    }

    const activeTempRoles = await LeaveTemporaryRole.find({
      interim_emp_id: employee.emp_id,
      status: "ACTIVE",
    }).lean();
    const temporaryRoleIds = Array.from(new Set([
      ...(employee.temporary_role_ids || []).map(Number),
      ...activeTempRoles.map((t) => Number(t.role_id)),
    ]));
    const effectiveRoleIds = Array.from(new Set([
      ...(employee.role_ids || []).map(Number),
      ...temporaryRoleIds,
    ]));

    req.user = {
      emp_id: employee.emp_id,
      dept_id: employee.dept_id,
      role_ids: effectiveRoleIds,
      active_role_id: employee.active_role_id,
      temporary_role_ids: temporaryRoleIds,
      isAdmin: false,
    };

    next();
    // auth.middleware.js — existing catch block mein cookie bhi clear karo
  } catch (error) {
    console.error("verify error:", error.message);

    // ✅ Stale/expired token cookie bhi clear karo
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

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

// ================= SUPER ADMIN CHECK =================
export const isSuperAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin || !req.user.is_super_admin) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Super Admin privileges required.",
    });
  }
  next();
};

// ================= MODULE REQUIREMENT CHECK =================
export const requireModule = (moduleName) => async (req, res, next) => {
  try {
    const config = await AppConfig.findOne({ key: "app_config" }).lean();
    const modules = config?.modules || { notesheet: true, application: true, leave: true };
    const key = moduleName.toLowerCase();
    if (modules[key] === false) {
      return res.status(403).json({
        success: false,
        message: `The ${moduleName} module is disabled for this installation.`,
      });
    }
    next();
  } catch (err) {
    console.error("requireModule check error:", err);
    next();
  }
};

export const requireAnyModule = (moduleNames = []) => async (req, res, next) => {
  try {
    const config = await AppConfig.findOne({ key: "app_config" }).lean();
    const modules = config?.modules || { notesheet: true, application: true, leave: true };
    const hasAny = moduleNames.some((m) => modules[m.toLowerCase()] !== false);
    if (!hasAny) {
      return res.status(403).json({
        success: false,
        message: `This feature requires one of the following modules: ${moduleNames.join(", ")}.`,
      });
    }
    next();
  } catch (err) {
    console.error("requireAnyModule check error:", err);
    next();
  }
};

// ================= TEMPORARY ROLE RESTRICTION =================
export const ensureNotTemporaryRole = (moduleName = "Notesheet") => (req, res, next) => {
  if (req.user?.isAdmin) return next();
  const currentRoleId = Number(req.user?.active_role_id);
  if (currentRoleId && req.user?.temporary_role_ids?.includes(currentRoleId)) {
    return res.status(403).json({
      success: false,
      message: `Access denied: This temporary officiating role is restricted to the Leave Portal only. ${moduleName} operations are disabled.`,
    });
  }
  next();
};

export const verifyAdminSecret = (req, res, next) => {
  const secretKey = req.headers["x-admin-secret"];

  if (!secretKey) {
    return res.status(401).json({
      success: false,
      message: "Admin secret key required",
    });
  }

  if (secretKey !== env.ADMIN_SECRET_KEY) {
    return res.status(403).json({
      success: false,
      message: "Invalid admin secret key",
    });
  }

  next();
};
