import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Employee from "../../models/user/employee.model.js";
import { env } from "../../config/env.config.js";
import { generateEmpId } from "../../utility/generateEmpID.js";
import Admin from "../../models/user/admin.model.js";
import Power from "../../models/userPowers/power.model.js";
import Role from "../../models/userPowers/role.model.js";

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Step 1: Check Admin first
    const admin = await Admin.findOne({ email });
    if (admin) {
      if (!admin.is_active) {
        return res
          .status(403)
          .json({ success: false, message: "Admin account is inactive" });
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { admin_id: admin.admin_id, isAdmin: true },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN },
      );

      admin.last_login = new Date();
      await admin.save();

      res.cookie("token", token, {
        httpOnly: true,
        secure: false, // production me HTTPS ke liye true rakho
        sameSite: "strict",
      });

      return res.status(200).json({
        success: true,
        message: "Admin login successful",
        isAdmin: true,
        canReceiveNotesheet: true, // Admin ke liye hamesha true
      });
    }

    // Step 2: If not Admin, check Employee
    const user = await Employee.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.is_active) {
      return res
        .status(403)
        .json({ success: false, message: "Account is inactive" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
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
      secure: false,
      sameSite: "strict",
    });

    const isDefaultPassword = await bcrypt.compare(
      "iqpaths@123",
      user.password,
    );

    // Dynamic flag from Power table
    const rolePower = await Power.findOne({
  power_id: user.active_role?.power_id
});

    return res.status(200).json({
  success: true,
  message: "User login successful",
  role_id: user.active_role?.role_id,
  dept_id: user.dept_id,
  isAdmin: false,
  isDefaultPassword,
  canReceiveNotesheet: user.active_role?.canReceiveNotesheet || false,
});
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Find logged-in user (from middleware)
    const user = await Employee.findOne({ emp_id: req.user.emp_id });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect",
      });
    }

    // Hash new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Password change failed",
      error: error.message,
    });
  }
};
export const getMe = async (req, res) => {
  try {
    // Agar user admin hai
    if (req.user.isAdmin) {
      const admin = await Admin.findOne({ admin_id: req.user.admin_id });

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      return res.json({
        success: true,
        user: {
          admin_id: admin.admin_id,
          username: admin.username,
          isAdmin: true,
          roles: [], // Admin ke liye roles optional
          active_role: null,
          canReceiveNotesheet: false,
        },
      });
    }

    // Agar normal employee hai
    const employee = await Employee.findOne({ emp_id: req.user.emp_id });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const rolePower = await Power.findOne({
      power_id: employee.active_role?.role_id || employee.role_id,
    });

    res.json({
      success: true,
      user: {
        emp_id: employee.emp_id,
        emp_name: employee.emp_name,
        dept_id: employee.dept_id,
        isAdmin: false,
        roles: employee.roles || [],
        active_role: employee.active_role,
        canReceiveNotesheet: rolePower?.canReceiveNotesheet || false,
      },
    });
  } catch (error) {
    console.error("Error in getMe:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


export const createUserByAdmin = async (req, res) => {
  try {
    const { emp_name, designation, mobile_number, email, dept_id } = req.body;

    const existing = await Employee.findOne({
      $or: [{ email }, { mobile_number }],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    const emp_id = await generateEmpId();
    const defaultPassword = "iqpaths@123";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const defaultRole = await Role.findOne({ role_name: "Employee" });

    if (!defaultRole) {
      return res.status(400).json({
        success: false,
        message: "Default role 'Employee' not found.",
      });
    }

    const roleData = {
      role_id: defaultRole.role_id,
      role_name: defaultRole.role_name,
      dept_id: dept_id,
      power_level: defaultRole.power_level,
      power_id: defaultRole.power_id,
      canReceiveNotesheet: defaultRole.canReceiveNotesheet,
    };

    const user = await Employee.create({
      emp_id,
      emp_name,
      designation,
      mobile_number,
      email,
      dept_id,
      password: hashedPassword,

      roles: [roleData],
      active_role: roleData,
    });

    res.json({
      success: true,
      message: "User created successfully",
      data: {
        emp_id: user.emp_id,
        email: user.email,
        defaultPassword,
        role: roleData.role_name,
      },
    });
  } catch (err) {
    console.error("Create User Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
