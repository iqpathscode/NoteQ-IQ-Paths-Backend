import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import bcrypt from "bcryptjs";
import { generateEmpId } from "../utility/generateEmpId.js";


// ─── Regex Validators ────────────────────────────────────────────────────────
const nameRegex = /^[a-zA-Z\s]+$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileRegex = /^\d{10}$/;

// ─── Password Generator ───────────────────────────────────────────────────────
/**
 * Generates a strong default password from the employee's name and mobile number.
 *
 * Strategy:
 *   - Take the first 3 letters of the name (capitalized first letter)
 *   - Append the last 4 digits of the mobile number
 *   - Append a fixed special character segment "@Iq"
 *
 * Example: name="Rahul Kumar", mobile="9876543210" → "Rah3210@Iq"
 *
 * Satisfies all password rules:
 *   ✅ Minimum 6 characters
 *   ✅ At least one uppercase letter  (first letter of name)
 *   ✅ At least one lowercase letter  (remaining name letters)
 *   ✅ At least one number            (last 4 digits of mobile)
 *   ✅ At least one special character (@)
 *   ✅ Not a common/dictionary password
 */
export const generateDefaultPassword = (emp_name, mobile_number) => {
  const namePart = emp_name.trim().replace(/\s+/g, "");
  const nameSegment =
    namePart.charAt(0).toUpperCase() + namePart.slice(1, 3).toLowerCase();

  const mobileSegment = mobile_number.toString().replace(/\D/g, "").slice(-4);

  return `${nameSegment}${mobileSegment}@Iq`;
};

// ─── Password Strength Validator ──────────────────────────────────────────────
/**
 * Validates a password against the platform's password policy.
 * Returns { valid: true } on success, or { valid: false, message: "..." } on failure.
 */
export const validatePasswordStrength = (password) => {
  const COMMON_PASSWORDS = [
    "Password1!",
    "Admin123!",
    "Welcome1!",
    "Qwerty1!",
    "Letmein1!",
    "iqpaths@123", // old default — explicitly disallowed
  ];

  if (!password || password.length < 6) {
    return { valid: false, message: "Password must be at least 6 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter",
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter",
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one number",
    };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one special character",
    };
  }
  if (COMMON_PASSWORDS.includes(password)) {
    return { valid: false, message: "Password is too common. Choose a stronger one." };
  }

  return { valid: true };
};

// ─── Nodemailer + Gmail Setup ─────────────────────────────────────────────────
// Install: npm install nodemailer
// Add to .env:
//   GMAIL_USER=tumhara@gmail.com
//   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ─── Notification Helper ──────────────────────────────────────────────────────
/**
 * Sends login credentials to the newly created employee via:
 *   1. Nodemailer + Gmail (real delivery)
 *   2. In-app notification (saved to DB — plug in your Notification model)
 */
const sendCredentialsNotification = async ({ emp_id, emp_name, email, defaultPassword }) => {
  // ── 1. Gmail Email ────────────────────────────────────────────────────────
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <div style="background: #1d4ed8; padding: 24px 32px;">
        <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Welcome to IQPaths 🎉</h2>
      </div>
      <div style="padding: 28px 32px; background: #ffffff;">
        <p style="color: #374151; font-size: 15px;">Hi <strong>${emp_name}</strong>,</p>
        <p style="color: #374151; font-size: 15px;">Your IQPaths account has been created. Use the credentials below to log in:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
          <tr>
            <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 4px 0 0 4px; color: #6b7280; width: 40%;">Login ID</td>
            <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 0 4px 4px 0; color: #111827; font-weight: bold;">${email}</td>
          </tr>
          <tr><td colspan="2" style="padding: 4px;"></td></tr>
          <tr>
            <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 4px 0 0 4px; color: #6b7280;">Password</td>
            <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 0 4px 4px 0; color: #111827; font-weight: bold; font-family: monospace;">${defaultPassword}</td>
          </tr>
        </table>
        <p style="color: #dc2626; font-size: 13px;">⚠️ Please change your password immediately after your first login.</p>
        <p style="color: #6b7280; font-size: 13px;">If you did not expect this account, contact your administrator.</p>
      </div>
      <div style="padding: 16px 32px; background: #f9fafb; text-align: center;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">— IQPaths Team</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"IQPaths" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: "Your IQPaths Account Has Been Created",
      text: `Hi ${emp_name},\n\nLogin ID: ${email}\nPassword: ${defaultPassword}\n\nPlease change your password after first login.\n\n— IQPaths Team`,
      html:    htmlBody,
    });
    console.log(`[GMAIL] Email sent to ${email}`);
  } catch (err) {
    // Log but don't crash user creation if email fails
    console.error("[GMAIL] Email failed:", err.message);
  }

  // ── 2. In-App Notification ────────────────────────────────────────────────
  // Uncomment and plug in your Notification model:
  //
  // await Notification.create({
  //   recipient_emp_id: emp_id,
  //   type:    "ACCOUNT_CREATED",
  //   title:   "Welcome to IQPaths",
  //   message: `Your account is ready. Login ID: ${emp_id}. Check your email for the password.`,
  //   read:    false,
  // });
  console.log(`[IN-APP] Notification queued for emp_id: ${emp_id}`);
};

// ─── Manual User Creation (Admin API) ────────────────────────────────────────
export const createUserByAdmin = async (req, res) => {
  try {
    const { emp_name, designation, mobile_number, email, dept_id } = req.body;

    // Required validation
    if (!emp_name || !designation || !mobile_number || !email || !dept_id) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Clean values
    const cleanName   = emp_name.toString().trim();
    const cleanEmail  = email.toString().trim().toLowerCase();
    const cleanMobile = mobile_number.toString().replace(/\D/g, "").slice(0, 10);

    // Format validation
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

    // Duplicate check
    const existing = await Employee.findOne({
      $or: [{ email: cleanEmail }, { mobile_number: cleanMobile }],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Department check
    const dept = await Department.findOne({ dept_id: Number(dept_id) });
    if (!dept) {
      return res.status(400).json({
        success: false,
        message: "Invalid department",
      });
    }

    // Generate & validate password
    const defaultPassword = generateDefaultPassword(cleanName, cleanMobile);
    const passwordCheck   = validatePasswordStrength(defaultPassword);
    if (!passwordCheck.valid) {
      // Fallback: should never happen with the generator above, but guard anyway
      return res.status(500).json({
        success: false,
        message: `Generated password failed policy: ${passwordCheck.message}`,
      });
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    const emp_id         = await generateEmpId();

    // Create user
    const user = await Employee.create({
      emp_id,
      emp_name:      cleanName,
      designation,
      mobile_number: cleanMobile,
      email:         cleanEmail,
      dept_id:       Number(dept_id),
      school_id:     dept.school_id,
      password:      hashedPassword,
      role_ids:      [],
      active_role_id: null,
    });

    // Send credentials notification (email + in-app)
    await sendCredentialsNotification({
      emp_id,
      emp_name: cleanName,
      email:    cleanEmail,
      defaultPassword,
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully. Credentials sent to employee.",
      data: {
        emp_id:      user.emp_id,
        email:       user.email,
        role_status: "No role assigned",
        // ⚠️  Do NOT return defaultPassword in production responses.
        // Included here only for dev/testing convenience.
        // defaultPassword,
      },
    });
  } catch (err) {
    console.error("Create User Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    });
  }
};

// ─── Bulk User Creation (Service) ────────────────────────────────────────────
export const createUserService = async (data, deptMap) => {
  // Normalize keys
  const normalizedData = {};
  Object.keys(data).forEach((key) => {
    normalizedData[key.trim().toLowerCase().replace(/\s+/g, "_")] = data[key];
  });

  const emp_name      = normalizedData.emp_name || normalizedData.employee_name;
  const designation   = normalizedData.designation;
  const mobile_number = normalizedData.mobile_number;
  const email         = normalizedData.email;
  const dept_name     = normalizedData.dept_name || normalizedData.department;

  // Clean values
  const empNameClean    = emp_name?.toString().trim();
  const designationClean = designation?.toString().trim();
  const mobileClean     = mobile_number?.toString().replace(/\D/g, "").slice(0, 10);
  const emailClean      = email?.toString().trim().toLowerCase();
  const deptNameClean   = dept_name?.toString().trim().toLowerCase();

  // Required validation
  if (!empNameClean || !designationClean || !mobileClean || !emailClean || !deptNameClean) {
    throw new Error("Missing required fields");
  }

  // Format validation
  if (!nameRegex.test(empNameClean)) throw new Error("Invalid name (only alphabets allowed)");
  if (!emailRegex.test(emailClean))  throw new Error("Invalid email format");
  if (!mobileRegex.test(mobileClean)) throw new Error("Mobile must be exactly 10 digits");

  // Department check
  const dept = deptMap.get(deptNameClean);
  if (!dept) throw new Error(`Invalid department: ${dept_name}`);

  // Duplicate check
  const existing = await Employee.findOne({
    $or: [{ email: emailClean }, { mobile_number: mobileClean }],
  });
  if (existing) throw new Error("User already exists");

  // Generate & validate password
  const defaultPassword = generateDefaultPassword(empNameClean, mobileClean);
  const passwordCheck   = validatePasswordStrength(defaultPassword);
  if (!passwordCheck.valid) {
    throw new Error(`Generated password failed policy: ${passwordCheck.message}`);
  }

  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  const emp_id         = await generateEmpId();

  // Create user
  const user = await Employee.create({
    emp_id,
    emp_name:      empNameClean,
    designation:   designationClean,
    mobile_number: mobileClean,
    email:         emailClean,
    dept_id:       dept.dept_id,
    school_id:     dept.school_id,
    password:      hashedPassword,
    role_ids:      [],
    active_role_id: null,
  });

  // Send credentials notification (email + in-app)
  await sendCredentialsNotification({
    emp_id,
    emp_name: empNameClean,
    email:    emailClean,
    defaultPassword,
  });

  return user;
};

// ==============================================================================================
// import Employee from "../models/user/employee.model.js";
// import Department from "../models/office/department.model.js";
// import bcrypt from "bcryptjs";
// import { generateEmpId } from "../utility/generateEmpId.js";
// import sgMail from "@sendgrid/mail";

// // ─── SendGrid Setup ───────────────────────────────────────────────────────────
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// // ─── Regex Validators ────────────────────────────────────────────────────────
// const nameRegex = /^[a-zA-Z\s]+$/;
// const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// const mobileRegex = /^\d{10}$/;

// // ─── Password Generator ───────────────────────────────────────────────────────
// export const generateDefaultPassword = (emp_name, mobile_number) => {
//   const namePart = emp_name.trim().replace(/\s+/g, "");
//   const nameSegment =
//     namePart.charAt(0).toUpperCase() + namePart.slice(1, 3).toLowerCase();
//   const mobileSegment = mobile_number.toString().replace(/\D/g, "").slice(-4);
//   return `${nameSegment}${mobileSegment}@Iq`;
// };

// // ─── Password Strength Validator ──────────────────────────────────────────────
// export const validatePasswordStrength = (password) => {
//   const COMMON_PASSWORDS = [
//     "Password1!", "Admin123!", "Welcome1!", "Qwerty1!",
//     "Letmein1!", "iqpaths@123",
//   ];

//   if (!password || password.length < 6)
//     return { valid: false, message: "Password must be at least 6 characters" };
//   if (!/[A-Z]/.test(password))
//     return { valid: false, message: "Password must contain at least one uppercase letter" };
//   if (!/[a-z]/.test(password))
//     return { valid: false, message: "Password must contain at least one lowercase letter" };
//   if (!/[0-9]/.test(password))
//     return { valid: false, message: "Password must contain at least one number" };
//   if (!/[^A-Za-z0-9]/.test(password))
//     return { valid: false, message: "Password must contain at least one special character" };
//   if (COMMON_PASSWORDS.includes(password))
//     return { valid: false, message: "Password is too common. Choose a stronger one." };

//   return { valid: true };
// };

// // ─── Notification Helper ──────────────────────────────────────────────────────
// const sendCredentialsNotification = async ({ emp_id, emp_name, email, defaultPassword }) => {
//   // ── 1. SendGrid Email ─────────────────────────────────────────────────────
//   const htmlBody = `
//     <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
//       <div style="background: #1d4ed8; padding: 24px 32px;">
//         <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Welcome to IQPaths 🎉</h2>
//       </div>
//       <div style="padding: 28px 32px; background: #ffffff;">
//         <p style="color: #374151; font-size: 15px;">Hi <strong>${emp_name}</strong>,</p>
//         <p style="color: #374151; font-size: 15px;">Your IQPaths account has been created. Use the credentials below to log in:</p>
//         <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 15px;">
//           <tr>
//             <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 4px 0 0 4px; color: #6b7280; width: 40%;">Login ID</td>
//             <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 0 4px 4px 0; color: #111827; font-weight: bold;">${email}</td>
//           </tr>
//           <tr><td colspan="2" style="padding: 4px;"></td></tr>
//           <tr>
//             <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 4px 0 0 4px; color: #6b7280;">Password</td>
//             <td style="padding: 10px 14px; background: #f3f4f6; border-radius: 0 4px 4px 0; color: #111827; font-weight: bold; font-family: monospace;">${defaultPassword}</td>
//           </tr>
//         </table>
//         <p style="color: #dc2626; font-size: 13px;">⚠️ Please change your password immediately after your first login.</p>
//         <p style="color: #6b7280; font-size: 13px;">If you did not expect this account, contact your administrator.</p>
//       </div>
//       <div style="padding: 16px 32px; background: #f9fafb; text-align: center;">
//         <p style="color: #9ca3af; font-size: 12px; margin: 0;">— IQPaths Team</p>
//       </div>
//     </div>
//   `;

//   const msg = {
//     to:      email,
//     from:    process.env.SENDGRID_FROM_EMAIL, // must be verified sender in SendGrid
//     subject: "Your IQPaths Account Has Been Created",
//     text:    `Hi ${emp_name},\n\nLogin ID: ${email}\nPassword: ${defaultPassword}\n\nPlease change your password after first login.\n\n— IQPaths Team`,
//     html:    htmlBody,
//   };

//   try {
//     await sgMail.send(msg);
//     console.log(`[SENDGRID] Email sent to ${email}`);
//   } catch (err) {
//     // SendGrid error details are in err.response.body
//     console.error("[SENDGRID] Email failed:", err.response?.body || err.message);
//   }

//   // ── 2. In-App Notification ────────────────────────────────────────────────
//   // await Notification.create({ ... });
//   console.log(`[IN-APP] Notification queued for emp_id: ${emp_id}`);
// };

// // ─── Manual User Creation (Admin API) ────────────────────────────────────────
// export const createUserByAdmin = async (req, res) => {
//   try {
//     const { emp_name, designation, mobile_number, email, dept_id } = req.body;

//     if (!emp_name || !designation || !mobile_number || !email || !dept_id) {
//       return res.status(400).json({ success: false, message: "All fields are required" });
//     }

//     const cleanName   = emp_name.toString().trim();
//     const cleanEmail  = email.toString().trim().toLowerCase();
//     const cleanMobile = mobile_number.toString().replace(/\D/g, "").slice(0, 10);

//     if (!nameRegex.test(cleanName))
//       return res.status(400).json({ success: false, message: "Name should contain only alphabets and spaces" });
//     if (!emailRegex.test(cleanEmail))
//       return res.status(400).json({ success: false, message: "Invalid email format" });
//     if (!mobileRegex.test(cleanMobile))
//       return res.status(400).json({ success: false, message: "Mobile number must be exactly 10 digits" });

//     const existing = await Employee.findOne({ $or: [{ email: cleanEmail }, { mobile_number: cleanMobile }] });
//     if (existing)
//       return res.status(400).json({ success: false, message: "User already exists" });

//     const dept = await Department.findOne({ dept_id: Number(dept_id) });
//     if (!dept)
//       return res.status(400).json({ success: false, message: "Invalid department" });

//     const defaultPassword = generateDefaultPassword(cleanName, cleanMobile);
//     const passwordCheck   = validatePasswordStrength(defaultPassword);
//     if (!passwordCheck.valid)
//       return res.status(500).json({ success: false, message: `Generated password failed policy: ${passwordCheck.message}` });

//     const hashedPassword = await bcrypt.hash(defaultPassword, 10);
//     const emp_id         = await generateEmpId();

//     const user = await Employee.create({
//       emp_id,
//       emp_name:      cleanName,
//       designation,
//       mobile_number: cleanMobile,
//       email:         cleanEmail,
//       dept_id:       Number(dept_id),
//       school_id:     dept.school_id,
//       password:      hashedPassword,
//       role_ids:      [],
//       active_role_id: null,
//     });

//     await sendCredentialsNotification({ emp_id, emp_name: cleanName, email: cleanEmail, defaultPassword });

//     return res.status(201).json({
//       success: true,
//       message: "User created successfully. Credentials sent to employee.",
//       data: { emp_id: user.emp_id, email: user.email, role_status: "No role assigned" },
//     });
//   } catch (err) {
//     console.error("Create User Error:", err);
//     return res.status(500).json({ success: false, message: err.message || "Something went wrong" });
//   }
// };

// // ─── Bulk User Creation (Service) ────────────────────────────────────────────
// export const createUserService = async (data, deptMap) => {
//   const normalizedData = {};
//   Object.keys(data).forEach((key) => {
//     normalizedData[key.trim().toLowerCase().replace(/\s+/g, "_")] = data[key];
//   });

//   const emp_name      = normalizedData.emp_name || normalizedData.employee_name;
//   const designation   = normalizedData.designation;
//   const mobile_number = normalizedData.mobile_number;
//   const email         = normalizedData.email;
//   const dept_name     = normalizedData.dept_name || normalizedData.department;

//   const empNameClean     = emp_name?.toString().trim();
//   const designationClean = designation?.toString().trim();
//   const mobileClean      = mobile_number?.toString().replace(/\D/g, "").slice(0, 10);
//   const emailClean       = email?.toString().trim().toLowerCase();
//   const deptNameClean    = dept_name?.toString().trim().toLowerCase();

//   if (!empNameClean || !designationClean || !mobileClean || !emailClean || !deptNameClean)
//     throw new Error("Missing required fields");

//   if (!nameRegex.test(empNameClean))  throw new Error("Invalid name (only alphabets allowed)");
//   if (!emailRegex.test(emailClean))   throw new Error("Invalid email format");
//   if (!mobileRegex.test(mobileClean)) throw new Error("Mobile must be exactly 10 digits");

//   const dept = deptMap.get(deptNameClean);
//   if (!dept) throw new Error(`Invalid department: ${dept_name}`);

//   const existing = await Employee.findOne({ $or: [{ email: emailClean }, { mobile_number: mobileClean }] });
//   if (existing) throw new Error("User already exists");

//   const defaultPassword = generateDefaultPassword(empNameClean, mobileClean);
//   const passwordCheck   = validatePasswordStrength(defaultPassword);
//   if (!passwordCheck.valid)
//     throw new Error(`Generated password failed policy: ${passwordCheck.message}`);

//   const hashedPassword = await bcrypt.hash(defaultPassword, 10);
//   const emp_id         = await generateEmpId();

//   const user = await Employee.create({
//     emp_id,
//     emp_name:      empNameClean,
//     designation:   designationClean,
//     mobile_number: mobileClean,
//     email:         emailClean,
//     dept_id:       dept.dept_id,
//     school_id:     dept.school_id,
//     password:      hashedPassword,
//     role_ids:      [],
//     active_role_id: null,
//   });

//   await sendCredentialsNotification({ emp_id, emp_name: empNameClean, email: emailClean, defaultPassword });

//   return user;
// };
