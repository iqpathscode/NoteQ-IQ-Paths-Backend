import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Notesheet from "../models/notes/notesheet.model.js";

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
