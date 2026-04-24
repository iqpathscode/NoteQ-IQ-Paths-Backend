import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Employee from "../../models/user/employee.model.js";
import { env } from "../../config/env.config.js";
import { generateEmpId } from "../../utility/generateEmpId.js";
import Admin from "../../models/user/admin.model.js";
import Power from "../../models/userPowers/power.model.js";
import Department from "../../models/office/department.model.js";
import Role from "../../models/userPowers/role.model.js";
import crypto from "crypto";


import sgMail from "@sendgrid/mail";

sgMail.setApiKey(env.SENDGRID_API_KEY);


export const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

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

      // res.cookie("token", token, {
      //   httpOnly: true,
      //   secure: false, // production me HTTPS ke liye true rakho
      //   sameSite: "strict",
      // });

      res.cookie("token", token, {
  httpOnly: true,
  secure: true,       // MUST in production (Render + Vercel)
  sameSite: "none" ,   // IMPORTANT for cross-site cookies
   maxAge: rememberMe
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000,
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

    // res.cookie("token", token, {
    //   httpOnly: true,
    //   secure: false,
    //   sameSite: "strict",
    // });
    res.cookie("token", token, {
  httpOnly: true,
  secure: true,       //  production me MUST
  sameSite: "none"    //  cross-origin ke liye
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

const nameRegex = /^[A-Za-z\s]+$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileRegex = /^[0-9]{10}$/;

export const createUserByAdmin = async (req, res) => {
  try {
    const { emp_name, designation, mobile_number, email, dept_id } = req.body;

    //  Required validation
    if (!emp_name || !designation || !mobile_number || !email || !dept_id) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    //  CLEAN VALUES (IMPORTANT )
    const cleanName = emp_name.toString().trim();
    const cleanEmail = email.toString().trim().toLowerCase();
    const cleanMobile = mobile_number.toString().replace(/\D/g, "").slice(0, 10);

    //  Format validation
    if (!nameRegex.test(cleanName)) {
      return res.status(400).json({
        success: false,
        message: "Name should contain only alphabets and spaces",
      });
    }

    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (!mobileRegex.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: "Mobile number must be exactly 10 digits",
      });
    }

    //  Check existing (use CLEAN values )
    const existing = await Employee.findOne({
      $or: [{ email: cleanEmail }, { mobile_number: cleanMobile }],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    //  Generate ID & password
    const emp_id = await generateEmpId();
    const defaultPassword = "iqpaths@123";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    //  Get department
    const dept = await Department.findOne({ dept_id: Number(dept_id) });

    if (!dept) {
      return res.status(400).json({
        success: false,
        message: "Invalid department",
      });
    }

    //  Create user
    const user = await Employee.create({
      emp_id,
      emp_name: cleanName,
      designation,
      mobile_number: cleanMobile,
      email: cleanEmail,
      dept_id: Number(dept_id),
      school_id: dept.school_id,
      password: hashedPassword,
      role_ids: [],
      active_role_id: null,
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        emp_id: user.emp_id,
        email: user.email,
        defaultPassword,
        role_status: "No role assigned",
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
  //  Normalize keys
  const normalizedData = {};
  Object.keys(data).forEach((key) => {
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "_");
    normalizedData[cleanKey] = data[key];
  });

  const emp_name = normalizedData.emp_name || normalizedData.employee_name;
  const designation = normalizedData.designation;
  const mobile_number = normalizedData.mobile_number;
  const email = normalizedData.email;
  const dept_name = normalizedData.dept_name || normalizedData.department;

  //  Clean values (IMPORTANT )
  const empNameClean = emp_name?.toString().trim();
  const designationClean = designation?.toString().trim();
  const mobileClean = mobile_number
    ?.toString()
    .replace(/\D/g, "")
    .slice(0, 10);
  const emailClean = email?.toString().trim().toLowerCase();
  const deptNameClean = dept_name?.toString().trim().toLowerCase();

  //  Required validation
  if (
    !empNameClean ||
    !designationClean ||
    !mobileClean ||
    !emailClean ||
    !deptNameClean
  ) {
    throw new Error("Missing required fields");
  }

  //  Format validation
  if (!nameRegex.test(empNameClean)) {
    throw new Error("Invalid name (only alphabets allowed)");
  }

  if (!emailRegex.test(emailClean)) {
    throw new Error("Invalid email format");
  }

  if (!mobileRegex.test(mobileClean)) {
    throw new Error("Mobile must be exactly 10 digits");
  }

  //  Department check
  const dept = deptMap.get(deptNameClean);

  if (!dept) {
    throw new Error(`Invalid department: ${dept_name}`);
  }

  //  Check existing
  const existing = await Employee.findOne({
    $or: [{ email: emailClean }, { mobile_number: mobileClean }],
  });

  if (existing) {
    throw new Error("User already exists");
  }

  //  Create user
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

export const logout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: true, // production me true
      sameSite: "Strict",
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};


export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  console.log("Incoming email:", email);
 let user = await Employee.findOne({ email });
 console.log("Employee found:", user);
 let userType = "employee";    

if (!user) {
  user = await Admin.findOne({ email });
    console.log("Admin found:", user);
  userType = "admin";
}

if (!user) {
  console.log("User not found in both collections");
  return res.status(404).json({ message: "User not found" });
}

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  user.resetToken = hashedToken;
  user.resetTokenExpiry = Date.now() + 3600000;
  await user.save();

  //  userType pass karo (important for reset API)
  const resetURL = `${env.FRONTEND_URL}/reset-password/${resetToken}?type=${userType}`;

  try {
    await sgMail.send({
  to: user.email,
  from: "IQ Paths <info@iqpaths.com>",
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

  //  Normalize type (important fix)
  const normalizedType = type?.toLowerCase()?.trim();

 console.log("TOKEN FROM URL:", token);

const hashedToken = crypto
  .createHash("sha256")
  .update(token)
  .digest("hex");

console.log("HASHED TOKEN:", hashedToken);

//  direct DB check (without expiry)
const adminUser = await Admin.findOne({ resetToken: hashedToken });
const empUser = await Employee.findOne({ resetToken: hashedToken });

console.log("ADMIN USER:", adminUser);
console.log("EMP USER:", empUser);

  let user;

  //  First try based on type
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

  //  Fallback (VERY IMPORTANT FIX)
  if (!user) {
    user =
      (await Admin.findOne({
        resetToken: hashedToken,
        resetTokenExpiry: { $gt: Date.now() },
      })) ||
      (await Employee.findOne({
        resetToken: hashedToken,
        resetTokenExpiry: { $gt: Date.now() },
      }));
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




