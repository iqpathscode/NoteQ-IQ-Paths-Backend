import Department from "../models/office/department.model.js";
import { Counter } from "../models/counter/counter.model.js";
import School from "../models/office/school.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";

export const createDepartment = async (req, res) => {
  try {
    let { dept_name, school_id } = req.body;

    dept_name = dept_name?.trim();

    //  Validate input
    if (!dept_name) {
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

    //  Check if school exists
    const schoolExists = await School.findOne({ school_id });
    if (!schoolExists) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    //  Case-insensitive duplicate check in same school
    const existingDept = await Department.findOne({
      dept_name: { $regex: new RegExp(`^${dept_name}$`, "i") },
      school_id,
    });

    if (existingDept) {
      return res.status(409).json({
        success: false,
        message: "Department already exists in this school",
      });
    }

    //  Auto-increment dept_id
    const counter = await Counter.findOneAndUpdate(
      { name: "dept_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    //  Create department
    const department = await Department.create({
      dept_id: counter.seq,
      dept_name,
      school_id,
    });

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
    });

  } catch (error) {
    console.error("Create Department Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getAllDepartments = async (req, res) => {
  try {
    const { school_id } = req.query;

    let filter = {};
    if (school_id) {
      filter.school_id = school_id;
    }

    const departments = await Department.find(filter)
      .sort({ dept_name: 1 });

    return res.status(200).json({
      success: true,
      count: departments.length,
      data: departments,
    });

  } catch (error) {
    console.error("Get Departments Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching departments",
    });
  }
};

export const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }

    const deptId = Number(id);

    const department = await Department.findOne({ dept_id: deptId });

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    //  Employee check
    const employeeExists = await Employee.exists({ dept_id: deptId });

    if (employeeExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete department. It is assigned to employees.",
      });
    }

    // FIXED: Role check (array field)
    const roleExists = await Role.exists({ dept_ids: deptId });

    if (roleExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete department. It is assigned to roles.",
      });
    }

    await Department.deleteOne({ dept_id: deptId });

    return res.status(200).json({
      success: true,
      message: "Department deleted successfully",
    });

  } catch (error) {
    console.error("Delete Department Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting department",
      error: error.message,
    });
  }
};