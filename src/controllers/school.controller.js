import School from "../models/office/school.model.js";
import { Counter } from "../models/counter/counter.model.js";

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