// controllers/role.controller.js
import Role from "../models/userPowers/role.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Department from "../models/office/department.model.js";
import Power from "../models/userPowers/power.model.js";
import Employee from "../models/user/employee.model.js";

export const createRole = async (req, res) => {
  try {
    console.log("Received payload:", req.body);

    let {
      role_name,
      power_id,
      dept_ids,
      canReceiveNotesheet,
      view_scope,
      view_dept_ids,
    } = req.body;

    role_name = role_name?.trim();
    power_id = Number(power_id);
    view_scope = view_scope || "OWN";

    let deptIdsNumber = [];
    view_dept_ids = Array.isArray(view_dept_ids)
      ? view_dept_ids.map(Number)
      : [];

    // ===============================
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

    // FETCH POWER
    
    const power = await Power.findOne({ power_id });

    if (!power) {
      return res.status(404).json({
        success: false,
        message: "Power not found",
      });
    }

    // ===============================
    //  LOGIC BASED ON POWER TYPE
    // ===============================
    if (power.power_type === "APPROVAL") {
      //  Department REQUIRED
      if (!Array.isArray(dept_ids) || dept_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Department is required for Approval Authority",
        });
      }

      deptIdsNumber = dept_ids.map(Number);

      //  Validate departments
      const departments = await Department.find({
        dept_id: { $in: deptIdsNumber },
      });

      if (departments.length !== deptIdsNumber.length) {
        return res.status(404).json({
          success: false,
          message: "One or more departments not found",
        });
      }

      //  view_scope validation
      if (!["OWN", "DEPARTMENT"].includes(view_scope)) {
        return res.status(400).json({
          success: false,
          message: "Approval role can only have OWN or DEPARTMENT view",
        });
      }

      //  DEPARTMENT → must select view departments
      if (view_scope === "DEPARTMENT") {
        if (!view_dept_ids.length) {
          return res.status(400).json({
            success: false,
            message: "Select at least one department for view access",
          });
        }

        const viewDepts = await Department.find({
          dept_id: { $in: view_dept_ids },
        });

        if (viewDepts.length !== view_dept_ids.length) {
          return res.status(404).json({
            success: false,
            message: "Invalid view departments selected",
          });
        }
      }

      //  OWN → always empty
      if (view_scope === "OWN") {
        view_dept_ids = [];
      }
    }

    else if (power.power_type === "HIGHER") {
      //  Global role → no dept
      deptIdsNumber = [];

      //  view_scope validation
      if (!["OWN", "ALL"].includes(view_scope)) {
        return res.status(400).json({
          success: false,
          message: "Higher role can only have OWN or ALL view",
        });
      }

      //  No need of view_dept_ids
      view_dept_ids = [];
    }

    // ===============================
    // DUPLICATE ROLE CHECK
    // ===============================
    const existingRole = await Role.findOne({
      role_name: { $regex: new RegExp(`^${role_name}$`, "i") },
      dept_ids: deptIdsNumber,
    });

    if (existingRole) {
      return res.status(409).json({
        success: false,
        message:
          power.power_type === "HIGHER"
            ? "Global role already exists"
            : "Role already exists for selected departments",
      });
    }

    // ===============================
    //  GENERATE ROLE ID
    // ===============================
    const counter = await Counter.findOneAndUpdate(
      { name: "role_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // ===============================
    //  CREATE ROLE
    // ===============================
    const role = await Role.create({
      role_id: counter.seq,
      role_name,
      power_id: power.power_id,
      dept_ids: deptIdsNumber,
      canReceiveNotesheet: !!canReceiveNotesheet,
      view_scope,
      view_dept_ids,
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

// assignPowerToRole.js
export const assignPowerToRole = async (req, res) => {
  try {
    const { role_id, power_id } = req.body;

    console.log("Assign Power Request:", { role_id, power_id });

    if (!role_id || !power_id) {
      console.log("Validation failed: Role or Power missing");
      return res.status(400).json({ success: false, message: "Role and Power required" });
    }

    // Fetch role
    const role = await Role.findOne({ role_id });
    console.log("Fetched Role:", role);
    if (!role) {
      console.log("Role not found in DB");
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    // Fetch power
    const power = await Power.findOne({ power_id });
    console.log("Fetched Power:", power);
    if (!power) {
      console.log("Power not found in DB");
      return res.status(404).json({ success: false, message: "Power not found" });
    }

    // Update role
    role.power_id = power.power_id;
    role.power_level = power.power_level;
    role.power_type = power.power_type;
    await role.save();
    console.log("Role after save:", role);

    // Update employees having this role
    const employees = await Employee.find({ "roles.role_id": role.role_id });
    console.log(`Employees found with role ${role.role_name}:`, employees.length);

    for (let emp of employees) {
      emp.roles = emp.roles.map(r =>
        r.role_id === role.role_id
          ? { ...r.toObject(), power_level: power.power_level, power_type: power.power_type }
          : r
      );

      if (emp.active_role?.role_id === role.role_id) {
        emp.active_role.power_level = power.power_level;
        emp.active_role.power_type = power.power_type;
      }

      await emp.save();
      console.log(`Updated employee ${emp.emp_name} (${emp.emp_id})`);
    }

    return res.json({ success: true, message: "Power assigned to role successfully!", data: role });
  } catch (error) {
    console.error("Assign Power Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
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