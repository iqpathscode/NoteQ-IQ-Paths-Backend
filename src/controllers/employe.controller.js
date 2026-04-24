import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Notesheet from "../models/notes/notesheet.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import School from "../models/office/school.model.js";
import Admin from "../models/user/admin.model.js";
import Power from "../models/userPowers/power.model.js";

const employeeDetailsPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    {
      $lookup: {
        from: Department.collection.name,
        localField: "dept_id",
        foreignField: "dept_id",
        as: "department",
      },
    },
    {
      $lookup: {
        from: Notesheet.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "notesheets",
      },
    },
    {
      $addFields: {
        department_name: { $arrayElemAt: ["$department.dept_name", 0] },
        notesheet_count: { $size: "$notesheets" },
      },
    },
    {
      $project: {
        _id: 0,
        emp_id: 1,
        emp_name: 1,
        designation: 1,
        role_ids: 1,
        active_role_id: 1,
        dept_id: 1,
        department_name: 1,
        notesheet_count: 1,
      },
    },
  );

  return pipeline;
};

export const getEmployeesWithDetails = async (req, res) => {
  try {
    const employees = await Employee.aggregate(employeeDetailsPipeline());

    return res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      data: employees,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getEmployeeDetailsById = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId is required",
      });
    }

    const results = await Employee.aggregate(
      employeeDetailsPipeline({ $match: { emp_id: empId } }),
    );

    const employee = results[0];

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Employee fetched successfully",
      data: employee,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getEmployeeNotesheetSummary = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId is required",
      });
    }

    // Total notesheets created by the user
    const totalCount = await Notesheet.countDocuments({ emp_id: empId });

    //  Pending notesheets created by the user
    const pendingCount = await Notesheet.countDocuments({
      emp_id: empId,
      status: "PENDING",
    });

    //  Approved notesheets created by the user
    const approvedCount = await Notesheet.countDocuments({
      emp_id: empId,
      status: "APPROVED",
    });

    return res.status(200).json({
      success: true,
      message: "User-specific notesheet summary fetched successfully",
      data: {
        emp_id: empId,
        total: totalCount,
        byStatus: {
          PENDING: pendingCount,
          APPROVED: approvedCount,
        },
      },
    });
  } catch (error) {
    console.error("Summary Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// export const assignRoleToFaculty = async (req, res) => {
//   try {
//     const { emp_id, role_name, dept_id } = req.body;

//     // 1. Validate
//     if (!emp_id || !role_name) {
//       return res.status(400).json({
//         success: false,
//         message: "Employee ID and Role Name are required",
//       });
//     }

//     // 2. Find Employee
//     const employee = await Employee.findOne({ emp_id: Number(emp_id) });

//     if (!employee) {
//       return res.status(404).json({
//         success: false,
//         message: "Employee not found",
//       });
//     }

//     // 3. Find Role (case-insensitive + dept match)
//     const roleExists = await Role.findOne({
//       role_name: { $regex: new RegExp(`^${role_name}$`, "i") },
//       $or: [
//         { dept_ids: Number(dept_id) },
//         { dept_ids: { $size: 0 } }
//       ],
//     });

//     if (!roleExists) {
//       return res.status(404).json({
//         success: false,
//         message: "Role not found",
//       });
//     }

//     const roleId = roleExists.role_id;

//     //  4. STRICT UNIQUE CHECK (MOST IMPORTANT)
//     const roleAlreadyAssigned = await Employee.exists({
//       role_ids: roleId,
//       emp_id: { $ne: Number(emp_id) }, // exclude current employee
//     });

//     if (roleAlreadyAssigned) {
//       return res.status(400).json({
//         success: false,
//         message: "This role is already assigned to another employee",
//       });
//     }

//     //  5. DUPLICATE CHECK (same employee)
//     if (employee.role_ids?.includes(roleId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Employee already has this role",
//       });
//     }

//     //  6. ASSIGN ROLE
//     const updatedEmployee = await Employee.findOneAndUpdate(
//       { emp_id: Number(emp_id) },
//       {
//         $addToSet: { role_ids: roleId },
//         $set: {
//           active_role_id: employee.active_role_id || roleId,
//         },
//       },
//       { new: true }
//     );

//     return res.status(200).json({
//       success: true,
//       message: `Role "${roleExists.role_name}" assigned successfully`,
//       data: updatedEmployee,
//     });

//   } catch (error) {
//     console.error("Assign Role Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error assigning role",
//       error: error.message,
//     });
//   }
// };

// Update Role of Faculty


export const assignRoleToFaculty = async (req, res) => {
  try {
    const { emp_id, role_name } = req.body;

    // 1. Validate
    if (!emp_id || !role_name) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Role Name are required",
      });
    }

    // 2. Find Employee
    const employee = await Employee.findOne({ emp_id: Number(emp_id) });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // 3. Find Role
    const roleExists = await Role.findOne({
      role_name: { $regex: new RegExp(`^${role_name}$`, "i") },
    });

    if (!roleExists) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // 4. Get Power
    const power = await Power.findOne({ power_id: roleExists.power_id });

    if (!power) {
      return res.status(404).json({
        success: false,
        message: "Power not found for this role",
      });
    }

    const roleId = roleExists.role_id;
    const empDeptId = employee.dept_id;
    const empSchoolId = employee.school_id;
    const roleDeptIds = roleExists.dept_ids || [];

    // =========================================================
    //  5. CORE VALIDATION (FIXED)
    // =========================================================

    //  CASE 1: Department Level (HOD)
    if (power.scope === "DEPARTMENT") {
      if (!roleDeptIds.includes(empDeptId)) {
        return res.status(400).json({
          success: false,
          message: "Employee does not belong to this department",
        });
      }
    }

    //  CASE 2: School Level (Dean)
    if (power.scope === "SCHOOL") {

      //  Fetch departments of role
      const roleDepartments = await Department.find({
        dept_id: { $in: roleDeptIds },
      });

      //  Extract unique school_ids
      const roleSchoolIds = [
        ...new Set(roleDepartments.map((d) => d.school_id)),
      ];

      //  Validate
      if (!roleSchoolIds.includes(empSchoolId)) {
        return res.status(400).json({
          success: false,
          message: "Employee does not belong to this school",
        });
      }
    }

    //  CASE 3: Global (Admin / PVD)
    //  No restriction

    // =========================================================
    //  6. STRICT UNIQUE CHECK
    // =========================================================
    const roleAlreadyAssigned = await Employee.exists({
      role_ids: roleId,
      emp_id: { $ne: Number(emp_id) },
    });

    if (roleAlreadyAssigned) {
      return res.status(400).json({
        success: false,
        message: "This role is already assigned to another employee",
      });
    }

    // =========================================================
    //  7. DUPLICATE CHECK
    // =========================================================
    if (employee.role_ids?.includes(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Employee already has this role",
      });
    }

    // =========================================================
    //  8. ASSIGN ROLE
    // =========================================================
    const updatedEmployee = await Employee.findOneAndUpdate(
      { emp_id: Number(emp_id) },
      {
        $addToSet: { role_ids: roleId },
        $set: {
          active_role_id: employee.active_role_id || roleId,
        },
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: `Role "${roleExists.role_name}" assigned successfully`,
      data: updatedEmployee,
    });

  } catch (error) {
    console.error("Assign Role Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error assigning role",
      error: error.message,
    });
  }
};


export const updateRoleOfFaculty = async (req, res) => {
  try {
    const { emp_id, role_id } = req.body;

    if (!emp_id || !role_id) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and Role ID are required",
      });
    }

    const employee = await Employee.findOne({ emp_id });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const role = await Role.findOne({ role_id });
    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // ---------------- HOD UNIQUE CHECK ----------------
    if (role.role_name.toUpperCase().includes("HOD")) {
      const existingHOD = await Employee.findOne({
        roles: {
          $elemMatch: {
            role_name: { $regex: /HOD/i },
            dept_id: role.dept_id,
          },
        },
      });

      if (existingHOD && existingHOD.emp_id !== emp_id) {
        return res.status(400).json({
          success: false,
          message: `This department already has an HOD assigned (${existingHOD.emp_id})`,
        });
      }
    }

    // ---------------- Update active_role ----------------
    employee.active_role = {
      role_id: role.role_id,
      role_name: role.role_name,
      dept_id: role.dept_id,
      power_id: role.power_id,
      power_level: role.power_level ?? 0,
      canReceiveNotesheet: role.canReceiveNotesheet ?? false,
    };

    // ---------------- Update roles array ----------------
    const index = employee.roles.findIndex((r) => r.role_id === role.role_id);
    if (index !== -1) {
      // Replace existing role
      employee.roles[index] = employee.active_role;
    } else {
      // Add new role if missing
      employee.roles.push(employee.active_role);
    }

    await employee.save();

    return res.json({
      success: true,
      message: "Role updated successfully!",
      data: employee,
    });
  } catch (error) {
    console.error("Update Role Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const switchEmployeeRole = async (req, res) => {
  try {
    const { role_id } = req.body;
    const empId = req.user.emp_id;

    if (!role_id) {
      return res
        .status(400)
        .json({ success: false, message: "role_id is required" });
    }

    const employee = await Employee.findOne({ emp_id: empId });
    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    // Check role against role_ids array
    const hasRole = employee.role_ids.includes(Number(role_id));
    if (!hasRole) {
      return res
        .status(403)
        .json({ success: false, message: "You are not assigned this role" });
    }

    //  Fetch role details from Role table
    const roleFromRoleTable = await Role.findOne({ role_id }).lean();
    if (!roleFromRoleTable) {
      return res
        .status(404)
        .json({ success: false, message: "Role not found in Role table" });
    }

    //  Update active_role_id and optional full role object
    employee.active_role_id = Number(role_id);
    employee.active_role = {
      role_id: roleFromRoleTable.role_id,
      role_name: roleFromRoleTable.role_name,
      dept_id: employee.dept_id,
      power_id: roleFromRoleTable.power_id,
      power_level: roleFromRoleTable.power_level,
      canReceiveNotesheet: roleFromRoleTable.canReceiveNotesheet,
    };
    await employee.save();

    //  Generate new token with updated role
    const token = jwt.sign(
      {
        emp_id: employee.emp_id,
        role_id: roleFromRoleTable.role_id,
        dept_id: employee.dept_id,
        isAdmin: employee.isAdmin || false,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN },
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false, // change to true in production with HTTPS
    });

    console.log("active role after switch:", employee.active_role);
    console.log("New role token:", roleFromRoleTable.role_id);

    res.json({
      success: true,
      message: "Role switched successfully",
      active_role: employee.active_role,
    });
  } catch (error) {
    console.error("Error switching role:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// export const transferRole = async (req, res) => {
//   try {
//     let { roleId, newUserId } = req.body;
//     const roleIdNum = Number(roleId);

//     // CURRENT USER
//     const currentUser = await Employee.findOne({ role_ids: roleIdNum });
//     if (currentUser) {
//       currentUser.role_ids = currentUser.role_ids.filter(r => r !== roleIdNum);
//       if (currentUser.active_role_id === roleIdNum) currentUser.active_role_id = null;
//       await currentUser.save();
//     }

//     // NEW USER
//     const newUser = await Employee.findOne({ emp_id: newUserId });
//     if (!newUser) return res.status(404).json({ success: false, message: "New user not found" });

//     if (!newUser.role_ids) newUser.role_ids = [];
//     if (!newUser.role_ids.includes(roleIdNum)) newUser.role_ids.push(roleIdNum);
//     newUser.active_role_id = roleIdNum;
//     await newUser.save();

//     //  OPTIONAL: Log NotesheetFlow update for new holder
//     await NotesheetFlow.updateMany(
//       { to_role_id: roleIdNum, to_emp_id: null }, // unassigned flows
//       { $set: { to_emp_id: newUserId } }
//     );

//     return res.status(200).json({ success: true, message: "Role transferred successfully" });

//   } catch (err) {
//     console.error("transferRole Error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

export const transferRole = async (req, res) => {
  try {
    let { roleId, newUserId } = req.body;
    const roleIdNum = Number(roleId);

    if (!roleIdNum || !newUserId) {
      return res.status(400).json({
        success: false,
        message: "roleId and newUserId are required",
      });
    }

    //  Get Role
    const role = await Role.findOne({ role_id: roleIdNum });
    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    //  Get Power
    const power = await Power.findOne({ power_id: role.power_id });
    if (!power) {
      return res.status(404).json({
        success: false,
        message: "Power not found",
      });
    }

    //  New User
    const newUser = await Employee.findOne({ emp_id: newUserId });
    if (!newUser) {
      return res.status(404).json({
        success: false,
        message: "New user not found",
      });
    }

    const empDeptId = newUser.dept_id;
    const empSchoolId = newUser.school_id;
    const roleDeptIds = role.dept_ids || [];

    // =========================================================
    // VALIDATION (SAME AS ASSIGN ROLE)
    // =========================================================

    //  DEPARTMENT LEVEL
    if (power.scope === "DEPARTMENT") {
      if (!roleDeptIds.includes(empDeptId)) {
        return res.status(400).json({
          success: false,
          message: "Employee does not belong to this department",
        });
      }
    }

    //  SCHOOL LEVEL
    if (power.scope === "SCHOOL") {
      const roleDepartments = await Department.find({
        dept_id: { $in: roleDeptIds },
      });

      const roleSchoolIds = [
        ...new Set(roleDepartments.map((d) => d.school_id)),
      ];

      if (!roleSchoolIds.includes(empSchoolId)) {
        return res.status(400).json({
          success: false,
          message: "Employee does not belong to this school",
        });
      }
    }

    //  GLOBAL → no restriction

    // =========================================================
    //  REMOVE FROM CURRENT USER
    // =========================================================
    const currentUser = await Employee.findOne({ role_ids: roleIdNum });
console.log("Current User:", currentUser);
    if (currentUser) {
      currentUser.role_ids = currentUser.role_ids.filter(
        (r) => r !== roleIdNum
      );

      if (currentUser.active_role_id === roleIdNum) {
        currentUser.active_role_id = null;
      }

      await currentUser.save();
    }

    // =========================================================
    //  ADD TO NEW USER
    // =========================================================
    if (!newUser.role_ids) newUser.role_ids = [];

    if (newUser.role_ids.includes(roleIdNum)) {
      return res.status(400).json({
        success: false,
        message: "User already has this role",
      });
    }

    newUser.role_ids.push(roleIdNum);
    newUser.active_role_id = roleIdNum;

    await newUser.save();

    // =========================================================
    // UPDATE NOTESHEET FLOW
    // =========================================================
    await NotesheetFlow.updateMany(
      { to_role_id: roleIdNum, to_emp_id: null },
      { $set: { to_emp_id: newUserId } }
    );

    return res.status(200).json({
      success: true,
      message: "Role transferred successfully",
    });

  } catch (err) {
    console.error("transferRole Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
// ================= GET PROFILE =================
// export const getProfile = async (req, res) => {
//   try {
//     const empId = req.user.emp_id;

//     const employee = await Employee.findOne({ emp_id: empId }).select("-password");

//     if (!employee) {
//       return res.status(404).json({
//         success: false,
//         message: "Employee not found",
//       });
//     }

//     //  manual fetch (NO populate)
//     const department = await Department.findOne({
//       dept_id: employee.dept_id,
//     });

//     const school = await School.findOne({
//       school_id: employee.school_id,
//     });

//     res.status(200).json({
//       success: true,
//       data: {
//         ...employee.toObject(),

//         //  frontend ke liye same structure bana diya
//         department: department
//           ? { name: department.dept_name }
//           : null,

//         school: school
//           ? { name: school.school_name }
//           : null,
//       },
//     });
//   } catch (error) {
//     console.error("Profile Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server Error",
//     });
//   }
// };

export const getProfile = async (req, res) => {
  try {
    console.log("USER FROM TOKEN:", req.user);

    //  ADMIN
    if (req.user.isAdmin) {
      const admin = await Admin.findOne({
        admin_id: req.user.admin_id,
      }).select("-password");

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          ...admin.toObject(),

          //  ADD THIS (IMPORTANT)
          name: admin.admin_name,

          department: { name: "All Departments" },
          school: { name: "All Schools" },
        },
      });
    }

    //  EMPLOYEE
    const employee = await Employee.findOne({
      emp_id: req.user.emp_id,
    }).select("-password");

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const [department, school] = await Promise.all([
      employee.dept_id
        ? Department.findOne({ dept_id: employee.dept_id })
        : null,
      employee.school_id
        ? School.findOne({ school_id: employee.school_id })
        : null,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...employee.toObject(),

        //  ADD THIS (IMPORTANT)
        name: employee.emp_name,

        department: department
          ? { name: department.dept_name }
          : null,

        school: school
          ? { name: school.school_name }
          : null,
      },
    });

  } catch (error) {
    console.error("Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { mobile_number, designation } = req.body; 

    //  ADMIN FLOW
    if (req.user.isAdmin) {
      const updatedAdmin = await Admin.findOneAndUpdate(
        { admin_id: req.user.admin_id },
        {
          mobile_number,
          designation,
        },
        { new: true }
      ).select("-password");

      if (!updatedAdmin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: {
          ...updatedAdmin.toObject(),
          department: { name: "All Departments" },
          school: { name: "All Schools" },
        },
      });
    }

    //  EMPLOYEE FLOW
    const updatedEmployee = await Employee.findOneAndUpdate(
      { emp_id: req.user.emp_id },
      {
        mobile_number,
        designation,      },
      { new: true }
    ).select("-password");

    if (!updatedEmployee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const [department, school] = await Promise.all([
      updatedEmployee.dept_id
        ? Department.findOne({ dept_id: updatedEmployee.dept_id })
        : null,
      updatedEmployee.school_id
        ? School.findOne({ school_id: updatedEmployee.school_id })
        : null,
    ]);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        ...updatedEmployee.toObject(),
        department: department ? { name: department.dept_name } : null,
        school: school ? { name: school.school_name } : null,
      },
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({
      success: false,
      message: "Update failed",
    });
  }
};