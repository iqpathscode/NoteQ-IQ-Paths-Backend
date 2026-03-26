import Notesheet from "../models/notes/notesheet.model.js";
import Employee from "../models/user/employee.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js"; 
import Role from "../models/userPowers/role.model.js";

export const notesheetViewPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    // Sender lookup
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "sender"
      }
    },
    // Receiver lookup
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "forward_to",
        foreignField: "emp_id",
        as: "receiver"
      }
    },
    //  Approval chain lookup
    {
      $lookup: {
        from: NotesheetFlow.collection.name,
        localField: "note_id",
        foreignField: "note_id",
        as: "approvalChain"
      }
    },
    {
      $addFields: {
        submittedBy: { $arrayElemAt: ["$sender.emp_name", 0] },
        submittedTo: { $arrayElemAt: ["$receiver.emp_name", 0] }
      }
    },
    {
      $project: {
        _id: 0,
        id: { $toString: "$note_id" },
        note_id: 1,
        title: "$subject",
        date: "$createdAt",
        status: 1,
        description: 1,
        attachment: "$attachment",
        submittedBy: 1,
        submittedTo: 1,
        category: { $literal: null },
        priority: { $literal: null },
        emp_id: 1,
        dept_id: 1,
        forward_to: 1,
        approvalChain: 1 //  new field
      }
    }
  );

  return pipeline;
};

export const getAllNotesheets = async (req, res) => {
  try {
    const notesheets = await Notesheet.aggregate(
      notesheetViewPipeline() // bina matchStage ke sabhi notesheets
    );

    return res.status(200).json({
      success: true,
      message: "All notesheets fetched successfully",
      data: notesheets
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getNotesheetsForEmployee = async (req, res) => {
  try {
    const empId = Number(req.query.empId);
    const status = req.query.status;

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId query param is required"
      });
    }

    let query = { emp_id: empId };

    if (status) {
      query.status = status;
    }

    //  Get notesheets
    const notesheets = await Notesheet.find(query)
      .sort({ createdAt: -1 })
      .lean();

    if (!notesheets.length) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    //  Collect all ids
    const empIds = new Set();
    const roleIds = new Set();

    notesheets.forEach(n => {
      empIds.add(n.emp_id);

      if (n.updated_by) empIds.add(n.updated_by);
      if (n.forward_to_role_id) roleIds.add(n.forward_to_role_id);
    });

    //  Fetch employees
    const employees = await Employee.find({
      emp_id: { $in: [...empIds] }
    }).lean();

    const employeeMap = {};
    employees.forEach(e => {
      employeeMap[e.emp_id] = e;
    });

    //  Fetch roles
    const roles = await Role.find({
      role_id: { $in: [...roleIds] }
    }).lean();

    const roleMap = {};
    roles.forEach(r => {
      roleMap[r.role_id] = r;
    });

    //  Format data
    const formatted = notesheets.map(n => {

      const employee = employeeMap[n.emp_id];
      const role = roleMap[n.forward_to_role_id];

      let submittedTo = "Completed";

      if (n.forward_to_role_id) {
        submittedTo = role?.role_name || "Unknown";
      }

      if (n.status === "APPROVED" && n.updated_by) {
        const approver = employeeMap[n.updated_by];
        const approverRole =
          approver?.active_role?.role_name ||
          approver?.designation ||
          "";

        submittedTo = `Approved by ${approver?.emp_name || "Unknown"} (${approverRole})`;
      }

      return {
        ...n,
        submittedBy: employee?.emp_name || "Unknown",
        submittedTo
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted
    });

  } catch (error) {
    console.error("Error fetching notesheets:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

export const getNotesheetById = async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);

    const notesheet = await Notesheet.aggregate([
      { $match: { note_id: noteId } },

      // Submitted by lookup
      {
        $lookup: {
          from: "employees",
          localField: "emp_id",
          foreignField: "emp_id",
          as: "submittedByEmp"
        }
      },

      // Submitted to lookup (forward_to_emp_id)
      {
        $lookup: {
          from: "employees",
          localField: "forward_to_emp_id",
          foreignField: "emp_id",
          as: "submittedToEmp"
        }
      },

      {
        $addFields: {
          submittedBy: { $arrayElemAt: ["$submittedByEmp.emp_name", 0] },
          submittedTo: { $arrayElemAt: ["$submittedToEmp.emp_name", 0] }
        }
      },

      {
        $project: {
          _id: 0,
          id: { $toString: "$note_id" },
          note_id: 1,
          title: "$subject",
          date: "$createdAt",
          status: 1,
          description: 1,
          attachment: 1,
          submittedBy: 1,
          submittedTo: 1,
          emp_id: 1,
          dept_id: 1,
          forward_to_emp_id: 1
        }
      }
    ]);

    if (!notesheet || notesheet.length === 0)
      return res.status(404).json({ success: false, message: "Notesheet not found" });

    return res.status(200).json({ success: true, data: notesheet[0] });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const getApprovalFlow = async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);

    const flow = await NotesheetFlow.aggregate([
      {
        $match: { note_id: noteId }
      },

      {
        $lookup: {
          from: "employees",
          localField: "from_emp_id",
          foreignField: "emp_id",
          as: "fromEmployee"
        }
      },

      {
        $lookup: {
          from: "employees",
          localField: "to_emp_id",
          foreignField: "emp_id",
          as: "toEmployee"
        }
      },

      {
        $addFields: {
          from_name: { $arrayElemAt: ["$fromEmployee.emp_name", 0] },
          to_name: { $arrayElemAt: ["$toEmployee.emp_name", 0] }
        }
      },

      {
        $project: {
          _id: 0,
          note_id: 1,
          level: 1,
          action: 1,
          remark: 1,
          final_status: 1,
          createdAt: 1,

          from_emp_id: 1,
          from_name: 1,

          to_emp_id: 1,
          to_name: 1
        }
      },

      {
        $sort: { level: 1 }
      }
    ]);

    return res.status(200).json({
      success: true,
      data: flow
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });

  }
};

export const getRecentNotesheets = async (req, res) => {
  try {
    const user = req.user;

    const recentNotes = await Notesheet.aggregate([
      {
        $match: {
          $or: [
            { created_by: user.emp_id },                   // created by user
            { $and: [{ forward_to_role_id: user.role_id }, { status: "PENDING" }] },  // pending for user
            { $and: [{ updated_by: user.emp_id }, { status: { $ne: "PENDING" } }] }  // processed by user
          ]
        }
      },

      {
        $lookup: {
          from: "employees",
          localField: "created_by",
          foreignField: "emp_id",
          as: "creator"
        }
      },

      {
        $addFields: {
          created_by_name: { $arrayElemAt: ["$creator.emp_name", 0] }
        }
      },

      {
        $project: {
          _id: 0,
          note_id: 1,
          subject: 1,
          status: 1,
          createdAt: 1,
          created_by: 1,
          created_by_name: 1,
          forward_to_role_id: 1,
          forward_to_dept_id: 1
        }
      },

      { $sort: { createdAt: -1 } },
      { $limit: 5 }
    ]);

    return res.status(200).json({
      success: true,
      data: recentNotes
    });

  } catch (error) {
    console.error("Recent Notesheets Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};