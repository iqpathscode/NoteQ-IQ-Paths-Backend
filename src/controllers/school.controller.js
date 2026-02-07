import  School  from "../models/office/school.model.js";
import { Counter } from "../models/counter/counter.model.js";

export const createSchool = async (req, res) => {
  try {
    const { school_name } = req.body;

    // 1. Validate
    if (!school_name || school_name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "School name is required",
      });
    }

    // 2. Check duplicate school name
    const existingSchool = await School.findOne({ school_name });
    if (existingSchool) {
      return res.status(409).json({
        success: false,
        message: "School already exists",
      });
    }

    // 3. Get next school_id (ATOMIC OPERATION)
    const counter = await Counter.findOneAndUpdate(
      { name: "school_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // 4. Create school
    const school = await School.create({
      school_id: counter.seq,
      school_name,
    });

    // 5. Respond
    return res.status(201).json({
      success: true,
      message: "School created successfully",
      data: school,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
