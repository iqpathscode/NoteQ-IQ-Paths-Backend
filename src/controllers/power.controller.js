// controllers/power.controller.js
import Power from "../models/userPowers/power.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js"; // ensure correct path

export const createPower = async (req, res) => {
  try {
    let { power_name, power_rank, power_type, canReceiveNotesheet } = req.body;

    // Trim values
    power_name = power_name?.trim();

    // Validate power_name
    if (!power_name) {
      return res.status(400).json({
        success: false,
        message: "Power name is required",
      });
    }

    // Validate power_type (Enum Safety)
    const allowedTypes = ["APPROVAL", "FORWARD", "ADMIN"];
    if (!allowedTypes.includes(power_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid power_type. Allowed values: ${allowedTypes.join(", ")}`,
      });
    }

    // Case-insensitive duplicate check
    const existingPower = await Power.findOne({
      power_name: { $regex: new RegExp(`^${power_name}$`, "i") },
    });

    if (existingPower) {
      return res.status(409).json({
        success: false,
        message: "Power already exists",
      });
    }

    // Atomic auto-increment power_id
    const counter = await Counter.findOneAndUpdate(
      { name: "power_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // Create power with flag
    const power = await Power.create({
      power_id: counter.seq,
      power_name,
      power_rank: power_rank ?? 0,
      power_type,
      canReceiveNotesheet: canReceiveNotesheet ?? false // 👈 added
    });

    return res.status(201).json({
      success: true,
      message: "Power created successfully",
      data: power,
    });
  } catch (error) {
    console.error("Create Power Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


export const getAllPowers = async (req, res) => {
  try {
    const powers = await Power.find().sort({ power_rank: 1 });

    return res.status(200).json({
      success: true,
      count: powers.length,
      data: powers,
    });
  } catch (error) {
    console.error("Get Powers Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching powers",
    });
  }
};


// Update Power of Faculty
export const updatePowerOfFaculty = async (req, res) => {
  try {
    const { emp_id, power_id } = req.body;

    //  Validate input
    if (!emp_id || !power_id) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Power ID are required",
      });
    }

    //  Verify employee exists
    const employee = await Employee.findOne({ emp_id });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    //  Verify power exists
    const powerExists = await Power.findOne({ power_id });
    if (!powerExists) {
      return res.status(404).json({
        success: false,
        message: "Power not found",
      });
    }

    //  Update employee's power
    employee.power_id = power_id;
    await employee.save();

    return res.json({
      success: true,
      message: "Power updated successfully!",
      data: employee,
    });
  } catch (error) {
    console.error("Update Power Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
