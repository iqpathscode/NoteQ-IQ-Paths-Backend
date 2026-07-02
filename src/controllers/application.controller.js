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

const getCurrentUserRoleId = (req) => Number(req.user?.active_role_id ?? req.user?.role_id ?? 0) || null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREATE APPLICATION
//    POST /api/applications
//    Body: emp_id, dept_id, applicationType, subject, description,
//          mode (0=chain, 1=direct), forward_to_role (mode=1 only), priority, attachments
// ─────────────────────────────────────────────────────────────────────────────
export const createApplication = async (req, res) => {
  try {
    const {
      emp_id,
      dept_id,
      applicationType,
      subject,
      description,
      fromDate,
      toDate,
      mode,
      forward_to_role,
      category,
      priority,
      reference_notesheet_id,
    } = req.body;

    const requestEmpId = req.user?.emp_id ?? emp_id;
    const requestDeptId = req.user?.dept_id ?? dept_id;

    if (!requestEmpId || !requestDeptId || !applicationType || !subject || !description || mode === undefined) {
      return res.status(400).json({
        success: false,
        message: "emp_id, dept_id, applicationType, subject, description and mode are required.",
      });
    }

    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      return res.status(400).json({ success: false, message: "fromDate must be before toDate." });
    }

    if (![0, 1].includes(Number(mode))) {
      return res.status(400).json({ success: false, message: "Invalid mode. 0 = chain, 1 = direct" });
    }

    const [sender, department] = await Promise.all([
      Employee.findOne({ emp_id: Number(requestEmpId) }),
      Department.findOne({ dept_id: Number(requestDeptId) }),
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
    const applicationDeptId = Number(requestDeptId);

    // MODE 1: DIRECT
    if (Number(mode) === 1) {
      if (!forward_to_role) {
        return res.status(400).json({ success: false, message: "forward_to_role is required for direct mode." });
      }

      nextRole = await Role.findOne({
        role_id: Number(forward_to_role),
        canReceiveNotesheet: true,
        dept_ids: { $in: [applicationDeptId] },
      });
      if (!nextRole)
        return res.status(404).json({ success: false, message: "Target role not found in the application department." });

      const power = await Power.findOne({ power_id: nextRole.power_id });
      forward_to_role_id = nextRole.role_id;
      forward_to_dept_id = applicationDeptId;
      level = power?.power_level ?? null;

      nextApprover = await Employee.findOne({
        role_ids: { $in: [Number(nextRole.role_id)] },
        dept_id: applicationDeptId,
        is_active: true,
      });
    }

    // MODE 0: CHAIN
    if (Number(mode) === 0) {
      const allRoles = await Role.find({ canReceiveNotesheet: true });
      const powerIds = [...new Set(allRoles.map((r) => r.power_id).filter(Boolean))];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(allPowers.map((p) => [p.power_id, p]));

      let eligible = allRoles
        .map((r) => ({ role: r, power: powerMap[r.power_id] ?? null }))
        .filter(
          (rp) =>
            rp.power?.power_type === "APPROVAL" &&
            rp.power.power_level > employeeLevel &&
            rp.role.dept_ids?.includes(applicationDeptId),
        )
        .sort((a, b) => a.power.power_level - b.power.power_level);

      if (!eligible.length) {
        return res.status(404).json({ success: false, message: "No approver role found in the application department above your level." });
      }

      const best = eligible[0];
      nextRole = best.role;
      forward_to_role_id = nextRole.role_id;
      forward_to_dept_id = applicationDeptId;
      level = best.power.power_level;

      nextApprover = await Employee.findOne({
        role_ids: { $in: [Number(nextRole.role_id)] },
        dept_id: applicationDeptId,
        is_active: true,
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

    const attachments = req.files?.length
      ? mapAttachments(req.files)
      : (Array.isArray(req.body?.attachments)
          ? req.body.attachments.map((item) => (typeof item === "string" ? { url: item, publicId: null, originalName: item.split("/").pop() } : item))
          : []);

    // ── Create Application ────────────────────────────────────────────────────
    const application = await Application.create({
      application_id,
      emp_id: sender.emp_id,
      emp_name: sender.emp_name,
      dept_id,
      applicationType,
      category: category || "General",
      priority: priority || "normal",
      reference_notesheet_id: reference_notesheet_id || null,
      subject,
      description,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      mode: Number(mode),
      level,
      current_holder_role_id: forward_to_role_id,
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
    const { emp_id, role_id, status, scope = "MY", departmentId, page = 1, limit = 10 } = req.query;
    const requestedRoleId = role_id ? Number(role_id) : null;
    const currentEmpId = Number(emp_id || req.user?.emp_id || 0) || null;
    const currentRoleId = getCurrentUserRoleId(req);
    const currentRole = currentRoleId ? await Role.findOne({ role_id: currentRoleId }) : null;
    const allowedScope = currentRole?.app_view_scope || currentRole?.view_scope || "MY";
    const requestedScope = String(scope || "MY").toUpperCase();

    if (!currentEmpId && requestedScope === "MY") {
      return res.status(400).json({ success: false, message: "emp_id is required." });
    }

    if (requestedScope === "DEPARTMENT" && !departmentId) {
      return res.status(400).json({ success: false, message: "departmentId is required for department scope." });
    }

    if (requestedScope === "DEPARTMENT" && !["DEPARTMENT", "ALL"].includes(String(allowedScope).toUpperCase())) {
      return res.status(403).json({ success: false, message: "Your role does not allow department view access." });
    }

    if (requestedScope === "ALL" && String(allowedScope).toUpperCase() !== "ALL") {
      return res.status(403).json({ success: false, message: "Your role does not allow all-application view access." });
    }

    const filter = { is_deleted: false };
    if (requestedScope === "MY") {
      // If a role_id is provided, show applications created by that role (role-based MY)
      if (requestedRoleId) {
        // permission: only the same active role or a role with ALL app view scope can view
        if (!(currentRoleId && Number(currentRoleId) === Number(requestedRoleId)) && String(allowedScope).toUpperCase() !== "ALL") {
          return res.status(403).json({ success: false, message: "Not authorized to view applications for this role." });
        }
        filter.created_by_role_id = Number(requestedRoleId);
      } else {
        filter.emp_id = currentEmpId;
      }
    } else if (requestedScope === "DEPARTMENT") {
      filter.dept_id = Number(departmentId);
    }

    if (status && status !== "all") filter.status = String(status).toUpperCase();

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
// 2B. ADMIN APPLICATIONS
//    GET /api/applications/admin/all?status=PENDING&page=1&limit=10
// ─────────────────────────────────────────────────────────────────────────────
export const getAllApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const filter = { is_deleted: false };
    if (status && status !== "all") {
      filter.status = String(status).toUpperCase();
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [applications, total] = await Promise.all([
      Application.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Application.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        applications,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
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
    const { role_id, status, page = 1, limit = 10 } = req.query;
    const requestedRoleId = Number(role_id || req.user?.active_role_id || 0) || null;
    const currentEmpId = req.user?.emp_id ?? null;
    const currentRoleId = getCurrentUserRoleId(req);

    if (!requestedRoleId) return res.status(400).json({ success: false, message: "role_id is required." });

    // Validate view permissions for the current role
    const currentRole = currentRoleId ? await Role.findOne({ role_id: currentRoleId }) : null;
    const requestedRole = await Role.findOne({ role_id: requestedRoleId });

    if (!requestedRole) return res.status(404).json({ success: false, message: "Requested role not found." });

    const appViewScope = (currentRole?.app_view_scope || currentRole?.view_scope || "OWN").toUpperCase();

    let allowed = false;
    if (currentRoleId && Number(currentRoleId) === Number(requestedRoleId)) allowed = true;
    else if (appViewScope === "ALL") allowed = true;
    else if (appViewScope === "DEPARTMENT") {
      const allowedDepts = Array.isArray(currentRole?.app_view_dept_ids) ? currentRole.app_view_dept_ids.map(Number) : [];
      const requestedDepts = Array.isArray(requestedRole?.dept_ids) ? requestedRole.dept_ids.map(Number) : [];
      if (allowedDepts.length && requestedDepts.some((d) => allowedDepts.includes(d))) allowed = true;
    }

    if (!allowed) return res.status(403).json({ success: false, message: "Not authorized to view applications for this role." });

    const filter = { is_deleted: false, current_holder_role_id: requestedRoleId };
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
// 3B. PROCESSED APPLICATIONS
//    GET /api/applications/processed
// ─────────────────────────────────────────────────────────────────────────────
export const getProcessedApplications = async (req, res) => {
  try {
    const currentRoles = req.user.role_ids || [req.user?.active_role_id].filter(Boolean);
    const currentEmpId = req.user.emp_id;

    const actedSteps = await ApplicationFlow.find({
      $or: [
        { from_role_id: { $in: currentRoles } },
        { from_emp_id: currentEmpId, action: { $ne: "CREATED" } },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!actedSteps.length) {
      return res.status(200).json({ success: true, processedApplications: [] });
    }

    const applicationIds = [...new Set(actedSteps.map((step) => step.application_id))];

    const [allSteps, applications] = await Promise.all([
      ApplicationFlow.find({ application_id: { $in: applicationIds } }).sort({ createdAt: 1 }).lean(),
      Application.find({ application_id: { $in: applicationIds } }).sort({ createdAt: -1 }).lean(),
    ]);

    const processedApplications = applications.map((application) => {
      const steps = allSteps.filter(
        (step) => String(step.application_id) === String(application.application_id),
      );

      const lastActedStep = [...steps]
        .reverse()
        .find(
          (step) =>
            currentRoles.includes(step.from_role_id) ||
            step.from_emp_id === currentEmpId,
        );

      const peopleInvolved = [
        ...new Set(
          steps
            .filter((step) => step.from_emp_name && step.from_emp_name !== "Unknown User")
            .map((step) => `${step.from_emp_name} (${step.from_role_name || "Unknown Role"})`),
        ),
      ];

      return {
        ...application,
        currentStatus: application.status,
        statusWhenActed: lastActedStep?.final_status || application.status,
        history: steps,
        peopleInvolved,
        totalSteps: steps.length,
      };
    });

    return res.status(200).json({ success: true, processedApplications });
  } catch (error) {
    console.error("Error fetching processed applications:", error);
    return res.status(500).json({ success: false, message: "Error fetching processed applications" });
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
// 5. EDIT APPLICATION
//    PUT /api/applications/:application_id/edit
//    Body: { emp_id, subject, description, category, priority, attachments, mode, forward_to_role, reference_notesheet_id, fromDate, toDate }
// ─────────────────────────────────────────────────────────────────────────────
export const editApplication = async (req, res) => {
  try {
    const { application_id } = req.params;
    const {
      emp_id,
      subject,
      description,
      category,
      priority,
      attachments,
      mode,
      forward_to_role,
      reference_notesheet_id,
      fromDate,
      toDate,
    } = req.body;

    const requestEmpId = req.user?.emp_id ?? emp_id;

    const application = await Application.findOne({ application_id, is_deleted: false });

    if (!application) return res.status(404).json({ success: false, message: "Application not found." });
    if (String(application.emp_id) !== String(requestEmpId))
      return res.status(403).json({ success: false, message: "Not authorized to edit this application." });
    if (application.status !== "PENDING")
      return res.status(400).json({ success: false, message: "Only PENDING applications can be edited." });

    const flowHistory = await ApplicationFlow.find({ application_id }).sort({ createdAt: 1 });
    const actionTaken = flowHistory.some((flow) => flow.action !== "CREATED");
    if (actionTaken) {
      return res.status(400).json({ success: false, message: "Application has already been forwarded and cannot be edited." });
    }

    const msElapsed = Date.now() - new Date(application.createdAt).getTime();
    if (msElapsed > 60 * 60 * 1000) {
      return res.status(400).json({ success: false, message: "Edit window of 1 hour has expired." });
    }

    const updated = await Application.findOneAndUpdate(
      { application_id },
      {
        ...(subject !== undefined && { subject }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(priority !== undefined && { priority }),
        ...(fromDate !== undefined && { fromDate }),
        ...(toDate !== undefined && { toDate }),
        ...(attachments !== undefined && { attachments: Array.isArray(attachments) ? attachments : [] }),
        ...(mode !== undefined && { mode: Number(mode) }),
        ...(forward_to_role !== undefined && { forward_to_role_id: Number(forward_to_role) }),
        ...(reference_notesheet_id !== undefined && { reference_notesheet_id }),
        updatedAt: new Date(),
      },
      { new: true },
    );

    await ApplicationFlow.findOneAndUpdate(
      { application_id, action: "CREATED" },
      { $set: { remark: description ?? updated?.description ?? null } },
    );

    return res.status(200).json({ success: true, message: "Application updated successfully.", data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. APPROVE APPLICATION — DIRECT MODE (mode=1)
//    PATCH /api/applications/:application_id/approve/direct
//    Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const approveApplicationDirect = async (req, res) => {
  try {
    const { emp_id, remarks = "" } = req.body;
    const currentRoleId = getCurrentUserRoleId(req);
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.mode !== 1)
      return res.status(400).json({ success: false, message: "This is not a direct mode application." });
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId))
      return res.status(403).json({ success: false, message: "Only the assigned role can approve this application." });
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
    application.current_holder_role_id = null;
    application.current_holder_emp_id = null;
    application.current_holder_emp_name = "";
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
    const currentRoleId = getCurrentUserRoleId(req);
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.mode !== 0)
      return res.status(400).json({ success: false, message: "This is not a chain mode application." });
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId))
      return res.status(403).json({ success: false, message: "Only the current role can approve this application." });
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
    application.current_holder_role_id = null;
    application.current_holder_emp_id = null;
    application.current_holder_emp_name = "";
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
    const currentRoleId = getCurrentUserRoleId(req);

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
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId)) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Only the current role can forward this application." });
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
      Role.findOne({
        role_id: Number(forward_to_role),
        canReceiveNotesheet: true,
        dept_ids: { $in: [application.dept_id] },
      }),
    ]);

    if (!toRole) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Target role not found." });
    }

    const nextApprover = await Employee.findOne({
      $or: [
        { active_role_id: Number(forward_to_role), dept_id: application.dept_id, is_active: true },
        { role_ids: { $in: [Number(forward_to_role)] }, dept_id: application.dept_id, is_active: true },
      ],
    });

    if (!nextApprover) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "No active employee found for the target role in the application department." });
    }

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
    application.current_holder_role_id = toRole.role_id;
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
    const currentRoleId = getCurrentUserRoleId(req);

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
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId)) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Only the current role can forward this application." });
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
            rp.power.power_level > currentLevel &&
            rp.role.dept_ids?.includes(application.dept_id),
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
        { active_role_id: Number(nextRole.role_id), dept_id: application.dept_id, is_active: true },
        { role_ids: { $in: [Number(nextRole.role_id)] }, dept_id: application.dept_id, is_active: true },
      ],
    });

    if (!nextApprover) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "No active employee found for the next role in the application department." });
    }

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
    application.current_holder_role_id = nextRole.role_id;
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
    const currentRoleId = getCurrentUserRoleId(req);
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId))
      return res.status(403).json({ success: false, message: "Only the assigned role can reject this application." });
    if (["APPROVED", "REJECTED"].includes(application.status))
      return res.status(400).json({ success: false, message: `Application is already ${application.status}.` });

    const rejecter = await Employee.findOne({ emp_id: Number(emp_id) });

    application.status = "REJECTED";
    application.authorityRemarks = remarks;
    application.current_holder_role_id = null;
    application.current_holder_emp_id = null;
    application.current_holder_emp_name = "";
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
// 10. CLOSE APPLICATION
//     PATCH /api/applications/:application_id/close
//     Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const closeApplication = async (req, res) => {
  try {
    const { emp_id, remarks = "" } = req.body;
    const currentRoleId = getCurrentUserRoleId(req);
    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (application.status !== "APPROVED")
      return res.status(400).json({ success: false, message: "Only APPROVED applications can be closed." });

    const latestApproval = await ApplicationFlow.findOne({
      application_id: application.application_id,
      action: "APPROVED",
    }).sort({ createdAt: -1 });

    if (!latestApproval)
      return res.status(400).json({ success: false, message: "No approval found for this application." });
    if (currentRoleId && Number(latestApproval.from_role_id) !== Number(currentRoleId))
      return res.status(403).json({ success: false, message: "Only the approving role can close this application." });

    const closer = await Employee.findOne({ emp_id: Number(emp_id) });

    application.status = "CLOSED";
    application.authorityRemarks = remarks;
    application.current_holder_role_id = null;
    application.current_holder_emp_id = null;
    application.current_holder_emp_name = "";
    await application.save();

    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: closer?.emp_id ?? null,
      from_emp_name: closer?.emp_name ?? "",
      from_role_id: latestApproval.from_role_id,
      from_role_name: latestApproval.from_role_name,
      to_emp_id: null,
      to_emp_name: null,
      to_role_id: null,
      to_role_name: null,
      action: "CLOSED",
      remark: remarks,
      level: application.level,
      final_status: "CLOSED",
    });

    return res.status(200).json({
      success: true,
      message: "Application closed successfully.",
      data: application,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. RAISE QUERY
//     PATCH /api/applications/:application_id/query
//     Body: { emp_id, remarks }
// ─────────────────────────────────────────────────────────────────────────────
export const raiseQuery = async (req, res) => {
  try {
    const { emp_id, remarks } = req.body;
    const currentRoleId = getCurrentUserRoleId(req);
    if (!remarks)
      return res.status(400).json({ success: false, message: "Remarks are required to raise a query." });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });
    if (currentRoleId && Number(application.current_holder_role_id || application.forward_to_role_id) !== Number(currentRoleId))
      return res.status(403).json({ success: false, message: "Only the assigned role can raise a query." });
    if (application.status !== "PENDING")
      return res.status(400).json({ success: false, message: "Query can only be raised on a PENDING application." });

    const queryer = await Employee.findOne({ emp_id: Number(emp_id) });
    // Find previous flow step (the role/employee who forwarded this to current holder)
    const allSteps = await ApplicationFlow.find({ application_id: application.application_id }).sort({ createdAt: 1 }).lean();
    const lastToCurrent = [...allSteps].reverse().find(
      (step) => step.to_role_id && Number(step.to_role_id) === Number(application.current_holder_role_id),
    );

    // Default targets: applicant
    let targetRoleId = application.submitted_by_role_id;
    let targetRoleName = application.submitted_by_role_name;
    let targetEmpId = application.emp_id;
    let targetEmpName = application.emp_name;

    if (lastToCurrent) {
      // send query back to the role who forwarded it here (level below current)
      if (lastToCurrent.from_role_id) {
        targetRoleId = lastToCurrent.from_role_id;
        targetRoleName = lastToCurrent.from_role_name || targetRoleName;
      }
      if (lastToCurrent.from_emp_id) {
        targetEmpId = lastToCurrent.from_emp_id;
        targetEmpName = lastToCurrent.from_emp_name || targetEmpName;
      }
    }

    // Update application to be held by the target role/employee so it won't appear for the raiser
    application.status = "QUERY_RAISED";
    application.authorityRemarks = remarks;
    application.current_holder_role_id = targetRoleId ?? null;
    application.current_holder_emp_id = targetEmpId ?? null;
    application.current_holder_emp_name = targetEmpName ?? "";
    application.forward_to_role_id = targetRoleId ?? null;
    application.forward_to_role_name = targetRoleName ?? "";
    await application.save();

    await ApplicationFlow.create({
      application_id: application.application_id,
      from_emp_id: queryer?.emp_id ?? null,
      from_emp_name: queryer?.emp_name ?? "",
      from_role_id: application.forward_to_role_id,
      from_role_name: application.forward_to_role_name,
      to_emp_id: targetEmpId,
      to_emp_name: targetEmpName,
      to_role_id: targetRoleId,
      to_role_name: targetRoleName,
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
// 12. REPLY TO QUERY
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
// 13. SOFT DELETE
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
