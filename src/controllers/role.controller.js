// controllers/role.controller.js
import Role from "../models/userPowers/role.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Department from "../models/office/department.model.js";
import Power from "../models/userPowers/power.model.js";

export const createPowerLevel = async (req, res) => {
  try {
    console.log("Received payload:", req.body);
    let { role_name, power_name, dept_id } = req.body; //  frontend se power_name aayega

    role_name = role_name?.trim();

    if (!role_name) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }

    if (!power_name) {
      return res.status(400).json({ success: false, message: "Power name is required" });
    }

    if (!dept_id) {
      return res.status(400).json({ success: false, message: "Department ID is required" });
    }

    const departmentExists = await Department.findOne({ dept_id });
    if (!departmentExists) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    // Find power by name
   const power = await Power.findOne({ power_name: new RegExp(`^${power_name}$`, "i") });
    if (!power) {
      return res.status(404).json({ success: false, message: "Power not found" });
    }

    const existingRole = await Role.findOne({
      role_name: { $regex: new RegExp(`^${role_name}$`, "i") },
      dept_id,
    });
    if (existingRole) {
      return res.status(409).json({ success: false, message: "Role already exists in this department" });
    }

    const counter = await Counter.findOneAndUpdate(
      { name: "role_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const role = await Role.create({
      role_id: counter.seq,
      role_name,
      power_id: power.power_id, //  backend assigns automatically
      dept_id,
    });

    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: role,
    });
  } catch (error) {
    console.error("Create Role Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};



export const getAllPowerLevels = async (req, res) => {
  try {
    const roles = await Role.find()
      .populate("dept_id") // if ObjectId ref
      .sort({ power_level: 1 });

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
      return res.status(400).json({ success: false, message: "Role and Power required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    role.power_id = power_id;
    await role.save();

    return res.json({ success: true, message: "Power assigned to role successfully!" });
  } catch (error) {
    console.error("Assign Power Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Assign Department to Role
export const assignDeptToRole = async (req, res) => {
  try {
    const { role_id, dept_ids } = req.body;
    if (!role_id || !dept_ids || dept_ids.length === 0) {
      return res.status(400).json({ success: false, message: "Role and Departments required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    // Verify departments exist
    const validDepts = await Department.find({ dept_id: { $in: dept_ids } });
    if (validDepts.length !== dept_ids.length) {
      return res.status(400).json({ success: false, message: "One or more departments not found" });
    }

    role.dept_ids = dept_ids;
    await role.save();

    return res.json({ success: true, message: "Departments assigned to role successfully!" });
  } catch (error) {
    console.error("Assign Dept Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Update Departments of Role
export const updateDeptOfRole = async (req, res) => {
  try {
    const { role_id, dept_ids } = req.body;
    if (!role_id || !dept_ids || dept_ids.length === 0) {
      return res.status(400).json({ success: false, message: "Role and Departments required" });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    role.dept_ids = dept_ids;
    await role.save();

    return res.json({ success: true, message: "Departments updated for role successfully!" });
  } catch (error) {
    console.error("Update Dept Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
