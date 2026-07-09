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

// const employeeDetailsPipeline = (matchStage = null) => {
//   const pipeline = [];

//   if (matchStage) {
//     pipeline.push(matchStage);
//   }

//   pipeline.push(
//     {
//       $lookup: {
//         from: Department.collection.name,
//         localField: "dept_id",
//         foreignField: "dept_id",
//         as: "department",
//       },
//     },
//     {
//       $lookup: {
//         from: Notesheet.collection.name,
//         localField: "emp_id",
//         foreignField: "emp_id",
//         as: "notesheets",
//       },
//     },
//     {
//       $addFields: {
//         department_name: { $arrayElemAt: ["$department.dept_name", 0] },
//         notesheet_count: { $size: "$notesheets" },
//       },
//     },
//     {
//       $project: {
//         _id: 0,
//         emp_id: 1,
//         emp_name: 1,
//         designation: 1,
//         role_ids: 1,
//         active_role_id: 1,
//         dept_id: 1,
//         department_name: 1,
//         notesheet_count: 1,
//       },
//     },
//   );

//   return pipeline;
// };

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CLOSED", "IN_EXECUTION"];

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
      // NOTE: foreignField "emp_id" se "created_by_emp_id" kiya —
      // kyunki hume ye batana hai employee ne KYA CREATE kiya, na ki
      // Notesheet.emp_id field (jo current holder / owner bhi ho sakta hai)
      $lookup: {
        from: Notesheet.collection.name,
        localField: "emp_id",
        foreignField: "created_by_emp_id",
        as: "notesheets",
      },
    },
    {
      // role_ids resolve karne ke liye role_name laane ka lookup
      $lookup: {
        from: Role.collection.name, // apna actual Role collection name confirm kar lena
        localField: "notesheets.created_by_role_id",
        foreignField: "role_id", // Role model me numeric role_id field ka naam confirm kar lena
        as: "rolesInfo",
      },
    },
    {
      $addFields: {
        department_name: { $arrayElemAt: ["$department.dept_name", 0] },

        // ---- PERSONAL: created_by_role_id === null ----
        personal_notesheets: {
          $filter: {
            input: "$notesheets",
            as: "ns",
            cond: { $eq: ["$$ns.created_by_role_id", null] },
          },
        },

        // ---- ROLE-BASED: created_by_role_id !== null ----
        role_notesheets: {
          $filter: {
            input: "$notesheets",
            as: "ns",
            cond: { $ne: ["$$ns.created_by_role_id", null] },
          },
        },
      },
    },
    {
      $addFields: {
        // ---- Personal summary (status-wise) ----
        personal_summary: {
          total: { $size: "$personal_notesheets" },
          byStatus: {
            $arrayToObject: {
              $map: {
                input: STATUSES,
                as: "st",
                in: [
                  "$$st",
                  {
                    $size: {
                      $filter: {
                        input: "$personal_notesheets",
                        as: "ns",
                        cond: { $eq: ["$$ns.status", "$$st"] },
                      },
                    },
                  },
                ],
              },
            },
          },
        },

        // is employee ne jitne distinct roles se notesheets banayi hain
        distinct_role_ids: {
          $setUnion: ["$role_notesheets.created_by_role_id", []],
        },
      },
    },
    {
      $addFields: {
        // ---- Role-wise summary (har role ka alag total + status breakdown) ----
        role_wise_summary: {
          $map: {
            input: "$distinct_role_ids",
            as: "rid",
            in: {
              role_id: "$$rid",
              role_name: {
                $let: {
                  vars: {
                    matchedRole: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$rolesInfo",
                            as: "r",
                            cond: { $eq: ["$$r.role_id", "$$rid"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: { $ifNull: ["$$matchedRole.role_name", "Unknown Role"] },
                },
              },
              total: {
                $size: {
                  $filter: {
                    input: "$role_notesheets",
                    as: "ns",
                    cond: { $eq: ["$$ns.created_by_role_id", "$$rid"] },
                  },
                },
              },
              byStatus: {
                $arrayToObject: {
                  $map: {
                    input: STATUSES,
                    as: "st",
                    in: [
                      "$$st",
                      {
                        $size: {
                          $filter: {
                            input: "$role_notesheets",
                            as: "ns",
                            cond: {
                              $and: [
                                { $eq: ["$$ns.created_by_role_id", "$$rid"] },
                                { $eq: ["$$ns.status", "$$st"] },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },

        // backward-compatible flat total (agar kahi already use ho raha ho)
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
        personal_summary: 1,
        role_wise_summary: 1,
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
    console.log("🔍 [Summary] Request received for empId:", empId);

    if (!empId) {
      console.log("❌ [Summary] empId missing/invalid");
      return res.status(400).json({
        success: false,
        message: "empId is required",
      });
    }

    // ✅ FIXED: "EXECUTION_STARTED" -> "IN_EXECUTION" (DB ke actual status value se match)
    const STATUSES = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "CLOSED",
      "IN_EXECUTION",
    ];

    const emptyStatusMap = () =>
      STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});

    // ---------------------------------------------------------
    // 1) EMPLOYEE'S OWN PERSONAL SUMMARY
    //    created_by_emp_id = empId  AND  created_by_role_id = null
    // ---------------------------------------------------------
    const ownAgg = await Notesheet.aggregate([
      {
        $match: {
          created_by_emp_id: empId,
          created_by_role_id: null,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const ownByStatus = emptyStatusMap();
    let ownTotal = 0;
    ownAgg.forEach((r) => {
      if (ownByStatus.hasOwnProperty(r._id)) ownByStatus[r._id] = r.count;
      ownTotal += r.count;
    });

    // ---------------------------------------------------------
    // 2) ROLE-WISE SUMMARY
    //    created_by_emp_id = empId  AND  created_by_role_id != null
    //    grouped by created_by_role_id
    // ---------------------------------------------------------
    const roleWiseAgg = await Notesheet.aggregate([
      {
        $match: {
          created_by_emp_id: empId,
          created_by_role_id: { $ne: null },
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: {
            role_id: "$created_by_role_id",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      {
        // ✅ FIXED: created_by_role_id Number hai, Role collection ka ObjectId "_id" nahi.
        // isliye "role_id" (numeric field) se match karo, na ki "_id" se.
        $lookup: {
          from: "roles", // apna actual Role collection ka naam confirm kar lena
          localField: "_id.role_id",
          foreignField: "role_id", // Role model me numeric field ka naam confirm kar lena
          as: "roleInfo",
        },
      },
    ]);

    const roleMap = {};

    roleWiseAgg.forEach((r) => {
      const roleId = String(r._id.role_id);
      const status = r._id.status;
      const roleName = r.roleInfo?.[0]?.role_name || "Unknown Role";

      if (!roleMap[roleId]) {
        roleMap[roleId] = {
          role_id: roleId,
          role_name: roleName,
          total: 0,
          byStatus: emptyStatusMap(),
        };
      }

      if (roleMap[roleId].byStatus.hasOwnProperty(status)) {
        roleMap[roleId].byStatus[status] = r.count;
      }
      roleMap[roleId].total += r.count;
    });

    // ---------------------------------------------------------
    // 3) GRAND TOTAL (own + all roles combined)
    // ---------------------------------------------------------
    const grandTotal = ownTotal + Object.values(roleMap).reduce((sum, r) => sum + r.total, 0);
    const grandByStatus = emptyStatusMap();
    STATUSES.forEach((s) => {
      grandByStatus[s] =
        ownByStatus[s] + Object.values(roleMap).reduce((sum, r) => sum + r.byStatus[s], 0);
    });

    return res.status(200).json({
      success: true,
      message: "Employee personal + role-wise notesheet summary fetched successfully",
      data: {
        emp_id: empId,
        grandTotal: {
          total: grandTotal,
          byStatus: grandByStatus,
        },
        ownProfile: {
          total: ownTotal,
          byStatus: ownByStatus,
        },
        roleWise: Object.values(roleMap),
      },
    });
  } catch (error) {
    console.error("❌ [Summary Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

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
      { new: true },
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

export const switchEmployeeRole = async (req, res) => {
  try {
    const { role_id } = req.body;
    const empId = req.user.emp_id;

    const employee = await Employee.findOne({ emp_id: empId });
    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    // =========================
    // PERSONAL MODE (role_id is null)
    // =========================
    if (role_id === null || role_id === undefined) {
      employee.active_role_id = null;
      employee.active_role = null;
      await employee.save();

      const token = jwt.sign(
        {
          emp_id: employee.emp_id,
          role_id: null,
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

      return res.json({
        success: true,
        message: "Switched to personal profile",
        active_role: null,
      });
    }

    // =========================
    // ROLE MODE (existing logic)
    // =========================

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
      view_scope: roleFromRoleTable.view_scope || "MY",
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
        (r) => r !== roleIdNum,
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
      { $set: { to_emp_id: newUserId } },
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

        department: department ? { name: department.dept_name } : null,

        school: school ? { name: school.school_name } : null,
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

    // SIGNATURE URL
    let signature = undefined;

    if (req.file) {
      signature = req.file.secure_url || req.file.path;
    }

    // ← Pehle existing signature DB se fetch karo
    const existingEmployee = !req.user.isAdmin
      ? await Employee.findOne({ emp_id: req.user.emp_id }).select("signature")
      : null;

    const existingSignature = existingEmployee?.signature || null;

    // signature sirf employee ke liye mandatory hai
    if (!req.user.isAdmin && !req.file && !existingSignature) {
      return res.status(400).json({
        success: false,
        message: "Signature is required",
      });
    }

    // ================= ADMIN FLOW =================
    if (req.user.isAdmin) {
      const updatedAdmin = await Admin.findOneAndUpdate(
        { admin_id: req.user.admin_id },
        {
          mobile_number,
          designation,
          ...(signature && { signature }),
        },
        { new: true },
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

    // ================= EMPLOYEE FLOW =================
    const updatedEmployee = await Employee.findOneAndUpdate(
      { emp_id: req.user.emp_id },
      {
        mobile_number,
        designation,
        ...(signature && { signature }),
      },
      { new: true },
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
