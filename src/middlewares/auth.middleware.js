import crypto from "crypto";
import { env } from "../config/env.config.js";
import Employee from "../models/user/employee.model.js";
import Admin from "../models/user/admin.model.js";
import AppConfig from "../models/counter/AppConfig.js";
import LeaveTemporaryRole from "../models/leave/LeaveTemporaryRole.model.js";
import {
  extractToken,
  clearAuthCookie,
  verifyAuthToken,
  isTokenBlacklisted,
} from "../utility/authToken.utils.js";

const syncEmployeeTemporaryRoles = async (employee) => {
  const roleIdsSet = new Set((employee.role_ids || []).map(Number));
  const tempRoleIdsSet = new Set((employee.temporary_role_ids || []).map(Number));
  let effectiveActiveRoleId = employee.active_role_id;

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
    roleIdsSet.add(Number(sch.role_id));
    tempRoleIdsSet.add(Number(sch.role_id));
  }

  const expiredActive = await LeaveTemporaryRole.find({
    interim_emp_id: employee.emp_id,
    status: "ACTIVE",
    end_date: { $lt: now },
  });

  for (const exp of expiredActive) {
    exp.status = "EXPIRED_AND_RESTORED";
    await exp.save();

    const expiredRoleId = Number(exp.role_id);
    const isActiveExpired = Number(effectiveActiveRoleId) === expiredRoleId;
    await Employee.updateOne(
      { emp_id: employee.emp_id },
      {
        $pull: { role_ids: exp.role_id, temporary_role_ids: exp.role_id },
        ...(isActiveExpired ? { $set: { active_role_id: null, active_role: null } } : {}),
      }
    );

    roleIdsSet.delete(expiredRoleId);
    tempRoleIdsSet.delete(expiredRoleId);
    if (isActiveExpired) {
      effectiveActiveRoleId = null;
    }

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

  for (const tempRole of activeTempRoles) {
    const roleId = Number(tempRole.role_id);
    tempRoleIdsSet.add(roleId);
    roleIdsSet.add(roleId);
  }

  return {
    temporaryRoleIds: Array.from(tempRoleIdsSet),
    effectiveRoleIds: Array.from(roleIdsSet),
    effectiveActiveRoleId,
  };
};

const authenticateAdmin = async (decoded, req, res, next) => {
  if (!decoded.admin_id) {
    clearAuthCookie(res, req);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  const admin = await Admin.findOne({ admin_id: decoded.admin_id })
    .select("-password -resetToken -resetTokenExpiry")
    .lean();

  if (!admin) {
    clearAuthCookie(res, req);
    return res.status(401).json({
      success: false,
      message: "Admin not found",
    });
  }

  if (!admin.is_active) {
    clearAuthCookie(res, req);
    return res.status(403).json({
      success: false,
      message: "Admin account is inactive",
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
};

const authenticateEmployee = async (decoded, req, res, next) => {
  if (!decoded.emp_id) {
    clearAuthCookie(res, req);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  const employee = await Employee.findOne({ emp_id: decoded.emp_id })
    .select("-password -resetToken -resetTokenExpiry")
    .lean();

  if (!employee) {
    clearAuthCookie(res, req);
    return res.status(401).json({
      success: false,
      message: "Employee not found",
    });
  }

  if (!employee.is_active) {
    clearAuthCookie(res, req);
    return res.status(403).json({
      success: false,
      message: "Account is inactive",
    });
  }

  const { temporaryRoleIds, effectiveRoleIds, effectiveActiveRoleId } =
    await syncEmployeeTemporaryRoles(employee);

  req.user = {
    emp_id: employee.emp_id,
    email: employee.email,
    dept_id: employee.dept_id,
    role_ids: effectiveRoleIds,
    active_role_id: effectiveActiveRoleId,
    temporary_role_ids: temporaryRoleIds,
    isAdmin: false,
  };

  return next();
};

// ================= AUTHENTICATE =================
export const authenticate = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Token required",
    });
  }

  if (!env.JWT_SECRET) {
    console.error("[Auth] JWT_SECRET is not configured");
    return res.status(500).json({
      success: false,
      message: "Authentication configuration error",
    });
  }

  let decoded;
  try {
    decoded = verifyAuthToken(token);
  } catch (error) {
    clearAuthCookie(res, req);
    const message =
      error?.name === "TokenExpiredError"
        ? "Session expired. Please login again."
        : "Invalid or expired token";
    return res.status(401).json({
      success: false,
      message,
    });
  }

  // Reject logged-out tokens without clearing valid sessions if Redis is unreachable
  try {
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      clearAuthCookie(res, req);
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
      });
    }
  } catch (error) {
    console.error("[Auth] Redis blacklist check failed:", error.message);
    return res.status(503).json({
      success: false,
      message: "Authentication service temporarily unavailable",
    });
  }

  try {
    if (decoded.isAdmin) {
      return await authenticateAdmin(decoded, req, res, next);
    }
    return await authenticateEmployee(decoded, req, res, next);
  } catch (error) {
    console.error("[Auth] Middleware DB error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
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

  if (typeof secretKey !== "string" || !secretKey) {
    return res.status(401).json({
      success: false,
      message: "Admin secret key required",
    });
  }

  if (!env.ADMIN_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "Admin secret key not configured",
    });
  }

  const provided = Buffer.from(secretKey, "utf8");
  const expected = Buffer.from(env.ADMIN_SECRET_KEY, "utf8");

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(403).json({
      success: false,
      message: "Invalid admin secret key",
    });
  }

  next();
};
