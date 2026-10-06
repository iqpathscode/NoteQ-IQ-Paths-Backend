import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Employee from "../../models/user/employee.model.js";
import { env } from "../../config/env.config.js";
import { generateEmpId } from "../../utility/generateEmpId.js";
import Admin from "../../models/user/admin.model.js";
import Power from "../../models/userPowers/power.model.js";
import Department from "../../models/office/department.model.js";
import Role from "../../models/userPowers/role.model.js";
import LeaveTemporaryRole from "../../models/leave/LeaveTemporaryRole.model.js";
import crypto from "crypto";
import redis from "../../config/redis.config.js";
import AppConfig from "../../models/counter/AppConfig.js";

// ── Brevo sendMail utility (sgMail ki jagah) ─────────────────────────────────
import { sendMail } from "../../utility/sendMail.js"; 

export const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: "Valid email and password are required" });
    }

    const admin = await Admin.findOne({ email });
    if (admin) {
      if (!admin.is_active) {
        return res.status(403).json({ success: false, message: "Admin account is inactive" });
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      const isSuper =
        !!admin.is_super_admin ||
        (process.env.SUPER_ADMIN_EMAIL &&
          admin.email?.toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase());

      const token = jwt.sign(
        { admin_id: admin.admin_id, isAdmin: true, is_super_admin: isSuper },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN },
      );

      admin.last_login = new Date();
      await admin.save();

      const isProduction = process.env.NODE_ENV === "production";
      res.cookie("token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
      });

      const appConfig = await AppConfig.findOne({ key: "app_config" }).lean();
      const modules = appConfig?.modules || { notesheet: true, application: true, leave: true };

      return res.status(200).json({
        success: true,
        message: "Admin login successful",
        isAdmin: true,
        is_super_admin: isSuper,
        canReceiveNotesheet: true,
        modules,
      });
    }

    const user = await Employee.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account is inactive" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        emp_id: user.emp_id,
        role_id: user.active_role?.role_id || 0,
        dept_id: user.dept_id || 0,
        isAdmin: false,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN },
    );

    user.last_login = new Date();
    await user.save();

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });

    const isDefaultPassword = await bcrypt.compare("iqpaths@123", user.password);

    const rolePower = await Power.findOne({ power_id: user.active_role?.power_id });

    const appConfig = await AppConfig.findOne({ key: "app_config" }).lean();
    const modules = appConfig?.modules || { notesheet: true, application: true, leave: true };

    return res.status(200).json({
      success: true,
      message: "User login successful",
      role_id: user.active_role?.role_id,
      dept_id: user.dept_id,
      isAdmin: false,
      isDefaultPassword,
      canReceiveNotesheet: user.active_role?.canReceiveNotesheet || false,
      canReceiveLeaveRequest: user.active_role?.canReceiveLeaveRequest || false,
      modules,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Login failed", error: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await Employee.findOne({ emp_id: req.user.emp_id });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Old password is incorrect" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Minimum 8 characters required" });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Use uppercase, lowercase, number & special character",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.isDefaultPassword = false;
    await user.save();

    res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Password change failed", error: error.message });
  }
};

export const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (req.user.isAdmin) {
      const admin = await Admin.findOne({ admin_id: req.user.admin_id });
      if (!admin) {
        return res.status(404).json({ success: false, message: "Admin not found" });
      }
      const isSuper =
        !!admin.is_super_admin ||
        (process.env.SUPER_ADMIN_EMAIL &&
          admin.email?.toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase());
      const appConfig = await AppConfig.findOne({ key: "app_config" }).lean();
      const modules = appConfig?.modules || { notesheet: true, application: true, leave: true };

      return res.json({
        success: true,
        user: {
          admin_id: admin.admin_id,
          username: admin.admin_name || admin.username,
          email: admin.email,
          isAdmin: true,
          is_super_admin: isSuper,
          roles: [],
          active_role: null,
          canReceiveNotesheet: false,
        },
        modules,
      });
    }

    const employee = await Employee.findOne({ emp_id: req.user.emp_id });
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const roles = await Role.find({ role_id: { $in: employee.role_ids || [] } }).lean();
    const powers = await Power.find({ power_id: { $in: roles.map((r) => r.power_id) } }).lean();

    // Detect active temporary roles assigned to this employee (for Leave Portal only)
    const activeTempRoles = await LeaveTemporaryRole.find({
      interim_emp_id: employee.emp_id,
      status: "ACTIVE",
    }).lean();
    const tempRoleIds = new Set([
      ...(employee.temporary_role_ids || []).map(Number),
      ...activeTempRoles.map((t) => Number(t.role_id)),
    ]);
    const tempRoleMap = Object.fromEntries(activeTempRoles.map((t) => [Number(t.role_id), t]));

    const rolesWithPower = roles.map((role) => {
      const power = powers.find((p) => p.power_id === role.power_id);
      const isTemp = tempRoleIds.has(Number(role.role_id));
      const tempAssignment = tempRoleMap[Number(role.role_id)];

      return {
        ...role,
        power_level: power?.power_level || 1,
        power_type:  power?.power_type  || null,
        is_temporary: isTemp,
        leave_only: isTemp,
        // Temporary role charge has NO notesheet/application powers; ONLY leave approvals!
        canReceiveNotesheet: isTemp ? false : (role.canReceiveNotesheet || false),
        canReceiveLeaveRequest: isTemp ? true : (role.canReceiveLeaveRequest || false),
        temporary_details: tempAssignment ? {
          leave_id: tempAssignment.leave_id,
          original_emp_name: tempAssignment.original_emp_name,
          start_date: tempAssignment.start_date,
          end_date: tempAssignment.end_date,
        } : null,
      };
    });

    let activeRole = rolesWithPower.find((r) => r.role_id === employee.active_role_id);
    if (!activeRole && rolesWithPower.length > 0) {
      activeRole = rolesWithPower[0];
      Employee.updateOne({ emp_id: employee.emp_id }, { active_role_id: activeRole.role_id }).catch(() => {});
    }

    const appConfig = await AppConfig.findOne({ key: "app_config" }).lean();
    const modules = appConfig?.modules || { notesheet: true, application: true, leave: true };

    return res.json({
      success: true,
      user: {
        emp_id:             employee.emp_id,
        emp_name:           employee.emp_name,
        dept_id:            employee.dept_id,
        isAdmin:            false,
        isDefaultPassword:  employee.isDefaultPassword ?? true,
        role_ids:           employee.role_ids,
        temporary_role_ids: Array.from(tempRoleIds),
        roles:              rolesWithPower,
        active_role:        activeRole || null,
        canReceiveNotesheet: activeRole?.is_temporary ? false : (activeRole?.canReceiveNotesheet || false),
        canReceiveLeaveRequest: activeRole?.is_temporary ? true : (activeRole?.canReceiveLeaveRequest || false),
      },
      modules,
    });
  } catch (error) {
    console.error("Error in getMe:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (token) {
      const decoded = jwt.decode(token);
      const expirySeconds = decoded.exp - Math.floor(Date.now() / 1000);
      if (expirySeconds > 0) {
        await redis.setex(`blacklist:${token}`, expirySeconds, "true");
      }
    }

    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    });

    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ message: "Valid email is required" });
  }

  let user = await Employee.findOne({ email });
  let userType = "employee";

  if (!user) {
    user = await Admin.findOne({ email });
    userType = "admin";
  }

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

  user.resetToken = hashedToken;
  user.resetTokenExpiry = Date.now() + 3600000;
  await user.save();

  const resetURL = `${env.FRONTEND_URL}/reset-password/${resetToken}?type=${userType}`;

  try {
    // ── Brevo se email bhejo ──────────────────────────────────────────────────
    await sendMail({
      to:      user.email,
      name:    user.emp_name || user.admin_name || "User",
      subject: "Reset Your Password - IQ Paths",
      html: `
  <div style="font-family: Arial, sans-serif; background-color: #f4f6f8; padding: 20px;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 10px;">

      <h2 style="color: #2563eb; text-align: center;">
        Password Reset Request
      </h2>

      <p style="font-size: 14px; color: #333;">
        Hello <strong>${user.emp_name || user.admin_name || "User"}</strong>,
      </p>

      <p style="font-size: 14px; color: #555;">
        We received a request to reset your password for your <strong>NoteQ</strong> account.
      </p>

      <p style="font-size: 14px; color: #555;">
        Click the button below to reset your password:
      </p>

      <div style="text-align: center; margin: 25px 0;">
        <a href="${resetURL}" 
           style="background-color: #2563eb; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Reset Password
        </a>
      </div>

      <p style="font-size: 13px; color: #777;">
        This link will expire in <strong>1 hour</strong>.
      </p>

      <p style="font-size: 13px; color: #777;">
        If you did not request a password reset, you can safely ignore this email.
      </p>

      <hr style="margin: 20px 0;" />

      <p style="font-size: 12px; color: #aaa; text-align: center;">
        © ${new Date().getFullYear()} IQ Paths. All rights reserved.
      </p>

    </div>
  </div>
      `,
    });

    res.status(200).json({ message: "Reset link sent to email" });
  } catch (err) {
    console.error("Email send error:", err);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    res.status(500).json({ message: "Failed to send email" });
  }
};

export const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;
  const { type } = req.query;

  if (!newPassword) {
    return res.status(400).json({ message: "New password is required" });
  }

  const normalizedType = type?.toLowerCase()?.trim();

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  let user;

  if (normalizedType === "admin") {
    user = await Admin.findOne({
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() },
    });
  } else if (normalizedType === "employee") {
    user = await Employee.findOne({
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() },
    });
  }

  if (!user) {
    user =
      (await Admin.findOne({ resetToken: hashedToken, resetTokenExpiry: { $gt: Date.now() } })) ||
      (await Employee.findOne({ resetToken: hashedToken, resetTokenExpiry: { $gt: Date.now() } }));
  }

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired link" });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;

  await user.save();

  res.status(200).json({ message: "Password reset successful" });
};
