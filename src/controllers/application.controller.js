import mongoose from "mongoose";
import Application from "../models/application/Application.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Power from "../models/userPowers/power.model.js";
import Department from "../models/office/department.model.js";
import ApplicationFlow from "../models/application/ApplicationFlow.model.js";
import { Counter } from "../models/counter/counter.model.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
const mapAttachments = (files = []) =>
  files.map((f) => ({
    url: f.path,
    publicId: f.filename,
    originalName: f.originalname,
  }));

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREATE APPLICATION
//    POST /api/applications
//    Body: emp_id, dept_id, applicationType, subject, description,
//          fromDate, toDate, mode (0=chain, 1=direct), forward_to_role (mode=1 only)
// ─────────────────────────────────────────────────────────────────────────────
export const createApplication = async (req, res) => {
  try {
    const {
      emp_id, dept_id, applicationType, subject,
      description, fromDate, toDate, mode, forward_to_role,
    } = req.body;

    if (!emp_id || !dept_id || !applicationType || !subject || !description || !fromDate || !toDate || mode === undefined) {
      return res.status(400).json({
        success: false,
        message: "emp_id, dept_id, applicationType, subject, description, fromDate, toDate, mode are all required.",
      });
    }

    if (new Date(fromDate) > new Date(toDate)) {
      return res.status(400).json({ success: false, message: "fromDate must be before toDate." });
    }

    const [sender, department] = await Promise.all([
      Employee.findOne({ emp_id }),
      Department.findOne({ dept_id }),
    ]);

    if (!sender) return res.status(404).json({ success: false, message: "Sender not found." });
    if (!department) return res.status(404).json({ success: false, message: "Department not found." });

    // ── Sender role + power level ─────────────────────────────────────────────
    let senderRole = null;
    let employeeLevel = 0;

    if (sender.active_role_id) {
      senderRole = await Role.findOne({ role_id: sender.active_role_id });
      if (senderRole) {
        const power = await Power.findOne({ power_id: senderRole.power_id });
        employeeLevel = power?.power_level ?? 0;
      }
    }

    // ── Resolve next role ─────────────────────────────────────────────────────
    let forward_to_role_id = null;
    let forward_to_dept_id = null;
    let level = null;
    let nextRole = null;
    let nextApprover = null;

    // MODE 1: DIRECT
    if (Number(mode) === 1) {
      if (!forward_to_role) {
        return res.status(400).json({ success: false, message: "forward_to_role is required for direct mode." });
      }

      nextRole = await Role.findOne({ role_id: Number(forward_to_role) });
      if (!nextRole)
        return res.status(404).json({ success: false, message: "Target role not found." });

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

    // MODE 0: CHAIN
    if (Number(mode) === 0) {
      const allRoles = await Role.find({ canReceiveNotesheet: true });
      const powerIds = [...new Set(allRoles.map((r) => r.power_id).filter(Boolean))];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(allPowers.map((p) => [p.power_id, p]));

      const eligible = allRoles
        .map((r) => ({ role: r, power: powerMap[r.power_id] ?? null }))
        .filter((rp) => rp.power?.power_type === "APPROVAL" && rp.power.power_level > employeeLevel)
        .sort((a, b) => a.power.power_level - b.power.power_level);

      if (!eligible.length) {
        return res.status(404).json({ success: false, message: "No approver role found above your level." });
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
        message: `No active employee found for role: ${nextRole?.role_name ?? "unknown"}.`,
      });
    }

    // ── Application ID generate ───────────────────────────────────────────────
    const generateDeptCode = (name) => {
      const words = name.trim().split(" ");
      return words.length > 1
        ? words.map((w) => w[0]).join("").toUpperCase()
        : words[0].substring(0, 3).toUpperCase();
    };

    const baseCode = department.dept_code || generateDeptCode(department.dept_name);
    const counter = await Counter.findOneAndUpdate(
      { name: `app_id_${baseCode}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const application_id = `APP_${baseCode}_${String(counter.seq).padStart(3, "0")}`;

    const attachments = mapAttachments(req.files || []);

    // ── Create Application ────────────────────────────────────────────────────
    const application = await Application.create({
      application_id,
      emp_id: sender.emp_id,
      emp_name: sender.emp_name,
      dept_id,
      applicationType,
      subject,
      description,
      fromDate,
      toDate,
      mode: Number(mode),
      level,
      forward_to_role_id,
      forward_to_dept_id,
      forward_to_role_name: nextRole?.role_name ?? "",
      current_holder_emp_id: nextApprover.emp_id,
      current_holder_emp_name: nextApprover.emp_name,
      submitted_by_role_id: senderRole?.role_id ?? null,
      submitted_by_role_name: senderRole?.role_name ?? "Employee",
      created_by_emp_id: sender.emp_id,
      created_by_role_id: senderRole?.role_id ?? null,
      attachments,
      status: "PENDING",
    });

    // ── ApplicationFlow entry ─────────────────────────────────────────────────
    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: sender.emp_id,
      from_emp_name: sender.emp_name,
      from_role_id: senderRole?.role_id ?? null,
      from_role_name: senderRole?.role_name ?? "Employee",
      to_emp_id: nextApprover.emp_id,
      to_emp_name: nextApprover.emp_name,
      to_role_id: forward_to_role_id,
      to_role_name: nextRole?.role_name ?? "",
      to_dept_id: forward_to_dept_id,
      action: "CREATED",
      remark: description ?? "",
      level,
      final_status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully.",
      data: application,
    });
  } catch (error) {
    console.error("CREATE APPLICATION ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. MY APPLICATIONS
//    GET /api/applications/my?emp_id=184&status=PENDING&page=1&limit=10
// ─────────────────────────────────────────────────────────────────────────────
export const getMyApplications = async (req, res) => {
  try {
    const { emp_id, status, page = 1, limit = 10 } = req.query;
    if (!emp_id) return res.status(400).json({ success: false, message: "emp_id is required." });

    const filter = { emp_id: Number(emp_id), is_deleted: false };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [applications, total] = await Promise.all([
      Application.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Application.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        applications,
        pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. RECEIVED APPLICATIONS
//    GET /api/applications/received?emp_id=205&status=PENDING
// ─────────────────────────────────────────────────────────────────────────────
export const getReceivedApplications = async (req, res) => {
  try {
    const { emp_id, status, page = 1, limit = 10 } = req.query;
    if (!emp_id) return res.status(400).json({ success: false, message: "emp_id is required." });

    const filter = { current_holder_emp_id: Number(emp_id), is_deleted: false };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [applications, total] = await Promise.all([
      Application.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Application.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        applications,
        pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. APPLICATION DETAIL  (with full flow history)
//    GET /api/applications/:application_id
// ─────────────────────────────────────────────────────────────────────────────
export const getApplicationById = async (req, res) => {
  try {
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });

    const flowHistory = await ApplicationFlow.find({
      application_id: req.params.application_id,
    }).sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      data: { application, flowHistory },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. APPROVE APPLICATION — DIRECT MODE (mode=1)
//    PATCH /api/applications/:application_id/approve/direct
//    Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const approveApplicationDirect = async (req, res) => {
  try {
    const { emp_id, remarks = "" } = req.body;
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.mode !== 1)
      return res.status(400).json({ success: false, message: "This is not a direct mode application." });
    if (application.current_holder_emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the assigned authority can approve this application." });
    if (!["PENDING", "QUERY_RAISED"].includes(application.status))
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });

    const [approver, role] = await Promise.all([
      Employee.findOne({ emp_id: Number(emp_id) }),
      Role.findOne({ role_id: application.forward_to_role_id }),
    ]);

    application.status = "APPROVED";
    application.authorityRemarks = remarks;
    application.forward_to_role_id = null;
    application.forward_to_dept_id = null;
    await application.save();

    // Mark previous PENDING flow as APPROVED
    await ApplicationFlow.updateOne(
      { application_id: application.application_id, final_status: "PENDING" },
      { $set: { final_status: "APPROVED" } },
    );

    // New flow entry
    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: approver?.emp_id ?? null,
      from_emp_name: approver?.emp_name ?? "",
      from_role_id: role?.role_id ?? application.forward_to_role_id,
      from_role_name: role?.role_name ?? application.forward_to_role_name,
      to_emp_id: null,
      to_emp_name: null,
      to_role_id: null,
      to_role_name: null,
      action: "APPROVED",
      remark: remarks,
      level: application.level,
      final_status: "APPROVED",
    });

    return res.status(200).json({
      success: true,
      message: "Application approved successfully (Direct).",
      data: application,
    });
  } catch (error) {
    console.error("APPROVE DIRECT ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. APPROVE APPLICATION — CHAIN MODE (mode=0)
//    PATCH /api/applications/:application_id/approve/chain
//    Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const approveApplicationChain = async (req, res) => {
  try {
    const { emp_id, remarks = "" } = req.body;
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.mode !== 0)
      return res.status(400).json({ success: false, message: "This is not a chain mode application." });
    if (application.current_holder_emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the current holder can approve this application." });
    if (!["PENDING", "QUERY_RAISED"].includes(application.status))
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });

    const [approver, role] = await Promise.all([
      Employee.findOne({ emp_id: Number(emp_id) }),
      Role.findOne({ role_id: application.forward_to_role_id }),
    ]);

    const levelValue = role?.power_level ?? application.level ?? 1;

    application.status = "APPROVED";
    application.authorityRemarks = remarks;
    application.forward_to_role_id = null;
    application.forward_to_dept_id = null;
    await application.save();

    // Mark previous PENDING flow as APPROVED
    await ApplicationFlow.updateOne(
      { application_id: application.application_id, final_status: "PENDING" },
      { $set: { final_status: "APPROVED" } },
    );

    // New flow entry
    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: approver?.emp_id ?? null,
      from_emp_name: approver?.emp_name ?? "",
      from_role_id: role?.role_id ?? application.forward_to_role_id,
      from_role_name: role?.role_name ?? application.forward_to_role_name,
      to_emp_id: null,
      to_emp_name: null,
      to_role_id: null,
      to_role_name: null,
      action: "APPROVED",
      remark: remarks,
      level: levelValue,
      final_status: "APPROVED",
    });

    return res.status(200).json({
      success: true,
      message: "Application approved successfully (Chain).",
      data: application,
    });
  } catch (error) {
    console.error("APPROVE CHAIN ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. FORWARD APPLICATION — DIRECT MODE (mode=1)
//    PATCH /api/applications/:application_id/forward/direct
//    Body: { emp_id, forward_to_role, remark }
//    Current holder aage kisi aur role ko manually forward karta hai.
// ─────────────────────────────────────────────────────────────────────────────
export const forwardApplicationDirect = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { emp_id, forward_to_role, remark } = req.body;

    if (!forward_to_role)
      return res.status(400).json({ success: false, message: "forward_to_role is required." });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    }).session(session);

    if (!application) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Application not found." });
    }
    if (application.mode !== 1) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "This is not a direct mode application." });
    }
    if (application.current_holder_emp_id !== Number(emp_id)) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Only the current holder can forward this application." });
    }
    if (!["PENDING", "QUERY_RAISED"].includes(application.status)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });
    }

    // Prevent duplicate forwarding to same role
    const alreadySent = await ApplicationFlow.findOne({
      application_id: application.application_id,
      to_role_id: Number(forward_to_role),
      final_status: "PENDING",
    }).session(session);

    if (alreadySent) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Already forwarded to this role." });
    }

    const [forwarder, forwarderRole, toRole] = await Promise.all([
      Employee.findOne({ emp_id: Number(emp_id) }),
      Role.findOne({ role_id: application.forward_to_role_id }),
      Role.findOne({ role_id: Number(forward_to_role) }),
    ]);

    if (!toRole) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Target role not found." });
    }

    const nextApprover = await Employee.findOne({
      $or: [
        { active_role_id: Number(forward_to_role), is_active: true },
        { role_ids: { $in: [Number(forward_to_role)] }, is_active: true },
      ],
    });

    const toPower = await Power.findOne({ power_id: toRole.power_id });

    // Mark current PENDING flow as RESOLVED
    await ApplicationFlow.updateMany(
      { application_id: application.application_id, final_status: "PENDING" },
      { $set: { final_status: "RESOLVED" } },
      { session },
    );

    // Update application
    application.forward_to_role_id = toRole.role_id;
    application.forward_to_role_name = toRole.role_name;
    application.forward_to_dept_id = toRole.dept_ids?.[0] ?? null;
    application.current_holder_emp_id = nextApprover?.emp_id ?? null;
    application.current_holder_emp_name = nextApprover?.emp_name ?? "";
    application.level = toPower?.power_level ?? application.level;
    application.status = "PENDING"; // Reset to PENDING if was QUERY_RAISED
    await application.save({ session });

    // New flow entry
    await ApplicationFlow.create(
      [
        {
          application_id: application.application_id,
          from_emp_id: forwarder?.emp_id ?? null,
          from_emp_name: forwarder?.emp_name ?? "",
          from_role_id: forwarderRole?.role_id ?? application.forward_to_role_id,
          from_role_name: forwarderRole?.role_name ?? application.forward_to_role_name,
          to_emp_id: nextApprover?.emp_id ?? null,
          to_emp_name: nextApprover?.emp_name ?? "",
          to_role_id: toRole.role_id,
          to_role_name: toRole.role_name,
          to_dept_id: toRole.dept_ids?.[0] ?? null,
          action: "FORWARDED",
          remark: remark ?? null,
          level: toPower?.power_level ?? application.level,
          final_status: "PENDING",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: `Application forwarded to ${toRole.role_name} (Direct).`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("FORWARD DIRECT ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. FORWARD APPLICATION — CHAIN MODE (mode=0)
//    PATCH /api/applications/:application_id/forward/chain
//    Body: { emp_id, remark, forward_to_role? }
//    forward_to_role optional — agar nahi diya toh auto next higher level dhundta hai
// ─────────────────────────────────────────────────────────────────────────────
export const forwardApplicationChain = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { emp_id, forward_to_role, remark } = req.body;

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    }).session(session);

    if (!application) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Application not found." });
    }
    if (application.mode !== 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "This is not a chain mode application." });
    }
    if (application.current_holder_emp_id !== Number(emp_id)) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Only the current holder can forward this application." });
    }
    if (!["PENDING", "QUERY_RAISED"].includes(application.status)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });
    }

    const [forwarder, forwarderRole] = await Promise.all([
      Employee.findOne({ emp_id: Number(emp_id) }),
      Role.findOne({ role_id: application.forward_to_role_id }),
    ]);

    const currentPower = forwarderRole
      ? await Power.findOne({ power_id: forwarderRole.power_id })
      : null;

    const currentLevel = currentPower?.power_level ?? application.level ?? 0;

    // ── Resolve next role ─────────────────────────────────────────────────────
    let nextRole = null;
    let nextPower = null;

    if (forward_to_role) {
      // MANUAL: specific role diya
      nextRole = await Role.findOne({
        role_id: Number(forward_to_role),
        canReceiveNotesheet: true,
      });

      if (!nextRole) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: "Target role not found." });
      }

      nextPower = await Power.findOne({ power_id: nextRole.power_id });

      if (nextPower && nextPower.power_level <= currentLevel) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Cannot forward to a role with equal or lower power level.",
        });
      }
    } else {
      // AUTO: next higher level dhundta hai
      const allRoles = await Role.find({ canReceiveNotesheet: true });
      const powerIds = [...new Set(allRoles.map((r) => r.power_id).filter(Boolean))];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(allPowers.map((p) => [p.power_id, p]));

      const eligible = allRoles
        .map((r) => ({ role: r, power: powerMap[r.power_id] ?? null }))
        .filter(
          (rp) =>
            rp.power?.power_type === "APPROVAL" &&
            rp.power.power_level > currentLevel,
        )
        .sort((a, b) => a.power.power_level - b.power.power_level);

      if (!eligible.length) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "No higher approval role found to forward to.",
        });
      }

      nextRole = eligible[0].role;
      nextPower = eligible[0].power;
    }

    if (!nextPower) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Power configuration not found for target role.",
      });
    }

    const nextApprover = await Employee.findOne({
      $or: [
        { active_role_id: Number(nextRole.role_id), is_active: true },
        { role_ids: { $in: [Number(nextRole.role_id)] }, is_active: true },
      ],
    });

    const targetDeptId = nextRole.dept_ids?.[0] ?? null;

    // Mark all current PENDING flows as RESOLVED
    await ApplicationFlow.updateMany(
      { application_id: application.application_id, final_status: "PENDING" },
      { $set: { final_status: "RESOLVED" } },
      { session },
    );

    // Update application
    application.forward_to_role_id = nextRole.role_id;
    application.forward_to_role_name = nextRole.role_name;
    application.forward_to_dept_id = targetDeptId;
    application.current_holder_emp_id = nextApprover?.emp_id ?? null;
    application.current_holder_emp_name = nextApprover?.emp_name ?? "";
    application.level = nextPower.power_level;
    application.status = "PENDING"; // Reset to PENDING if was QUERY_RAISED
    await application.save({ session });

    // New flow entry
    await ApplicationFlow.create(
      [
        {
          application_id: application.application_id,
          from_emp_id: forwarder?.emp_id ?? null,
          from_emp_name: forwarder?.emp_name ?? "",
          from_role_id: forwarderRole?.role_id ?? null,
          from_role_name: forwarderRole?.role_name ?? "",
          to_emp_id: nextApprover?.emp_id ?? null,
          to_emp_name: nextApprover?.emp_name ?? "",
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

    return res.status(200).json({
      success: true,
      message: `Application forwarded to ${nextRole.role_name} (Chain).`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("FORWARD CHAIN ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. REJECT APPLICATION
//    PATCH /api/applications/:application_id/reject
//    Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const rejectApplication = async (req, res) => {
  try {
    const { emp_id, remarks = "" } = req.body;
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.current_holder_emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the assigned authority can reject this application." });
    if (["APPROVED", "REJECTED"].includes(application.status))
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });

    const rejecter = await Employee.findOne({ emp_id: Number(emp_id) });

    application.status = "REJECTED";
    application.authorityRemarks = remarks;
    await application.save();

    await ApplicationFlow.updateOne(
      { application_id: application.application_id, final_status: "PENDING" },
      { $set: { final_status: "REJECTED" } },
    );

    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: rejecter?.emp_id ?? null,
      from_emp_name: rejecter?.emp_name ?? "",
      from_role_id: application.forward_to_role_id,
      from_role_name: application.forward_to_role_name,
      to_emp_id: application.emp_id,
      to_emp_name: application.emp_name,
      to_role_id: application.submitted_by_role_id,
      to_role_name: application.submitted_by_role_name,
      action: "REJECTED",
      remark: remarks,
      level: application.level,
      final_status: "REJECTED",
    });

    return res.status(200).json({
      success: true,
      message: "Application rejected successfully.",
      data: application,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. RAISE QUERY
//     PATCH /api/applications/:application_id/query
//     Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const raiseQuery = async (req, res) => {
  try {
    const { emp_id, remarks } = req.body;
    if (!remarks)
      return res.status(400).json({ success: false, message: "Remarks are required to raise a query." });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.current_holder_emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the assigned authority can raise a query." });
    if (application.status !== "PENDING")
      return res.status(400).json({ success: false, message: "Query can only be raised on a PENDING application." });

    const queryer = await Employee.findOne({ emp_id: Number(emp_id) });

    application.status = "QUERY_RAISED";
    application.authorityRemarks = remarks;
    await application.save();

    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: queryer?.emp_id ?? null,
      from_emp_name: queryer?.emp_name ?? "",
      from_role_id: application.forward_to_role_id,
      from_role_name: application.forward_to_role_name,
      to_emp_id: application.emp_id,
      to_emp_name: application.emp_name,
      to_role_id: application.submitted_by_role_id,
      to_role_name: application.submitted_by_role_name,
      action: "QUERY",
      remark: remarks,
      level: application.level,
      final_status: "QUERY_RAISED",
    });

    return res.status(200).json({
      success: true,
      message: "Query raised successfully.",
      data: application,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. REPLY TO QUERY
//     PATCH /api/applications/:application_id/query-reply
//     Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const replyToQuery = async (req, res) => {
  try {
    const { emp_id, remarks } = req.body;
    if (!remarks)
      return res.status(400).json({ success: false, message: "Reply remarks are required." });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the applicant can reply to a query." });
    if (application.status !== "QUERY_RAISED")
      return res.status(400).json({ success: false, message: "No query has been raised on this application." });

    application.status = "PENDING";
    await application.save();

    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: application.emp_id,
      from_emp_name: application.emp_name,
      from_role_id: application.submitted_by_role_id,
      from_role_name: application.submitted_by_role_name,
      to_emp_id: application.current_holder_emp_id,
      to_emp_name: application.current_holder_emp_name,
      to_role_id: application.forward_to_role_id,
      to_role_name: application.forward_to_role_name,
      action: "QUERY_REPLY",
      remark: remarks,
      level: application.level,
      final_status: "QUERY_REPLIED",
    });

    return res.status(200).json({
      success: true,
      message: "Query reply submitted successfully.",
      data: application,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. SOFT DELETE
//     DELETE /api/applications/:application_id
//     Body: { emp_id }
// ─────────────────────────────────────────────────────────────────────────────
export const deleteApplication = async (req, res) => {
  try {
    const { emp_id } = req.body;
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.emp_id !== Number(emp_id))
      return res.status(403).json({ success: false, message: "Only the applicant can delete their application." });
    if (application.status !== "PENDING")
      return res.status(400).json({ success: false, message: "Only PENDING applications can be deleted." });

    application.is_deleted = true;
    application.deleted_at = new Date();
    await application.save();

    return res.status(200).json({ success: true, message: "Application deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
