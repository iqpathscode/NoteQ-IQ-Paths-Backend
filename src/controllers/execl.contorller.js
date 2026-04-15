import xlsx from "xlsx";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import { createUserService } from "../controllers/login/auth.controller.js";

export const bulkSignup = async (req, res) => {
  try {
    if (!req.file) {
      console.log("FILE NOT RECEIVED:", req.file);
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (!req.file.buffer) {
      console.log(" FILE OBJECT:", req.file);
      throw new Error("File buffer missing");
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });

    console.log(" Sheet Names:", workbook.SheetNames);

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const data = xlsx.utils.sheet_to_json(sheet);

    console.log(" FULL DATA:", data);
    console.log(" FIRST ROW:", data[0]);

    if (!data.length) {
      return res.status(400).json({
        success: false,
        message: "Excel is empty",
      });
    }

    //  FIXED: Dynamic dept extraction
    const deptNames = [
      ...new Set(
        data.map(row => {
          const deptKey = Object.keys(row).find(k =>
            k.toLowerCase().includes("department")
          );

          const value = row[deptKey]?.toString().toLowerCase().trim();

          console.log(" Extracted Dept:", value);

          return value;
        })
      )
    ];

    console.log("FINAL DEPT NAMES:", deptNames);

    const departments = await Department.find({
      dept_name: {
        $in: deptNames.map(name => new RegExp(`^${name}$`, "i")),
      },
    });

    console.log(" DB DEPARTMENTS FOUND:", departments);

    const deptMap = new Map(
      departments.map(d => [d.dept_name.toLowerCase().trim(), d])
    );

    console.log("DEPT MAP KEYS:", [...deptMap.keys()]);

    //  Normalize emails/mobiles properly
    const emails = data.map(d => d.email?.toString().toLowerCase().trim());
    const mobiles = data.map(d => d.mobile_number?.toString().trim());

    const existingUsers = await Employee.find({
      $or: [
        { email: { $in: emails } },
        { mobile_number: { $in: mobiles } },
      ],
    });

    const existingEmails = new Set(existingUsers.map(u => u.email));
    const existingMobiles = new Set(existingUsers.map(u => u.mobile_number));

    const seenEmails = new Set();
    const seenMobiles = new Set();

    const inserted = [];
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      console.log("\n Processing row:", i + 2);
      console.log("Row Data:", row);

      try {
        //  normalize row values
        const email = Object.values(row).find(v =>
          typeof v === "string" && v.includes("@")
        )?.toLowerCase().trim();

        const mobile = Object.values(row).find(v =>
          typeof v === "number" || /^\d+$/.test(v)
        )?.toString().trim();

        console.log(" Email:", email);
        console.log(" Mobile:", mobile);

        if (seenEmails.has(email) || seenMobiles.has(mobile)) {
          throw new Error("Duplicate in Excel");
        }

        if (existingEmails.has(email) || existingMobiles.has(mobile)) {
          throw new Error("User already exists");
        }

        // create user
        const result = await createUserService(row, deptMap);

        console.log(" User Created:", result);

        //  move AFTER success
        seenEmails.add(email);
        seenMobiles.add(mobile);

        inserted.push(result); //  FIXED (no .user)

      } catch (err) {
        console.log(" Error at row", i + 2, err.message);

        errors.push({
          row: i + 2,
          message: err.message,
        });
      }
    }

    console.log("\n FINAL RESULT:");
    console.log("Inserted:", inserted.length);
    console.log("Errors:", errors);

    return res.status(201).json({
      success: true,
      message: "Bulk upload completed",
      summary: {
        total: data.length,
        inserted: inserted.length,
        failed: errors.length,
      },
      errors,
    });

  } catch (err) {
    console.error(" Bulk Upload Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Bulk upload failed",
    });
  }
};