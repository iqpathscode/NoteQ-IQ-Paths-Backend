import School from "../models/office/school.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Department from "../models/office/department.model.js";

export const createSchool = async (req, res) => {
  try {
    let { school_name } = req.body;

    school_name = school_name?.trim();

    //  Validate
    if (!school_name) {
      return res.status(400).json({
        success: false,
        message: "School name is required",
      });
    }

    //  Case-insensitive duplicate check
    const existingSchool = await School.findOne({
      school_name: { $regex: new RegExp(`^${school_name}$`, "i") },
    });

    if (existingSchool) {
      return res.status(409).json({
        success: false,
        message: "School already exists",
      });
    }

    //  Atomic auto-increment school_id
    const counter = await Counter.findOneAndUpdate(
      { name: "school_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    //  Create school
    const school = await School.create({
      school_id: counter.seq,
      school_name,
    });

    return res.status(201).json({
      success: true,
      message: "School created successfully",
      data: school,
    });

  } catch (error) {
    console.error("Create School Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getAllSchools = async (req, res) => {
  try {
    const schools = await School.find().sort({ school_name: 1 });

    return res.status(200).json({
      success: true,
      count: schools.length,
      data: schools,
    });
  } catch (error) {
    console.error("Get Schools Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching schools",
    });
  }
};

export const deleteSchool = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "School ID is required",
      });
    }

    // Check if school exists
    const school = await School.findOne({ school_id: id });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "School not found",
      });
    }

    // IMPORTANT: check if departments exist under this school
    const hasDepartments = await Department.findOne({ school_id: id });

    if (hasDepartments) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete school. Departments exist under this school.",
      });
    }

    // Delete
    await School.deleteOne({ school_id: id });

    return res.status(200).json({
      success: true,
      message: "School deleted successfully",
    });

  } catch (error) {
    console.error("Delete School Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting school",
      error: error.message,
    });
  }
};