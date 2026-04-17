// controllers/power.controller.js
import Power from "../models/userPowers/power.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js"; // ensure correct path
import Role from "../models/userPowers/role.model.js"; // ensure correct path

export const createPower = async (req, res) => {
  try {
    let { power_name, power_level, power_type, canReceiveNotesheet } = req.body;

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
    const allowedTypes = ["APPROVAL", "HIGHER"];
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
      power_level: power_level ?? 0,
      power_type,
      canReceiveNotesheet: canReceiveNotesheet ?? false 
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
    const powers = await Power.find().sort({ power_level: 1 });

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


// Update Power of Faculty for specific role
export const updatePowerOfFaculty = async (req, res) => {
  try {
    const { emp_id, role_id, power_id } = req.body;

    if (!emp_id || !role_id || !power_id) {
      return res.status(400).json({
        success: false,
        message: "Employee ID, Role ID, and Power ID are required",
      });
    }

    const employee = await Employee.findOne({ emp_id });
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const role = employee.roles.find((r) => r.role_id === Number(role_id));
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not selected or not found" });
    }

    // Verify power exists
    const powerExists = await Power.findOne({ power_id: Number(power_id) });
    if (!powerExists) {
      return res.status(404).json({ success: false, message: "Power not found" });
    }

    // Update power for selected role
    role.power_id = Number(power_id);
    await employee.save();

    return res.json({ success: true, message: "Power updated successfully!", data: employee });
  } catch (error) {
    console.error("Update Power Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const deletePower = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validate
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Power ID is required",
      });
    }

    const powerId = Number(id);

    // 2. Check if power exists
    const power = await Power.findOne({ power_id: powerId });

    if (!power) {
      return res.status(404).json({
        success: false,
        message: "Power not found",
      });
    }

    // ✅ 3. MOST IMPORTANT: check role dependency
    const roleExists = await Role.exists({ power_id: powerId });

    if (roleExists) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete power. It is assigned to one or more roles.",
      });
    }

    // 4. Delete (only if safe)
    await Power.deleteOne({ power_id: powerId });

    return res.status(200).json({
      success: true,
      message: "Power deleted successfully",
    });

  } catch (error) {
    console.error("Delete Power Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting power",
      error: error.message,
    });
  }
};