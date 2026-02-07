import  Department  from "../models/office/department.model.js";
import { Counter } from "../models/counter/counter.model.js";
import  School  from "../models/office/school.model.js";

export const createDepartment = async (req, res) => {
  try {
    const { dept_name, school_id } = req.body;

    // 1. Validate input
    if (!dept_name || dept_name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Department name is required",
      });
    }

    if (!school_id) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    // 2. Check if school exists (CRITICAL)
    const schoolExists = await School.findOne({ school_id });
    if (!schoolExists) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // 3. Prevent duplicate department in same school
    const existingDept = await Department.findOne({
      dept_name,
      school_id,
    });

    if (existingDept) {
      return res.status(409).json({
        success: false,
        message: "Department already exists in this school",
      });
    }

    // 4. Get next dept_id (atomic)
    const counter = await Counter.findOneAndUpdate(
      { name: "dept_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // 5. Create department
    const department = await Department.create({
      dept_id: counter.seq,
      dept_name,
      school_id,
    });

    // 6. Respond
    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
