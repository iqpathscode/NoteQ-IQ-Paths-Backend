import Notesheet from "../models/notes/notesheet.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Employee from "../models/user/employee.model.js";
import Power from "../models/userPowers/power.model.js";
import Department from "../models/office/department.model.js";
// export const getReceivedNotesheets = async (req, res) => {
//   try {
//     const user = await Employee.findOne({ emp_id: req.user.emp_id });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     // ONLY ACTIVE ROLE ( MAIN FIX)
//     const activeRoleId = user.active_role_id;

//     const role = await Role.findOne({ role_id: activeRoleId });

//     const roleDeptIds = role?.dept_ids?.length
//       ? role.dept_ids
//       : [user.dept_id];

//     const notesheets = await Notesheet.find({
//       status: "PENDING",
//       forward_to_role_id: activeRoleId, // ONLY ACTIVE ROLE
//       $or: [
//         { forward_to_dept_id: { $in: roleDeptIds } },
//         { forward_to_dept_id: null },
//       ],
//     }).sort({ createdAt: -1 });

//     return res.json({
//       success: true,
//       data: notesheets,
//     });

//   } catch (error) {
//     console.error("ERROR ", error);
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };


export const getReceivedNotesheets = async (req, res) => {
  try {
    const user = await Employee.findOne({ emp_id: req.user.emp_id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const activeRoleId = user.active_role_id;

    const role = await Role.findOne({ role_id: activeRoleId });
    const power = await Power.findOne({ power_id: role.power_id });

    let query = {
      status: "PENDING",
      forward_to_role_id: activeRoleId,
    };

    // =========================================================
    // ✅ SCOPE BASED FILTER (MAIN FIX)
    // =========================================================

    // 🔹 GLOBAL → no dept filter
    if (power.scope === "GLOBAL") {
      // nothing extra
    }

    // 🔹 SCHOOL
    else if (power.scope === "SCHOOL") {
      const departments = await Department.find({
        dept_id: { $in: role.dept_ids },
      });

      const schoolIds = [
        ...new Set(departments.map((d) => d.school_id)),
      ];

      query.forward_to_school_id = { $in: schoolIds };
    }

    // 🔹 DEPARTMENT
    else {
      const roleDeptIds = role?.dept_ids?.length
        ? role.dept_ids
        : [user.primary_dept_id];

      query.$or = [
        { forward_to_dept_id: { $in: roleDeptIds } },
        { forward_to_dept_id: null },
      ];
    }

    const notesheets = await Notesheet.find(query).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: notesheets,
    });

  } catch (error) {
    console.error("ERROR ", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const approveNotesheetDirect = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({
      note_id: Number(noteId),
    });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    //  Only direct mode
    if (notesheet.mode !== 1) {
      return res.status(400).json({
        success: false,
        message: "This is not a direct notesheet",
      });
    }

    // ================= ROLE FIX  =================
    const userRoleId = user.active_role_id || user.role_id;

    // DEBUG (important)
    console.log("User Role:", userRoleId);
    console.log("Notesheet Forward Role:", notesheet.forward_to_role_id);

    // ================= AUTH LOGIC (FIXED) =================
    const roleMatch =
      Number(notesheet.forward_to_role_id) === Number(userRoleId);

    const deptMatch =
      !notesheet.forward_to_dept_id ||
      Number(notesheet.forward_to_dept_id) === Number(user.dept_id);

    //  IMPORTANT CHANGE
    // direct me sirf role match enough hai
    if (!roleMatch) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized (role mismatch)",
      });
    }

    // ================= STATUS CHECK =================
    if (notesheet.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Already processed",
      });
    }

const [role, employee] = await Promise.all([
  Role.findOne({ role_id: userRoleId }),
  Employee.findOne({ emp_id: user.emp_id })
]);

//  SAFETY FIX BEFORE SAVE
if (!notesheet.created_by_emp_id) {
  notesheet.created_by_emp_id = notesheet.emp_id;
}

if (!notesheet.created_by_role_id) {
  notesheet.created_by_role_id = notesheet.forward_to_role_id || userRoleId;
}
    // ================= APPROVE =================
notesheet.status = "APPROVED";
notesheet.forward_to_role_id = null;
notesheet.forward_to_dept_id = null;
notesheet.updated_by = user.emp_id;

//  FIX
if (!notesheet.created_by_emp_id) {
  notesheet.created_by_emp_id = notesheet.emp_id;
}

if (!notesheet.created_by_role_id) {
  notesheet.created_by_role_id = userRoleId;
}

await notesheet.save();

    // update previous flow
    await NotesheetFlow.updateOne(
      { note_id: notesheet.note_id, final_status: "PENDING" },
      { $set: { final_status: "APPROVED" } }
    );

    // create new flow

await NotesheetFlow.create({
  note_id: notesheet.note_id,
  from_emp_id: user.emp_id,
  from_emp_name: employee?.emp_name || "Unknown User",
  from_role_id: userRoleId,
  from_role_name: role?.role_name || "Unknown Role",
  to_emp_id: null,
  to_emp_name: null,
  to_role_id: null,
  to_role_name: null,
  action: "APPROVED",
  remark: remark || null,
  level: role?.power_level || 1,
  final_status: "APPROVED",
});

    return res.json({
      success: true,
      message: "Notesheet approved successfully (Direct)",
    });

  } catch (error) {
    console.error("Approve Direct Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const approveNotesheetChain = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({
      note_id: Number(noteId),
    });

    if (!notesheet || notesheet.mode !== 0) {
      return res.status(400).json({
        success: false,
        message: "Not a chain notesheet",
      });
    }

    if (notesheet.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Already processed",
      });
    }

   const userRoleId = user.active_role_id;

//  parallel fetch (best)
const [role, employee] = await Promise.all([
  Role.findOne({ role_id: userRoleId }),
  Employee.findOne({ emp_id: user.emp_id })
]);

if (!role) {
  return res.status(400).json({
    success: false,
    message: "Role not found",
  });
}

//  SAFE LEVEL
const levelValue = role.power_level || notesheet.level || 1;

//  FINAL APPROVE
notesheet.status = "APPROVED";
notesheet.forward_to_role_id = null;
notesheet.forward_to_dept_id = null;
notesheet.updated_by = user.emp_id;

if (!notesheet.created_by_emp_id) {
  notesheet.created_by_emp_id = notesheet.emp_id;
}

if (!notesheet.created_by_role_id) {
  notesheet.created_by_role_id = userRoleId;
}

await notesheet.save();

//  UPDATE PREVIOUS FLOW
await NotesheetFlow.updateOne(
  { note_id: notesheet.note_id, final_status: "PENDING" },
  { $set: { final_status: "APPROVED" } }
);

//  CREATE FLOW (FULL FIX )
await NotesheetFlow.create({
  note_id: notesheet.note_id,

  from_emp_id: user.emp_id,
  from_emp_name: employee?.emp_name || "Unknown User",

  from_role_id: userRoleId,
  from_role_name: role?.role_name || "Unknown Role",

  to_emp_id: null,
  to_emp_name: null,

  to_role_id: null,
  to_role_name: null,

  action: "APPROVED",
  remark: remark || null,

  level: levelValue,
  final_status: "APPROVED",
});

    return res.json({
      success: true,
      message: "Approved (Chain)",
    });

  } catch (error) {
    console.error("Approve Chain Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const forwardNotesheetDirect = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark, forward_to_role } = req.body;
    const user = req.user;

    //  HELPER
    const ensureCreatedFields = (notesheet, userRoleId) => {
      if (!notesheet.created_by_emp_id) {
        notesheet.created_by_emp_id = notesheet.emp_id;
      }

      if (!notesheet.created_by_role_id) {
        notesheet.created_by_role_id = userRoleId;
      }
    };

    const notesheet = await Notesheet.findOne({
      note_id: Number(noteId),
    });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    if (notesheet.mode !== 1) {
      return res.status(400).json({
        success: false,
        message: "Not a direct notesheet",
      });
    }

    if (notesheet.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Already processed",
      });
    }

    const userRoleId = user.active_role_id || user.role_id;

    //  AUTH CHECK
    if (Number(notesheet.forward_to_role_id) !== Number(userRoleId)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    //  PARALLEL FETCH
    const [role, employee, toRole] = await Promise.all([
      Role.findOne({ role_id: userRoleId }),
      Employee.findOne({ emp_id: user.emp_id }),
      Role.findOne({ role_id: Number(forward_to_role) }),
    ]);

    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Role not found",
      });
    }

    if (!toRole) {
      return res.status(404).json({
        success: false,
        message: "Target role not found",
      });
    }

    //  DUPLICATE CHECK
    const alreadySent = await NotesheetFlow.findOne({
      note_id: notesheet.note_id,
      to_role_id: Number(forward_to_role),
      final_status: "PENDING",
    });

    if (alreadySent) {
      return res.status(400).json({
        success: false,
        message: "Already forwarded to this role",
      });
    }

    // ================= UPDATE NOTESHEET =================
    notesheet.forward_to_role_id = Number(forward_to_role);
    notesheet.forward_to_dept_id = null;
    notesheet.updated_by = user.emp_id;

    //  FIX (VERY IMPORTANT)
    ensureCreatedFields(notesheet, userRoleId);

    await notesheet.save();

    // ================= CREATE FLOW =================
    await NotesheetFlow.create({
      note_id: notesheet.note_id,

      from_emp_id: user.emp_id,
      from_emp_name: employee?.emp_name || "Unknown User",

      from_role_id: userRoleId,
      from_role_name: role.role_name,

      to_emp_id: null,
      to_emp_name: null,

      to_role_id: Number(forward_to_role),
      to_role_name: toRole.role_name,

      action: "FORWARDED",
      remark: remark || null,

      level: role.power_level || 1,
      final_status: "PENDING",
    });

    return res.json({
      success: true,
      message: "Forwarded (Direct)",
    });

  } catch (error) {
    console.error("Forward Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ---------------- REJECT NOTESHEET ----------------

export const rejectNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;

    const user = req.user;
    const userId = user.emp_id;
    const userRoleId = user.active_role_id || user.role_id;

    // ---------------- FETCH NOTESHEET ----------------
    const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    // ---------------- FETCH USER + ROLE ----------------
    const [employee, role] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId }),
    ]);

    // ---------------- GET CURRENT PENDING STEP ----------------
    const pendingStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      final_status: "PENDING",
      $or: [
        { to_emp_id: userId },
        { to_role_id: userRoleId }
      ],
    }).sort({ createdAt: -1 });

    if (!pendingStep) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this notesheet",
      });
    }

    // ---------------- CLOSE CURRENT STEP ----------------
    pendingStep.final_status = "APPROVED"; // close step
    await pendingStep.save();

    // ---------------- CREATE NEW REJECT FLOW ----------------
    await NotesheetFlow.create({
      note_id: notesheet.note_id,

      from_emp_id: userId,
      from_emp_name: employee?.emp_name || "Unknown User",

      from_role_id: userRoleId,
      from_role_name: role?.role_name || "Unknown Role",

      to_emp_id: pendingStep.from_emp_id || null,
      to_emp_name: pendingStep.from_emp_name || null,

      to_role_id: pendingStep.from_role_id || null,
      to_role_name: pendingStep.from_role_name || null,

      action: "REJECTED",
      remark: remark || "Rejected",

      level: pendingStep.level,
      final_status: "REJECTED",
    });

    // ---------------- UPDATE NOTESHEET ----------------
    notesheet.status = "REJECTED";
    notesheet.rejectedBy = userId;
    notesheet.rejectedDate = new Date();

    await notesheet.save();

    return res.status(200).json({
      success: true,
      message: "Notesheet rejected successfully",
    });

  } catch (error) {
    console.error("Reject notesheet error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// controllers/notesheet.controller.js
// export const getReceivedQueryNotesheets = async (req, res) => {
//   try {
//     console.log(" API HIT: getReceivedQueryNotesheets");
//     console.log(" User:", req.user);

//     const currentEmpId = req.user?.emp_id;
//     const currentRoleId = req.user?.active_role_id;

//     console.log(" currentEmpId:", currentEmpId);
//     console.log(" currentRoleId:", currentRoleId);

//     if (!currentEmpId || !currentRoleId) {
//       console.log(" Unauthorized - missing emp_id or role_id");

//       return res.status(401).json({
//         success: false,
//         message: "Unauthorized user",
//       });
//     }

//     console.log(" Fetching flows from DB...");

//     const flows = await NotesheetFlow.find({
//       action: { $in: ["QUERY", "QUERY_REPLY"] },
//       to_role_id: currentRoleId,
//     })
//       .sort({ createdAt: -1 })
//       .lean();

//     console.log(" Flows found:", flows.length);
//     console.log(" Sample flow:", flows[0] || null);

//     const map = new Map();

//     flows.forEach((flow) => {
//       const id = flow.note_id;

//       if (!map.has(id)) {
//         map.set(id, {
//           note_id: flow.note_id,
//           subject: flow.subject || "",
//           lastMessage: "",
//           updatedAt: flow.createdAt,
//           queryCount: 0,
//           participants: [],
//         });
//       }

//       const item = map.get(id);

//       item.queryCount += 1;
//       item.lastMessage = Array.isArray(flow.remark)
//         ? flow.remark.join(", ")
//         : flow.remark;

//       item.updatedAt = flow.createdAt;

//       item.participants.push({
//         from: flow.from_emp_name,
//         role: flow.from_role_name,
//       });
//     });

//     console.log(" Final grouped result:", Array.from(map.values()).length);

//     return res.status(200).json({
//       success: true,
//       count: map.size,
//       data: Array.from(map.values()),
//     });
//   } catch (error) {
//     console.error(" getReceivedQueryNotesheets ERROR:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch query notesheets",
//     });
//   }
// };

// Get Query Conversation
// export const getQueriesByNoteId = async (req, res) => {
//   try {
//     const { noteId } = req.params;
//     const currentUserId = req.user.emp_id; // FIX (id → emp_id)

//     const flows = await NotesheetFlow.find({
//       note_id: Number(noteId),
//       action: { $in: ["QUERY", "QUERY_REPLY"] },
//     }).sort({ createdAt: 1 });

//     // const queries = flows
//     //   .filter((flow) => flow.remark)
//     //   .map((flow) => ({
//     //     from: flow.from_emp_id === currentUserId ? "self" : "other",

//     //     type:
//     //       flow.action === "QUERY"
//     //         ? "question"
//     //         : flow.action === "QUERY_REPLY"
//     //         ? "reply"
//     //         : "normal",

//     //     //  MAIN FIX (NAME SHOW)
//     //     authority: flow.from_emp_name
//     //       ? `${flow.from_emp_name} (${flow.from_role_name || "Role"})`
//     //       : `Role ${flow.from_role_id}`,

//     //     message: flow.remark,
//     //     time: new Date(flow.createdAt).toLocaleString(),
//     //   }));

//     const queries = flows
//   .filter((flow) => flow.remark && flow.remark.length > 0)
//   .map((flow) => ({
//     from: flow.from_emp_id === currentUserId ? "self" : "other",

//     type:
//       flow.action === "QUERY"
//         ? "question"
//         : flow.action === "QUERY_REPLY"
//         ? "reply"
//         : "normal",

//     authority: flow.from_emp_name
//       ? `${flow.from_emp_name} (${flow.from_role_name || "Role"})`
//       : `Role ${flow.from_role_id}`,

//     message: Array.isArray(flow.remark)
//       ? flow.remark.join(", ")
//       : flow.remark,

//     time: new Date(flow.createdAt).toLocaleString(),
//   }));

//     return res.status(200).json({
//       success: true,
//       queries,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch queries",
//     });
//   }
// };

export const getQueriesByNoteId = async (req, res) => {
  try {
    const { noteId } = req.params;
    const currentUserId = req.user?.emp_id;

    if (!noteId) {
      return res.status(400).json({
        success: false,
        message: "noteId is required",
      });
    }

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const normalizedNoteId = isNaN(Number(noteId))
      ? noteId
      : Number(noteId);

    const flows = await NotesheetFlow.find({
      note_id: normalizedNoteId,
      action: { $in: ["QUERY", "QUERY_REPLY"] },
    })
      .sort({ createdAt: 1 })
      .lean();

    const queries = flows
      .filter((flow) => flow.remark && flow.remark.length > 0)
      .map((flow) => {
        const message = Array.isArray(flow.remark)
          ? flow.remark.join(", ")
          : flow.remark;

        return {
          id: flow._id.toString(),

          from:
            Number(flow.from_emp_id) === Number(currentUserId)
              ? "self"
              : "other",

          type:
            flow.action === "QUERY"
              ? "question"
              : flow.action === "QUERY_REPLY"
              ? "reply"
              : "normal",

          authority: flow.from_emp_name
            ? `${flow.from_emp_name} (${flow.from_role_name || "Role"})`
            : `Role ${flow.from_role_id}`,

          message: message || "",

          time: new Date(flow.createdAt).toISOString(),

          meta: {
            roleId: flow.from_role_id,
            empId: flow.from_emp_id,
          },
        };
      });

    return res.status(200).json({
      success: true,
      count: queries.length,
      queries,
    });

  } catch (error) {
    console.error("getQueriesByNoteId ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch queries",
    });
  }
};



export const sendQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { query } = req.body; // single message from frontend

    const userId = req.user.emp_id;
    const userRoleId = req.user.active_role_id;

    // parallel fetch employee and role
    const [employee, role] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId }),
    ]);

    const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });

    if (!notesheet) {
      return res.status(404).json({ success: false, message: "Notesheet not found" });
    }

    // check if user is authorized to send query
    const pendingStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      final_status: "PENDING",
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    });

    if (!pendingStep) {
      return res.status(403).json({ success: false, message: "Not authorized to send query" });
    }

    const lastActionStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: { $in: ["FORWARDED", "APPROVED"] },
    }).sort({ createdAt: -1 });

    if (!lastActionStep) {
      return res.status(400).json({ success: false, message: "No previous handler found" });
    }

    const levelValue = pendingStep?.level || notesheet.level || 1;

    //  Check if a pending QUERY already exists
    let existingQuery = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: "QUERY",
      final_status: "PENDING",
    });

    if (existingQuery) {
      // Push new message to remark array
      existingQuery.remark.push(query); // multi-message support
      await existingQuery.save();

      return res.status(200).json({
        success: true,
        message: "Query updated with new message",
      });
    }

    //  If no pending query → create new
    await NotesheetFlow.create({
      note_id: notesheet.note_id,

      from_emp_id: userId,
      from_emp_name: employee?.emp_name || "Unknown User",

      from_role_id: userRoleId,
      from_role_name: role?.role_name || "Unknown Role",

      to_emp_id: lastActionStep.from_emp_id,
      to_emp_name: lastActionStep.from_emp_name || null,

      to_role_id: lastActionStep.from_role_id,
      to_role_name: lastActionStep.from_role_name || null,

      action: "QUERY",
      remark: [query], // array me store

      level: levelValue,
      final_status: "PENDING",
    });

    // update notesheet forward info
    notesheet.forward_to_emp_id = lastActionStep.from_emp_id;
    notesheet.forward_to_role_id = lastActionStep.from_role_id;
    notesheet.forward_to_dept_id = null;
    notesheet.status = "PENDING";

    await notesheet.save();

    return res.status(200).json({ success: true, message: "Query sent successfully" });
  } catch (error) {
    console.error("Send Query Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const replyQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { reply } = req.body;

    if (!reply) {
      return res.status(400).json({
        success: false,
        message: "Reply is required",
      });
    }

    const userId = req.user.emp_id;
    const userRoleId = req.user.active_role_id;

    const [employee, role] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId })
    ]);

    const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });
    if (!notesheet) return res.status(404).json({ success: false, message: "Notesheet not found" });

    const currentQueryStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: "QUERY",
      final_status: "PENDING",
      $or: [
        { to_emp_id: userId },
        { to_role_id: userRoleId }
      ],
    });

    if (!currentQueryStep) {
      return res.status(403).json({ success: false, message: "No query assigned to you" });
    }

    // Ensure remark is an array for multi-message
    if (!Array.isArray(currentQueryStep.remark)) {
      currentQueryStep.remark = currentQueryStep.remark ? [currentQueryStep.remark] : [];
    }
    currentQueryStep.remark.push(reply);
    await currentQueryStep.save();

    // Create QUERY_REPLY step
    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: userId,
      from_emp_name: employee?.emp_name || "Unknown User",
      from_role_id: userRoleId,
      from_role_name: role?.role_name || "Unknown Role",
      to_emp_id: currentQueryStep.from_emp_id,
      to_emp_name: currentQueryStep.from_emp_name || null,
      to_role_id: currentQueryStep.from_role_id,
      to_role_name: currentQueryStep.from_role_name || null,
      action: "QUERY_REPLY",
      remark: reply,
      level: currentQueryStep.level,
      final_status: "PENDING",
    });

    notesheet.forward_to_emp_id = currentQueryStep.from_emp_id;
    notesheet.forward_to_role_id = currentQueryStep.from_role_id;
    notesheet.status = "PENDING";
    await notesheet.save();

    return res.status(200).json({ success: true, message: "Reply sent successfully" });

  } catch (error) {
    console.error("Reply query error:", error);
    return res.status(500).json({ success: false, message: "Error replying query" });
  }
};

export const getProcessedNotesheets = async (req, res) => {
  try {
    const currentRoles = req.user.role_ids || [req.user.active_role_id];

    const processedActions = [
      "CREATED",
      "FORWARDED",
      "APPROVED",
      "QUERY",
      "QUERY_REPLY",
      "REJECTED"
    ];

    const processedSteps = await NotesheetFlow.find({
      action: { $in: processedActions },
      $or: [
        { from_role_id: { $in: currentRoles } },
        { to_role_id: { $in: currentRoles } }, 
        { action: "CREATED", from_emp_id: req.user.emp_id }
      ]
    }).sort({ createdAt: 1 });

    if (!processedSteps.length) {
      return res.status(200).json({ success: true, processedNotesheets: [] });
    }

    const noteIds = [...new Set(processedSteps.map(step => step.note_id))];

    const processedNotesheets = await Notesheet.find({
      note_id: { $in: noteIds }
    }).sort({ createdAt: -1 });

    const history = processedNotesheets.map(note => {

      const steps = processedSteps
        .filter(step => step.note_id === note.note_id)
        .map(s => ({
          action: s.action,
          byName: s.from_emp_name || "Unknown User",
          byRole: s.from_role_name || "Unknown Role",
          remark: s.remark,
          time: s.createdAt,
          final_status: s.final_status
        }));

      const peopleInvolved = [
        ...new Set(steps.map(s => `${s.byName} (${s.byRole})`))
      ];

      return {
        ...note._doc,
        history: steps,
        peopleInvolved
      };
    });

    return res.status(200).json({
      success: true,
      processedNotesheets: history
    });

  } catch (err) {
    console.error("getProcessedNotesheets Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching processed notesheets"
    });
  }
};