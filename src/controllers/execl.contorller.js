import xlsx from "xlsx";
import bcrypt from "bcryptjs";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import { generateEmpId } from "../utility/generateEmpId.js";
import { sendCredentialsNotification } from "../controllers/userController.js";
import { generateDefaultPassword, validatePasswordStrength } from "../controllers/userController.js";

const nameRegex   = /^[a-zA-Z\s]+$/;
const emailRegex  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileRegex = /^\d{10}$/;

// ── Ek row ko process karne ka kaam ──
const processRow = async (row, deptMap, dbEmails, dbMobiles, seenEmails, seenMobiles) => {
  const { _rowNum, emp_name, designation, mobile_number, email, dept_name } = row;

  const baseData = {
    row:           _rowNum,
    emp_name:      emp_name      || "N/A",
    email:         email         || "N/A",
    mobile_number: mobile_number || "N/A",
    designation:   designation   || "N/A",
    dept_name:     dept_name     || "N/A",
  };

  // ── Already exists — SKIP ──
  const emailExists  = dbEmails.has(email);
  const mobileExists = dbMobiles.has(mobile_number);

  if (emailExists || mobileExists) {
    return {
      type: "skipped",
      data: {
        ...baseData,
        reason: emailExists
          ? `Email already registered: ${email}`
          : `Mobile already registered: ${mobile_number}`,
      },
    };
  }

  // ── Excel duplicate ──
  if (seenEmails.has(email)) {
    return {
      type: "error",
      data: { ...baseData, error: `Duplicate email in this file: ${email}` },
    };
  }
  if (seenMobiles.has(mobile_number)) {
    return {
      type: "error",
      data: { ...baseData, error: `Duplicate mobile in this file: ${mobile_number}` },
    };
  }

  // ── Validation ──
  try {
    if (!emp_name || !designation || !mobile_number || !email || !dept_name)
      throw new Error("Missing required fields");
    if (!nameRegex.test(emp_name))
      throw new Error("Invalid name (only alphabets allowed)");
    if (!emailRegex.test(email))
      throw new Error("Invalid email format");
    if (!mobileRegex.test(mobile_number))
      throw new Error("Mobile must be exactly 10 digits");

    const dept = deptMap.get(dept_name);
    if (!dept) throw new Error(`Department not found: ${dept_name}`);

    const defaultPassword = generateDefaultPassword(emp_name, mobile_number);
    const passwordCheck   = validatePasswordStrength(defaultPassword);
    if (!passwordCheck.valid)
      throw new Error(`Password policy failed: ${passwordCheck.message}`);

    // ── Hash + EmpId parallel ──
    const [hashedPassword, emp_id] = await Promise.all([
      bcrypt.hash(defaultPassword, 10),
      generateEmpId(),
    ]);

    const user = await Employee.create({
      emp_id,
      emp_name,
      designation,
      mobile_number,
      email,
      dept_id:        dept.dept_id,
      school_id:      dept.school_id,
      password:       hashedPassword,
      role_ids:       [],
      active_role_id: null,
    });

    // ── Email fire-and-forget — response wait nahi karega ──
    sendCredentialsNotification({ emp_id, emp_name, email, defaultPassword })
      .catch(err => console.error(`Email failed for ${email}:`, err));

    // Seen sets update
    seenEmails.add(email);
    seenMobiles.add(mobile_number);
    dbEmails.add(email);
    dbMobiles.add(mobile_number);

    return {
      type: "inserted",
      data: { row: _rowNum, emp_id: user.emp_id, emp_name, email },
    };

  } catch (err) {
    return {
      type: "error",
      data: { ...baseData, error: err.message },
    };
  }
};

export const bulkSignup = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer)
      return res.status(400).json({ success: false, message: "No file uploaded" });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const data     = xlsx.utils.sheet_to_json(sheet);

    if (!data.length)
      return res.status(400).json({ success: false, message: "Excel is empty" });

    // ── Step 1: Normalize ──
    const normalizedRows = data.map((row, i) => {
      const n = {};
      Object.keys(row).forEach(k => {
        n[k.trim().toLowerCase().replace(/\s+/g, "_")] = row[k];
      });
      return {
        _rowNum:       i + 2,
        emp_name:      (n.emp_name || n.employee_name)?.toString().trim(),
        designation:   n.designation?.toString().trim(),
        mobile_number: n.mobile_number?.toString().replace(/\D/g, "").slice(0, 10),
        email:         n.email?.toString().trim().toLowerCase(),
        dept_name:     (n.dept_name || n.department)?.toString().trim().toLowerCase(),
      };
    });

    // ── Step 2: Department map ──
    const allDepts = await Department.find({});
    const deptMap  = new Map(allDepts.map(d => [d.dept_name.trim().toLowerCase(), d]));

    // ── Step 3: Existing users ek baar fetch ──
    const allEmails  = normalizedRows.map(r => r.email).filter(Boolean);
    const allMobiles = normalizedRows.map(r => r.mobile_number).filter(Boolean);

    const existingUsers = await Employee.find({
      $or: [
        { email:         { $in: allEmails  } },
        { mobile_number: { $in: allMobiles } },
      ],
    });

    const dbEmails  = new Set(existingUsers.map(u => u.email));
    const dbMobiles = new Set(existingUsers.map(u => u.mobile_number));

    // ── Step 4: Batch processing — 50 rows ek saath ──
    const BATCH_SIZE = 50;
    const seenEmails  = new Set();
    const seenMobiles = new Set();

    const inserted = [];
    const skipped  = [];
    const errors   = [];

    for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
      const batch = normalizedRows.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(row =>
          processRow(row, deptMap, dbEmails, dbMobiles, seenEmails, seenMobiles)
        )
      );

      for (const result of results) {
        if (result.type === "inserted") inserted.push(result.data);
        else if (result.type === "skipped") skipped.push(result.data);
        else errors.push(result.data);
      }
    }

    return res.status(207).json({
      success: true,
      message: "Bulk upload completed",
      summary: {
        total:    data.length,
        inserted: inserted.length,
        skipped:  skipped.length,
        failed:   errors.length,
      },
      inserted,
      skipped,
      errors,
    });

  } catch (err) {
    console.error("Bulk Upload Error:", err);
    return res.status(500).json({ success: false, message: err.message || "Bulk upload failed" });
  }
};