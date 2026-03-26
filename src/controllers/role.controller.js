// controllers/role.controller.js
import Role from "../models/userPowers/role.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Department from "../models/office/department.model.js";
import Power from "../models/userPowers/power.model.js";

export const createRole = async (req, res) => {
  try {
    console.log("Received payload:", req.body);

    let { role_name, power_id, dept_ids, canReceiveNotesheet } = req.body;

    //  Trim & convert
    role_name = role_name?.trim();
    power_id = Number(power_id);

    //  Validations
    if (!role_name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    if (!power_id) {
      return res.status(400).json({
        success: false,
        message: "Power ID is required",
      });
    }

    if (!Array.isArray(dept_ids) || dept_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one department is required",
      });
    }

    //  Convert dept_ids → numbers
    const deptIdsNumber = dept_ids.map(Number);

    //  Check departments exist
    const departments = await Department.find({
      dept_id: { $in: deptIdsNumber },
    });

    if (departments.length !== deptIdsNumber.length) {
      return res.status(404).json({
        success: false,
        message: "One or more departments not found",
      });
    }

    //  Fetch power (IMPORTANT)
    const power = await Power.findOne({ power_id });

    if (!power) {
      return res.status(404).json({
        success: false,
        message: "Power not found",
      });
    }

    //  Duplicate role check (same name + same departments)
    const existingRole = await Role.findOne({
      role_name: { $regex: new RegExp(`^${role_name}$`, "i") },
      dept_ids: { $all: deptIdsNumber, $size: deptIdsNumber.length },
    });

    if (existingRole) {
      return res.status(409).json({
        success: false,
        message: "Role already exists for selected departments",
      });
    }

    //  Increment role_id
    const counter = await Counter.findOneAndUpdate(
      { name: "role_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    //  Create role (AUTO power_level from Power table)
    const role = await Role.create({
      role_id: counter.seq,
      role_name,
      power_id: power.power_id,
      power_level: power.power_level,
      dept_ids: deptIdsNumber,
      canReceiveNotesheet: !!canReceiveNotesheet,
    });

    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: role,
    });

  } catch (error) {
    console.error("Create Role Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ power_level: 1 });

    return res.status(200).json({
      success: true,
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error("Get Roles Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching power levels",
    });
  }
};

// Assign Power to Role
export const assignPowerToRole = async (req, res) => {
  try {
    const { role_id, power_id } = req.body;
    if (!role_id || !power_id) {
      return res
        .status(400)
        .json({ success: false, message: "Role and Power required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });
    }

    role.power_id = power_id;
    await role.save();

    return res.json({
      success: true,
      message: "Power assigned to role successfully!",
    });
  } catch (error) {
    console.error("Assign Power Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Assign Department to Role
export const assignDeptToRole = async (req, res) => {
  try {
    const { role_id, dept_ids } = req.body;
    if (!role_id || !dept_ids || dept_ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Role and Departments required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });
    }

    // Verify departments exist
    const validDepts = await Department.find({ dept_id: { $in: dept_ids } });
    if (validDepts.length !== dept_ids.length) {
      return res
        .status(400)
        .json({ success: false, message: "One or more departments not found" });
    }

    role.dept_ids = dept_ids;
    await role.save();

    return res.json({
      success: true,
      message: "Departments assigned to role successfully!",
    });
  } catch (error) {
    console.error("Assign Dept Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Update Departments of Role
export const updateDeptOfRole = async (req, res) => {
  try {
    const { role_id, dept_ids } = req.body;
    if (!role_id || !dept_ids || dept_ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Role and Departments required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });
    }

    role.dept_ids = dept_ids;
    await role.save();

    return res.json({
      success: true,
      message: "Departments updated for role successfully!",
    });
  } catch (error) {
    console.error("Update Dept Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};


export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Check if role exists
    const role = await Role.findOne({ role_id: id });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Optional (IMPORTANT): check if role assigned to employees
    // (agar Employee model me roles store hote hain)
    // const isUsed = await Employee.findOne({ "roles.role_id": Number(id) });
    // if (isUsed) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Cannot delete role. It is assigned to employees.",
    //   });
    // }

    // Delete
    await Role.deleteOne({ role_id: id });

    return res.status(200).json({
      success: true,
      message: "Role deleted successfully",
    });

  } catch (error) {
    console.error("Delete Role Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting role",
      error: error.message,
    });
  }
};