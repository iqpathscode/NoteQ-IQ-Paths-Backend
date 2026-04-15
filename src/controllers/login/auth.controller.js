import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Employee from "../../models/user/employee.model.js";
import { env } from "../../config/env.config.js";
import { generateEmpId } from "../../utility/generateEmpID.js";
import Admin from "../../models/user/admin.model.js";
import Power from "../../models/userPowers/power.model.js";
import Department from "../../models/office/department.model.js";
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
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // ================= ADMIN =================
    if (req.user.isAdmin) {
      const admin = await Admin.findOne({
        admin_id: req.user.admin_id,
      });

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
          roles: [],
          active_role: null,
          canReceiveNotesheet: false,
        },
      });
    }

    // ================= EMPLOYEE =================
    const employee = await Employee.findOne({
      emp_id: req.user.emp_id,
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    //  FETCH ROLES + POWER TOGETHER
    const roles = await Role.find({
      role_id: { $in: employee.role_ids || [] },
    }).lean();

    const powers = await Power.find({
      power_id: { $in: roles.map(r => r.power_id) },
    }).lean();

    //  Merge power into roles
    const rolesWithPower = roles.map(role => {
      const power = powers.find(p => p.power_id === role.power_id);
      return {
        ...role,
        power_level: power?.power_level || 1,
        power_type: power?.power_type || null,
      };
    });

    //  ACTIVE ROLE
    const activeRole = rolesWithPower.find(
      r => r.role_id === employee.active_role_id
    );

    return res.json({
      success: true,
      user: {
        emp_id: employee.emp_id,
        emp_name: employee.emp_name,
        dept_id: employee.dept_id,
        isAdmin: false,
        role_ids: employee.role_ids,

        roles: rolesWithPower,  //  FIXED
        active_role: activeRole || null,

        canReceiveNotesheet:
          activeRole?.canReceiveNotesheet || false,
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

    // 🔹 Validation
    if (!emp_name || !designation || !mobile_number || !email || !dept_id) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // 🔹 Check existing user
    const existing = await Employee.findOne({
      $or: [{ email }, { mobile_number }],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // 🔹 Generate ID & password
    const emp_id = await generateEmpId();
    const defaultPassword = "iqpaths@123";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 🔹 Get department (for school_id)
    const dept = await Department.findOne({ dept_id: Number(dept_id) });

    if (!dept) {
      return res.status(400).json({
        success: false,
        message: "Invalid department",
      });
    }

    //  CREATE USER (DEFAULT EMPLOYEE STATE)
    const user = await Employee.create({
      emp_id,
      emp_name,
      designation,
      mobile_number,
      email,
      dept_id: Number(dept_id),
      school_id: dept.school_id, // auto set

      password: hashedPassword,

      //  IMPORTANT: No role assigned initially
      role_ids: [],            // empty = no role yet
      active_role_id: null,    // null = no active role
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        emp_id: user.emp_id,
        email: user.email,
        defaultPassword,
        role_status: "No role assigned", //  helpful for UI
      },
    });
  } catch (err) {
    console.error("Create User Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    });
  }
};

export const createUserService = async (data, deptMap) => {

  //  normalize keys
  const normalizedData = {};
  Object.keys(data).forEach(key => {
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "_");
    normalizedData[cleanKey] = data[key];
  });

  const emp_name = normalizedData.emp_name || normalizedData.employee_name;
  const designation = normalizedData.designation;
  const mobile_number = normalizedData.mobile_number;
  const email = normalizedData.email;
  const dept_name = normalizedData.dept_name || normalizedData.department;

  //  clean values
  const empNameClean = emp_name?.toString().trim();
  const designationClean = designation?.toString().trim();
  const mobileClean = mobile_number?.toString().trim();
  const emailClean = email?.toString().trim().toLowerCase();
  const deptNameClean = dept_name?.toString().trim().toLowerCase();

  if (!empNameClean || !designationClean || !mobileClean || !emailClean || !deptNameClean) {
    throw new Error("Missing required fields");
  }

  const dept = deptMap.get(deptNameClean);

  if (!dept) {
    throw new Error(`Invalid department: ${dept_name}`);
  }

  const existing = await Employee.findOne({
    $or: [{ email: emailClean }, { mobile_number: mobileClean }],
  });

  if (existing) {
    throw new Error("User already exists");
  }

  const emp_id = await generateEmpId();
  const hashedPassword = await bcrypt.hash("iqpaths@123", 10);

  const user = await Employee.create({
    emp_id,
    emp_name: empNameClean,
    designation: designationClean,
    mobile_number: mobileClean,
    email: emailClean,
    dept_id: dept.dept_id,
    school_id: dept.school_id,
    password: hashedPassword,
    role_ids: [],
    active_role_id: null,
  });

  return user;
};