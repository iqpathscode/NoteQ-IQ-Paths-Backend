import Department from "../models/office/department.model.js";
import { Counter } from "../models/counter/counter.model.js";
import School from "../models/office/school.model.js";
import Employee from "../models/user/employee.model.js";

const departmentListPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    {
      $lookup: {
        from: School.collection.name,
        localField: "school_id",
        foreignField: "school_id",
        as: "school",
      },
    },
    {
      $addFields: {
        school_name: { $arrayElemAt: ["$school.school_name", 0] },
      },
    },
    {
      $project: {
        _id: 0,
        dept_id: 1,
        dept_name: 1,
        school_id: 1,
        school_name: 1,
      },
    },
    {
      $sort: { dept_name: 1 },
    }
  );

  return pipeline;
};

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

export const getDepartments = async (req, res) => {
  try {
    const search = req.query.search?.trim();
    const schoolId = Number(req.query.schoolId);
    const matchFilters = {};

    if (search) {
      matchFilters.dept_name = { $regex: search, $options: "i" };
    }

    if (schoolId) {
      matchFilters.school_id = schoolId;
    }

    const matchStage =
      Object.keys(matchFilters).length > 0
        ? { $match: matchFilters }
        : null;

    const departments = await Department.aggregate(
      departmentListPipeline(matchStage)
    );

    return res.status(200).json({
      success: true,
      message: "Departments fetched successfully",
      data: departments,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
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

    const department = await Department.findOne({ dept_id: Number(id) });

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    // ✅ Correct dependency check
    const employeeExists = await Employee.exists({
      dept_id: Number(id),
    });

    if (employeeExists) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete department. It is assigned to employees.",
      });
    }

    await Department.deleteOne({ dept_id: Number(id) });

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
