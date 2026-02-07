// controllers/power.controller.js
import Power from "../models/userPowers/power.model.js";
import { Counter } from "../models/counter/counter.model.js";

export const createPower = async (req, res) => {
  try {
    const { power_name, power_rank, power_type } = req.body;

    // 1. Validate power_name
    if (!power_name || power_name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Power name is required",
      });
    }

    // 2. Validate power_type (enum safety)
    const allowedTypes = ["APPROVAL", "FORWARD", "ADMIN"];
    if (!power_type || !allowedTypes.includes(power_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid power_type. Allowed values: ${allowedTypes.join(", ")}`,
      });
    }

    // 3. Prevent duplicate power_name
    const existingPower = await Power.findOne({ power_name });
    if (existingPower) {
      return res.status(409).json({
        success: false,
        message: "Power already exists",
      });
    }

    // 4. Generate auto-increment power_id (atomic)
    const counter = await Counter.findOneAndUpdate(
      { name: "power_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // 5. Create power (respect defaults)
    const power = await Power.create({
      power_id: counter.seq,
      power_name,
      power_rank: power_rank ?? 0, // IMPORTANT: don't break default
      power_type,
    });

    return res.status(201).json({
      success: true,
      message: "Power created successfully",
      data: power,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
