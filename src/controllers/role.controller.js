// controllers/role.controller.js
import  Role  from "../models/userPowers/role.model.js";
import { Counter } from "../models/counter/counter.model.js";
import  Department  from "../models/office/department.model.js";

export const createPowerLevel = async (req, res) => {
  try {
    const { role_name, power_level, dept_id } = req.body;

    // 1. Validate input
    if (!role_name || role_name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    if (power_level === undefined || power_level === null) {
      return res.status(400).json({
        success: false,
        message: "Power level is required",
      });
    }

    if (!dept_id) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }

    // 2. Verify department exists (CRITICAL)
    const departmentExists = await Department.findOne({ dept_id });
    if (!departmentExists) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    // 3. Prevent duplicate role in same department
    const existingRole = await Role.findOne({
      role_name,
      dept_id,
    });

    if (existingRole) {
      return res.status(409).json({
        success: false,
        message: "Role already exists in this department",
      });
    }

    // 4. Auto-increment role_id (atomic)
    const counter = await Counter.findOneAndUpdate(
      { name: "role_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // 5. Create role / power level
    const role = await Role.create({
      role_id: counter.seq,
      role_name,
      power_level,
      dept_id,
    });

    // 6. Respond
    return res.status(201).json({
      success: true,
      message: "Power level created successfully",
      data: role,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};



// role power_level will be fetched from the database and given by the user

// controllers/role.controller.js
// import { Role } from "../models/role.model.js";
// import { Counter } from "../models/counter.model.js";
// import { Department } from "../models/department.model.js";
// import { PowerLevel } from "../models/powerLevel.model.js";

// export const createPowerLevelRole = async (req, res) => {
//   try {
//     const { role_name, power_level, dept_id } = req.body;

//     // 1. Validate input
//     if (!role_name || role_name.trim() === "") {
//       return res.status(400).json({
//         success: false,
//         message: "Role name is required",
//       });
//     }

//     if (power_level === undefined || power_level === null) {
//       return res.status(400).json({
//         success: false,
//         message: "Power level is required",
//       });
//     }

//     if (!dept_id) {
//       return res.status(400).json({
//         success: false,
//         message: "Department ID is required",
//       });
//     }

//     // 2. Validate department exists
//     const department = await Department.findOne({ dept_id });
//     if (!department) {
//       return res.status(404).json({
//         success: false,
//         message: "Department not found",
//       });
//     }

//     // 3. Validate power level exists (THIS IS THE CHANGE)
//     const validPowerLevel = await PowerLevel.findOne({ power_level });
//     if (!validPowerLevel) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid power level",
//       });
//     }

//     // 4. Prevent duplicate role per department
//     const existingRole = await Role.findOne({ role_name, dept_id });
//     if (existingRole) {
//       return res.status(409).json({
//         success: false,
//         message: "Role already exists in this department",
//       });
//     }

//     // 5. Auto-increment role_id
//     const counter = await Counter.findOneAndUpdate(
//       { name: "role_id" },
//       { $inc: { seq: 1 } },
//       { new: true, upsert: true }
//     );

//     // 6. Create role using DB-validated power_level
//     const role = await Role.create({
//       role_id: counter.seq,
//       role_name,
//       power_level: validPowerLevel.power_level,
//       dept_id,
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Role created successfully",
//       data: role,
//     });

//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };
