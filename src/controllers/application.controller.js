import mongoose from "mongoose";
import Application from "../models/application/Application.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Power from "../models/userPowers/power.model.js";
import Department from "../models/office/department.model.js";
import ApplicationFlow from "../models/application/ApplicationFlow.model.js";
import { Counter } from "../models/counter/counter.model.js";
// import { sendNotesheetMail } from "../services/notesheetMail.servies.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
const mapAttachments = (files = []) =>
  files.map((f) => ({
    url: f.path,
    publicId: f.filename,
    originalName: f.originalname,
  }));

const getCurrentUserRoleId = (req) =>
  Number(req.user?.active_role_id ?? req.user?.role_id ?? 0) || null;

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

    if (
      !requestEmpId ||
      !requestDeptId ||
      !applicationType ||
      !subject ||
      !description ||
      mode === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "emp_id, dept_id, applicationType, subject, description and mode are required.",
      });
    }

    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      return res
        .status(400)
        .json({ success: false, message: "fromDate must be before toDate." });
    }

    if (![0, 1].includes(Number(mode))) {
      return res.status(400).json({
        success: false,
        message: "Invalid mode. 0 = chain, 1 = direct",
      });
    }

    const [sender, department] = await Promise.all([
      Employee.findOne({ emp_id: Number(requestEmpId) }),
      Department.findOne({ dept_id: Number(requestDeptId) }),
    ]);

    if (!sender)
      return res
        .status(404)
        .json({ success: false, message: "Sender not found." });
    if (!department)
      return res
        .status(404)
        .json({ success: false, message: "Department not found." });

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
        return res.status(400).json({
          success: false,
          message: "forward_to_role is required for direct mode.",
        });
      }

      nextRole = await Role.findOne({
        role_id: Number(forward_to_role),
        canReceiveNotesheet: true,
        dept_ids: { $in: [applicationDeptId] },
      });
      if (!nextRole)
        return res.status(404).json({
          success: false,
          message: "Target role not found in the application department.",
        });

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
      const powerIds = [
        ...new Set(allRoles.map((r) => r.power_id).filter(Boolean)),
      ];
      const allPowers = await Power.find({ power_id: { $in: powerIds } });
      const powerMap = Object.fromEntries(
        allPowers.map((p) => [p.power_id, p]),
      );

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
        return res.status(404).json({
          success: false,
          message:
            "No approver role found in the application department above your level.",
        });
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
        ? words
            .map((w) => w[0])
            .join("")
            .toUpperCase()
        : words[0].substring(0, 3).toUpperCase();
    };

    const baseCode =
      department.dept_code || generateDeptCode(department.dept_name);
    const counter = await Counter.findOneAndUpdate(
      { name: `app_id_${baseCode}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const application_id = `APP_${baseCode}_${String(counter.seq).padStart(3, "0")}`;

    const attachments = req.files?.length
      ? mapAttachments(req.files)
      : Array.isArray(req.body?.attachments)
        ? req.body.attachments.map((item) =>
            typeof item === "string"
              ? {
                  url: item,
                  publicId: null,
                  originalName: item.split("/").pop(),
                }
              : item,
          )
        : [];

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
      message: `Application submitted successfully. Reference ID: ${application.application_id}`,
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

export const getAllApplicationsByScope = async (req, res) => {
  try {
    const { role_id, empId, scope } = req.query;
 
    if (!role_id && !empId) {
      return res.status(400).json({
        success: false,
        message: "role_id or empId is required",
      });
    }
 
    let roleId = null;
    let empIdNum = empId ? Number(empId) : null;
    let activeRole = null;
 
    // ✅ FIXED: empId ab role_id ke saath bhi parse hota hai (pehle sirf
    // "else" branch mein set hota tha, jab role_id na diya gaya ho).
    // Isse "MY" scope filter dono fields (created_by_emp_id + created_by_role_id)
    // saath match kar sakta hai — getEmployeeApplicationSummary jaisa hi.
    if (role_id) {
      roleId = Number(role_id);
      activeRole = await Role.findOne({ role_id: roleId });
      if (!activeRole) {
        return res.status(404).json({
          success: false,
          message: "Role not found",
        });
      }
 
      // agar empId nahi bheja gaya, employee lookup se fallback mat karo —
      // role_id explicitly diya gaya hai, use hi authoritative maano
    } else {
      empIdNum = Number(empId);
 
      const employee = await Employee.findOne({ emp_id: empIdNum });
      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }
 
      roleId = employee.active_role_id ? Number(employee.active_role_id) : null;
      activeRole = roleId ? await Role.findOne({ role_id: roleId }) : null;
    }
 
    const roleDeptIds = (activeRole?.dept_ids || []).map(Number);
    const appViewDeptIds = (
      activeRole?.app_view_dept_ids ||
      activeRole?.view_dept_ids ||
      []
    ).map(Number);
    const allAccessibleDeptIds = [
      ...new Set([...roleDeptIds, ...appViewDeptIds]),
    ];
 
    const appScope = activeRole?.app_view_scope || activeRole?.view_scope;
 
    let allowedScopes = ["MY"];
    if (appScope === "ALL") {
      allowedScopes = ["MY", "DEPARTMENT", "ALL"];
    } else if (appScope === "DEPARTMENT") {
      allowedScopes = ["MY", "DEPARTMENT"];
    }
 
    const appliedScope = allowedScopes.includes(scope) ? scope : "MY";
 
    let filter = {};
 
    // =========================
    // MY SCOPE — hamesha sirf khud (is role se) create ki hui applications,
    // chahe role ka view_scope kuch bhi ho (OWN / DEPARTMENT / ALL)
    // =========================
    if (appliedScope === "MY") {
      if (roleId) {
        // ✅ FIXED: created_by_emp_id bhi add kiya — pehle sirf
        // created_by_role_id se filter hota tha, jisse same role_id
        // wale doosre employees ki applications bhi mix ho sakti thi.
        filter = { created_by_role_id: roleId };
        if (empIdNum) {
          filter.created_by_emp_id = empIdNum;
        }
      } else {
        filter = { created_by_emp_id: empIdNum, created_by_role_id: null };
      }
    }
 
    // =========================
    // DEPARTMENT — role ke accessible departments ki saari applications
    // (Dean: apne department(s) ki sabhi; ya specific dept select karke)
    // =========================
    else if (appliedScope === "DEPARTMENT") {
      const requestedDept = req.query.departmentId
        ? Number(req.query.departmentId)
        : null;
 
      if (allAccessibleDeptIds.length === 0) {
        filter = { _id: null };
      } else if (requestedDept !== null) {
        filter = allAccessibleDeptIds.includes(requestedDept)
          ? { dept_id: requestedDept }
          : { _id: null };
      } else {
        filter = { dept_id: { $in: allAccessibleDeptIds } };
      }
    }
 
    // =========================
    // ALL — VC/PVC jaise roles ke liye, system ki saari applications
    // =========================
    else {
      filter = {};
    }
 
    const { status } = req.query;
    if (status && status !== "all") {
      filter.status = String(status).toUpperCase();
    }
 
    const limit = req.query.limit ? Number(req.query.limit) : 100;
 
    const applications = await Application.find({
      ...filter,
      is_deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(limit);
 
    const applicationIds = applications.map((a) => a.application_id);
 
    const allFlows = await ApplicationFlow.find({
      application_id: { $in: applicationIds },
    }).sort({ createdAt: 1 });
 
    const processedApplications = applications.map((app) => {
      let flow = allFlows.filter(
        (f) => f.application_id === app.application_id,
      );
 
      flow = flow.filter(
        (item) =>
          item.action !== "REJECTED" || item.final_status === "REJECTED",
      );
 
      const currentStep = flow.find((item) => item.final_status === "PENDING");
 
      return {
        ...app.toObject(),
        flow,
        current_step: currentStep || null,
      };
    });
 
    return res.status(200).json({
      success: true,
      count: processedApplications.length,
      data: {
        applications: processedApplications,
      },
    });
  } catch (error) {
    console.error("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
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
      Application.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
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
    const requestedRoleId =
      Number(role_id || req.user?.active_role_id || 0) || null;
    const currentEmpId = req.user?.emp_id ?? null;
    const currentRoleId = getCurrentUserRoleId(req);

    if (!requestedRoleId)
      return res
        .status(400)
        .json({ success: false, message: "role_id is required." });

    // Validate view permissions for the current role
    const currentRole = currentRoleId
      ? await Role.findOne({ role_id: currentRoleId })
      : null;
    const requestedRole = await Role.findOne({ role_id: requestedRoleId });

    if (!requestedRole)
      return res
        .status(404)
        .json({ success: false, message: "Requested role not found." });

    const appViewScope = (
      currentRole?.app_view_scope ||
      currentRole?.view_scope ||
      "OWN"
    ).toUpperCase();

    let allowed = false;
    if (currentRoleId && Number(currentRoleId) === Number(requestedRoleId))
      allowed = true;
    else if (appViewScope === "ALL") allowed = true;
    else if (appViewScope === "DEPARTMENT") {
      const allowedDepts = Array.isArray(currentRole?.app_view_dept_ids)
        ? currentRole.app_view_dept_ids.map(Number)
        : [];
      const requestedDepts = Array.isArray(requestedRole?.dept_ids)
        ? requestedRole.dept_ids.map(Number)
        : [];
      if (
        allowedDepts.length &&
        requestedDepts.some((d) => allowedDepts.includes(d))
      )
        allowed = true;
    }

    if (!allowed)
      return res.status(403).json({
        success: false,
        message: "Not authorized to view applications for this role.",
      });

    const filter = {
      is_deleted: false,
      current_holder_role_id: requestedRoleId,
    };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
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
// 3B. PROCESSED APPLICATIONS
//    GET /api/applications/processed
// ─────────────────────────────────────────────────────────────────────────────

export const getProcessedApplications = async (req, res) => {
  try {
    const currentRoles =
      req.user.role_ids || [req.user?.active_role_id].filter(Boolean);
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

    const applicationIds = [
      ...new Set(actedSteps.map((step) => step.application_id)),
    ];

    const [allSteps, applications] = await Promise.all([
      ApplicationFlow.find({ application_id: { $in: applicationIds } })
        .sort({ createdAt: 1 })
        .lean(),
      Application.find({ application_id: { $in: applicationIds } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const processedApplications = applications.map((application) => {
      const steps = allSteps.filter(
        (step) =>
          String(step.application_id) === String(application.application_id),
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
            .filter(
              (step) =>
                step.from_emp_name && step.from_emp_name !== "Unknown User",
            )
            .map(
              (step) =>
                `${step.from_emp_name} (${step.from_role_name || "Unknown Role"})`,
            ),
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
    return res.status(500).json({
      success: false,
      message: "Error fetching processed applications",
    });
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });

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

    const application = await Application.findOne({
      application_id,
      is_deleted: false,
    });

    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (String(application.emp_id) !== String(requestEmpId))
      return res.status(403).json({
        success: false,
        message: "Not authorized to edit this application.",
      });
    if (application.status !== "PENDING")
      return res.status(400).json({
        success: false,
        message: "Only PENDING applications can be edited.",
      });

    const flowHistory = await ApplicationFlow.find({ application_id }).sort({
      createdAt: 1,
    });
    const actionTaken = flowHistory.some((flow) => flow.action !== "CREATED");
    if (actionTaken) {
      return res.status(400).json({
        success: false,
        message: "Application has already been forwarded and cannot be edited.",
      });
    }

    const msElapsed = Date.now() - new Date(application.createdAt).getTime();
    if (msElapsed > 60 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: "Edit window of 1 hour has expired.",
      });
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
        ...(attachments !== undefined && {
          attachments: Array.isArray(attachments) ? attachments : [],
        }),
        ...(mode !== undefined && { mode: Number(mode) }),
        ...(forward_to_role !== undefined && {
          forward_to_role_id: Number(forward_to_role),
        }),
        ...(reference_notesheet_id !== undefined && { reference_notesheet_id }),
        updatedAt: new Date(),
      },
      { new: true },
    );

    await ApplicationFlow.findOneAndUpdate(
      { application_id, action: "CREATED" },
      { $set: { remark: description ?? updated?.description ?? null } },
    );

    return res.status(200).json({
      success: true,
      message: "Application updated successfully.",
      data: updated,
    });
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (application.mode !== 1)
      return res.status(400).json({
        success: false,
        message: "This is not a direct mode application.",
      });
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    )
      return res.status(403).json({
        success: false,
        message: "Only the assigned role can approve this application.",
      });
    if (!["PENDING", "QUERY_RAISED"].includes(application.status))
      return res.status(400).json({
        success: false,
        message: `Application is already ${application.status}.`,
      });

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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (application.mode !== 0)
      return res.status(400).json({
        success: false,
        message: "This is not a chain mode application.",
      });
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    )
      return res.status(403).json({
        success: false,
        message: "Only the current role can approve this application.",
      });
    if (!["PENDING", "QUERY_RAISED"].includes(application.status))
      return res.status(400).json({
        success: false,
        message: `Application is already ${application.status}.`,
      });

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
      return res
        .status(400)
        .json({ success: false, message: "forward_to_role is required." });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    }).session(session);

    if (!application) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    }
    if (application.mode !== 1) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "This is not a direct mode application.",
      });
    }
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Only the current role can forward this application.",
      });
    }
    if (!["PENDING", "QUERY_RAISED"].includes(application.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Application is already ${application.status}.`,
      });
    }

    // Prevent duplicate forwarding to same role
    const alreadySent = await ApplicationFlow.findOne({
      application_id: application.application_id,
      to_role_id: Number(forward_to_role),
      final_status: "PENDING",
    }).session(session);

    if (alreadySent) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ success: false, message: "Already forwarded to this role." });
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
      return res
        .status(404)
        .json({ success: false, message: "Target role not found." });
    }

    const nextApprover = await Employee.findOne({
      $or: [
        {
          active_role_id: Number(forward_to_role),
          dept_id: application.dept_id,
          is_active: true,
        },
        {
          role_ids: { $in: [Number(forward_to_role)] },
          dept_id: application.dept_id,
          is_active: true,
        },
      ],
    });

    if (!nextApprover) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "No active employee found for the target role in the application department.",
      });
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
          from_role_id:
            forwarderRole?.role_id ?? application.forward_to_role_id,
          from_role_name:
            forwarderRole?.role_name ?? application.forward_to_role_name,
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    }
    if (application.mode !== 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "This is not a chain mode application.",
      });
    }
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Only the current role can forward this application.",
      });
    }
    if (!["PENDING", "QUERY_RAISED"].includes(application.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Application is already ${application.status}.`,
      });
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
        return res
          .status(404)
          .json({ success: false, message: "Target role not found." });
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
        {
          active_role_id: Number(nextRole.role_id),
          dept_id: application.dept_id,
          is_active: true,
        },
        {
          role_ids: { $in: [Number(nextRole.role_id)] },
          dept_id: application.dept_id,
          is_active: true,
        },
      ],
    });

    if (!nextApprover) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message:
          "No active employee found for the next role in the application department.",
      });
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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    )
      return res.status(403).json({
        success: false,
        message: "Only the assigned role can reject this application.",
      });
    if (["APPROVED", "REJECTED"].includes(application.status))
      return res.status(400).json({
        success: false,
        message: `Application is already ${application.status}.`,
      });

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
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (application.status !== "APPROVED")
      return res.status(400).json({
        success: false,
        message: "Only APPROVED applications can be closed.",
      });

    const latestApproval = await ApplicationFlow.findOne({
      application_id: application.application_id,
      action: "APPROVED",
    }).sort({ createdAt: -1 });

    if (!latestApproval)
      return res.status(400).json({
        success: false,
        message: "No approval found for this application.",
      });
    if (
      currentRoleId &&
      Number(latestApproval.from_role_id) !== Number(currentRoleId)
    )
      return res.status(403).json({
        success: false,
        message: "Only the approving role can close this application.",
      });

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
      return res.status(400).json({
        success: false,
        message: "Remarks are required to raise a query.",
      });

    const application = await Application.findOne({
      application_id: req.params.application_id,
      is_deleted: false,
    });

    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });
    if (
      currentRoleId &&
      Number(
        application.current_holder_role_id || application.forward_to_role_id,
      ) !== Number(currentRoleId)
    )
      return res.status(403).json({
        success: false,
        message: "Only the assigned role can raise a query.",
      });
    if (application.status !== "PENDING")
      return res.status(400).json({
        success: false,
        message: "Query can only be raised on a PENDING application.",
      });

    const queryer = await Employee.findOne({ emp_id: Number(emp_id) });

    // ✅ CAPTURE current (raiser) role/emp info BEFORE any overwrite happens
    const raiserRoleId =
      application.current_holder_role_id ?? application.forward_to_role_id;
    const raiserRoleName =
      application.current_holder_role_name ?? application.forward_to_role_name;
    const raiserEmpId = application.current_holder_emp_id;
    const raiserEmpName = application.current_holder_emp_name;

    const allSteps = await ApplicationFlow.find({
      application_id: application.application_id,
    })
      .sort({ createdAt: 1 })
      .lean();
    const lastToCurrent = [...allSteps]
      .reverse()
      .find(
        (step) =>
          step.to_role_id &&
          Number(step.to_role_id) ===
            Number(application.current_holder_role_id),
      );

    let targetRoleId = application.submitted_by_role_id;
    let targetRoleName = application.submitted_by_role_name;
    let targetEmpId = application.emp_id;
    let targetEmpName = application.emp_name;

    if (lastToCurrent) {
      if (lastToCurrent.from_role_id) {
        targetRoleId = lastToCurrent.from_role_id;
        targetRoleName = lastToCurrent.from_role_name || targetRoleName;
      }
      if (lastToCurrent.from_emp_id) {
        targetEmpId = lastToCurrent.from_emp_id;
        targetEmpName = lastToCurrent.from_emp_name || targetEmpName;
      }
    }

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
      from_emp_id: raiserEmpId ?? queryer?.emp_id ?? null, // ✅ fixed
      from_emp_name: raiserEmpName ?? queryer?.emp_name ?? "", // ✅ fixed
      from_role_id: raiserRoleId ?? null, // ✅ fixed
      from_role_name: raiserRoleName ?? "", // ✅ fixed
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
// export const replyToQuery = async (req, res) => {
//   try {
//     const { emp_id, reply } = req.body;
//     console.log("BODY RECEIVED:", req.body);
//     if (!reply)
//       return res
//         .status(400)
//         .json({ success: false, message: "Reply is required." });

//     const application = await Application.findOne({
//       application_id: req.params.application_id,
//       is_deleted: false,
//     });

//     if (!application)
//       return res
//         .status(404)
//         .json({ success: false, message: "Application not found." });
//     if (application.emp_id !== Number(emp_id))
//       return res.status(403).json({
//         success: false,
//         message: "Only the applicant can reply to a query.",
//       });
//     if (application.status !== "QUERY_RAISED")
//       return res.status(400).json({
//         success: false,
//         message: "No query has been raised on this application.",
//       });

//     application.status = "PENDING";
//     await application.save();

//     await ApplicationFlow.create({
//       application_id: application.application_id,
//       from_emp_id: application.emp_id,
//       from_emp_name: application.emp_name,
//       from_role_id: application.submitted_by_role_id,
//       from_role_name: application.submitted_by_role_name,
//       to_emp_id: application.current_holder_emp_id,
//       to_emp_name: application.current_holder_emp_name,
//       to_role_id: application.forward_to_role_id,
//       to_role_name: application.forward_to_role_name,
//       action: "QUERY_REPLY",
//       remark: reply,
//       level: application.level,
//       final_status: "QUERY_REPLIED",
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Query reply submitted successfully.",
//       data: application,
//     });
//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };
export const replyToQuery = async (req, res) => {
  try {
    const { application_id } = req.params;
    const { reply } = req.body;
    const userId = req.user.emp_id;
    const userRoleId = req.user.active_role_id;

    if (!reply?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Reply is required" });

    const [employee, role, application] = await Promise.all([
      Employee.findOne({ emp_id: userId }),
      Role.findOne({ role_id: userRoleId }),
      Application.findOne({ application_id, is_deleted: false }),
    ]);
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    // 🔍 DEBUG — isse pata chalega exact mismatch
    console.log("userId:", userId, typeof userId);
    console.log("userRoleId:", userRoleId, typeof userRoleId);
    const allQueries = await ApplicationFlow.find({
      application_id,
      action: "QUERY",
    }).lean();
    console.log("Stored QUERY flows:", JSON.stringify(allQueries, null, 2));

    // ✅ QUERY_RAISED status wali query dhundo — sirf to_role_id match karo (role based auth)
    const currentQueryStep = await ApplicationFlow.findOne({
      application_id,
      action: "QUERY",
      final_status: "QUERY_RAISED",
      $or: [
        { to_emp_id: userId },
        { to_role_id: userRoleId },
        { to_emp_id: Number(userId) },
        { to_role_id: Number(userRoleId) },
        { to_emp_id: String(userId) },
        { to_role_id: String(userRoleId) },
      ],
    }).sort({ createdAt: -1 });

    if (!currentQueryStep) {
      return res.status(403).json({
        success: false,
        message: "No pending query found to reply to",
      });
    }

    // ✅ Pehle QUERY_REPLY create karo
    await ApplicationFlow.create({
      application_id,
      from_emp_id: userId,
      from_emp_name: employee?.emp_name ?? "Unknown User",
      from_role_id: userRoleId,
      from_role_name: role?.role_name ?? "Unknown Role",
      to_emp_id: currentQueryStep.from_emp_id,
      to_emp_name: currentQueryStep.from_emp_name ?? null,
      to_role_id: currentQueryStep.from_role_id,
      to_role_name: currentQueryStep.from_role_name ?? null,
      action: "QUERY_REPLY",
      remark: reply,
      level: currentQueryStep.level,
      final_status: ACTION_STATUS.QUERY_REPLY,
    });

    // ✅ Ab hi purani QUERY ko RESOLVED mark karo
    await ApplicationFlow.findByIdAndUpdate(currentQueryStep._id, {
      $set: { final_status: "RESOLVED" },
    });

    // Query raiser ka role fetch karo
    const targetRole = await Role.findOne({
      role_id: currentQueryStep.from_role_id,
    });

    application.current_holder_emp_id = currentQueryStep.from_emp_id;
    application.current_holder_emp_name = currentQueryStep.from_emp_name;

    application.current_holder_role_id = currentQueryStep.from_role_id;
    application.current_holder_role_name = currentQueryStep.from_role_name;

    application.forward_to_emp_id = currentQueryStep.from_emp_id;
    application.forward_to_role_id = currentQueryStep.from_role_id;
    application.forward_to_role_name = currentQueryStep.from_role_name;

    application.forward_to_dept_id = targetRole?.dept_ids?.[0] ?? null;

    application.status = "PENDING";

    await application.save();

    return res
      .status(200)
      .json({ success: true, message: "Reply sent successfully" });
  } catch (error) {
    console.error("Reply Query Error:", error);
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
    const { application_id } = req.params;
    const emp_id = req.user?.emp_id; // ✅ auth middleware se, req.body se nahi

    if (!emp_id)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const application = await Application.findOne({
      application_id,
      is_deleted: false,
    });

    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found." });

    if (Number(application.emp_id) !== Number(emp_id))
      return res.status(403).json({
        success: false,
        message: "Only the applicant can delete their application.",
      });

    if (application.status !== "PENDING")
      return res.status(400).json({
        success: false,
        message: "Only PENDING applications can be deleted.",
      });

    application.is_deleted = true;
    application.deleted_at = new Date();
    await application.save();

    return res
      .status(200)
      .json({ success: true, message: "Application deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEmployeeApplicationSummary = async (req, res) => {
  try {
    const empId = Number(req.params.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId is required",
      });
    }

    // Notesheet jaisa hi status enum use kiya hai — agar Application ke
    // status values alag hain (e.g. "IN_EXECUTION" na ho) to ye list update karna
    const STATUSES = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "CLOSED",
      "IN_EXECUTION",
    ];

    const emptyStatusMap = () =>
      STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});

    // ---------------------------------------------------------
    // 1) EMPLOYEE'S OWN PERSONAL SUMMARY
    //    created_by_emp_id = empId  AND  created_by_role_id = null
    // ---------------------------------------------------------
    const ownAgg = await Application.aggregate([
      {
        $match: {
          created_by_emp_id: empId,
          created_by_role_id: null,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const ownByStatus = emptyStatusMap();
    let ownTotal = 0;
    ownAgg.forEach((r) => {
      if (ownByStatus.hasOwnProperty(r._id)) ownByStatus[r._id] = r.count;
      ownTotal += r.count;
    });

    // ---------------------------------------------------------
    // 2) ROLE-WISE SUMMARY
    //    created_by_emp_id = empId  AND  created_by_role_id != null
    //    grouped by created_by_role_id
    // ---------------------------------------------------------
    const roleWiseAgg = await Application.aggregate([
      {
        $match: {
          created_by_emp_id: empId,
          created_by_role_id: { $ne: null },
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: {
            role_id: "$created_by_role_id",
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      {
        // created_by_role_id Number hai, isliye Role collection ke numeric
        // "role_id" field se match karo, ObjectId "_id" se nahi
        $lookup: {
          from: "roles", // apna actual Role collection ka naam confirm kar lena
          localField: "_id.role_id",
          foreignField: "role_id",
          as: "roleInfo",
        },
      },
    ]);

    const roleMap = {};

    roleWiseAgg.forEach((r) => {
      const roleId = String(r._id.role_id);
      const status = r._id.status;
      const roleName = r.roleInfo?.[0]?.role_name || "Unknown Role";

      if (!roleMap[roleId]) {
        roleMap[roleId] = {
          role_id: roleId,
          role_name: roleName,
          total: 0,
          byStatus: emptyStatusMap(),
        };
      }

      if (roleMap[roleId].byStatus.hasOwnProperty(status)) {
        roleMap[roleId].byStatus[status] = r.count;
      }
      roleMap[roleId].total += r.count;
    });

    // ---------------------------------------------------------
    // 3) GRAND TOTAL (own + all roles combined)
    // ---------------------------------------------------------
    const grandTotal =
      ownTotal + Object.values(roleMap).reduce((sum, r) => sum + r.total, 0);
    const grandByStatus = emptyStatusMap();
    STATUSES.forEach((s) => {
      grandByStatus[s] =
        ownByStatus[s] +
        Object.values(roleMap).reduce((sum, r) => sum + r.byStatus[s], 0);
    });

    return res.status(200).json({
      success: true,
      message:
        "Employee personal + role-wise application summary fetched successfully",
      data: {
        emp_id: empId,
        grandTotal: {
          total: grandTotal,
          byStatus: grandByStatus,
        },
        ownProfile: {
          total: ownTotal,
          byStatus: ownByStatus,
        },
        roleWise: Object.values(roleMap),
      },
    });
  } catch (error) {
    console.error("❌ [Application Summary Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getRecentApplications = async (req, res) => {
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
        message:
          "view_type is required and must be either 'employee' or 'role'",
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
      // ✅ Personal profile = sirf woh applications jo bina kisi role ke bane the
      filter.created_by_emp_id = empId;
      filter.created_by_role_id = null;
    } else if (viewType === "role") {
      if (!roleId) {
        return res.status(400).json({
          success: false,
          message: "role_id is required for role view_type",
        });
      }
      // ✅ Role context = us specific role se bani applications
      filter.created_by_role_id = roleId;
    }

    const recentApplications = await Application.find(filter)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return res.status(200).json({
      success: true,
      data: recentApplications || [],
    });
  } catch (error) {
    console.error("Recent Applications Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getApplicationApprovalFlow = async (req, res) => {
  try {
    const applicationId = req.params.application_id;

    const application = await Application.findOne({
      application_id: applicationId,
    }).lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const flow = await ApplicationFlow.aggregate([
      { $match: { application_id: applicationId } },
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

      // TO DEPT
      {
        $lookup: {
          from: "departments",
          localField: "to_dept_id",
          foreignField: "dept_id",
          as: "toDept",
        },
      },
      { $unwind: { path: "$toDept", preserveNullAndEmptyArrays: true } },

      {
        $addFields: {
          from_name: { $ifNull: ["$from_emp_name", "$fromEmployee.emp_name"] },
          from_role_name: {
            $ifNull: ["$from_role_name", "$fromRole.role_name"],
          },
          to_name: { $ifNull: ["$to_emp_name", "$toEmployee.emp_name"] },
          to_role_name: { $ifNull: ["$to_role_name", "$toRole.role_name"] },
          to_dept_name: { $ifNull: ["$toDept.dept_name", null] },
          from_signature: "$fromEmployee.signature",
          from_department: "$fromDept.dept_name",
          from_school: "$fromSchool.school_name",
          from_designation: "$fromEmployee.designation",
        },
      },

      {
        $project: {
          _id: 0,
          application_id: 1,
          level: 1,
          action: 1,
          remark: 1,
          final_status: 1,
          createdAt: 1,
          from_emp_id: 1,
          from_name: 1,
          from_role_id: 1,
          from_role_name: 1,
          from_signature: 1,
          from_department: 1,
          from_school: 1,
          from_designation: 1,
          to_emp_id: 1,
          to_name: 1,
          to_role_id: 1,
          to_role_name: 1,
          to_dept_id: 1,
          to_dept_name: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      application,
      data: flow,
    });
  } catch (error) {
    console.error("getApplicationApprovalFlow error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getQueriesByApplicationId = async (req, res) => {
  try {
    const { application_id: applicationId } = req.params;
    const currentUserId = req.user?.emp_id;

    if (!applicationId)
      return res
        .status(400)
        .json({ success: false, message: "applicationId is required" });
    if (!currentUserId)
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user" });

    // Agar tumne "type field extension" strategy use ki hai (same NotesheetFlow
    // collection, bas ek `type: "APPLICATION"` field se differentiate), to
    // yaha `ApplicationFlow.find` ki jagah `NotesheetFlow.find` use karo aur
    // query mein `type: "APPLICATION"` add kar dena. Neeche separate model maan ke likha hai.
    const flows = await ApplicationFlow.find({
      application_id: applicationId,
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


export const getApprovedApplicationsByRole = async (req, res) => {
  try {
    const roleId = req.user?.active_role_id || req.user?.role_id;

    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: "Role not found for user session",
      });
    }

    const latestFlows = await ApplicationFlow.aggregate([
      {
        $match: {
          from_role_id: Number(roleId),
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: "$application_id",
          latest: {
            $first: "$$ROOT",
          },
        },
      },
      {
        $match: {
          "latest.action": "APPROVED",
        },
      },
      {
        $replaceRoot: {
          newRoot: "$latest",
        },
      },
    ]);

    if (!latestFlows.length) {
      return res.status(200).json({
        success: true,
        message: "No approved applications for this role",
        data: [],
        count: 0,
      });
    }

    const applicationIds = latestFlows.map((f) => f.application_id);

    const applications = await Application.find(
      {
        application_id: { $in: applicationIds },
        is_deleted: { $ne: true },
      },
      {
        application_id: 1,
        application_name: 1, // Change if your schema uses another field
        status: 1,
        lifecycle_status: 1,
      }
    ).lean();

    const applicationMap = {};

    applications.forEach((app) => {
      applicationMap[app.application_id] = app;
    });

    const formatted = latestFlows.map((f) => ({
      application_id: f.application_id,
      application_name:
        applicationMap[f.application_id]?.application_name ||
        "No Application Name",
      status: applicationMap[f.application_id]?.status || null,
      lifecycle_status:
        applicationMap[f.application_id]?.lifecycle_status || null,
      approved_by_emp_id: f.from_emp_id,
      approved_by_role_id: f.from_role_id,
      approved_by_role_name: f.from_role_name || null,
      remarks: f.remark,
      level: f.level,
      approved_at: f.createdAt,
      action: f.action,
    }));

    return res.status(200).json({
      success: true,
      message: "Approved applications (latest state only)",
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


export const forwardExecutionApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { roleId, comment } = req.body;
    const user = req.user;
    const currentRoleId = user.active_role_id || user.role_id;

    if (!currentRoleId)
      return res.status(400).json({ success: false, message: "User role missing" });
    if (!roleId)
      return res.status(400).json({ success: false, message: "Please select role" });

    const application = await Application.findOne({ application_id: applicationId });
    if (!application)
      return res.status(404).json({ success: false, message: "Application not found" });

    if (!["APPROVED", "IN_EXECUTION"].includes(application.status)) {
      return res.status(400).json({ success: false, message: "Application is not in valid state" });
    }

    const lastApproval = await ApplicationFlow.findOne({
      application_id: applicationId,
      action: "APPROVED",
    }).sort({ createdAt: -1 });
    if (!lastApproval)
      return res.status(400).json({ success: false, message: "Application not approved yet" });

    if (Number(lastApproval.from_role_id) !== Number(currentRoleId)) {
      return res.status(403).json({
        success: false,
        message: "Only approving role can start execution",
      });
    }

    if (Number(currentRoleId) === Number(roleId)) {
      return res.status(400).json({ success: false, message: "Cannot forward to same role" });
    }

    const [currentRole, executionRole, employee] = await Promise.all([
      Role.findOne({ role_id: currentRoleId }),
      Role.findOne({ role_id: roleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);
    if (!executionRole)
      return res.status(404).json({ success: false, message: "Selected role not found" });

    const executionEmployee = await Employee.findOne({
      $or: [{ active_role_id: Number(roleId) }, { role_ids: Number(roleId) }],
    });

    // ✅ NEW CHECK — role kisi bhi employee ko assign hai ya nahi
    if (!executionEmployee) {
      const roleEverAssigned = await Employee.exists({
        $or: [{ active_role_id: Number(roleId) }, { role_ids: Number(roleId) }],
      });
      if (!roleEverAssigned) {
        return res.status(400).json({
          success: false,
          message: `Role "${executionRole.role_name}" is not currently assigned to any employee. Cannot forward.`,
        });
      }
    }

    application.status = "IN_EXECUTION";
    application.lifecycle_status = "OPEN";
    application.forward_to_role_id = Number(roleId);
    application.forward_to_emp_id = executionEmployee?.emp_id || null;
    application.forward_to_dept_id = null;
    application.current_holder_emp_id = executionEmployee?.emp_id || null;
    application.updated_by = user.emp_id;
    await application.save();

    await ApplicationFlow.create({
      application_id: applicationId,
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
      level: currentRole?.power_level || application.level || 1,
      final_status: ACTION_STATUS.EXECUTION_STARTED,
    });

    return res.json({
      success: true,
      message: "Execution started successfully",
    });
  } catch (error) {
    console.error("Application Execution Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// COMPLETE EXECUTION (CLOSED) — APPLICATION
// ============================================================
export const completeExecutionApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { remark } = req.body;
    const user = req.user;
    const userRoleId = Number(user.active_role_id || user.role_id);

    const application = await Application.findOne({ application_id: applicationId });
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    if (application.status !== "IN_EXECUTION") {
      return res
        .status(400)
        .json({ success: false, message: "Application is not in execution" });
    }
    if (application.lifecycle_status !== "OPEN") {
      return res
        .status(400)
        .json({ success: false, message: "Application already closed" });
    }

    const executionStep = await ApplicationFlow.findOne({
      application_id: applicationId,
      action: "EXECUTION_STARTED",
      final_status: "PENDING",
    });
    if (!executionStep)
      return res
        .status(400)
        .json({ success: false, message: "Execution step not found" });

    if (Number(executionStep.to_emp_id) !== Number(user.emp_id)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only assigned execution user can close this application",
        });
    }
    if (String(application.forward_to_role_id) !== String(userRoleId)) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const [role, employee] = await Promise.all([
      Role.findOne({ role_id: userRoleId }),
      Employee.findOne({ emp_id: user.emp_id }),
    ]);

    application.status = "CLOSED";
    application.lifecycle_status = "CLOSED";
    application.forward_to_role_id = null;
    application.forward_to_emp_id = null;
    application.forward_to_dept_id = null;
    application.updated_by = user.emp_id;
    await application.save();

    await ApplicationFlow.updateOne(
      { application_id: applicationId, action: "EXECUTION_STARTED", final_status: "PENDING" },
      { $set: { final_status: "COMPLETED" } },
    );

    await ApplicationFlow.create({
      application_id: applicationId,
      from_emp_id: user.emp_id,
      from_emp_name: employee?.emp_name || "Unknown",
      from_role_id: userRoleId,
      from_role_name: role?.role_name || "Unknown",
      to_emp_id: null,
      to_role_id: null,
      to_role_name: null,
      action: "CLOSED",
      remark: remark || "", 
      level: role?.power_level || application.level || 1,
      final_status: ACTION_STATUS.CLOSED, // 'COMPLETED'
    });

    // await sendApplicationMail({
    //   to_emp_id: application.created_by_emp_id || application.emp_id,
    //   type: "CLOSED",
    //   applicationId,
    //   subject: application.subject,
    //   actionBy: employee?.emp_name || "Unknown",
    //   actionByRole: role?.role_name,
    //   remark,
    // });

    return res
      .status(200)
      .json({
        success: true,
        message: "Application execution completed successfully",
      });
  } catch (error) {
    console.error("Complete Application Execution Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const getExecutionApplications = async (req, res) => {
  try {
    let { roleId, empId } = req.query;
    console.log("🔍 Execution fetch — roleId:", roleId, typeof roleId);

    if (!roleId) {
      return res.status(400).json({ success: false, message: "roleId is required" });
    }

    roleId = Number(roleId);
    console.log("🔍 Converted roleId:", roleId);

    const query = {
      forward_to_role_id: roleId,
      status: "IN_EXECUTION",
      lifecycle_status: "OPEN",
      is_deleted: { $ne: true },
    };
    console.log("🔍 Query:", query);

    const applications = await Application.find(query).sort({ updatedAt: -1 }).lean();
    console.log("🔍 Found count:", applications.length);

    if (!applications.length) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // ================= FETCH FLOWS =================
    const applicationIds = applications.map((a) => a.application_id);

    const flows = await ApplicationFlow.find({
      application_id: { $in: applicationIds },
    }).lean();

    // ================= GROUP FLOWS =================
    const flowMap = {};

    flows.forEach((flow) => {
      if (!flowMap[flow.application_id]) {
        flowMap[flow.application_id] = [];
      }
      flowMap[flow.application_id].push(flow);
    });

    // ================= ATTACH LATEST MOVEMENT =================
    const finalData = applications.map((app) => {
      const relatedFlows = flowMap[app.application_id] || [];

      const latestMovement = relatedFlows.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];

      return {
        ...app,
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
      message: "Failed to fetch execution applications",
    });
  }
};