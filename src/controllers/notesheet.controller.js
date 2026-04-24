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
        forward_to_name: { $arrayElemAt: ["$receiver.emp_name", 0] },
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

    // Fetch notesheet details first
    const notesheet = await Notesheet.findOne({ note_id: noteId }).lean();
    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    // Fetch approval flow
    const flow = await NotesheetFlow.aggregate([
      { $match: { note_id: noteId } },

      // From employee lookup
      {
        $lookup: {
          from: "employees",
          localField: "from_emp_id",
          foreignField: "emp_id",
          as: "fromEmployee",
        },
      },

      // To employee lookup
      {
        $lookup: {
          from: "employees",
          localField: "to_emp_id",
          foreignField: "emp_id",
          as: "toEmployee",
        },
      },

      // To role lookup
      {
        $lookup: {
          from: "roles",
          localField: "to_role_id",
          foreignField: "role_id",
          as: "toRole",
        },
      },

      { $unwind: { path: "$toRole", preserveNullAndEmptyArrays: true } },

      // Lookup employees assigned to the role
      {
        $lookup: {
          from: "employees",
          let: { roleId: "$to_role_id" },
          pipeline: [
            { $match: { $expr: { $in: ["$$roleId", "$role_ids"] } } },
          ],
          as: "roleEmployee",
        },
      },

      // Add fields for names and roles
      {
        $addFields: {
          from_name: { $arrayElemAt: ["$fromEmployee.emp_name", 0] },
          from_role_name: {
            $ifNull: [
              { $arrayElemAt: ["$fromEmployee.active_role_name", 0] },
              "$fromRole.role_name",
            ],
          },
          to_name: {
            $cond: [
              { $gt: [{ $size: "$toEmployee" }, 0] },
              { $arrayElemAt: ["$toEmployee.emp_name", 0] },
              {
                $cond: [
                  { $gt: [{ $size: "$roleEmployee" }, 0] },
                  { $arrayElemAt: ["$roleEmployee.emp_name", 0] },
                  null,
                ],
              },
            ],
          },
          to_role_name: {
            $switch: {
              branches: [
                {
                  case: { $in: ["$action", ["QUERY", "QUERY_REPLY"]] },
                  then: "$toRole.role_name",
                },
                {
                  case: { $in: ["$action", ["CREATED", "FORWARDED"]] },
                  then: {
                    $cond: [
                      { $gt: [{ $size: "$toEmployee" }, 0] },
                      null,
                      "$toRole.role_name",
                    ],
                  },
                },
                {
                  case: { $in: ["$action", ["APPROVED", "REJECTED"]] },
                  then: "$toRole.role_name",
                },
              ],
              default: "$toRole.role_name",
            },
          },
        },
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
          from_role_name: 1,
          to_emp_id: 1,
          to_name: 1,
          to_role_id: 1,
          to_role_name: 1,
        },
      },

      { $sort: { createdAt: 1 } },
    ]);

    // Send both notesheet and flow
    return res.status(200).json({
      success: true,
      notesheet,
      data: flow,
    });
  } catch (error) {
    console.error("Approval Flow Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getRecentNotesheets = async (req, res) => {
  try {
    const roleId = req.query.role_id ? Number(req.query.role_id) : null;
    const empId = req.query.emp_id ? Number(req.query.emp_id) : null;

    //  dono missing → error
    if (!roleId && !empId) {
      return res.status(400).json({
        success: false,
        message: "Either role_id or emp_id is required",
      });
    }

    let filter = {};

    //  PRIORITY: role-based
    if (roleId) {
      filter.created_by_role_id = roleId;
    } 
    //  fallback: employee-based
    else if (empId) {
      filter.created_by_emp_id = empId;
    }

    const recentNotes = await Notesheet.find(filter)
  .sort({ createdAt: -1 }) // latest first
  .limit(5) // optional (performance ke liye)
  .lean();
      

    return res.status(200).json({
      success: true,
      data: recentNotes || [],
    });

  } catch (error) {
    console.error("Recent Notes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
export const getAllNotesheetsByScope = async (req, res) => {
  try {
    console.log(" API HIT");
    const { empId, scope } = req.query;

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const employee = await Employee.findOne({ emp_id: empId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const roleId = employee.active_role_id
      ? Number(employee.active_role_id)
      : null;

    const activeRole = roleId
      ? await Role.findOne({ role_id: roleId })
      : null;

    const roleDeptIds = activeRole?.dept_ids || [];

    let allowedScopes = ["MY"];

    if (activeRole?.view_scope === "ALL") {
      allowedScopes = ["MY", "DEPARTMENT", "ALL"];
    } else if (activeRole?.view_scope === "DEPARTMENT") {
      allowedScopes = ["MY", "DEPARTMENT"];
    }

    const appliedScope = allowedScopes.includes(scope) ? scope : "MY";

    let filter = {};

    if (appliedScope === "MY") {
      filter = roleId
        ? { created_by_role_id: roleId }
        : { created_by_emp_id: empId };
    } else if (appliedScope === "DEPARTMENT") {
      // filter = roleDeptIds.length
      //   ? { dept_id: { $in: roleDeptIds } }
      //   : { _id: null };
      filter =
  viewDeptIds.length > 0
    ? { dept_id: { $in: viewDeptIds } }
    : { _id: null };
    } else {
      filter = {};
    }

    filter.status = { $ne: "APPROVED" };

    console.log(" Final Filter:", filter);

    const notesheets = await Notesheet.find(filter).sort({
      createdAt: -1,
    });

    console.log(" Notesheets:", notesheets.length);

    //  STEP 1: sab note_ids nikaalo
    const noteIds = notesheets.map((n) => n.note_id);

    //  STEP 2: ek hi query me saare flows lao
    const allFlows = await NotesheetFlow.find({
      note_id: { $in: noteIds },
    }).sort({ createdAt: 1 });

    console.log(" All Flows:", allFlows.length);

    //  STEP 3: mapping
    const processedNotesheets = notesheets.map((note, index) => {
      console.log(`\n Note ${note.note_id}`);

      // note ka flow filter karo
      let flow = allFlows.filter(
        (f) => f.note_id === note.note_id
      );

      console.log(" Raw Flow from DB:", flow);

      // reject clean
      flow = flow.filter(
        (item) =>
          item.action !== "REJECTED" ||
          item.final_status === "REJECTED"
      );


      // current step
      const currentStep = flow.find(
        (item) => item.final_status === "PENDING"
      );


      return {
        ...note.toObject(),
        flow,
        current_step: currentStep || null,
      };
    });


    return res.status(200).json({
      success: true,
      count: processedNotesheets.length,
      data: processedNotesheets,
    });
  } catch (error) {
    console.error(" ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};