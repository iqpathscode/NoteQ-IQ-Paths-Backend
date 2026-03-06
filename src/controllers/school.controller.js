import School from "../models/office/school.model.js";
import { Counter } from "../models/counter/counter.model.js";

const schoolListPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    {
      $project: {
        _id: 0,
        school_id: 1,
        school_name: 1,
      },
    },
    {
      $sort: { school_name: 1 },
    }
  );

  return pipeline;
};

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

export const getSchools = async (req, res) => {
  try {
    const search = req.query.search?.trim();
    const matchStage = search
      ? {
          $match: {
            school_name: { $regex: search, $options: "i" },
          },
        }
      : null;

    const schools = await School.aggregate(schoolListPipeline(matchStage));

    return res.status(200).json({
      success: true,
      message: "Schools fetched successfully",
      data: schools,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
