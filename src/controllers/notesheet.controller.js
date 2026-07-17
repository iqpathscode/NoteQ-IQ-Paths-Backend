import Notesheet from "../models/notes/notesheet.model.js";
import Employee from "../models/user/employee.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Role from "../models/userPowers/role.model.js";
import Department from "../models/office/department.model.js";

export const notesheetViewPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) pipeline.push(matchStage);

  pipeline.push(
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "sender",
      },
    },
    {
      $unwind: {
        path: "$sender",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "roles",
        localField: "sender.active_role_id",
        foreignField: "role_id",
        as: "fromRole",
      },
    },
    {
      $unwind: {
        path: "$fromRole",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "forward_to",
        foreignField: "emp_id",
        as: "receiver",
      },
    },
    {
      $unwind: {
        path: "$receiver",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Approval chain with full enrichment
    {
      $lookup: {
        from: NotesheetFlow.collection.name,
        localField: "note_id",
        foreignField: "note_id",
        as: "approvalChain",
      },
    },

    {
      $addFields: {
        // ✅ Sort ONLY by createdAt — level is unreliable (repeats/resets)
        approvalChain: {
          $sortArray: {
            input: {
              $map: {
                input: "$approvalChain",
                as: "item",
                in: {
                  note_id: "$$item.note_id",
                  level: "$$item.level",
                  action: "$$item.action",
                  remark: "$$item.remark",
                  final_status: "$$item.final_status",
                  createdAt: "$$item.createdAt",

                  from_emp_id: "$$item.from_emp_id",
                  // ✅ Use stored name fields directly from flow documents
                  from_name: "$$item.from_emp_name",
                  from_role_name: "$$item.from_role_name",

                  to_emp_id: "$$item.to_emp_id",
                  to_name: "$$item.to_emp_name",
                  to_role_id: "$$item.to_role_id",
                  to_role_name: "$$item.to_role_name",
                },
              },
            },
            // ✅ THE KEY FIX: sort by createdAt only
            sortBy: { createdAt: 1 },
          },
        },

        submittedBy: "$sender.emp_name",
        submittedByRole: {
          $ifNull: ["$sender.active_role_name", "$fromRole.role_name"],
        },
        forward_to_name: "$receiver.emp_name",
        submittedTo: "$receiver.emp_name",
        signature: "$sender.signature",
      },
    },

    // $project mein ye add karo
    {
      $project: {
        _id: 0,
        id: { $toString: "$note_id" },
        note_id: 1,
        title: "$subject",
        subject: 1, // ✅ add
        date: "$createdAt",
        createdAt: 1, // ✅ add — edit window check ke liye zaroori
        status: 1,
        description: 1,
        attachment: 1,
        attachments: 1, // ✅ add
        category: 1, // ✅ add
        priority: 1, // ✅ add
        mode: 1, // ✅ add
        level: 1, // ✅ add
        emp_id: 1, // ✅ add
        dept_id: 1, // ✅ add
        is_deleted: 1, // ✅ add — future debugging ke liye

        submittedBy: 1,
        submittedByRole: 1,
        submittedTo: 1,
        signature: 1,
        approvalChain: 1,
      },
    },
  );

  return pipeline;
};

export const getAllNotesheets = async (req, res) => {
  try {
     const notesheets = await Notesheet.aggregate(
      notesheetViewPipeline({ $match: { is_deleted: { $ne: true } } })
    );

    return res.status(200).json({
      success: true,
      message: "All notesheets fetched successfully",
      data: notesheets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getNotesheetsForEmployee = async (req, res) => {
  try {
    const empId = Number(req.query.empId);
    const status = req.query.status;
    const roleId = req.query.role_id ? Number(req.query.role_id) : null;
    const viewType = req.query.view_type; // "role" | "employee"

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId query param is required",
      });
    }

    // ✅ FIXED: ab summary endpoint (getEmployeeNotesheetSummary) jaisa hi
    // filtering logic use ho raha hai — created_by_emp_id + created_by_role_id.
    // Pehle sirf `emp_id: empId` pe filter tha, jo summary ke "roleWise"
    // grouping se match hi nahi karta tha (isliye stat card count aur is
    // list ka data mismatch ho raha tha).
    let query = {
      created_by_emp_id: empId,
      is_deleted: { $ne: true },
    };

    if (viewType === "role" && roleId) {
      // Role-wise view: sirf usi role se create/act ki hui notesheets
      query.created_by_role_id = roleId;
    } else {
      // Own profile view: created_by_role_id null hona chahiye
      query.created_by_role_id = null;
    }

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
        data: [],
      });
    }

    //  Collect all ids
    const empIds = new Set();
    const roleIds = new Set();

    notesheets.forEach((n) => {
      empIds.add(n.emp_id);

      if (n.updated_by) empIds.add(n.updated_by);
      if (n.forward_to_role_id) roleIds.add(n.forward_to_role_id);
    });

    //  Fetch employees
    const employees = await Employee.find({
      emp_id: { $in: [...empIds] },
    }).lean();

    const employeeMap = {};
    employees.forEach((e) => {
      employeeMap[e.emp_id] = e;
    });

    //  Fetch roles
    const roles = await Role.find({
      role_id: { $in: [...roleIds] },
    }).lean();

    const roleMap = {};
    roles.forEach((r) => {
      roleMap[r.role_id] = r;
    });

    //  Format data
    const formatted = notesheets.map((n) => {
      const employee = employeeMap[n.emp_id];
      const role = roleMap[n.forward_to_role_id];

      let submittedTo = "Completed";

      if (n.forward_to_role_id) {
        submittedTo = role?.role_name || "Unknown";
      }

      if (n.status === "APPROVED" && n.updated_by) {
        const approver = employeeMap[n.updated_by];
        const approverRole =
          approver?.active_role_id?.role_name || approver?.designation || "";

        submittedTo = `Approved by ${approver?.emp_name || "Unknown"} (${approverRole})`;
      }

      return {
        ...n,
        submittedBy: employee?.emp_name || "Unknown",
        submittedTo,
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    console.error("Error fetching notesheets:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


export const getNotesheetById = async (req, res) => {
  try {
    const noteId = req.params.noteId; // ✅ Number() hataao — note_id string hai

    const notesheet = await Notesheet.aggregate([
      { 
        $match: { 
          note_id: noteId,
          is_deleted: { $ne: true } // ✅ deleted block karo
        } 
      },

      {
        $lookup: {
          from: "employees",
          localField: "emp_id",
          foreignField: "emp_id",
          as: "submittedByEmp",
        },
      },

      {
        $lookup: {
          from: "employees",
          localField: "forward_to_emp_id",
          foreignField: "emp_id",
          as: "submittedToEmp",
        },
      },

      {
        $addFields: {
          submittedBy: { $arrayElemAt: ["$submittedByEmp.emp_name", 0] },
          submittedTo: { $arrayElemAt: ["$submittedToEmp.emp_name", 0] },
        },
      },

      {
        $project: {
          _id: 0,
          id: { $toString: "$note_id" },
          note_id: 1,
          title: "$subject",
          subject: 1,       // ✅ edit form ke liye
          category: 1,      // ✅ edit form ke liye
          priority: 1,      // ✅ edit form ke liye
          description: 1,   // ✅ edit form ke liye
          createdAt: 1,     // ✅ 10-min check ke liye
          date: "$createdAt",
          status: 1,
          attachment: 1,
          submittedBy: 1,
          submittedTo: 1,
          emp_id: 1,
          dept_id: 1,
          created_by_emp_id: 1, // ✅ creator check ke liye
          forward_to_emp_id: 1,
        },
      },
    ]);

    if (!notesheet || notesheet.length === 0)
      return res.status(404).json({ success: false, message: "Notesheet not found" });

    return res.status(200).json({ success: true, data: notesheet[0] });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getApprovalFlow = async (req, res) => {
  try {
    const noteId = req.params.noteId;

    const notesheet = await Notesheet.findOne({ note_id: noteId }).lean();

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    const flow = await NotesheetFlow.aggregate([
      { $match: { note_id: noteId } },
      { $sort: { createdAt: 1 } },

      // FROM EMPLOYEE
      {
        $lookup: {
          from: "employees",
          localField: "from_emp_id",
          foreignField: "emp_id",
          as: "fromEmployee",
        },
      },
      { $unwind: { path: "$fromEmployee", preserveNullAndEmptyArrays: true } },

      // DEPT
      {
        $lookup: {
          from: "departments",
          localField: "fromEmployee.dept_id",
          foreignField: "dept_id",
          as: "fromDept",
        },
      },
      { $unwind: { path: "$fromDept", preserveNullAndEmptyArrays: true } },

      // SCHOOL
      {
        $lookup: {
          from: "schools",
          localField: "fromEmployee.school_id",
          foreignField: "school_id",
          as: "fromSchool",
        },
      },
      { $unwind: { path: "$fromSchool", preserveNullAndEmptyArrays: true } },

      // FROM ROLE
      {
        $lookup: {
          from: "roles",
          localField: "from_role_id",
          foreignField: "role_id",
          as: "fromRole",
        },
      },
      { $unwind: { path: "$fromRole", preserveNullAndEmptyArrays: true } },

      // TO EMPLOYEE
      {
        $lookup: {
          from: "employees",
          localField: "to_emp_id",
          foreignField: "emp_id",
          as: "toEmployee",
        },
      },
      { $unwind: { path: "$toEmployee", preserveNullAndEmptyArrays: true } },

      // TO ROLE
      {
        $lookup: {
          from: "roles",
          localField: "to_role_id",
          foreignField: "role_id",
          as: "toRole",
        },
      },
      { $unwind: { path: "$toRole", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          from_name: { $ifNull: ["$from_emp_name", "$fromEmployee.emp_name"] },
          from_role_name: {
            $ifNull: ["$from_role_name", "$fromRole.role_name"],
          },
          to_name: { $ifNull: ["$to_emp_name", "$toEmployee.emp_name"] },
          to_role_name: { $ifNull: ["$to_role_name", "$toRole.role_name"] },
          from_signature: "$fromEmployee.signature",
          from_department: "$fromDept.dept_name",
          from_school: "$fromSchool.school_name",
          from_designation: "$fromEmployee.designation",
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
          from_signature: 1,
          from_department: 1,
          from_school: 1,
          from_designation: 1,
          to_emp_id: 1,
          to_name: 1,
          to_role_id: 1,
          to_role_name: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      notesheet,
      data: flow,
    });
  } catch (error) {
    console.error("getApprovalFlow error:", error.message);
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
    const viewType = req.query.view_type; // "employee" | "role"

    if (!roleId && !empId) {
      return res.status(400).json({
        success: false,
        message: "Either role_id or emp_id is required",
      });
    }

    if (!viewType || !["employee", "role"].includes(viewType)) {
      return res.status(400).json({
        success: false,
        message: "view_type is required and must be either 'employee' or 'role'",
      });
    }

    let filter = {
      is_deleted: { $ne: true },
    };

    if (viewType === "employee") {
      if (!empId) {
        return res.status(400).json({
          success: false,
          message: "emp_id is required for employee view_type",
        });
      }
      // ✅ Personal profile = sirf woh notes jo bina kisi role ke bane the
      filter.created_by_emp_id = empId;
      filter.created_by_role_id = null;
    } else if (viewType === "role") {
      if (!roleId) {
        return res.status(400).json({
          success: false,
          message: "role_id is required for role view_type",
        });
      }
      // ✅ Role context = us specific role se bane notes
      filter.created_by_role_id = roleId;
    }

    const recentNotes = await Notesheet.find(filter)
      .sort({ createdAt: -1 })
      .limit(5)
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
    const { empId, scope } = req.query;
    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const empIdNum = Number(empId);

    const employee = await Employee.findOne({ emp_id: empIdNum });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const roleId = employee.active_role_id
      ? Number(employee.active_role_id)
      : null;

    const activeRole = roleId ? await Role.findOne({ role_id: roleId }) : null;

    const roleDeptIds = activeRole?.dept_ids || [];
    const viewDeptIds = activeRole?.view_dept_ids || [];

    const allAccessibleDeptIds = [...new Set([...roleDeptIds, ...viewDeptIds])];

    let allowedScopes = ["MY"];
    if (activeRole?.view_scope === "ALL") {
      allowedScopes = ["MY", "DEPARTMENT", "ALL"];
    } else if (activeRole?.view_scope === "DEPARTMENT") {
      allowedScopes = ["MY", "DEPARTMENT"];
    }

    const appliedScope = allowedScopes.includes(scope) ? scope : "MY";

    let filter = {};

    // =========================
    // MY SCOPE
    // =========================
    if (appliedScope === "MY") {
      if (roleId) {
        // Active role selected hai → sirf usi role se banayi notesheets
        filter = { created_by_role_id: roleId };
      } else {
        // Koi active role nahi → sirf personal (bina role ke) notesheets
        filter = { created_by_emp_id: empIdNum, created_by_role_id: null };
      }
    }

    // =========================
    // DEPARTMENT
    // =========================
    else if (appliedScope === "DEPARTMENT") {
      const requestedDept = req.query.departmentId
        ? Number(req.query.departmentId)
        : null;

      if (allAccessibleDeptIds.length === 0) {
        filter = { _id: null };
      } else if (
        requestedDept &&
        allAccessibleDeptIds.includes(requestedDept)
      ) {
        filter = { dept_id: requestedDept };
      } else {
        filter = { dept_id: { $in: allAccessibleDeptIds } };
      }
    }

    // =========================
    // ALL
    // =========================
    else {
      filter = {};
    }

    const notesheets = await Notesheet.find({ ...filter, is_deleted: { $ne: true } }).sort({ createdAt: -1 });

    const noteIds = notesheets.map((n) => n.note_id);

    const allFlows = await NotesheetFlow.find({
      note_id: { $in: noteIds },
    }).sort({ createdAt: 1 });

    const processedNotesheets = notesheets.map((note) => {
      let flow = allFlows.filter((f) => f.note_id === note.note_id);

      flow = flow.filter(
        (item) =>
          item.action !== "REJECTED" || item.final_status === "REJECTED",
      );

      const currentStep = flow.find((item) => item.final_status === "PENDING");

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
    console.error("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getDepartmentsByRole = async (req, res) => {
  try {
    const { empId } = req.query;

    //  Validation
    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const employee = await Employee.findOne({ emp_id: Number(empId) });
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const roleId = employee.active_role_id
      ? Number(employee.active_role_id)
      : null;

    const activeRole = roleId ? await Role.findOne({ role_id: roleId }) : null;

    //  dept_ids + view_dept_ids dono merge
    const allAccessibleDeptIds = [
      ...new Set([
        ...(activeRole?.dept_ids || []),
        ...(activeRole?.view_dept_ids || []),
      ]),
    ];

    if (allAccessibleDeptIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const departments = await Department.find(
      { dept_id: { $in: allAccessibleDeptIds } },
      { dept_id: 1, dept_name: 1, _id: 0 },
    ).sort({ dept_name: 1 });

    return res.status(200).json({
      success: true,
      count: departments.length,
      data: departments,
    });
  } catch (error) {
    console.error("getDepartmentsByRole ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
