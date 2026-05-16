import Notesheet from "../models/notes/notesheet.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Power from "../models/userPowers/power.model.js";
import { Notification } from "../models/counter/notification.model.js";
import { sendNotesheetReceivedMail } from "../controllers/notification.controller.js";
import { sendNotesheetMail } from "../services/notesheetMail.servies.js";
import { sendFinalExecutionMailToAll } from "../controllers/notification.controller.js";
import mongoose from "mongoose";
import { buildAttachments } from "../utility/attachmentHelper.js";

// ============================================================
// CREATE NOTESHEET — fixed N+1 role fetch
// ============================================================
export const createNotesheet = async (req, res) => {
  try {
    const {
      emp_id,
      dept_id,
      subject,
      category,
      priority,
      description,
      forward_to_role,
      attachments,
      mode,
      reference_notesheet_id,
    } = req.body;

    let finalAttachments = Array.isArray(attachments) ? attachments : [];

    const [sender, department] = await Promise.all([
      Employee.findOne({ emp_id }),
      Department.findOne({ dept_id }),
    ]);

    if (!sender)
      return res
        .status(404)
        .json({ success: false, message: "Sender not found" });
    if (!department)
      return res
        .status(404)
        .json({ success: false, message: "Department not found" });
    if (!category || !priority) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Category and Priority are required",
        });
    }

    // ---- SENDER ROLE ----
    let senderRole = null;
    let employeeLevel = 0;

    if (sender.active_role_id) {
      senderRole = await Role.findOne({ role_id: sender.active_role_id });
      if (senderRole) {
        const power = await Power.findOne({ power_id: senderRole.power_id });
        employeeLevel = power?.power_level ?? 0;
      }
    }

    // ---- RESOLVE NEXT ROLE ----
    let forward_to_role_id = null;
    let forward_to_dept_id = null;
    let level = null;
    let nextRole = null;
    let nextApprover = null;

    if (Number(mode) === 1) {
      // DIRECT MODE
      nextRole = await Role.findOne({ role_id: Number(forward_to_role) });
      if (!nextRole)
        return res
          .status(404)
          .json({ success: false, message: "Target role not found" });

      const power = await Power.findOne({ power_id: nextRole.power_id });
      forward_to_role_id = nextRole.role_id;
      forward_to_dept_id = dept_id;
      level = power?.power_level ?? null;

      nextApprover = await Employee.findOne({
        $or: [
          { active_role_id: nextRole.role_id, is_active: true },
          { role_ids: { $in: [Number(nextRole.role_id)] }, is_active: true },
        ],
      });
    }

    if (Number(mode) === 0) {
      // CHAIN MODE
      const allRoles = await Role.find({ canReceiveNotesheet: true });
      const powerIds = [
        ...new Set(allRoles.map((r) => r.power_id).filter(Boolean)),
      ];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(
        allPowers.map((p) => [p.power_id, p]),
      );

      const eligible = allRoles
        .map((r) => ({ role: r, power: powerMap[r.power_id] ?? null }))
        .filter(
          (rp) =>
            rp.power?.power_type === "APPROVAL" &&
            rp.power.power_level > employeeLevel,
        )
        .sort((a, b) => a.power.power_level - b.power.power_level);

      if (!eligible.length) {
        return res
          .status(404)
          .json({
            success: false,
            message: "No next approver role found above your level",
          });
      }

      const best = eligible[0];
      nextRole = best.role;
      forward_to_role_id = nextRole.role_id;
      forward_to_dept_id = nextRole.dept_ids?.[0] ?? null;
      level = best.power.power_level;

      nextApprover = await Employee.findOne({
        $or: [
          { active_role_id: Number(nextRole.role_id), is_active: true },
          { role_ids: { $in: [Number(nextRole.role_id)] }, is_active: true },
        ],
      });
    }

    if (!nextApprover) {
      return res.status(404).json({
        success: false,
        message: `No active employee found for approver role: ${nextRole?.role_name ?? "unknown"}`,
      });
    }

    // ---- NOTE ID ----
    const generateDeptCode = (name) => {
      const words = name.trim().split(" ");
      return words.length > 1
        ? words
            .map((w) => w[0])
            .join("")
            .toUpperCase()
        : words[0].substring(0, 3).toUpperCase();
    };

    const baseCode =
      department.dept_code || generateDeptCode(department.dept_name);
    const counter = await Counter.findOneAndUpdate(
      { name: `note_id_${baseCode}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const customNoteId = `NS_${baseCode}_${String(counter.seq).padStart(3, "0")}`;

    // ---- CREATE NOTESHEET ----
    const notesheet = await Notesheet.create({
      note_id: customNoteId,
      emp_id,
      dept_id,
      subject,
      description,
      category,
      priority,
      forward_to_role_id,
      forward_to_dept_id,
      created_by_emp_id: sender.emp_id,
      created_by_role_id: senderRole?.role_id ?? null,
      attachments: finalAttachments,
      mode: Number(mode),
      level,
      status: "PENDING",
      current_holder_emp_id: nextApprover.emp_id,
      reference_notesheet_id: reference_notesheet_id ?? null,
    });

    // ✅ FIX: senderRole already fetched above — no extra DB call
    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: sender.emp_id,
      from_emp_name: sender.emp_name,
      from_role_id: senderRole?.role_id ?? null,
      from_role_name: senderRole?.role_name ?? "Employee", // ✅ no extra await
      to_emp_id: nextApprover.emp_id,
      to_emp_name: nextApprover.emp_name,
      to_role_id: forward_to_role_id,
      to_role_name: nextRole?.role_name ?? null,
      to_dept_id: forward_to_dept_id,
      action: "CREATED",
      remark: description ?? null,
      level,
      final_status: "PENDING",
    });

    // sendNotesheetMail({
    //   to_emp_id: nextApprover.emp_id,
    //   type: "CREATED",
    //   noteId: notesheet.note_id,
    //   subject: notesheet.subject,
    //   actionBy: sender.emp_name,
    //   remark: description ?? null,
    // })
    // .catch((err) => console.error("Mail error:", err));

    return res
      .status(201)
      .json({
        success: true,
        message: "Notesheet created successfully",
        data: notesheet,
      });
  } catch (error) {
    console.error("CREATE NOTESHEET ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const forwardChainOnly = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { note_id, forward_to_role, remark } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({ note_id }).session(session);

    if (!notesheet) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Notesheet not found" });
    }

    if (notesheet.mode !== 0) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "This is not a chain notesheet" });
    }

    // ================= AUTHORIZATION =================
    if (
      notesheet.current_holder_emp_id !== null &&
      notesheet.current_holder_emp_id !== user.emp_id
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to forward this notesheet",
      });
    }

    const userRoleId = user.active_role_id || user.role_id;

    const [employee, role] = await Promise.all([
      Employee.findOne({ emp_id: user.emp_id }),
      Role.findOne({ role_id: userRoleId }),
    ]);

    if (!role) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });
    }

    const currentPower = await Power.findOne({ power_id: role.power_id });

    if (!currentPower) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Power not found" });
    }

    // ================= RESOLVE NEXT ROLE =================
    let nextRole = null;
    let nextPower = null;

    if (!forward_to_role) {
      // AUTO MODE
      const allRoles = await Role.find({ canReceiveNotesheet: true });
      const powerIds = [
        ...new Set(allRoles.map((r) => r.power_id).filter(Boolean)),
      ];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(
        allPowers.map((p) => [p.power_id, p]),
      );

      const eligible = allRoles
        .map((r) => ({ role: r, power: powerMap[r.power_id] || null }))
        .filter(
          (rp) =>
            rp.power?.power_type === "APPROVAL" &&
            rp.power.power_level > currentPower.power_level,
        )
        .sort((a, b) => a.power.power_level - b.power.power_level);

      if (!eligible.length) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "No higher approval role found to forward to",
        });
      }

      nextRole = eligible[0].role;
      nextPower = eligible[0].power;
    } else {
      // MANUAL MODE
      nextRole = await Role.findOne({
        role_id: Number(forward_to_role),
        canReceiveNotesheet: true,
      });

      if (!nextRole) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ success: false, message: "Target role not found" });
      }

      nextPower = await Power.findOne({ power_id: nextRole.power_id });

      if (nextPower && nextPower.power_level < currentPower.power_level) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Cannot forward to a role with equal or lower power level",
        });
      }
    }

    if (!nextPower) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Power configuration not found for the target role",
      });
    }

    const nextEmployee = await Employee.findOne({
      $or: [
        { active_role_id: Number(nextRole.role_id) },
        { role_ids: { $in: [Number(nextRole.role_id)] } },
      ],
    });

    const targetDeptId = nextRole.dept_ids?.[0] ?? null;

    // ✅ FIX: mark ALL current PENDING steps RESOLVED before creating new FORWARDED
    await NotesheetFlow.updateMany(
      { note_id, final_status: "PENDING" },
      { $set: { final_status: "RESOLVED" } },
      { session },
    );

    // ================= UPDATE NOTESHEET =================
    notesheet.forward_to_role_id = nextRole.role_id;
    notesheet.forward_to_emp_id = nextEmployee?.emp_id ?? null;
    notesheet.current_holder_emp_id = nextEmployee?.emp_id ?? null;
    notesheet.forward_to_dept_id = targetDeptId;
    notesheet.level = nextPower.power_level;
    notesheet.updated_by = user.emp_id;

    await notesheet.save({ session });

    // ================= CREATE FLOW =================
    await NotesheetFlow.create(
      [
        {
          note_id,
          from_emp_id: user.emp_id,
          from_emp_name: employee?.emp_name ?? "Unknown User",
          from_role_id: userRoleId,
          from_role_name: role.role_name,
          to_emp_id: nextEmployee?.emp_id ?? null,
          to_emp_name: nextEmployee?.emp_name ?? null,
          to_role_id: nextRole.role_id,
          to_role_name: nextRole.role_name,
          to_dept_id: targetDeptId,
          action: "FORWARDED",
          remark: remark ?? null,
          level: nextPower.power_level,
          final_status: "PENDING",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    // if (nextEmployee?.emp_id) {
    //   sendNotesheetMail({
    //     to_emp_id: nextEmployee.emp_id,
    //     type: "FORWARDED",
    //     noteId: note_id,
    //     subject: notesheet.subject,
    //     actionBy: employee?.emp_name ?? "Unknown User",
    //     remark: remark ?? null,
    //   }).catch((err) => console.error("Notesheet mail error:", err));
    // }

    return res.json({
      success: true,
      message: `Forwarded to ${nextRole.role_name}`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Forward Chain Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const getEligibleRoles = async (req, res) => {
  try {
    const { note_id, mode } = req.query;
    const user = req.user;

    if (!mode) {
      return res.status(400).json({
        success: false,
        message: "Mode is required",
      });
    }

    let roles = await Role.find({ canReceiveNotesheet: true });

    const powers = await Power.find();
    const depts = await Department.find();

    //  Enrich roles with power + dept
    roles = roles.map((r) => {
      const power = powers.find((p) => p.power_id === r.power_id);

      const deptNames = (r.dept_ids || []).map(
        (dId) => depts.find((d) => d.dept_id === dId)?.dept_name || "Dept",
      );

      return {
        ...r.toObject(),
        power_level: power?.power_level || 0,
        dept_name: deptNames.join(", "),
      };
    });

    /* =========================
       DIRECT MODE
    ========================== */
    if (mode === "direct") {
      const filtered = roles.filter((r) => r.role_id !== user.active_role_id);

      return res.json({
        success: true,
        count: filtered.length,
        data: filtered,
      });
    }

    /* =========================
       CHAIN MODE
    ========================== */
    if (mode === "chain") {
      //  FIXED (NO Number conversion)
      const notesheet = await Notesheet.findOne({
        note_id: note_id,
      });

      if (!notesheet) {
        return res.status(404).json({
          success: false,
          message: "Notesheet not found",
        });
      }

      const currentLevel = notesheet.level || 0;
      const currentRoleId = notesheet.forward_to_role_id;

      const AUTO_FORWARD_LIMIT = 1;

      /* =========================
         AUTO FORWARD STAGE
      ========================== */
      if (currentLevel <= AUTO_FORWARD_LIMIT) {
        return res.json({
          success: true,
          count: 0,
          data: [],
        });
      }

      /* =========================
         MANUAL SELECTION STAGE
      ========================== */

      //  FIXED (NO Number conversion)
      const flowEntries = await NotesheetFlow.find({
        note_id: note_id,
        action: "FORWARDED",
      });

      const alreadyForwardedRoleIds = flowEntries.map(
        (flow) => flow.to_role_id,
      );

      let filteredRoles = roles.filter((r) => {
        if (r.role_id === currentRoleId) return false;
        if (alreadyForwardedRoleIds.includes(r.role_id)) return false;
        if (r.power_level < currentLevel) return false;

        if (!r.dept_ids || r.dept_ids.length === 0) return true;

        return r.dept_ids.includes(notesheet.dept_id);
      });

      filteredRoles = filteredRoles.sort(
        (a, b) => a.power_level - b.power_level,
      );

      console.log(
        "Final Eligible Roles:",
        filteredRoles.map((r) => ({
          role_id: r.role_id,
          role_name: r.role_name,
          power_level: r.power_level,
        })),
      );

      return res.json({
        success: true,
        count: filteredRoles.length,
        data: filteredRoles,
      });
    }

    /* =========================
       INVALID MODE
    ========================== */
    return res.status(400).json({
      success: false,
      message: "Invalid mode",
    });
  } catch (error) {
    console.error("ERROR in getEligibleRoles:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getExecutionNotesheets = async (req, res) => {
  try {
    let { roleId, empId } = req.query;

    // Validation
    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: "roleId is required",
      });
    }

    roleId = Number(roleId);

    if (isNaN(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid roleId (must be a number)",
      });
    }

    //  Query
    const query = {
      forward_to_role_id: roleId,
      status: "IN_EXECUTION",
      lifecycle_status: "OPEN",
    };

    // ================= FETCH NOTESHEETS =================
    const notesheets = await Notesheet.find(query)
      .sort({ updatedAt: -1 })
      .lean();

    if (!notesheets.length) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // ================= FETCH FLOWS =================
    const noteIds = notesheets.map((n) => n.note_id);

    const flows = await NotesheetFlow.find({
      note_id: { $in: noteIds },
    }).lean();

    // ================= GROUP FLOWS =================
    const flowMap = {};

    flows.forEach((flow) => {
      if (!flowMap[flow.note_id]) {
        flowMap[flow.note_id] = [];
      }
      flowMap[flow.note_id].push(flow);
    });

    // ================= ATTACH LATEST MOVEMENT =================
    const finalData = notesheets.map((note) => {
      const relatedFlows = flowMap[note.note_id] || [];

      const latestMovement = relatedFlows.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];

      return {
        ...note,
        latestMovement: latestMovement || null,
      };
    });

    return res.status(200).json({
      success: true,
      count: finalData.length,
      data: finalData,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch execution notesheets",
    });
  }
};

export const forwardExecutionNotesheet = async (req, res) => {
  try {
    console.log(" API HIT: forwardExecutionNotesheet");

    const { noteId } = req.params;
    const { roleId, comment } = req.body;
    const user = req.user;

    console.log(" Input:", { noteId, roleId, user });

    // ================= FETCH NOTESHEET =================
    const notesheet = await Notesheet.findOne({ note_id: noteId });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    console.log(" Notesheet:", notesheet.note_id, notesheet.status);

    // ================= ROLE =================
    const currentRoleId = user.active_role_id || user.role_id;

    if (!currentRoleId) {
      return res.status(400).json({
        success: false,
        message: "User role missing",
      });
    }

    // ================= STATUS CHECK =================
    if (!["APPROVED", "IN_EXECUTION"].includes(notesheet.status)) {
      return res.status(400).json({
        success: false,
        message: "Notesheet is not in valid state",
      });
    }

    // ================= ROLE REQUIRED =================
    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: "Please select role",
      });
    }

    // ================= GET LAST APPROVAL =================
    const lastApproval = await NotesheetFlow.findOne({
      note_id: noteId,
      action: "APPROVED",
    }).sort({ createdAt: -1 });

    if (!lastApproval) {
      return res.status(400).json({
        success: false,
        message: "Notesheet not approved yet",
      });
    }

    console.log(" Last Approval:", lastApproval.from_role_id);

    //  ONLY APPROVER ROLE CAN START EXECUTION
    if (Number(lastApproval.from_role_id) !== Number(currentRoleId)) {
      return res.status(403).json({
        success: false,
        message: "Only approving role can start execution",
      });
    }

    // ================= FETCH DATA =================
    const [currentRole, executionRole, employee] = await Promise.all([
      Role.findOne({ role_id: currentRoleId }),
      Role.findOne({ role_id: roleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);

    // ================= FIND EXECUTION EMPLOYEE =================
    const executionEmployee = await Employee.findOne({
      $or: [{ active_role_id: Number(roleId) }, { role_ids: Number(roleId) }],
    });

    if (!executionRole) {
      return res.status(404).json({
        success: false,
        message: "Selected role not found",
      });
    }

    //  Prevent same role
    if (Number(currentRoleId) === Number(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Cannot forward to same role",
      });
    }

    // ================= UPDATE NOTESHEET =================
    notesheet.status = "IN_EXECUTION";
    notesheet.lifecycle_status = "OPEN";

    notesheet.forward_to_role_id = Number(roleId);

    notesheet.forward_to_emp_id = executionEmployee?.emp_id || null;

    notesheet.forward_to_dept_id = null;

    notesheet.current_holder_emp_id = executionEmployee?.emp_id || null;

    notesheet.updated_by = user.emp_id;

    await notesheet.save();

    console.log(" Notesheet updated");
    // ================= FLOW LOG =================
    await NotesheetFlow.create({
      note_id: noteId,

      from_emp_id: user.emp_id,
      from_emp_name: employee?.emp_name || "Unknown",

      from_role_id: currentRoleId,
      from_role_name: currentRole?.role_name || "Unknown",

      to_emp_id: executionEmployee?.emp_id || null,

      to_emp_name: executionEmployee?.emp_name || null,

      to_role_id: Number(roleId),

      to_role_name: executionRole?.role_name || "Execution Role",

      action: "EXECUTION_STARTED",

      remark: comment || null,

      level: currentRole?.power_level || notesheet.level || 1,

      final_status: "PENDING",
    });

    // await sendFinalExecutionMailToAll({ noteId });

    console.log(" Flow created");

    return res.json({
      success: true,
      message: "Execution started successfully",
    });
  } catch (error) {
    console.error(" Execution Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const completeExecutionNotesheet = async (req, res) => {
  try {
    const { noteId } = req.params;
    const { remark } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({
      note_id: noteId,
    });

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found",
      });
    }

    // ================= STATUS CHECK =================
    if (notesheet.status !== "IN_EXECUTION") {
      return res.status(400).json({
        success: false,
        message: "Notesheet is not in execution",
      });
    }

    if (notesheet.lifecycle_status !== "OPEN") {
      return res.status(400).json({
        success: false,
        message: "Notesheet already closed",
      });
    }

    const userRoleId = Number(user.active_role_id || user.role_id);

    // ================= EXECUTION STEP =================
    const executionStep = await NotesheetFlow.findOne({
      note_id: noteId,
      action: "EXECUTION_STARTED",
      final_status: "PENDING",
    });

    if (!executionStep) {
      return res.status(400).json({
        success: false,
        message: "Execution step not found",
      });
    }

    // ================= ONLY ASSIGNED USER CAN CLOSE =================
    if (Number(executionStep.to_emp_id) !== Number(user.emp_id)) {
      return res.status(403).json({
        success: false,
        message: "Only assigned execution user can close this notesheet",
      });
    }

    // ================= ROLE VALIDATION =================
    if (String(notesheet.forward_to_role_id) !== String(userRoleId)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);

    // ================= UPDATE NOTESHEET =================
    notesheet.status = "CLOSED";
    notesheet.lifecycle_status = "CLOSED";

    notesheet.forward_to_role_id = null;
    notesheet.forward_to_emp_id = null;
    notesheet.forward_to_dept_id = null;

    notesheet.updated_by = user.emp_id;

    await notesheet.save();

    // ================= COMPLETE PENDING FLOW =================
    await NotesheetFlow.updateOne(
      {
        note_id: noteId,
        action: "EXECUTION_STARTED",
        final_status: "PENDING",
      },
      {
        $set: {
          final_status: "COMPLETED",
        },
      },
    );

    // ================= CREATE CLOSED FLOW =================
    await NotesheetFlow.create({
      note_id: noteId,

      from_emp_id: user.emp_id,
      from_emp_name: employee?.emp_name || "Unknown",

      from_role_id: userRoleId,
      from_role_name: role?.role_name || "Unknown",

      to_emp_id: null,
      to_role_id: null,
      to_role_name: null,

      action: "CLOSED",

      remark: remark ? [remark] : [],

      level: role?.power_level || notesheet.level || 1,

      final_status: "COMPLETED",
    });

    // ================= SEND FINAL MAIL TO ALL =================
    await sendFinalExecutionMailToAll({
      noteId,
    });

    return res.status(200).json({
      success: true,
      message: "Notesheet execution completed successfully",
    });
  } catch (error) {
    console.error("Complete Execution Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getNotesheetForRef = async (req, res) => {
  try {
    /* ── 1. Auth middleware se user info ──────────────────────────────── */
    const {
      emp_id,
      active_role_id, // null  → no active role
      role_ids = [], // []    → no roles assigned at all
    } = req.user;

    /* ── 2. Parse query params ───────────────────────────────────────── */
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim() || "";
    const status = req.query.status?.trim() || "";
    const priority = req.query.priority?.trim() || "";
    const lifecycle = req.query.lifecycle?.trim() || "";

    /* ── 3. Determine mode & build core OR conditions ────────────────── */
    const hasRole =
      Array.isArray(role_ids) && role_ids.length > 0 && active_role_id != null;

    /*
     * coreConditions — the OR buckets that define "which notesheets belong to me"
     * Kept separate so search/status filters can be $and-ed cleanly later.
     */
    let coreConditions;

    if (!hasRole) {
      // MODE A — user-based: everything this emp created
      coreConditions = [{ created_by_emp_id: emp_id }];
    } else {
      // MODE B — role-based: inbox (forwarded to role) + sent (created by role)
      coreConditions = [
        { forward_to_role_id: active_role_id }, // INBOX — sitting with this role
        { created_by_role_id: active_role_id }, // SENT  — created by this role
      ];
    }

    /* ── 4. Build extra filter conditions ────────────────────────────── */
    const extraFilters = [];

    // Status filter
    if (status) {
      const validStatuses = [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "IN_EXECUTION",
        "CLOSED",
      ];
      const normalized = status.toUpperCase();
      if (validStatuses.includes(normalized)) {
        extraFilters.push({ status: normalized });
      }
    } else {
      // Default: only APPROVED or CLOSED notesheets
      extraFilters.push({ status: { $in: ["APPROVED", "CLOSED"] } }); // 👈 yahi add karo
    }

    // Priority filter
    if (priority) {
      const validPriorities = ["low", "normal", "high", "urgent"];
      const normalized = priority.toLowerCase();
      if (validPriorities.includes(normalized)) {
        extraFilters.push({ priority: normalized });
      }
    }

    // Lifecycle filter
    if (lifecycle) {
      const validLifecycles = ["OPEN", "CLOSED"];
      const normalized = lifecycle.toUpperCase();
      if (validLifecycles.includes(normalized)) {
        extraFilters.push({ lifecycle_status: normalized });
      }
    }

    // Search filter — subject OR category OR note_id
    if (search) {
      const regex = { $regex: search, $options: "i" };
      extraFilters.push({
        $or: [{ subject: regex }, { category: regex }, { note_id: regex }],
      });
    }

    /* ── 5. Compose final Mongo filter ───────────────────────────────── */
    //
    //  With no extra filters  →  { $or: coreConditions }
    //  With extra filters     →  { $and: [{ $or: coreConditions }, ...extras] }
    //
    const mongoFilter =
      extraFilters.length === 0
        ? { $or: coreConditions }
        : { $and: [{ $or: coreConditions }, ...extraFilters] };

    /* ── 6. Execute query with pagination ────────────────────────────── */
    const [notesheets, total] = await Promise.all([
      Notesheet.find(mongoFilter)
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit)
        .lean(),
      Notesheet.countDocuments(mongoFilter),
    ]);

    /* ── 7. Send response ────────────────────────────────────────────── */
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      message: "Notesheets fetched successfully",
      meta: {
        mode: hasRole ? "role_based" : "user_based",
        active_role_id: hasRole ? active_role_id : null,
        emp_id,
      },
      data: notesheets,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("[getNotesheet] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching notesheets",
    });
  }
};
