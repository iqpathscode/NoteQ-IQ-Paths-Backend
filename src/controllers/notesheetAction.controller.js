import Notesheet from "../models/notes/notesheet.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Employee from "../models/user/employee.model.js";
import Power from "../models/userPowers/power.model.js";
import { sendNotesheetMail } from "../services/notesheetMail.servies.js";
import { checkQueryBlock, canRaiseQuery } from "../utility/notesheetGuards.js";
import { sendNotification } from "../utility/sendNotifications.js";
import mongoose from "mongoose";

// ─── STATUS MAP — final_status kabhi body se nahi aayega ─────────────────────
const ACTION_STATUS = {
  CREATED: "PENDING",
  FORWARDED: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  QUERY: "QUERY_RAISED",
  QUERY_REPLY: "PENDING",
  EXECUTION_STARTED: "PENDING",
  CLOSED: "COMPLETED",
};

// ============================================================
// GET RECEIVED NOTESHEETS
// ============================================================
export const getReceivedNotesheets = async (req, res) => {
  try {
    const { dept_id } = req.query;
    const user = await Employee.findOne({ emp_id: req.user.emp_id });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const activeRoleId = user.active_role_id;
    const role = await Role.findOne({ role_id: activeRoleId });
    if (!role)
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });

    const power = await Power.findOne({ power_id: role.power_id });

    const baseQuery = {
      status: "PENDING",
      forward_to_role_id: activeRoleId,
      is_deleted: { $ne: true },
    };

    const directQuery = { ...baseQuery, mode: 1 };
    if (dept_id) directQuery.dept_id = dept_id;

    let chainQuery = {};
    if (power.scope !== "GLOBAL") {
      const roleDeptIds = role?.dept_ids?.length
        ? role.dept_ids
        : [user.dept_id];
      chainQuery = {
        ...baseQuery,
        mode: { $ne: 1 },
        forward_to_dept_id: { $in: roleDeptIds },
      };
      if (dept_id && roleDeptIds.includes(dept_id))
        chainQuery.forward_to_dept_id = dept_id;
    } else {
      chainQuery = { ...baseQuery, mode: { $ne: 1 } };
      if (dept_id) chainQuery.forward_to_dept_id = dept_id;
    }

    const notesheets = await Notesheet.find({ $or: [directQuery, chainQuery] })
      .sort({ createdAt: -1 })
      .lean();

    if (!notesheets.length) return res.json({ success: true, data: [] });

    const noteIds = notesheets.map((n) => n.note_id);
    const flows = await NotesheetFlow.find({
      note_id: { $in: noteIds },
    }).lean();

    const flowMap = {};
    flows.forEach((flow) => {
      if (!flowMap[flow.note_id]) flowMap[flow.note_id] = [];
      flowMap[flow.note_id].push(flow);
    });

    const finalData = notesheets.map((note) => {
      const relatedFlows = flowMap[note.note_id] || [];
      const latestMovement = relatedFlows.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];
      return { ...note, latestMovement: latestMovement || null };
    });

    return res.json({ success: true, data: finalData });
  } catch (error) {
    console.error("getReceivedNotesheets ERROR", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// APPROVE DIRECT
// ============================================================
export const approveNotesheetDirect = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;
    const userRoleId = user.active_role_id || user.role_id;

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet)
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });
    if (notesheet.mode !== 1)
      return res
        .status(400)
        .json({ success: false, message: "This is not a direct notesheet" });
    if (notesheet.status !== "PENDING")
      return res
        .status(400)
        .json({ success: false, message: "Already processed" });

    if (String(notesheet.forward_to_role_id) !== String(userRoleId)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized (role mismatch)",
      });
    }

    const qb = await checkQueryBlock(noteId);
    if (qb.blocked)
      return res.status(403).json({ success: false, message: qb.message });

    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }).lean(),
      Employee.findOne({ emp_id: user.emp_id }).lean(),
    ]);

    notesheet.status = "APPROVED";
    notesheet.forward_to_role_id = null;
    notesheet.forward_to_dept_id = null;
    notesheet.updated_by = user.emp_id;
    if (!notesheet.created_by_emp_id)
      notesheet.created_by_emp_id = notesheet.emp_id;

    // ✅ Parallel: save notesheet + update old flow + create new flow
    const [, , flow] = await Promise.all([
      notesheet.save(),
      NotesheetFlow.updateOne(
        { note_id: noteId, final_status: "PENDING" },
        { $set: { final_status: "APPROVED" } },
      ),
      NotesheetFlow.create({
        note_id: noteId,
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
        final_status: ACTION_STATUS.APPROVED,
      }),
    ]);

    // ✅ Respond immediately — mail fire-and-forget (don't block response)
    res.json({
      success: true,
      message: "Notesheet approved successfully (Direct)",
    });

    sendNotesheetMail({
      to_emp_id: notesheet.created_by_emp_id,
      type: "APPROVED",
      noteId,
      subject: notesheet.subject,
      actionBy: employee?.emp_name,
      actionByRole: role?.role_name,
      remark,
    }).catch((err) => console.error("Mail send failed (approve direct):", err));
  } catch (error) {
    console.error("Approve Direct Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
// ============================================================
// APPROVE CHAIN
// ============================================================
export const approveNotesheetChain = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;
    const userRoleId = user.active_role_id || user.role_id;

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet || notesheet.mode !== 0)
      return res
        .status(400)
        .json({ success: false, message: "Not a chain notesheet" });
    if (notesheet.status !== "PENDING")
      return res
        .status(400)
        .json({ success: false, message: "Already processed" });

    const qb = await checkQueryBlock(noteId);
    if (qb.blocked)
      return res.status(403).json({ success: false, message: qb.message });

    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }).lean(),
      Employee.findOne({ emp_id: user.emp_id }).lean(),
    ]);
    if (!role)
      return res
        .status(400)
        .json({ success: false, message: "Role not found" });

    const levelValue = role.power_level || notesheet.level || 1;

    notesheet.status = "APPROVED";
    notesheet.forward_to_role_id = null;
    notesheet.lifecycle_status = "OPEN";
    notesheet.forward_to_dept_id = null;
    notesheet.updated_by = user.emp_id;
    if (!notesheet.created_by_emp_id)
      notesheet.created_by_emp_id = notesheet.emp_id;

    await Promise.all([
      notesheet.save(),
      NotesheetFlow.updateOne(
        { note_id: noteId, final_status: "PENDING" },
        { $set: { final_status: "APPROVED" } },
      ),
      NotesheetFlow.create({
        note_id: noteId,
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
        final_status: ACTION_STATUS.APPROVED,
      }),
    ]);

    res.json({ success: true, message: "Approved (Chain)" });

    sendNotesheetMail({
      to_emp_id: notesheet.created_by_emp_id,
      type: "APPROVED",
      noteId,
      subject: notesheet.subject,
      actionBy: employee?.emp_name,
      actionByRole: role?.role_name,
      remark,
    }).catch((err) => console.error("Mail send failed (approve chain):", err));
  } catch (error) {
    console.error("Approve Chain Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// FORWARD DIRECT
// ========================================================
export const forwardNotesheetDirect = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { noteId } = req.params;
    const { remark, forward_to_role } = req.body;
    const user = req.user;
    const userRoleId = user.active_role_id || user.role_id;

    const notesheet = await Notesheet.findOne({ note_id: noteId }).session(
      session,
    );
    if (!notesheet) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });
    }
    if (notesheet.mode !== 1) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Not a direct notesheet" });
    }
    if (notesheet.status !== "PENDING") {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Already processed" });
    }
    if (String(notesheet.forward_to_role_id) !== String(userRoleId)) {
      await session.abortTransaction();
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const qb = await checkQueryBlock(noteId, session);
    if (qb.blocked) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: qb.message });
    }

    // ✅ Parallel: role/employee/toRole + nextEmployee + alreadySent check together
    const [role, employee, toRole, nextEmployee, alreadySent] =
      await Promise.all([
        Role.findOne({ role_id: userRoleId }).lean(),
        Employee.findOne({ emp_id: user.emp_id }).lean(),
        Role.findOne({ role_id: Number(forward_to_role) }).lean(),
        Employee.findOne({
          $or: [
            { active_role_id: Number(forward_to_role) },
            { role_ids: Number(forward_to_role) },
          ],
        }).lean(),
        NotesheetFlow.findOne({
          note_id: noteId,
          to_role_id: Number(forward_to_role),
          final_status: "PENDING",
        }).session(session),
      ]);

    if (!role) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Role not found" });
    }
    if (!toRole) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Target role not found" });
    }

    // ✅ Department check — sirf tab lagega jab role kisi specific dept se bound hai
    if (toRole.dept_ids && toRole.dept_ids.length > 0) {
      if (!toRole.dept_ids.includes(Number(notesheet.dept_id))) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: `Cannot forward outside department. Role "${toRole.role_name}" does not belong to this department.`,
        });
      }
    }
    // else: role.dept_ids empty/missing → global role, no restriction

    if (alreadySent) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Already forwarded to this role" });
    }

    // ✅ role kisi bhi employee ko assign hai ya nahi
    const roleEverAssigned = await Employee.exists({
      $or: [
        { active_role_id: Number(forward_to_role) },
        { role_ids: Number(forward_to_role) },
      ],
    }).session(session);
    if (!roleEverAssigned) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Role "${toRole.role_name}" is not currently assigned to any employee. Cannot forward.`,
      });
    }

    // ✅ STEP 1 — pehle purane PENDING record(s) ko RESOLVED karo, aur COMPLETE hone do
    await NotesheetFlow.updateMany(
      { note_id: noteId, final_status: "PENDING" },
      { $set: { final_status: "RESOLVED" } },
      { session },
    );

    // ✅ STEP 2 — ab notesheet fields set karo aur naya PENDING record banao
    notesheet.forward_to_role_id = Number(forward_to_role);
    notesheet.current_holder_emp_id = nextEmployee?.emp_id || null;
    notesheet.forward_to_dept_id = notesheet.dept_id;
    notesheet.updated_by = user.emp_id;
    if (!notesheet.created_by_emp_id)
      notesheet.created_by_emp_id = notesheet.emp_id;

    await Promise.all([
      notesheet.save({ session }),
      NotesheetFlow.create(
        [
          {
            note_id: noteId,
            from_emp_id: user.emp_id,
            from_emp_name: employee?.emp_name ?? "Unknown User",
            from_role_id: userRoleId,
            from_role_name: role?.role_name ?? "Unknown Role",

            // 🔧 FIX: pending step hai abhi — emp ko freeze mat karo, sirf role snapshot karo
            to_emp_id: null,
            to_emp_name: null,
            to_role_id: Number(forward_to_role),
            to_role_name: toRole?.role_name ?? "Unknown Role",

            action: "FORWARDED",
            remark: remark ?? null,
            level: role?.power_level ?? 1,
            final_status: ACTION_STATUS.FORWARDED,
          },
        ],
        { session },
      ),
    ]);

    await session.commitTransaction();

    res.json({ success: true, message: "Forwarded successfully" });
    console.log("🔍 DEBUG nextEmployee:", nextEmployee);

    // 🔔 Real-time notification
    if (nextEmployee?.emp_id) {
      console.log(
        "🔍 DEBUG sending notification to emp_id:",
        nextEmployee.emp_id,
      );
      const io = req.app.get("io");
      sendNotification(io, {
        emp_id: nextEmployee.emp_id,
        role_id: Number(forward_to_role),
        type: "RECEIVED",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "New Notesheet Received",
        message: `${notesheet.subject} forwarded to you by ${employee?.emp_name ?? "Unknown"}`,
      })
        .then(() => console.log("✅ DEBUG notification created & emitted"))
        .catch((err) =>
          console.error("Notification send failed (forward):", err),
        );
    } else {
      console.log(
        " DEBUG nextEmployee not found or no emp_id — notification skipped",
      );
    }
  } catch (error) {
    await session.abortTransaction();
    console.error("Forward Direct Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ============================================================
// REJECT NOTESHEET
// ============================================================
export const rejectNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;
    const userId = user.emp_id;
    const userRoleId = user.active_role_id || user.role_id;

    if (!remark?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Remark is required to reject the notesheet",
      });
    }

    const notesheet = await Notesheet.findOne({ note_id: noteId });
    if (!notesheet)
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });

    // ✅ QUERY BLOCK
    const qb = await checkQueryBlock(noteId);
    if (qb.blocked)
      return res.status(403).json({ success: false, message: qb.message });

    // ✅ Parallel: employee/role fetch + pendingStep fetch together
    const [employee, role, pendingStep] = await Promise.all([
      Employee.findOne({ emp_id: userId }).lean(),
      Role.findOne({ role_id: userRoleId }).lean(),
      NotesheetFlow.findOne({
        note_id: noteId,
        final_status: "PENDING",
        $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
      }).sort({ createdAt: -1 }),
    ]);

    if (!pendingStep) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this notesheet",
      });
    }

    pendingStep.final_status = "REJECTED";

    notesheet.status = "REJECTED";
    notesheet.lifecycle_status = "CLOSED";
    notesheet.rejectedBy = userId;
    notesheet.rejectedDate = new Date();

    // ✅ Parallel: pendingStep save + notesheet save + new flow create
    await Promise.all([
      pendingStep.save(),
      notesheet.save(),
      NotesheetFlow.create({
        note_id: noteId,
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
        final_status: ACTION_STATUS.REJECTED,
      }),
    ]);

    // ✅ Respond immediately — mail fire-and-forget
    res
      .status(200)
      .json({ success: true, message: "Notesheet rejected successfully" });

    sendNotesheetMail({
      to_emp_id: notesheet.created_by_emp_id,
      type: "REJECTED",
      noteId,
      subject: notesheet.subject,
      actionBy: employee?.emp_name,
      actionByRole: role?.role_name,
      remark,
    }).catch((err) => console.error("Mail send failed (reject):", err));

    // 🔔 Notification
    if (notesheet.created_by_emp_id) {
      const io = req.app.get("io");
      sendNotification(io, {
        emp_id: notesheet.created_by_emp_id,
        role_id: notesheet.created_by_role_id,
        type: "REJECTED",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "Notesheet Rejected",
        message: `${notesheet.subject} was rejected by ${employee?.emp_name ?? "Unknown"}`,
      }).catch((err) =>
        console.error("Notification send failed (reject):", err),
      );
    }
  } catch (error) {
    console.error("Reject notesheet error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getQueriesByNoteId = async (req, res) => {
  try {
    const { noteId } = req.params;
    const currentUserId = req.user?.emp_id;

    if (!noteId)
      return res
        .status(400)
        .json({ success: false, message: "noteId is required" });
    if (!currentUserId)
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user" });

    const flows = await NotesheetFlow.find({
      note_id: noteId,
      action: { $in: ["QUERY", "QUERY_REPLY"] },
    })
      .sort({ createdAt: 1 })
      .lean();

    // ✅ Koi bhi QUERY_RAISED status wali query open hai?
    const has_open_query = flows.some(
      (f) => f.action === "QUERY" && f.final_status === "QUERY_RAISED",
    );

    const queries = flows
      .filter((flow) => flow.remark && flow.remark.length > 0)
      .map((flow) => {
        const message = Array.isArray(flow.remark)
          ? flow.remark.join(", ")
          : flow.remark;

        return {
          id: flow._id.toString(),
          from:
            String(flow.from_emp_id) === String(currentUserId)
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
          is_open:
            flow.action === "QUERY" && flow.final_status === "QUERY_RAISED",
          meta: { roleId: flow.from_role_id, empId: flow.from_emp_id },
        };
      });

    return res.status(200).json({
      success: true,
      count: queries.length,
      has_open_query, // ✅ frontend isko check karega
      queries,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch queries" });
  }
};

// ============================================================
// SEND QUERY
// ============================================================
export const sendQuery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { noteId } = req.params;
    const { query } = req.body;
    const userId = req.user.emp_id;
    const userRoleId = req.user.active_role_id;

    console.log("noteId:", noteId);
    console.log("userId:", userId, typeof userId);
    console.log("userRoleId:", userRoleId, typeof userRoleId);

    const allFlows = await NotesheetFlow.find({ note_id: noteId }).lean();
    console.log("All flows for this note:", JSON.stringify(allFlows, null, 2));

    if (!query?.trim()) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Query text is required" });
    }

    const [employee, role, notesheet] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId }),
      Notesheet.findOne({ note_id: noteId }),
    ]);

    if (!notesheet) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });
    }

    // ✅ AUTHORIZATION — sirf current holder hi query bhej sakta hai
    const pendingStep = await NotesheetFlow.findOne({
      note_id: noteId,
      final_status: "PENDING",
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    });

    if (!pendingStep) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to send query" });
    }

    // ✅ canRaiseQuery — level 1 check + existing open query check
    const qCheck = await canRaiseQuery(noteId);
    if (!qCheck.allowed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: qCheck.message });
    }

    const lastForwardedStep = qCheck.lastForwardedStep;

    // ✅ Same role ko query nahi bhej sakte
    if (lastForwardedStep.from_role_id === userRoleId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "You cannot send a query to your own role",
      });
    }

    // ✅ Mark current PENDING step RESOLVED (within transaction)
    await NotesheetFlow.findByIdAndUpdate(
      pendingStep._id,
      { $set: { final_status: "RESOLVED" } },
      { session },
    );

    // ✅ Create QUERY flow with final_status = QUERY_RAISED (within transaction)
    await NotesheetFlow.create(
      [
        {
          note_id: noteId,
          from_emp_id: userId,
          from_emp_name: employee?.emp_name ?? "Unknown User",
          from_role_id: userRoleId,
          from_role_name: role?.role_name ?? "Unknown Role",
          to_emp_id: null,
          to_emp_name: null,
          to_role_id: lastForwardedStep.from_role_id,
          to_role_name: lastForwardedStep.from_role_name ?? null,
          action: "QUERY",
          remark: [query], // ✅ array — schema ke hisaab se
          level: lastForwardedStep.level ?? pendingStep.level ?? 1,
          final_status: ACTION_STATUS.QUERY,
        },
      ],
      { session },
    );

    const targetRole = await Role.findOne({
      role_id: lastForwardedStep.from_role_id,
    });

    notesheet.forward_to_emp_id = lastForwardedStep.from_emp_id;
    notesheet.forward_to_role_id = lastForwardedStep.from_role_id;
    notesheet.current_holder_emp_id = lastForwardedStep.from_emp_id;
    notesheet.forward_to_dept_id = targetRole?.dept_ids?.[0] ?? null;
    notesheet.status = "PENDING";
    await notesheet.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, message: "Query sent successfully" });

    // 🔔 Notification
    if (lastForwardedStep.from_emp_id) {
      const io = req.app.get("io");
      sendNotification(io, {
        emp_id: lastForwardedStep.from_emp_id,
        role_id: lastForwardedStep.from_role_id,
        type: "QUERY",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "Query Raised",
        message: `${notesheet.subject} — query raised by ${employee?.emp_name ?? "Unknown"}`,
      }).catch((err) =>
        console.error("Notification send failed (query):", err),
      );
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Send Query Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// REPLY QUERY
// ============================================================
export const replyQuery = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { reply } = req.body;
    const userId = req.user.emp_id;
    const userRoleId = req.user.active_role_id;

    if (!reply?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Reply is required" });

    const [employee, role, notesheet] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId }),
      Notesheet.findOne({ note_id: noteId }),
    ]);
    if (!notesheet)
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });

    // ✅ QUERY_RAISED status wali query dhundo — sirf to_role_id match karo (role based auth)
    const currentQueryStep = await NotesheetFlow.findOne({
      note_id: noteId,
      action: "QUERY",
      final_status: "QUERY_RAISED", // ✅ QUERY_RAISED check
      $or: [{ to_emp_id: userId }, { to_role_id: userRoleId }],
    }).sort({ createdAt: -1 });

    if (!currentQueryStep) {
      return res.status(403).json({
        success: false,
        message: "No pending query found to reply to",
      });
    }

    // ✅ Mark QUERY as RESOLVED
    await NotesheetFlow.findByIdAndUpdate(currentQueryStep._id, {
      $set: { final_status: "RESOLVED" },
    });

    // ✅ Create QUERY_REPLY — final_status = PENDING (query raiser action le sakta hai)
    await NotesheetFlow.create({
      note_id: noteId,
      from_emp_id: userId,
      from_emp_name: employee?.emp_name ?? "Unknown User",
      from_role_id: userRoleId,
      from_role_name: role?.role_name ?? "Unknown Role",
      to_emp_id: null,
      to_emp_name: null,

      to_role_id: currentQueryStep.from_role_id,
      to_role_name: currentQueryStep.from_role_name ?? null,
      action: "QUERY_REPLY",
      remark: reply,
      level: currentQueryStep.level,
      final_status: ACTION_STATUS.QUERY_REPLY,
    });

    // Dean ka role fetch karo
    const targetRole = await Role.findOne({
      role_id: currentQueryStep.from_role_id,
    });

    notesheet.forward_to_emp_id = currentQueryStep.from_emp_id;
    notesheet.forward_to_role_id = currentQueryStep.from_role_id;
    notesheet.current_holder_emp_id = currentQueryStep.from_emp_id;
    notesheet.forward_to_dept_id =
      targetRole?.dept_ids?.[0] ?? employee?.dept_id ?? null;
    notesheet.status = "PENDING";
    await notesheet.save();

    res.status(200).json({ success: true, message: "Reply sent successfully" });

    // 🔔 Notification
    if (currentQueryStep.from_emp_id) {
      const io = req.app.get("io");
      sendNotification(io, {
        emp_id: currentQueryStep.from_emp_id,
        role_id: currentQueryStep.from_role_id,
        type: "QUERY",
        reference_id: notesheet.note_id,
        reference_type: "Notesheet",
        title: "Query Reply Received",
        message: `${notesheet.subject} — reply received from ${employee?.emp_name ?? "Unknown"}`,
      }).catch((err) =>
        console.error("Notification send failed (reply query):", err),
      );
    }
  } catch (error) {
    console.error("Reply Query Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// GET PROCESSED NOTESHEETS
// ============================================================
export const getProcessedNotesheets = async (req, res) => {
  try {
    const currentEmpId = req.user.emp_id;
    const currentActiveRoleId = req.user.active_role_id || null; // null = personal capacity

    // ✅ Sirf active role ke basis pe filter — na ki sab role_ids
    const actedSteps = await NotesheetFlow.find({
      $or: [
        // Is active role se koi action liya ho
        { from_role_id: currentActiveRoleId, from_emp_id: currentEmpId },
        // Ya is emp ne CREATE kiya ho isi active role capacity me
        {
          from_emp_id: currentEmpId,
          action: "CREATED",
          from_role_id: currentActiveRoleId,
        },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!actedSteps.length)
      return res.status(200).json({ success: true, processedNotesheets: [] });

    const noteIds = [...new Set(actedSteps.map((s) => s.note_id))];
    const allSteps = await NotesheetFlow.find({ note_id: { $in: noteIds } })
      .sort({ createdAt: 1 })
      .lean();
    const notesheets = await Notesheet.find({ note_id: { $in: noteIds } })
      .sort({ createdAt: -1 })
      .lean();

    const history = notesheets.map((note) => {
      const steps = allSteps
        .filter((s) => String(s.note_id) === String(note.note_id))
        .map((s) => ({
          action: s.action,
          byEmpId: s.from_emp_id,
          byRoleId: s.from_role_id,
          byName: s.from_emp_name || "Unknown User",
          byRole: s.from_role_name || "Unknown Role",
          toName: s.to_emp_name || null,
          toRole: s.to_role_name || null,
          remark: s.remark,
          time: s.createdAt,
          final_status: s.final_status,
        }));

      // ✅ Simple ID-based match — active role + emp dono match
      const lastActedStep = [...steps]
        .reverse()
        .find(
          (s) =>
            s.byRoleId === currentActiveRoleId && s.byEmpId === currentEmpId,
        );

      const peopleInvolved = [
        ...new Set(
          steps
            .filter((s) => s.byName !== "Unknown User")
            .map((s) => `${s.byName} (${s.byRole})`),
        ),
      ];

      return {
        ...note,
        currentStatus: note.status,
        statusWhenActed: lastActedStep?.final_status || note.status,
        history: steps,
        peopleInvolved,
        totalSteps: steps.length,
      };
    });

    return res
      .status(200)
      .json({ success: true, processedNotesheets: history });
  } catch (err) {
    console.error("getProcessedNotesheets error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching processed notesheets" });
  }
};

// ============================================================
// GET APPROVED NOTESHEETS BY ROLE
// ============================================================
export const getApprovedNotesheetsByRole = async (req, res) => {
  try {
    const roleId = req.user?.active_role_id || req.user?.role_id;
    if (!roleId)
      return res
        .status(400)
        .json({ success: false, message: "Role not found for user session" });

    const latestFlows = await NotesheetFlow.aggregate([
      { $match: { from_role_id: roleId } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$note_id", latest: { $first: "$$ROOT" } } },
      { $match: { "latest.action": "APPROVED" } },
      { $replaceRoot: { newRoot: "$latest" } },
    ]);

    if (!latestFlows.length)
      return res.status(200).json({
        success: true,
        message: "No approved notesheets for this role",
        data: [],
        count: 0,
      });

    const noteIds = latestFlows.map((f) => f.note_id);
    const notesheets = await Notesheet.find(
      { note_id: { $in: noteIds }, is_deleted: { $ne: true } },
      { note_id: 1, subject: 1, lifecycle_status: 1 },
    ).lean();

    const notesheetMap = {};
    notesheets.forEach((n) => {
      notesheetMap[n.note_id] = n;
    });

    const formatted = latestFlows.map((f) => ({
      note_id: f.note_id,
      subject: notesheetMap[f.note_id]?.subject || "No Subject",
      lifecycle_status: notesheetMap[f.note_id]?.lifecycle_status || null,
      approved_by_emp_id: f.from_emp_id,
      approved_by_role_id: f.from_role_id,
      approved_by_role_name: f.from_role_name || null,
      remarks: f.remark,
      level: f.level,
      approved_at: f.createdAt,
      status: "APPROVED",
    }));

    return res.status(200).json({
      success: true,
      message: "Approved notesheets (latest state only)",
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

export const locateNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const empId = req.user.emp_id;
    const activeRoleId = req.user.active_role_id;

    const notesheet = await Notesheet.findOne({ note_id: noteId }).lean();
    if (!notesheet) {
      return res.json({ success: true, location: "not_found" });
    }

    const isCurrentHolder =
      notesheet.status === "PENDING" &&
      notesheet.current_holder_emp_id === empId &&
      String(notesheet.forward_to_role_id) === String(activeRoleId);

    if (isCurrentHolder) {
      return res.json({ success: true, location: "received", note_id: noteId });
    }

    return res.json({ success: true, location: "history", note_id: noteId });
  } catch (err) {
    console.error("locateNotesheet error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
