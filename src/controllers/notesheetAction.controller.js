import Notesheet from "../models/notes/notesheet.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Employee from "../models/user/employee.model.js";

// ---------------- GET RECEIVED NOTESHEETS ---------------
export const getReceivedNotesheets = async (req, res) => {
  try {
    const user = req.user;

    // console.log("Received notesheet API called");
    // console.log("req.user:", user);

    const pendingNotesheets = await Notesheet.find({
      status: "PENDING",
      $or: [
        { forward_to_emp_id: user.emp_id },
        {
          forward_to_role_id: user.role_id,
          dept_id: user.dept_id,
        },
      ],
    }).sort({ createdAt: -1 });

    const formatted = await Promise.all(
      pendingNotesheets.map(async (n) => {
        // Submitted By (Employee Name)
        const employee = await Employee.findOne({
          emp_id: Number(n.emp_id),
        });

        let submittedTo = "Unknown";

        // Pending case → Role name
        if (n.forward_to_role_id) {
          const role = await Role.findOne({
            role_id: Number(n.forward_to_role_id),
          });

          submittedTo = role?.role_name || "Unknown";
        }

        // Approved case → Employee name + role
        if (n.status === "APPROVED" && n.updated_by) {
          const approver = await Employee.findOne({
            emp_id: Number(n.updated_by),
          });

          const approverRole =
            approver?.active_role?.role_name || approver?.designation || "";

          submittedTo = `Approved by ${approver?.emp_name || "Unknown"} (${approverRole})`;
        }

        return {
          ...n._doc,
          submittedBy: employee?.emp_name || "Unknown",
          submittedTo,
        };
      }),
    );

    // console.log("Pending notesheets:", formatted.length);

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    // console.error("Error fetching received notesheets:", error);

    return res.status(500).json({
      success: false,
      message: "Error fetching received notesheets",
      error: error.message,
    });
  }
};

export const approveNotesheetDirect = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark, forward_to_role } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    // console.log("Notesheet role:", notesheet.forward_to_role_id);
    // console.log("User role:", user.role_id);
    // console.log("Notesheet dept:", notesheet.forward_to_dept_id);
    // console.log("User dept:", user.dept_id);

    //  Only Direct Mode
    if (notesheet.mode !== 1) {
      return res.status(400).json({
        success: false,
        message: "This is not a direct notesheet",
      });
    }

    //  Authorization check
    const roleMatch =
      Number(notesheet.forward_to_role_id) === Number(user.role_id);

    const deptMatch =
      !notesheet.forward_to_dept_id ||
      Number(notesheet.forward_to_dept_id) === Number(user.dept_id);

    const isAuthorized = roleMatch && deptMatch;

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized",
      });
    }

    if (notesheet.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Already processed",
      });
    }

    const role = await Role.findOne({ role_id: user.role_id });

    // CASE 1: FORWARD

    if (forward_to_role) {
      notesheet.forward_to_role_id = forward_to_role;
      notesheet.forward_to_dept_id = null; // optional (agar dept-based hai toh set karo)
      notesheet.updated_by = user.emp_id;
      notesheet.status = "PENDING";

      await notesheet.save();

      await NotesheetFlow.create({
        note_id: notesheet.note_id,
        from_emp_id: user.emp_id,
        from_role_id: user.role_id,
        to_role_id: forward_to_role,
        action: "FORWARDED",
        remark: remark || null,
        level: role.power_level,
        final_status: "PENDING",
      });

      return res.status(200).json({
        success: true,
        message: "Notesheet forwarded successfully",
      });
    }

    //  CASE 2: FINAL APPROVE
    else {
      notesheet.status = "APPROVED";
      notesheet.forward_to_role_id = null;
      notesheet.forward_to_dept_id = null;
      notesheet.updated_by = user.emp_id;

      await notesheet.save();

      await NotesheetFlow.updateOne(
        { note_id: notesheet.note_id, final_status: "PENDING" },
        { $set: { final_status: "APPROVED" } },
      );

      await NotesheetFlow.create({
        note_id: notesheet.note_id,
        from_emp_id: user.emp_id,
        from_role_id: user.role_id,
        action: "APPROVED",
        remark: remark || null,
        level: role.power_level,
        final_status: "APPROVED",
      });

      return res.status(200).json({
        success: true,
        message: "Notesheet approved successfully",
      });
    }
  } catch (error) {
    console.error("Approve Notesheet Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
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
      forward_to_role_id: user.role_id,
    });

    if (!notesheet || notesheet.mode !== 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid chain notesheet",
      });
    }

    if (notesheet.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Notesheet already processed",
      });
    }

    const role = await Role.findOne({ role_id: user.role_id });

    //  FINAL APPROVE
    notesheet.status = "APPROVED";
    notesheet.forward_to_role_id = null;
    notesheet.forward_to_dept_id = null;

    await notesheet.save();

    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: user.emp_id,
      from_role_id: user.role_id,
      action: "APPROVED",
      remark: remark || null,
      level: role.power_level,
      final_status: "APPROVED",
    });

    return res.json({
      success: true,
      message: "Notesheet fully approved",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
// ---------------- REJECT NOTESHEET ----------------

export const rejectNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params; // numeric note_id
    const { remark } = req.body;
    const userId = req.user.emp_id;
    const userRoleId = req.user.role_id;

    // ---------------- Notesheet check ----------------
    const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });
    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    // ---------------- Pending flow step fetch ----------------
    const pendingStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      final_status: "PENDING",
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    });

    if (!pendingStep) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this notesheet",
      });
    }

    // ---------------- Update step as rejected ----------------
    pendingStep.final_status = "REJECTED";
    pendingStep.action = "REJECTED";
    pendingStep.remark = remark || "Rejected";
    pendingStep.updatedAt = new Date();
    await pendingStep.save();

    // ---------------- Update notesheet overall status ----------------
    notesheet.status = "REJECTED";
    notesheet.rejectedBy = userId;
    notesheet.rejectedDate = new Date();
    await notesheet.save();

    res.status(200).json({
      success: true,
      message: "Notesheet rejected successfully",
    });
  } catch (error) {
    console.error("Reject notesheet error:", error);
    res.status(500).json({
      success: false,
      message: "Error rejecting notesheet",
      error: error.message,
    });
  }
};

// Get Query Conversation
export const getQueriesByNoteId = async (req, res) => {
  try {
    const { noteId } = req.params;
    const currentUserId = req.user.id;

    // Query + reply dono ke liye flows fetch karo
    const flows = await NotesheetFlow.find({
      note_id: noteId,
      action: { $in: ["QUERY", "QUERY_REPLY"] },
    }).sort({ createdAt: 1 });

    // console.log(" Query Flows:", flows);

    const queries = flows
      .filter((flow) => flow.remark)
      .map((flow) => ({
        from: flow.from_emp_id === currentUserId ? "self" : "other",

        type:
          flow.action === "QUERY"
            ? "question"
            : flow.action === "QUERY_REPLY"
              ? "reply"
              : "normal",

        authority: flow.from_role_id
          ? `Role ${flow.from_role_id}`
          : "Authority",

        message: flow.remark,
        time: new Date(flow.createdAt).toLocaleString(),
      }));

    return res.status(200).json({
      success: true,
      queries,
    });
  } catch (error) {
    // console.error("Error fetching queries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch queries",
    });
  }
};

// // ---------------- SEND QUERY ----------------
// export const sendQuery = async (req, res) => {
//   try {
//     const { noteId } = req.params;
//     const { query } = req.body;

//     const userId = req.user.emp_id;
//     const userRoleId = req.user.role_id;

//     //  Fetch notesheet
//     const notesheet = await Notesheet.findOne({
//       note_id: Number(noteId),
//     });

//     if (!notesheet) {
//       return res.status(404).json({
//         success: false,
//         message: "Notesheet not found",
//       });
//     }

//     //  Current pending step
//     const pendingStep = await NotesheetFlow.findOne({
//       note_id: Number(noteId),
//       final_status: "PENDING",
//       $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
//     });

//     if (!pendingStep) {
//       return res.status(403).json({
//         success: false,
//         message: "Not authorized to send query",
//       });
//     }

//     //  Find previous handler (important)
//     const lastActionStep = await NotesheetFlow.findOne({
//       note_id: Number(noteId),
//       action: { $in: ["FORWARDED", "APPROVED"] },
//     }).sort({ createdAt: -1 });

//     if (!lastActionStep) {
//       return res.status(400).json({
//         success: false,
//         message: "No previous handler found",
//       });
//     }

//     //  Create QUERY step
//     const newQueryStep = new NotesheetFlow({
//       note_id: notesheet.note_id,

//       from_emp_id: userId,
//       from_role_id: userRoleId,

//       to_emp_id: lastActionStep.from_emp_id,
//       to_role_id: lastActionStep.from_role_id,

//       action: "QUERY",
//       remark: query,

//       level: pendingStep.level,
//       final_status: "PENDING",
//     });

//     await newQueryStep.save();

//     //  Update notesheet (IMPORTANT FIX)
//     notesheet.forward_to_emp_id = lastActionStep.from_emp_id;
//     notesheet.forward_to_role_id = lastActionStep.from_role_id;
//     notesheet.forward_to_dept_id = null;
//     notesheet.status = "PENDING";

//     await notesheet.save();

//     return res.status(200).json({
//       success: true,
//       message: "Query sent successfully",
//       data: newQueryStep,
//     });

//   } catch (error) {
//     console.error("Send query error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error sending query",
//       error: error.message,
//     });
//   }
// };

// export const replyQuery = async (req, res) => {
//   try {
//     const { noteId } = req.params;
//     const { reply, message } = req.body;

//     const finalReply = reply || message;

//     if (!finalReply) {
//       return res.status(400).json({
//         success: false,
//         message: "Reply is required",
//       });
//     }

//     const userId = req.user.emp_id;
//     const userRoleId = req.user.role_id;

//     //  Notesheet fetch
//     const notesheet = await Notesheet.findOne({
//       note_id: Number(noteId),
//     });

//     if (!notesheet) {
//       return res.status(404).json({
//         success: false,
//         message: "Notesheet not found",
//       });
//     }

//     //  Current QUERY step
//     const currentQueryStep = await NotesheetFlow.findOne({
//       note_id: Number(noteId),
//       action: "QUERY",
//       final_status: "PENDING",
//       $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
//     });

//     if (!currentQueryStep) {
//       return res.status(403).json({
//         success: false,
//         message: "No query assigned to you",
//       });
//     }

//     //  Mark QUERY completed
//     currentQueryStep.final_status = "REPLIED";
//     await currentQueryStep.save();

//     //  Reply back
//     const replyStep = new NotesheetFlow({
//       note_id: notesheet.note_id,
//       from_emp_id: userId,
//       from_role_id: userRoleId,
//       to_emp_id: currentQueryStep.from_emp_id,
//       to_role_id: currentQueryStep.from_role_id,
//       action: "QUERY_REPLY",
//       remark: finalReply,
//       level: currentQueryStep.level,
//       final_status: "PENDING",
//     });

//     await replyStep.save();

//     //  Update notesheet
//     notesheet.forward_to_emp_id = currentQueryStep.from_emp_id;
//     notesheet.forward_to_role_id = currentQueryStep.from_role_id;
//     notesheet.status = "PENDING";

//     await notesheet.save();

//     return res.status(200).json({
//       success: true,
//       message: "Query replied successfully",
//       data: replyStep,
//     });

//   } catch (error) {
//     console.error("Reply query error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error replying query",
//       error: error.message,
//     });
//   }
// };

export const sendQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { query } = req.body;

    const userId = req.user.emp_id;
    const userRoleId = req.user.role_id;

    //  Fetch notesheet
    const notesheet = await Notesheet.findOne({
      note_id: Number(noteId),
    });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    //  Check if user is current holder
    const pendingStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      final_status: "PENDING",
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    });

    if (!pendingStep) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to send query",
      });
    }

    //  Prevent multiple active queries
    const existingQuery = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: "QUERY",
      final_status: "PENDING",
    });

    if (existingQuery) {
      return res.status(400).json({
        success: false,
        message: "Query already pending",
      });
    }

    //  Ensure previous query is replied
    const lastQuery = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: "QUERY",
    }).sort({ createdAt: -1 });

    if (lastQuery && lastQuery.final_status !== "REPLIED") {
      return res.status(400).json({
        success: false,
        message: "Previous query not answered yet",
      });
    }

    //  Find previous handler
    const lastActionStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: { $in: ["FORWARDED", "APPROVED"] },
    }).sort({ createdAt: -1 });

    if (!lastActionStep) {
      return res.status(400).json({
        success: false,
        message: "No previous handler found",
      });
    }

    //  Create QUERY
    const newQueryStep = new NotesheetFlow({
      note_id: notesheet.note_id,

      from_emp_id: userId,
      from_role_id: userRoleId,

      to_emp_id: lastActionStep.from_emp_id,
      to_role_id: lastActionStep.from_role_id,

      action: "QUERY",
      remark: query,

      level: pendingStep.level,
      final_status: "PENDING",
    });

    await newQueryStep.save();

    //  Update notesheet
    notesheet.forward_to_emp_id = lastActionStep.from_emp_id;
    notesheet.forward_to_role_id = lastActionStep.from_role_id;
    notesheet.forward_to_dept_id = null;
    notesheet.status = "PENDING";

    await notesheet.save();

    return res.status(200).json({
      success: true,
      message: "Query sent successfully",
      data: newQueryStep,
    });
  } catch (error) {
    console.error("Send query error:", error);
    return res.status(500).json({
      success: false,
      message: "Error sending query",
      error: error.message,
    });
  }
};

export const replyQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { reply, message } = req.body;

    const finalReply = reply || message;

    if (!finalReply) {
      return res.status(400).json({
        success: false,
        message: "Reply is required",
      });
    }

    const userId = req.user.emp_id;
    const userRoleId = req.user.role_id;

    //  Fetch notesheet
    const notesheet = await Notesheet.findOne({
      note_id: Number(noteId),
    });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    //  Find current QUERY
    const currentQueryStep = await NotesheetFlow.findOne({
      note_id: Number(noteId),
      action: "QUERY",
      final_status: "PENDING",
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    });

    if (!currentQueryStep) {
      return res.status(403).json({
        success: false,
        message: "No query assigned to you",
      });
    }

    //  Mark QUERY as REPLIED (NOT APPROVED ❗)
    currentQueryStep.final_status = "REPLIED";
    await currentQueryStep.save();

    //  Create QUERY_REPLY
    const replyStep = new NotesheetFlow({
      note_id: notesheet.note_id,

      from_emp_id: userId,
      from_role_id: userRoleId,

      to_emp_id: currentQueryStep.from_emp_id,
      to_role_id: currentQueryStep.from_role_id,

      action: "QUERY_REPLY",
      remark: finalReply,

      level: currentQueryStep.level,
      final_status: "PENDING",
    });

    await replyStep.save();

    //  Send back to higher authority
    notesheet.forward_to_emp_id = currentQueryStep.from_emp_id;
    notesheet.forward_to_role_id = currentQueryStep.from_role_id;
    notesheet.status = "PENDING";

    await notesheet.save();

    return res.status(200).json({
      success: true,
      message: "Query replied successfully",
      data: replyStep,
    });
  } catch (error) {
    console.error("Reply query error:", error);
    return res.status(500).json({
      success: false,
      message: "Error replying query",
      error: error.message,
    });
  }
};