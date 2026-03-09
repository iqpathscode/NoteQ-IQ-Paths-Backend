import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Notesheet from "../models/notes/notesheet.model.js";
import Role from "../models/userPowers/role.model.js";

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
        as: "department"
      }
    },
    {
      $lookup: {
        from: Notesheet.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "notesheets"
      }
    },
    {
      $addFields: {
        department_name: { $arrayElemAt: ["$department.dept_name", 0] },
        notesheet_count: { $size: "$notesheets" }
      }
    },
    {
      $project: {
        _id: 0,
        emp_id: 1,
        emp_name: 1,
        designation: 1,
        dept_id: 1,
        department_name: 1,
        notesheet_count: 1
      }
    }
  );

  return pipeline;
};

export const getEmployeesWithDetails = async (req, res) => {
  try {
    const employees = await Employee.aggregate(employeeDetailsPipeline());

    return res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      data: employees
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getEmployeeDetailsById = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId is required"
      });
    }

    const results = await Employee.aggregate(
      employeeDetailsPipeline({ $match: { emp_id: empId } })
    );

    const employee = results[0];

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Employee fetched successfully",
      data: employee
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getEmployeeNotesheetSummary = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId is required"
      });
    }

    const summary = await Notesheet.aggregate([
      { $match: { emp_id: empId } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const countsByStatus = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0
    };

    for (const item of summary) {
      if (item?._id && countsByStatus[item._id] !== undefined) {
        countsByStatus[item._id] = item.count;
      }
    }

    const total =
      countsByStatus.PENDING +
      countsByStatus.APPROVED +
      countsByStatus.REJECTED;

    return res.status(200).json({
      success: true,
      message: "Notesheet summary fetched successfully",
      data: {
        emp_id: empId,
        total,
        byStatus: countsByStatus
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

// Assign Role to Faculty
export const assignRoleToFaculty = async (req, res) => {
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

    const roleExists = await Role.findOne({ role_id });
    if (!roleExists) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    employee.roles = employee.roles || [];

    const alreadyHasRole = employee.roles.some(
      (r) => r.role_id === role_id
    );

    if (!alreadyHasRole) {
      const newRole = {
        role_id,
        role_name: roleExists.role_name,
      };

      employee.roles.push(newRole);

      // first role -> set active role
      if (!employee.active_role || !employee.active_role.role_id) {
        employee.active_role = newRole;
      }

      await employee.save();
    }

    return res.json({
      success: true,
      message: alreadyHasRole
        ? "Role already assigned!"
        : "Role assigned successfully!",
      data: employee,
    });
  } catch (error) {
    console.error("Assign Role Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update Role of Faculty
export const updateRoleOfFaculty = async (req, res) => {
  try {
    const { emp_id, role_id, newRoleName } = req.body;

    if (!emp_id || !role_id || !newRoleName) {
      return res.status(400).json({
        success: false,
        message: "Employee ID, Role ID and newRoleName are required",
      });
    }

    const employee = await Employee.findOne({ emp_id });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    let roleUpdated = false;

    employee.roles = employee.roles.map((role) => {
      if (role.role_id === role_id) {
        roleUpdated = true;

        // update active role also
        if (
          employee.active_role &&
          employee.active_role.role_id === role_id
        ) {
          employee.active_role.role_name = newRoleName;
        }

        return {
          role_id,
          role_name: newRoleName,
        };
      }

      return role;
    });

    if (!roleUpdated) {
      return res.status(404).json({
        success: false,
        message: "Role not found in employee",
      });
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
      return res.status(400).json({
        success: false,
        message: "role_id is required"
      });
    }

    const employee = await Employee.findOne({ emp_id: empId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    const role = employee.roles.find(r => r.role_id === role_id);

    if (!role) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned this role"
      });
    }

    // save full object
    employee.active_role = role;

    await employee.save();

    res.json({
      success: true,
      message: "Role switched successfully",
      active_role: role
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};