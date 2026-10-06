import mongoose from "mongoose";
import Holiday from "../models/leave/Holiday.model.js";
import LeaveType from "../models/leave/LeaveType.model.js";
import LeaveRequest from "../models/leave/LeaveRequest.model.js";
import LeaveFlow from "../models/leave/LeaveFlow.model.js";
import LeaveBalance from "../models/leave/LeaveBalance.model.js";
import LeaveAdjustment from "../models/leave/LeaveAdjustment.model.js";
import LeaveBulkUpload from "../models/leave/LeaveBulkUpload.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Power from "../models/userPowers/power.model.js";
import Department from "../models/office/department.model.js";
import School from "../models/office/school.model.js";
import LeaveWorkflow from "../models/leave/LeaveWorkflow.model.js";
import LeaveTemporaryRole from "../models/leave/LeaveTemporaryRole.model.js";
import Admin from "../models/user/admin.model.js";
import { Counter } from "../models/counter/counter.model.js";
import { sendNotification } from "../utility/sendNotifications.js";
import { sendMail } from "../utility/sendMail.js";
import { env } from "../config/env.config.js";
import {
  calculateLeaveDays,
  getOrInitLeaveBalance,
  getAllEmployeeBalances,
  seedInitialLeaveTypes,
} from "../utility/leaveCalc.utils.js";

// Helper: Department Code Generator
const generateDeptCode = (name = "") => {
  const words = name.trim().split(" ");
  return words.length > 1
    ? words
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : (words[0] || "GEN").substring(0, 3).toUpperCase();
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET LEAVE TYPES & SEEDING
//    GET /api/leave/types
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveTypes = async (req, res) => {
  try {
    await seedInitialLeaveTypes();
    const leaveTypes = await LeaveType.find({ is_active: true }).sort({ leave_type_id: 1 }).lean();
    return res.status(200).json({ success: true, data: leaveTypes });
  } catch (error) {
    console.error("getLeaveTypes error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave types" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1.1 GET DEPARTMENT COLLEAGUES (For Class Handover)
//     GET /api/leave/colleagues
// ─────────────────────────────────────────────────────────────────────────────
export const getDepartmentColleagues = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    const employee = await Employee.findOne({ emp_id: empId }).lean();
    const deptId = employee?.dept_id ? Number(employee.dept_id) : (req.user?.dept_id ? Number(req.user.dept_id) : null);

    const filter = { is_active: true };
    if (empId) filter.emp_id = { $ne: empId };
    if (deptId) filter.dept_id = deptId;

    const colleagues = await Employee.find(filter)
      .select("emp_id emp_name designation email phone dept_id")
      .sort({ emp_name: 1 })
      .lean();

    const { from_date, to_date } = req.query;

    let enriched = colleagues.map((c) => ({
      ...c,
      is_on_leave: false,
      leave_reason: null,
      leave_details: null,
    }));

    if (from_date && to_date) {
      const qFrom = new Date(from_date);
      qFrom.setHours(0, 0, 0, 0);
      const qTo = new Date(to_date);
      qTo.setHours(23, 59, 59, 999);

      if (!isNaN(qFrom.getTime()) && !isNaN(qTo.getTime())) {
        const collEmpIds = colleagues.map((c) => c.emp_id);

        const overlappingLeaves = await LeaveRequest.find({
          emp_id: { $in: collEmpIds },
          status: "APPROVED",
          is_deleted: { $ne: true },
          from_date: { $lte: qTo },
          to_date: { $gte: qFrom },
        }).lean();

        const leaveTypes = await LeaveType.find().lean();
        const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t.name || t.code]));

        const leaveByEmp = {};
        for (const l of overlappingLeaves) {
          if (l.is_early_resumed && l.resumed_duty_date) {
            const resumedDate = new Date(l.resumed_duty_date);
            resumedDate.setHours(0, 0, 0, 0);
            if (resumedDate <= qFrom) {
              continue;
            }
          }

          const typeName = typeMap[l.leave_type_id] || "Leave";
          const fStr = new Date(l.from_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
          const tStr = new Date(l.to_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
          leaveByEmp[l.emp_id] = {
            leave_id: l.leave_id,
            leave_type_name: typeName,
            from_date: l.from_date,
            to_date: l.to_date,
            reason_text: `${typeName} (${fStr} – ${tStr})`,
          };
        }

        enriched = colleagues.map((c) => {
          const lv = leaveByEmp[c.emp_id];
          return {
            ...c,
            is_on_leave: Boolean(lv),
            leave_reason: lv ? lv.reason_text : null,
            leave_details: lv || null,
          };
        });
      }
    }

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error("getDepartmentColleagues error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch department colleagues" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. APPLY LEAVE (Employee)
//    POST /api/leave/apply
// ─────────────────────────────────────────────────────────────────────────────
export const applyLeave = async (req, res) => {
  try {
    const {
      leave_type_id,
      from_date,
      to_date,
      duration_type = "FULL_DAY",
      reason,
      forward_to_role,
      mode = 1,
      attachments = [],
      handover = null,
      delegation = null,
    } = req.body;

    const empId = Number(req.user?.emp_id);
    if (!empId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    if (!leave_type_id || !from_date || !to_date || !reason) {
      return res.status(400).json({
        success: false,
        message: "leave_type_id, from_date, to_date, and reason are required.",
      });
    }

    const [employee, leaveType] = await Promise.all([
      Employee.findOne({ emp_id: empId }).lean(),
      LeaveType.findOne({ leave_type_id: Number(leave_type_id) }).lean(),
    ]);

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee record not found." });
    }
    if (!leaveType) {
      return res.status(404).json({ success: false, message: "Leave type not found." });
    }

    const deptId = Number(employee.dept_id) || 1;
    const department = await Department.findOne({ dept_id: deptId }).lean();
    const deptName = department?.dept_name || "General";
    const deptCode = department?.dept_code || generateDeptCode(deptName);

    // 1. Calculate working days server-side
    const calculation = await calculateLeaveDays(
      from_date,
      to_date,
      duration_type,
      employee.school_id || 0
    );

    const no_of_days = calculation.no_of_days;
    if (no_of_days <= 0) {
      return res.status(400).json({
        success: false,
        message: "The selected date range contains 0 working leave days (all days are weekends or holidays).",
        breakdown: calculation.breakdown,
      });
    }

    // 2. Determine applicant's official capacity & role context
    const hasAssignedRoles = employee.role_ids && employee.role_ids.length > 0;
    let effectiveRoleId = null;
    let applicantRole = null;

    const reqRoleId = Number(
      req.body?.active_role_id ||
      req.headers?.["x-active-role-id"] ||
      employee.active_role_id
    );
    if (hasAssignedRoles) {
      effectiveRoleId = (reqRoleId && employee.role_ids.includes(reqRoleId))
        ? reqRoleId
        : Number(employee.role_ids[0]);
      applicantRole = await Role.findOne({ role_id: effectiveRoleId }).lean();
    }

    // 3. Validate leave balance (role-specific balance if configured, otherwise base balance)
    const currentYear = new Date(from_date).getFullYear();
    const balance = await getOrInitLeaveBalance(empId, leave_type_id, currentYear, effectiveRoleId);
    const availableDays = Math.max(
      0,
      (balance.allocated_days || 0) + (balance.carried_forward_days || 0) - (balance.used_days || 0)
    );

    if (no_of_days > availableDays) {
      return res.status(400).json({
        success: false,
        message: `Insufficient leave balance. Requested ${no_of_days} days, but only ${availableDays} days remaining for ${leaveType.name}.`,
        availableDays,
        requestedDays: no_of_days,
      });
    }

    // 4. Resolve Approver via Chain Mode (Department-based chain of command)
    let nextApprover = null;
    let forward_to_role_id = null;
    let forward_to_dept_id = deptId;
    let level = 1;

    // Get applicant power level
    let applicantPowerLevel = 0;
    if (effectiveRoleId && applicantRole?.power_id) {
      const myPower = await Power.findOne({ power_id: applicantRole.power_id }).lean();
      applicantPowerLevel = myPower?.power_level || 0;
    }

    // Resolve dynamic approval chain for applicant in their effective capacity
    const dynamicChain = await resolveApprovalChainForApplicant({
      ...employee,
      active_role_id: effectiveRoleId,
    });
    let approval_chain = [];
    if (dynamicChain && dynamicChain.length > 0) {
      approval_chain = dynamicChain.map((step, idx) => ({
        step: step.step || idx + 1,
        label: step.label || (idx === dynamicChain.length - 1 ? "Final Approval Authority" : `Authority Level ${idx + 1}`),
        role_id: step.role_id,
        role_name: step.role_name,
        emp_id: step.emp_id || null,
        emp_name: step.emp_name || null,
        status: idx === 0 ? "PENDING" : "UPCOMING",
      }));
      const firstAuth = dynamicChain[0];
      forward_to_role_id = firstAuth.role_id || null;
      level = firstAuth.role_level || 1;
      if (firstAuth.emp_id) {
        nextApprover = { emp_id: firstAuth.emp_id, emp_name: firstAuth.emp_name };
      }
    }

    // Fallback if no chain authority resolved
    if (!nextApprover) {
      nextApprover = await Employee.findOne({
        dept_id: deptId,
        role_ids: { $exists: true, $ne: [] },
        emp_id: { $ne: empId },
        is_active: true,
      }).lean();
    }

    const currentHolderEmpId = nextApprover ? nextApprover.emp_id : empId;

    // 4. Resolve Handover / Class Substitute if provided
    let handoverData = null;
    let assignedColleague = null;
    if (handover && handover.assigned_to_emp_id) {
      assignedColleague = await Employee.findOne({
        emp_id: Number(handover.assigned_to_emp_id),
        is_active: true,
      }).lean();
      if (assignedColleague) {
        // Validate if colleague is on approved leave during this period
        const overlapLeave = await LeaveRequest.findOne({
          emp_id: assignedColleague.emp_id,
          status: "APPROVED",
          is_deleted: { $ne: true },
          from_date: { $lte: new Date(to_date) },
          to_date: { $gte: new Date(from_date) },
        }).lean();

        if (overlapLeave) {
          const isStillOnLeave = !(overlapLeave.is_early_resumed && overlapLeave.resumed_duty_date && new Date(overlapLeave.resumed_duty_date) <= new Date(from_date));
          if (isStillOnLeave) {
            return res.status(400).json({
              success: false,
              message: `Cannot assign classes to ${assignedColleague.emp_name} because they are already on approved leave from ${new Date(overlapLeave.from_date).toLocaleDateString("en-IN")} to ${new Date(overlapLeave.to_date).toLocaleDateString("en-IN")}.`,
            });
          }
        }

        handoverData = {
          assigned_to_emp_id: assignedColleague.emp_id,
          assigned_to_emp_name: assignedColleague.emp_name,
          assigned_to_email: assignedColleague.email || null,
          classes_count: Number(handover.classes_count) || 0,
          notes: handover.notes ? String(handover.notes).trim() : "",
        };
      }
    }

    // 4.1 Resolve Alternate Leave Approver / Temporary Role In-Charge Handover
    let delegationData = null;
    let delegatedColleague = null;
    if (hasAssignedRoles && delegation && delegation.delegate_emp_id) {
      delegatedColleague = await Employee.findOne({
        emp_id: Number(delegation.delegate_emp_id),
        is_active: true,
      }).lean();
      if (delegatedColleague) {
        // Validate if colleague is on approved leave during this period
        const overlapLeave = await LeaveRequest.findOne({
          emp_id: delegatedColleague.emp_id,
          status: "APPROVED",
          is_deleted: { $ne: true },
          from_date: { $lte: new Date(to_date) },
          to_date: { $gte: new Date(from_date) },
        }).lean();

        if (overlapLeave) {
          const isStillOnLeave = !(overlapLeave.is_early_resumed && overlapLeave.resumed_duty_date && new Date(overlapLeave.resumed_duty_date) <= new Date(from_date));
          if (isStillOnLeave) {
            return res.status(400).json({
              success: false,
              message: `Cannot nominate ${delegatedColleague.emp_name} as Temporary In-Charge because they are already on approved leave from ${new Date(overlapLeave.from_date).toLocaleDateString("en-IN")} to ${new Date(overlapLeave.to_date).toLocaleDateString("en-IN")}.`,
            });
          }
        }

        const delRoleId = delegation.role_id ? Number(delegation.role_id) : effectiveRoleId;
        const delRole = await Role.findOne({ role_id: delRoleId }).lean();
        delegationData = {
          delegate_emp_id: delegatedColleague.emp_id,
          delegate_emp_name: delegatedColleague.emp_name,
          delegate_email: delegatedColleague.email || null,
          role_id: delRoleId,
          role_name: delRole?.role_name || applicantRole?.role_name || "Leave Authority",
          instructions: delegation.instructions ? String(delegation.instructions).trim() : "",
          status: "PENDING",
        };
      }
    }

    // 5. Generate unique leave_id via Counter
    const counter = await Counter.findOneAndUpdate(
      { name: `leave_id_${deptCode}` },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );
    const leave_id = `LV_${deptCode}_${String(counter.seq).padStart(3, "0")}`;

    // 6. Create LeaveRequest document
    const leaveRequest = await LeaveRequest.create({
      leave_id,
      emp_id: empId,
      dept_id: deptId,
      leave_type_id: Number(leave_type_id),
      from_date: new Date(from_date),
      to_date: new Date(to_date),
      duration_type,
      no_of_days,
      reason: reason.trim(),
      status: "PENDING",
      lifecycle_status: "OPEN",
      current_holder_emp_id: currentHolderEmpId,
      forward_to_emp_id: nextApprover?.emp_id || null,
      forward_to_role_id,
      forward_to_dept_id,
      attachments: Array.isArray(attachments) ? attachments : [],
      mode: 0, // Chain Mode Only
      level,
      current_step_index: 0,
      approval_chain,
      handover: handoverData,
      delegation: delegationData,
      created_by_emp_id: empId,
      created_by_name: applicantRole ? `${employee.emp_name} (${applicantRole.role_name})` : employee.emp_name,
      created_by_role_id: effectiveRoleId,
      received_at: new Date(),
    });

    // 7. Write Initial LeaveFlow Row (action: "CREATED")
    await LeaveFlow.create({
      leave_id,
      from_emp_id: empId,
      from_emp_name: employee.emp_name,
      from_role_id: effectiveRoleId,
      from_role_name: applicantRole?.role_name || "Employee",
      to_emp_id: nextApprover?.emp_id || null,
      to_emp_name: nextApprover?.emp_name || "Approver",
      to_role_id: forward_to_role_id,
      to_role_name: "Leave Authority",
      to_dept_id: deptId,
      action: "CREATED",
      remark: [reason.trim()],
      level: 0,
      final_status: "PENDING",
    });

    // 8. Dispatch Notification to Approver
    if (nextApprover) {
      sendNotification(req.app?.get("io"), {
        emp_id: nextApprover.emp_id,
        role_id: forward_to_role_id,
        type: "RECEIVED",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "New Leave Application Received",
        message: `${employee.emp_name} has applied for ${no_of_days} days ${leaveType.name} (${from_date} to ${to_date}).`,
      }).catch((err) => console.error("Notification error:", err));
    }

    // 9. Dispatch Notification & Email to Substitute Colleague for Class Handover
    if (assignedColleague) {
      const applicantDept = employee?.dept_id ? await Department.findOne({ dept_id: employee.dept_id }).lean() : null;
      const classCountNum = Number(handoverData.classes_count) || 0;
      const classCountStr = classCountNum > 0 ? `${classCountNum} classes/lectures` : "classes/duties";
      const fromDateFormatted = new Date(from_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const toDateFormatted = new Date(to_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const portalUrl = env.FRONTEND_URL || "http://localhost:5173";
      const handoverPortalLink = `${portalUrl}/leave/history?tab=handover&leave_id=${leave_id}`;

      const handoverMsg = `${employee.emp_name} has assigned ${classCountStr} to you during leave (${fromDateFormatted} to ${toDateFormatted}). Notes: ${handoverData.notes || "Class arrangement"}.`;

      sendNotification(req.app?.get("io"), {
        emp_id: assignedColleague.emp_id,
        type: "INFO",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Class / Work Duty Handover Assigned",
        message: handoverMsg,
      }).catch((err) => console.error("Handover notification error:", err));

      if (assignedColleague.email) {
        sendMail({
          to: assignedColleague.email.trim(),
          name: assignedColleague.emp_name,
          subject: `📚 Class Duty Handover Assigned: ${employee.emp_name} (${fromDateFormatted} to ${toDateFormatted})`,
          html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
              <div style="background: linear-gradient(135deg, #1e3a8a, #2563eb); padding: 22px 28px; color: #ffffff;">
                <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #93c5fd; font-weight: 600;">NoteQ / IQPaths HRMS & Academic Portal</div>
                <h1 style="margin: 6px 0 0; font-size: 19px; font-weight: 700; color: #ffffff;">Class / Lecture Duty Handover Assigned</h1>
              </div>

              <div style="padding: 24px 28px; color: #1e293b; line-height: 1.6;">
                <p style="font-size: 15px; margin-top: 0;">Dear <strong>${assignedColleague.emp_name}</strong>,</p>
                <p style="font-size: 14px; color: #475569;">
                  Your colleague <strong>${employee.emp_name}</strong> (${employee.designation || "Faculty"}, ${applicantDept?.dept_name || "Department"}) has applied for leave and designated you to cover their academic classes and duties during their absence.
                </p>

                <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 18px; margin: 18px 0;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600; width: 42%;">Faculty Member:</td>
                      <td style="padding: 7px 0; color: #0f172a; font-weight: 700;">${employee.emp_name} (${employee.designation || "Faculty"})</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Department:</td>
                      <td style="padding: 7px 0; color: #0f172a;">${applicantDept?.dept_name || "Academic Department"}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Leave Period:</td>
                      <td style="padding: 7px 0; color: #0f172a; font-weight: 600;">${fromDateFormatted} to ${toDateFormatted} (${no_of_days} Day${no_of_days > 1 ? "s" : ""})</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Leave Type:</td>
                      <td style="padding: 7px 0; color: #0f172a;">${leaveType?.name || "Leave"}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Assigned Classes / Lectures:</td>
                      <td style="padding: 7px 0; color: #2563eb; font-weight: 700; font-size: 15px;">${classCountNum > 0 ? `${classCountNum} Classes / Lectures` : "Classes as arranged"}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Arrangement Notes:</td>
                      <td style="padding: 7px 0; color: #0f172a;">${handoverData.notes || "Please cover regular scheduled teaching periods."}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Reason for Leave:</td>
                      <td style="padding: 7px 0; color: #475569; font-style: italic;">${reason || "Personal work"}</td>
                    </tr>
                    <tr>
                      <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Application Ref ID:</td>
                      <td style="padding: 7px 0; color: #0f172a; font-family: monospace; font-weight: 700;">${leave_id}</td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin: 24px 0 14px;">
                  <a href="${handoverPortalLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 26px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block; box-shadow: 0 2px 6px rgba(37,99,235,0.3);">
                    View Assigned Lectures in Portal &rarr;
                  </a>
                </div>
                <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
                  Portal Link: <a href="${handoverPortalLink}" style="color: #2563eb;">${handoverPortalLink}</a>
                </p>
              </div>

              <div style="background: #f1f5f9; border-top: 1px solid #e2e8f0; padding: 14px 28px; font-size: 12px; color: #64748b; text-align: center;">
                This is an automated academic handover notification generated by NoteQ / IQPaths HRMS. Please do not reply directly to this email.
              </div>
            </div>
          `,
        }).catch((err) => console.error("Handover email error:", err));
      }
    }

    // 8.1 Dispatch Alternate Leave Approver / Temporary Role In-Charge notification if designated
    if (delegatedColleague) {
      sendNotification(req.app?.get("io"), {
        emp_id: delegatedColleague.emp_id,
        type: "INFO",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Nominated as Temporary In-Charge",
        message: `${employee.emp_name} (${delegationData.role_name}) has nominated you as Temporary In-Charge for ${from_date} to ${to_date}. (Scheduled upon higher authority approval).`,
      }).catch((err) => console.error("Delegation notification error:", err));

      if (delegatedColleague.email) {
        sendMail({
          to: delegatedColleague.email,
          name: delegatedColleague.emp_name,
          subject: `Temporary Role In-Charge Nomination by ${employee.emp_name}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
              <h2 style="color: #2563eb; margin-top: 0;">Temporary Role In-Charge Nomination</h2>
              <p>Dear <strong>${delegatedColleague.emp_name}</strong>,</p>
              <p>Your colleague <strong>${employee.emp_name}</strong> has applied for leave and nominated you as the <strong>Temporary In-Charge</strong> for the role of <strong>${delegationData.role_name}</strong> during their absence.</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 16px 0;">
                <p style="margin: 4px 0;"><strong>Authority Name:</strong> ${employee.emp_name}</p>
                <p style="margin: 4px 0;"><strong>Role Capacity:</strong> ${delegationData.role_name}</p>
                <p style="margin: 4px 0;"><strong>Leave Period:</strong> ${from_date} to ${to_date}</p>
                <p style="margin: 4px 0;"><strong>Delegation Instructions:</strong> ${delegationData.instructions || "Authorized to review and sanction departmental matters and leaves"}</p>
                <p style="margin: 4px 0;"><strong>Status:</strong> Pending Final Authority Approval (will activate automatically across leave duration)</p>
              </div>
              <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This is an automated notification from the IQPaths HRMS & Leave Portal.</p>
            </div>
          `,
        }).catch((err) => console.error("Delegation email error:", err));
      }
    }

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "leave", action: "APPLIED" });
    }

    return res.status(201).json({
      success: true,
      message: "Leave application submitted successfully.",
      data: leaveRequest,
      breakdown: calculation.breakdown,
    });
  } catch (error) {
    console.error("applyLeave error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit leave application.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET MY LEAVES (Employee Leave History)
//    GET /api/leave/my
// ─────────────────────────────────────────────────────────────────────────────
export const getMyLeaves = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    if (!empId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    const { status, year, month, start_date, end_date, leave_type_id, page = 1, limit = 50, all_roles } = req.query;
    const activeRoleId = Number(
      req.headers["x-active-role-id"] ||
      req.query.active_role_id ||
      req.user?.active_role_id
    ) || null;

    const filter = { emp_id: empId, is_deleted: false };

    if (all_roles !== "true") {
      const employee = await Employee.findOne({ emp_id: empId }).lean();
      const hasRoles = employee?.role_ids && employee.role_ids.length > 0;

      if (hasRoles && activeRoleId) {
        if (employee.role_ids.length > 1) {
          // Employee with multiple roles (e.g. Rinki having Ass Dean and Dean)
          const isPrimaryRole = Number(employee.role_ids[0]) === activeRoleId;
          if (isPrimaryRole) {
            filter.$or = [
              { created_by_role_id: activeRoleId },
              { created_by_role_id: null },
              { created_by_role_id: { $exists: false } },
            ];
          } else {
            filter.created_by_role_id = activeRoleId;
          }
        } else {
          // Single-role employee
          filter.$or = [
            { created_by_role_id: activeRoleId },
            { created_by_role_id: null },
            { created_by_role_id: { $exists: false } },
          ];
        }
      } else if (!hasRoles) {
        // Employee with NO roles: show records created under personal profile
        filter.$or = [
          { created_by_role_id: null },
          { created_by_role_id: { $exists: false } },
        ];
      }
    }

    if (status && status !== "ALL") {
      filter.status = String(status).toUpperCase();
    }
    if (leave_type_id) {
      filter.leave_type_id = Number(leave_type_id);
    }

    // Flexible Date Filtering: Weekly / Custom (start_date & end_date), Monthly (month & year), or Yearly (year)
    if (start_date && end_date) {
      const s = new Date(start_date);
      s.setHours(0, 0, 0, 0);
      const e = new Date(end_date);
      e.setHours(23, 59, 59, 999);
      filter.from_date = { $lte: e };
      filter.to_date = { $gte: s };
    } else if (month && year) {
      const m = Number(month) - 1;
      const y = Number(year);
      const startOfMonth = new Date(y, m, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.from_date = { $lte: endOfMonth };
      filter.to_date = { $gte: startOfMonth };
    } else if (year) {
      const y = Number(year);
      const startOfYear = new Date(y, 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(y, 11, 31, 23, 59, 59, 999);
      filter.from_date = { $lte: endOfYear };
      filter.to_date = { $gte: startOfYear };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [leaves, totalCount, leaveTypes] = await Promise.all([
      LeaveRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      LeaveRequest.countDocuments(filter),
      LeaveType.find().lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));

    const holderEmpIds = [...new Set(leaves.map((l) => l.current_holder_emp_id).filter(Boolean))];
    const roleIds = [...new Set(leaves.map((l) => l.forward_to_role_id).filter(Boolean))];
    const createdRoleIds = [...new Set(leaves.map((l) => l.created_by_role_id).filter(Boolean))];

    const [holderEmps, holderRoles, createdRoles] = await Promise.all([
      Employee.find({ emp_id: { $in: holderEmpIds } }, "emp_id emp_name designation").lean(),
      Role.find({ role_id: { $in: roleIds } }, "role_id role_name").lean(),
      Role.find({ role_id: { $in: createdRoleIds } }, "role_id role_name").lean(),
    ]);

    const holderEmpMap = Object.fromEntries(holderEmps.map((e) => [e.emp_id, e]));
    const roleMap = Object.fromEntries(holderRoles.map((r) => [r.role_id, r]));
    const createdRoleMap = Object.fromEntries(createdRoles.map((r) => [r.role_id, r.role_name]));

    const enriched = leaves.map((l) => {
      const holder = holderEmpMap[l.current_holder_emp_id];
      const role = roleMap[l.forward_to_role_id];
      const pendingWith = l.status === "PENDING"
        ? (role ? `${role.role_name}${holder ? ` (${holder.emp_name})` : ""}` : (holder ? holder.emp_name : "Department Authority"))
        : null;

      const isHrEntry = Boolean(l.is_hr_entry || (l.created_by_emp_id && l.created_by_emp_id !== l.emp_id));

      const recipientRole = role?.role_name || l.approval_chain?.[0]?.role_name || null;
      const recipientName = holder?.emp_name || l.approval_chain?.[0]?.emp_name || null;

      return {
        ...l,
        is_hr_entry: isHrEntry,
        created_by_name: l.created_by_name || (isHrEntry ? "HR Administration" : null),
        created_by_role_name: createdRoleMap[l.created_by_role_id] || null,
        leave_type_name: typeMap[l.leave_type_id]?.name || `Type ${l.leave_type_id}`,
        leave_type_code: typeMap[l.leave_type_id]?.code || "LV",
        pending_with: pendingWith,
        current_holder_name: holder?.emp_name || null,
        current_holder_role: role?.role_name || null,
        recipient_name: recipientName,
        recipient_role: recipientRole,
        forward_to_role_name: recipientRole,
        forward_to_emp_name: recipientName,
        current_holder: (holder || recipientName) ? {
          emp_id: holder?.emp_id || null,
          emp_name: recipientName,
          designation: holder?.designation || null,
          role_name: recipientRole || "Approving Authority",
        } : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error) {
    console.error("getMyLeaves error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave history." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 GET ASSIGNED LECTURES & DUTIES (Handed over to me)
//     GET /api/leave/assigned-handovers
// ─────────────────────────────────────────────────────────────────────────────
export const getAssignedHandovers = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    if (!empId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    const { status, year } = req.query;
    const filter = {
      "handover.assigned_to_emp_id": empId,
      is_deleted: { $ne: true },
    };

    if (status && status !== "ALL") {
      filter.status = String(status).toUpperCase();
    }
    if (year) {
      const y = Number(year);
      const startOfYear = new Date(y, 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(y, 11, 31, 23, 59, 59, 999);
      filter.from_date = { $lte: endOfYear };
      filter.to_date = { $gte: startOfYear };
    }

    const leaves = await LeaveRequest.find(filter).sort({ createdAt: -1 }).lean();

    const [leaveTypes, applicantEmps, departments] = await Promise.all([
      LeaveType.find().lean(),
      Employee.find({ emp_id: { $in: leaves.map((l) => l.emp_id) } })
        .select("emp_id emp_name designation email mobile_number dept_id school_id")
        .lean(),
      Department.find().select("dept_id dept_name dept_code").lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const empMap = Object.fromEntries(applicantEmps.map((e) => [e.emp_id, e]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d]));

    const enriched = leaves.map((l) => {
      const applicant = empMap[l.emp_id];
      const dept = deptMap[l.dept_id] || (applicant?.dept_id ? deptMap[applicant.dept_id] : null);
      const lt = typeMap[l.leave_type_id];

      return {
        ...l,
        applicant_name: applicant?.emp_name || l.created_by_name || "Colleague",
        applicant_designation: applicant?.designation || "Faculty",
        applicant_email: applicant?.email || null,
        applicant_mobile: applicant?.mobile_number || null,
        department_name: dept?.dept_name || "Department",
        department_code: dept?.dept_code || "DEPT",
        leave_type_name: lt?.name || "Leave",
        leave_type_code: lt?.code || "LV",
        classes_count: l.handover?.classes_count || 0,
        handover_notes: l.handover?.notes || "",
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length,
    });
  } catch (error) {
    console.error("getAssignedHandovers error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assigned handovers." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET MY LEAVE BALANCES
//    GET /api/leave/my/balance
// ─────────────────────────────────────────────────────────────────────────────
export const getMyBalance = async (req, res) => {
  try {
    // If emp_id is passed in query (e.g. HR inspecting balances), use it; otherwise default to logged in user
    const targetEmpId = Number(req.query.emp_id || req.user?.emp_id);
    if (!targetEmpId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    const { year, role_id } = req.query;
    const yearNum = year ? Number(year) : new Date().getFullYear();
    const targetRoleId =
      role_id !== undefined && role_id !== null && role_id !== "" && role_id !== "null"
        ? Number(role_id)
        : req.headers["x-active-role-id"]
        ? Number(req.headers["x-active-role-id"])
        : null;

    // Fetch target employee and assigned roles
    const employee = await Employee.findOne({ emp_id: targetEmpId })
      .select("emp_id emp_name designation role_ids active_role_id dept_id")
      .lean();

    let employeeRoles = [];
    if (employee?.role_ids && employee.role_ids.length > 0) {
      employeeRoles = await Role.find({ role_id: { $in: employee.role_ids } })
        .select("role_id role_name")
        .lean();
    }

    // Active balance for the requested role or base
    const balances = await getAllEmployeeBalances(targetEmpId, yearNum, targetRoleId);

    // Build role_balances map: "base" -> employee wide; "<roleId>" -> role specific
    const roleBalances = {};
    roleBalances["base"] = await getAllEmployeeBalances(targetEmpId, yearNum, null);
    for (const r of employeeRoles) {
      roleBalances[String(r.role_id)] = await getAllEmployeeBalances(targetEmpId, yearNum, r.role_id);
    }

    return res.status(200).json({
      success: true,
      data: balances,
      employee: employee
        ? {
            emp_id: employee.emp_id,
            emp_name: employee.emp_name,
            designation: employee.designation,
            roles: employeeRoles,
            active_role_id: employee.active_role_id,
          }
        : null,
      active_role_id: targetRoleId,
      role_balances: roleBalances,
    });
  } catch (error) {
    console.error("getMyBalance error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave balances." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4b. GET TEAM & DEPARTMENT LEAVE CALENDAR (Out-Of-Office / OOO View)
//     GET /api/leave/team-calendar
// ─────────────────────────────────────────────────────────────────────────────
export const getTeamLeaveCalendar = async (req, res) => {
  try {
    const userEmpId = Number(req.user?.emp_id);
    if (!userEmpId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const {
      dept_id,
      year = new Date().getFullYear(),
      month, // 1 - 12 (optional)
      start_date,
      end_date,
      status = "APPROVED", // "APPROVED" or "ALL"
      scope = "dept", // "dept" or "my"
    } = req.query;

    // Fetch user details to determine default department and role
    const currentUser = await Employee.findOne({ emp_id: userEmpId }).lean();
    const userDeptId = currentUser?.dept_id ? Number(currentUser.dept_id) : 1;

    // Resolve user's active role & privileges
    const activeRoleId = Number(
      req.headers?.["x-active-role-id"] ||
      req.query.active_role_id ||
      currentUser?.active_role_id
    );
    const activeRole = activeRoleId ? await Role.findOne({ role_id: activeRoleId }).lean() : null;

    // Check active delegations or temporary officiating roles
    const now = new Date();
    const [activeDelegations, activeTempRoles] = await Promise.all([
      LeaveRequest.find({
        status: "APPROVED",
        from_date: { $lte: now },
        to_date: { $gte: now },
        "delegation.delegate_emp_id": userEmpId,
      }).lean(),
      LeaveTemporaryRole.find({
        interim_emp_id: userEmpId,
        status: "ACTIVE",
        start_date: { $lte: now },
        end_date: { $gte: now },
      }).lean(),
    ]);
    const hasActiveDelegation = activeDelegations.length > 0 || activeTempRoles.length > 0;

    const isAdmin = Boolean(req.user?.isAdmin || req.user?.is_super_admin);
    const isHR = Boolean(
      isAdmin ||
      activeRole?.role_name?.toLowerCase().includes("hr") ||
      activeRole?.power_type === "HR" ||
      activeRole?.power_name?.toLowerCase() === "hr"
    );
    const isApprover = Boolean(
      isAdmin ||
      isHR ||
      activeRole?.canReceiveLeaveRequest ||
      hasActiveDelegation
    );

    // Strict access level:
    // "all": HR / Super Admin (can view any department)
    // "dept": HOD / Leave Approver (can view their department team)
    // "my": Regular Faculty / Staff (strictly personal leaves only)
    const accessLevel = isHR ? "all" : isApprover ? "dept" : "my";

    // Determine target date range
    let rangeStart = null;
    let rangeEnd = null;

    if (start_date && end_date) {
      rangeStart = new Date(start_date);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(end_date);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (year && month) {
      const y = Number(year);
      const m = Number(month) - 1; // 0-indexed
      rangeStart = new Date(y, m, 1, 0, 0, 0, 0);
      rangeEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
    } else {
      const y = Number(year) || new Date().getFullYear();
      rangeStart = new Date(y, 0, 1, 0, 0, 0, 0);
      rangeEnd = new Date(y, 11, 31, 23, 59, 59, 999);
    }

    // Build query filter
    const filter = {
      is_deleted: false,
      from_date: { $lte: rangeEnd },
      to_date: { $gte: rangeStart },
    };

    if (status && status !== "ALL") {
      filter.status = status.toUpperCase();
    } else {
      filter.status = { $in: ["APPROVED", "PENDING"] };
    }

    // Enforce role-based scoping
    if (accessLevel === "my") {
      // Regular user: strictly own leaves only
      filter.emp_id = userEmpId;
    } else if (accessLevel === "dept") {
      // Department Approver / HOD:
      if (scope === "my") {
        filter.emp_id = userEmpId;
      } else {
        filter.dept_id = userDeptId;
      }
    } else {
      // HR / Admin:
      if (scope === "my") {
        filter.emp_id = userEmpId;
      } else if (dept_id && dept_id !== "all") {
        filter.dept_id = Number(dept_id);
      }
    }

    // Parallel fetch: leaves, leave types, departments, holidays
    const [leaves, leaveTypes, departments, holidays] = await Promise.all([
      LeaveRequest.find(filter).sort({ from_date: 1 }).lean(),
      LeaveType.find().lean(),
      Department.find().select("dept_id dept_name dept_code").sort({ dept_id: 1 }).lean(),
      Holiday.find({
        $or: [
          { holiday_date: { $gte: rangeStart, $lte: rangeEnd } },
          { from_date: { $lte: rangeEnd }, to_date: { $gte: rangeStart } },
        ],
      }).lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d]));

    // Fetch employee details for all applicants and substitute colleagues
    const empIds = [
      ...new Set(
        leaves
          .map((l) => l.emp_id)
          .concat(leaves.map((l) => l.handover?.assigned_to_emp_id))
          .filter(Boolean)
      ),
    ];
    const roleIds = [...new Set(leaves.map((l) => l.created_by_role_id).filter(Boolean))];

    const [employees, roles] = await Promise.all([
      Employee.find({ emp_id: { $in: empIds } })
        .select("emp_id emp_name designation email phone dept_id school_id")
        .lean(),
      Role.find({ role_id: { $in: roleIds } })
        .select("role_id role_name")
        .lean(),
    ]);

    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));
    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r]));

    // Enrich leaves
    const enrichedLeaves = leaves.map((l) => {
      const applicant = empMap[l.emp_id];
      const dept = deptMap[l.dept_id];
      const role = roleMap[l.created_by_role_id];
      const lt = typeMap[l.leave_type_id];
      const handoverEmp = l.handover?.assigned_to_emp_id ? empMap[l.handover.assigned_to_emp_id] : null;

      return {
        ...l,
        applicant_name: applicant?.emp_name || `Emp #${l.emp_id}`,
        applicant_designation: role ? role.role_name.replace(/_/g, " ") : (applicant?.designation || "Faculty"),
        applicant_email: applicant?.email || null,
        applicant_phone: applicant?.phone || null,
        department_name: dept?.dept_name || "General",
        department_code: dept?.dept_code || "GEN",
        leave_type_name: lt?.name || "Leave",
        leave_type_code: lt?.code || "LV",
        role_name: role?.role_name ? role.role_name.replace(/_/g, " ") : null,
        handover_colleague_name: handoverEmp?.emp_name || l.handover?.assigned_to_emp_name || null,
        handover_colleague_designation: handoverEmp?.designation || null,
      };
    });

    // Compute live OOO & Staffing Metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endToday = new Date(today);
    endToday.setHours(23, 59, 59, 999);

    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);

    const onLeaveTodayList = enrichedLeaves.filter((l) => {
      if (l.is_early_resumed && (l.actual_days_used === 0 || new Date() >= new Date(l.resumed_duty_date))) {
        return false;
      }
      const s = new Date(l.from_date);
      const e = new Date(l.to_date);
      s.setHours(0, 0, 0, 0);
      e.setHours(23, 59, 59, 999);
      return today >= s && today <= e && l.status === "APPROVED";
    });

    const upcomingThisWeekCount = enrichedLeaves.filter((l) => {
      if (l.is_early_resumed && l.actual_days_used === 0) return false;
      const s = new Date(l.from_date);
      return s > endToday && s <= weekFromNow && l.status === "APPROVED";
    }).length;

    // Identify staffing conflicts: dates where >= 2 people are on leave in the selected scope
    const dateLeaveCountMap = {};
    enrichedLeaves.forEach((l) => {
      if (l.status !== "APPROVED") return;
      if (l.is_early_resumed && l.actual_days_used === 0) return;
      const cur = new Date(l.from_date);
      cur.setHours(0, 0, 0, 0);
      let end = new Date(l.to_date);
      if (l.is_early_resumed && l.resumed_duty_date) {
        const resumeDate = new Date(l.resumed_duty_date);
        resumeDate.setDate(resumeDate.getDate() - 1);
        if (resumeDate < end) end = resumeDate;
      }
      end.setHours(0, 0, 0, 0);

      while (cur <= end) {
        const dStr = cur.toISOString().slice(0, 10);
        if (!dateLeaveCountMap[dStr]) dateLeaveCountMap[dStr] = [];
        dateLeaveCountMap[dStr].push({
          emp_id: l.emp_id,
          emp_name: l.applicant_name,
          leave_type_code: l.leave_type_code,
          leave_id: l.leave_id,
        });
        cur.setDate(cur.getDate() + 1);
      }
    });

    const conflicts = Object.entries(dateLeaveCountMap)
      .filter(([dStr, list]) => list.length >= 2)
      .map(([date, list]) => ({
        date,
        count: list.length,
        employees: list,
      }));

    const visibleDepartments =
      accessLevel === "all"
        ? departments
        : departments.filter((d) => d.dept_id === userDeptId);

    return res.status(200).json({
      success: true,
      data: {
        access_level: accessLevel, // "my" | "dept" | "all"
        leaves: enrichedLeaves,
        holidays: holidays.map((h) => ({
          name: h.name,
          date: h.holiday_date || h.from_date,
          from_date: h.from_date || h.holiday_date,
          to_date: h.to_date || h.holiday_date || h.from_date,
          type: h.type || "PUBLIC",
        })),
        metrics: {
          on_leave_today_count: onLeaveTodayList.length,
          on_leave_today_list: onLeaveTodayList,
          upcoming_this_week_count: upcomingThisWeekCount,
          active_conflicts_count: accessLevel === "my" ? 0 : conflicts.length,
          conflicts: accessLevel === "my" ? [] : conflicts,
        },
        departments: visibleDepartments,
        user_dept_id: userDeptId,
      },
    });
  } catch (error) {
    console.error("getTeamLeaveCalendar error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch team leave calendar." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET LEAVE DETAIL & TIMELINE
//    GET /api/leave/:leave_id
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveDetail = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const [leaveRequest, flows, leaveTypes] = await Promise.all([
      LeaveRequest.findOne({ leave_id }).lean(),
      LeaveFlow.find({ leave_id }).sort({ createdAt: 1 }).lean(),
      LeaveType.find().lean(),
    ]);

    if (!leaveRequest) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const [applicant, department, holder, holderRole, createdRole] = await Promise.all([
      Employee.findOne({ emp_id: leaveRequest.emp_id }).select("emp_id emp_name designation email phone dept_id school_id").lean(),
      Department.findOne({ dept_id: leaveRequest.dept_id }).select("dept_id dept_name dept_code school_id").lean(),
      leaveRequest.current_holder_emp_id
        ? Employee.findOne({ emp_id: leaveRequest.current_holder_emp_id }).select("emp_id emp_name designation role_ids active_role_id").lean()
        : null,
      leaveRequest.forward_to_role_id
        ? Role.findOne({ role_id: leaveRequest.forward_to_role_id }).select("role_id role_name").lean()
        : null,
      leaveRequest.created_by_role_id
        ? Role.findOne({ role_id: leaveRequest.created_by_role_id }).select("role_id role_name").lean()
        : null,
    ]);

    // Fallback: resolve holder employee if not found directly
    let resolvedHolder = holder;
    if (!resolvedHolder && leaveRequest.forward_to_emp_id) {
      resolvedHolder = await Employee.findOne({ emp_id: leaveRequest.forward_to_emp_id })
        .select("emp_id emp_name designation role_ids active_role_id")
        .lean();
    }
    if (!resolvedHolder && leaveRequest.forward_to_role_id) {
      resolvedHolder = await Employee.findOne({
        $or: [
          { active_role_id: leaveRequest.forward_to_role_id },
          { role_ids: leaveRequest.forward_to_role_id },
        ],
        is_active: true,
      })
        .select("emp_id emp_name designation role_ids active_role_id")
        .lean();
    }

    // Fallback: resolve holder role if not found directly
    let resolvedRole = holderRole;
    if (!resolvedRole && resolvedHolder) {
      const targetRoleId = resolvedHolder.active_role_id || (resolvedHolder.role_ids && resolvedHolder.role_ids[0]);
      if (targetRoleId) {
        resolvedRole = await Role.findOne({ role_id: targetRoleId }).select("role_id role_name").lean();
      }
    }

    const pendingChainStep =
      (leaveRequest.approval_chain || []).find((s) => s.status === "PENDING") ||
      leaveRequest.approval_chain?.[0];
    const lastFlow = flows && flows.length > 0 ? flows[flows.length - 1] : null;

    const recipientEmpName =
      resolvedHolder?.emp_name ||
      pendingChainStep?.emp_name ||
      lastFlow?.to_emp_name ||
      null;
    const recipientRoleName =
      resolvedRole?.role_name ||
      pendingChainStep?.role_name ||
      lastFlow?.to_role_name ||
      "Approving Authority";

    const pendingWith = leaveRequest.status === "PENDING"
      ? (recipientRoleName ? `${recipientRoleName}${recipientEmpName ? ` (${recipientEmpName})` : ""}` : (recipientEmpName || "Department Authority"))
      : null;

    const isHrEntry = Boolean(
      leaveRequest.is_hr_entry ||
      (leaveRequest.created_by_emp_id && leaveRequest.created_by_emp_id !== leaveRequest.emp_id)
    );

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const endTodayDate = new Date();
    endTodayDate.setHours(23, 59, 59, 999);

    const isDelegationActiveNow = Boolean(
      leaveRequest.status === "APPROVED" &&
      leaveRequest.delegation?.delegate_emp_id &&
      new Date(leaveRequest.from_date) <= endTodayDate &&
      new Date(leaveRequest.to_date) >= todayDate
    );

    // Fetch substitute faculty / handover employee details if present
    let handoverEmp = null;
    let handoverDept = null;
    if (leaveRequest.handover?.assigned_to_emp_id) {
      handoverEmp = await Employee.findOne({ emp_id: leaveRequest.handover.assigned_to_emp_id })
        .select("emp_id emp_name designation email phone dept_id")
        .lean();
      if (handoverEmp?.dept_id) {
        handoverDept = await Department.findOne({ dept_id: handoverEmp.dept_id })
          .select("dept_id dept_name dept_code")
          .lean();
      }
    }

    // Resolve sanctioning authority for approved leave
    const approvingFlow = flows && flows.length > 0
      ? flows.slice().reverse().find((f) => f.action === "APPROVED")
      : null;
    const approvingStep = (leaveRequest.approval_chain || [])
      .slice()
      .reverse()
      .find((s) => s.status === "APPROVED");

    const sanctionYear = new Date(leaveRequest.from_date).getFullYear();
    const sanctionRefNo = `ESTB/LV-ORD/${sanctionYear}/${leaveRequest.leave_id}`;

    const sanctionOrder = leaveRequest.status === "APPROVED" ? {
      ref_no: sanctionRefNo,
      sanctioned_at: approvingFlow?.createdAt || leaveRequest.updatedAt,
      sanctioned_by_name: approvingFlow?.from_emp_name || approvingStep?.emp_name || "Competent Authority",
      sanctioned_by_role: approvingFlow?.from_role_name || approvingStep?.role_name || "Approving Authority",
      sanctioned_by_designation: approvingFlow?.from_designation || null,
      remarks: approvingFlow?.remark
        ? (Array.isArray(approvingFlow.remark) ? approvingFlow.remark.join(", ") : approvingFlow.remark)
        : (approvingStep?.remark || "Sanctioned as per institutional rules"),
    } : null;

    return res.status(200).json({
      success: true,
      data: {
        ...leaveRequest,
        is_delegation_active_now: isDelegationActiveNow,
        is_hr_entry: isHrEntry,
        created_by_name: leaveRequest.created_by_name || (isHrEntry ? "HR Administration" : null),
        leave_type_name: typeMap[leaveRequest.leave_type_id]?.name || "Leave",
        leave_type_code: typeMap[leaveRequest.leave_type_id]?.code || "LV",
        applicant: applicant ? {
          ...applicant,
          designation: createdRole ? createdRole.role_name : (applicant.designation || "Faculty"),
        } : null,
        applicant_role_name: createdRole?.role_name || null,
        applicant_designation: createdRole ? createdRole.role_name : (applicant?.designation || "Faculty"),
        department,
        forward_to_role_name: recipientRoleName,
        forward_to_emp_name: recipientEmpName,
        recipient_name: recipientEmpName,
        recipient_role: recipientRoleName,
        current_holder: (resolvedHolder || recipientEmpName) ? {
          emp_id: resolvedHolder?.emp_id || pendingChainStep?.emp_id || null,
          emp_name: recipientEmpName,
          designation: resolvedHolder?.designation || null,
          role_name: recipientRoleName,
        } : null,
        pending_with: pendingWith,
        timeline: flows,
        handover: leaveRequest.handover ? {
          ...leaveRequest.handover,
          assigned_to_emp_name: handoverEmp?.emp_name || leaveRequest.handover.assigned_to_emp_name || null,
          assigned_to_designation: handoverEmp?.designation || null,
          assigned_to_dept_name: handoverDept?.dept_name || null,
          assigned_to_email: handoverEmp?.email || leaveRequest.handover.assigned_to_email || null,
          assigned_to_phone: handoverEmp?.phone || null,
        } : null,
        sanction_order: sanctionOrder,
      },
    });
  } catch (error) {
    console.error("getLeaveDetail error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave details." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5b. GET MY ACTIVE DELEGATIONS
//     GET /api/leave/active-delegations
// ─────────────────────────────────────────────────────────────────────────────
export const getMyActiveDelegations = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    if (!empId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    await syncTemporaryRoleLifecycle(req.app?.get("io"));

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const activeDelegations = await LeaveRequest.find({
      status: "APPROVED",
      is_early_resumed: { $ne: true },
      from_date: { $lte: endOfToday },
      to_date: { $gte: startOfToday },
      "delegation.delegate_emp_id": empId,
      is_deleted: { $ne: true },
    }).lean();

    const activeTempRoles = await LeaveTemporaryRole.find({
      interim_emp_id: empId,
      status: "ACTIVE",
    }).lean();

    const hasActive = activeDelegations.length > 0 || activeTempRoles.length > 0;

    return res.status(200).json({
      success: true,
      has_active_delegation: hasActive,
      active_delegations: activeDelegations.map((d) => ({
        leave_id: d.leave_id,
        delegated_from_emp_id: d.emp_id,
        delegated_from_emp_name: d.created_by_name || d.emp_name,
        role_id: d.delegation?.role_id,
        role_name: d.delegation?.role_name,
        from_date: d.from_date,
        to_date: d.to_date,
        instructions: d.delegation?.instructions,
      })),
      active_temporary_roles: activeTempRoles,
    });
  } catch (error) {
    console.error("getMyActiveDelegations error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch active delegations." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. CANCEL LEAVE (Employee)
//    POST /api/leave/:leave_id/cancel
// ─────────────────────────────────────────────────────────────────────────────
export const cancelLeave = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { reason = "Cancelled by applicant" } = req.body;
    const empId = Number(req.user?.emp_id);

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    if (leave.emp_id !== empId && !req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "You can only cancel your own leave requests." });
    }

    if (leave.status === "CANCELLED" || leave.status === "REJECTED") {
      return res.status(400).json({ success: false, message: `Leave request is already ${leave.status}.` });
    }

    const wasApproved = leave.status === "APPROVED";
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If approved, only allow cancellation if from_date >= today
    if (wasApproved && new Date(leave.from_date) < today) {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a past or already utilized approved leave.",
      });
    }

    // Update status
    leave.status = "CANCELLED";
    leave.lifecycle_status = "CLOSED";
    leave.current_holder_emp_id = null;
    await leave.save();

    // If was approved, refund used_days on LeaveBalance (role-specific if exists, otherwise base balance)
    if (wasApproved) {
      const year = new Date(leave.from_date).getFullYear();
      const targetRoleId = leave.created_by_role_id || null;
      const hasRoleBal = targetRoleId
        ? await LeaveBalance.exists({ emp_id: leave.emp_id, role_id: targetRoleId, leave_type_id: leave.leave_type_id, year })
        : false;

      await LeaveBalance.findOneAndUpdate(
        { emp_id: leave.emp_id, role_id: hasRoleBal ? targetRoleId : null, leave_type_id: leave.leave_type_id, year },
        { $inc: { used_days: -leave.no_of_days } }
      );
    }

    // Write cancellation flow
    await LeaveFlow.create({
      leave_id,
      from_emp_id: empId,
      from_emp_name: req.user?.emp_name || "Applicant",
      from_role_id: req.user?.active_role_id || null,
      from_role_name: "Applicant",
      action: "CANCELLED",
      remark: [reason],
      final_status: "CANCELLED",
    });

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "leave", action: "CANCELLED" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave application cancelled successfully.",
      data: leave,
    });
  } catch (error) {
    console.error("cancelLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to cancel leave application." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET RECEIVED LEAVES (Approver)
//    GET /api/leave/received
// ─────────────────────────────────────────────────────────────────────────────
export const getReceivedLeaves = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    if (!empId) {
      return res.status(401).json({ success: false, message: "User authentication required." });
    }

    const activeRoleId = Number(
      req.headers["x-active-role-id"] ||
      req.query.active_role_id ||
      req.user?.active_role_id
    ) || null;
    const { status = "PENDING" } = req.query;

    let baseConditions = [];

    if (activeRoleId) {
      // Strictly role-based: only leaves routed to this active role
      baseConditions.push({ forward_to_role_id: activeRoleId });
    } else {
      // Personal / no-role mode: only leaves routed directly to this employee without a role
      baseConditions.push({
        current_holder_emp_id: empId,
        $or: [{ forward_to_role_id: null }, { forward_to_role_id: { $exists: false } }],
      });
    }

    // Check if empId is currently designated as an active Alternate Leave Approver
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const activeDelegations = await LeaveRequest.find({
      status: "APPROVED",
      from_date: { $lte: endOfToday },
      to_date: { $gte: today },
      "delegation.delegate_emp_id": empId,
      is_deleted: false,
    }).lean();

    const delegatedRoleIds = [];
    const delegatedHODIds = [];
    activeDelegations.forEach((d) => {
      if (d.delegation?.role_id) {
        delegatedRoleIds.push(d.delegation.role_id);
        baseConditions.push({ forward_to_role_id: d.delegation.role_id });
      }
      const hodEmpId = d.emp_id || d.created_by_emp_id;
      if (hodEmpId) {
        delegatedHODIds.push(hodEmpId);
        baseConditions.push({ current_holder_emp_id: hodEmpId, forward_to_role_id: d.delegation?.role_id || null });
      }
    });

    const filter = {
      $or: baseConditions,
      is_deleted: false,
    };

    if (status && status !== "ALL") {
      filter.status = String(status).toUpperCase();
    }

    const [leaves, leaveTypes, employees, departments, roles] = await Promise.all([
      LeaveRequest.find(filter).sort({ received_at: -1 }).lean(),
      LeaveType.find().lean(),
      Employee.find().select("emp_id emp_name designation email dept_id role_ids active_role_id").lean(),
      Department.find().select("dept_id dept_name").lean(),
      Role.find().select("role_id role_name").lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r.role_name]));

    const enriched = leaves.map((l) => {
      const isHrEntry = Boolean(l.is_hr_entry || (l.created_by_emp_id && l.created_by_emp_id !== l.emp_id));

      const isDelegated = Boolean(
        (
          (l.forward_to_role_id && delegatedRoleIds.includes(l.forward_to_role_id)) ||
          (l.current_holder_emp_id && delegatedHODIds.includes(l.current_holder_emp_id))
        ) && l.current_holder_emp_id !== empId && l.forward_to_role_id !== activeRoleId
      );

      const matchingDelegation = isDelegated
        ? activeDelegations.find(
            (d) =>
              (l.forward_to_role_id && d.delegation?.role_id === l.forward_to_role_id) ||
              (l.current_holder_emp_id &&
                (d.emp_id === l.current_holder_emp_id || d.created_by_emp_id === l.current_holder_emp_id))
          )
        : null;

      const recipientRole = roleMap[l.forward_to_role_id] || l.approval_chain?.[0]?.role_name || null;
      let recipientEmp = empMap[l.current_holder_emp_id] || empMap[l.forward_to_emp_id] || null;
      if (!recipientEmp && l.forward_to_role_id) {
        recipientEmp = employees.find(
          (e) => (e.active_role_id === l.forward_to_role_id || (e.role_ids && e.role_ids.includes(l.forward_to_role_id)))
        );
      }
      const recipientName = recipientEmp?.emp_name || l.approval_chain?.[0]?.emp_name || null;

      return {
        ...l,
        is_delegated: isDelegated,
        delegated_role_name: matchingDelegation?.delegation?.role_name || null,
        delegated_from_name: matchingDelegation?.emp_name || matchingDelegation?.created_by_name || null,
        is_hr_entry: isHrEntry,
        created_by_name: l.created_by_name || (isHrEntry ? "HR Administration" : null),
        leave_type_name: typeMap[l.leave_type_id]?.name || "Leave",
        leave_type_code: typeMap[l.leave_type_id]?.code || "LV",
        applicant_name: empMap[l.emp_id]?.emp_name || `Emp ${l.emp_id}`,
        applicant_designation: empMap[l.emp_id]?.designation || "",
        department_name: deptMap[l.dept_id] || "General",
        forward_to_role_name: recipientRole,
        forward_to_emp_name: recipientName,
        recipient_name: recipientName,
        recipient_role: recipientRole,
        current_holder: (recipientEmp || recipientName) ? {
          emp_id: recipientEmp?.emp_id || null,
          emp_name: recipientName,
          designation: recipientEmp?.designation || null,
          role_name: recipientRole || "Approving Authority",
        } : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length,
    });
  } catch (error) {
    console.error("getReceivedLeaves error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch received leave requests." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. APPROVE LEAVE (Approver)
//    POST /api/leave/:leave_id/approve
// ─────────────────────────────────────────────────────────────────────────────
export const approveLeave = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { remark = "Approved" } = req.body;
    const approverEmpId = Number(req.user?.emp_id);

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    if (leave.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Leave request cannot be approved as current status is ${leave.status}.`,
      });
    }

    const approver = await Employee.findOne({ emp_id: approverEmpId }).lean();
    const activeRoleId = Number(
      req.headers?.["x-active-role-id"] ||
      req.query?.active_role_id ||
      req.user?.active_role_id
    ) || null;
    const approverRole = activeRoleId
      ? await Role.findOne({ role_id: activeRoleId }).lean()
      : null;

    // Check if current approver is acting via an active approved delegation
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let activeDelegation = null;
    let isActingApprover = false;
    let delegatedFrom = null;
    let delegatedRoleName = null;

    const targetRoleId = leave.forward_to_role_id;
    const targetEmpId = leave.current_holder_emp_id || leave.forward_to_emp_id;

    const delegationQuery = {
      status: "APPROVED",
      from_date: { $lte: endOfToday },
      to_date: { $gte: startOfToday },
      "delegation.delegate_emp_id": approverEmpId,
      is_deleted: { $ne: true },
    };

    if (targetRoleId || targetEmpId) {
      const orConditions = [];
      if (targetRoleId) orConditions.push({ "delegation.role_id": targetRoleId });
      if (targetEmpId) orConditions.push({ emp_id: targetEmpId });
      delegationQuery.$or = orConditions;
    }

    activeDelegation = await LeaveRequest.findOne(delegationQuery).lean();

    if (activeDelegation) {
      isActingApprover = true;
      delegatedFrom = activeDelegation.emp_name || activeDelegation.created_by_name;
      delegatedRoleName = activeDelegation.delegation?.role_name || "Authority";
    }

    const actingApproverName = isActingApprover
      ? `${approver?.emp_name || "Approver"} (Acting for ${delegatedFrom})`
      : (approver?.emp_name || "Approver");

    const actingRoleName = isActingApprover
      ? `${delegatedRoleName} (Officiating)`
      : (approverRole?.role_name || "Approver");

    const actingRoleId = isActingApprover
      ? (activeDelegation.delegation?.role_id || activeRoleId)
      : activeRoleId;

    const actingRemarkSuffix = isActingApprover
      ? ` [Acting Leave Approver on behalf of ${delegatedFrom}]`
      : "";
    const finalRemark = (remark.trim() + (actingRemarkSuffix ? ` ${actingRemarkSuffix}` : "")).trim();

    // 1. Obtain full approval chain for this leave request
    let chain = leave.approval_chain && leave.approval_chain.length > 0 ? leave.approval_chain : null;
    if (!chain || chain.length === 0) {
      const applicant = await Employee.findOne({ emp_id: leave.emp_id }).lean();
      const dynamicChain = applicant ? await resolveApprovalChainForApplicant(applicant) : [];
      if (dynamicChain.length > 0) {
        chain = dynamicChain.map((step, idx) => ({
          step: step.step || idx + 1,
          label: step.label || (idx === dynamicChain.length - 1 ? "Final Approval Authority" : `Authority Level ${idx + 1}`),
          role_id: step.role_id,
          role_name: step.role_name,
          emp_id: step.emp_id || null,
          emp_name: step.emp_name || null,
          status: "UPCOMING",
        }));
      }
    }

    // 2. Identify the current step index in the chain
    let currentStepIdx = -1;
    if (chain && chain.length > 0) {
      // Best: match step by forward_to_role_id
      if (leave.forward_to_role_id) {
        currentStepIdx = chain.findIndex((c) => c.role_id === leave.forward_to_role_id);
      }
      // If delegated, match by delegated role
      if (currentStepIdx === -1 && isActingApprover && activeDelegation.delegation?.role_id) {
        currentStepIdx = chain.findIndex((c) => c.role_id === activeDelegation.delegation.role_id);
      }
      // Fallback: match by approver's active role
      if (currentStepIdx === -1 && activeRoleId) {
        currentStepIdx = chain.findIndex((c) => c.role_id === activeRoleId);
      }
      // Fallback: match by approver employee id
      if (currentStepIdx === -1) {
        currentStepIdx = chain.findIndex((c) => c.emp_id === approverEmpId);
      }
      // Fallback: match by delegated from employee id
      if (currentStepIdx === -1 && isActingApprover && activeDelegation.emp_id) {
        currentStepIdx = chain.findIndex((c) => c.emp_id === activeDelegation.emp_id);
      }
      // Fallback: use current_step_index or 0
      if (currentStepIdx === -1) {
        currentStepIdx = leave.current_step_index || 0;
      }
    }

    const hasNextStep = chain && currentStepIdx !== -1 && currentStepIdx < chain.length - 1;
    const nextStep = hasNextStep ? chain[currentStepIdx + 1] : null;

    if (nextStep) {
      // ─────────────────────────────────────────────────────────────
      // INTERMEDIATE APPROVAL: Move to next level in chain
      // ─────────────────────────────────────────────────────────────
      const nextRoleId = nextStep.role_id ? Number(nextStep.role_id) : null;

      // Resolve next authority employee
      let nextApprover = null;
      if (nextStep.emp_id) {
        nextApprover = await Employee.findOne({ emp_id: nextStep.emp_id, is_active: true }).lean();
      }
      if (!nextApprover && nextRoleId) {
        nextApprover = await Employee.findOne({
          role_ids: { $in: [nextRoleId] },
          dept_id: leave.dept_id,
          is_active: true,
        }).lean();
        if (!nextApprover) {
          nextApprover = await Employee.findOne({
            $or: [{ role_ids: { $in: [nextRoleId] } }, { active_role_id: nextRoleId }],
            is_active: true,
          }).lean();
        }
      }

      // Update approval chain step statuses
      if (chain[currentStepIdx]) {
        chain[currentStepIdx].status = "APPROVED";
        chain[currentStepIdx].action_date = new Date();
        chain[currentStepIdx].remark = finalRemark;
        chain[currentStepIdx].emp_id = approverEmpId;
        chain[currentStepIdx].emp_name = actingApproverName;
      }
      chain[currentStepIdx + 1].status = "PENDING";
      if (nextApprover) {
        chain[currentStepIdx + 1].emp_id = nextApprover.emp_id;
        chain[currentStepIdx + 1].emp_name = nextApprover.emp_name;
      }

      // IMPORTANT: Leave remains PENDING for creator until final level approves!
      leave.status = "PENDING";
      leave.lifecycle_status = "OPEN";
      leave.current_step_index = currentStepIdx + 1;
      leave.level = nextStep.step || (currentStepIdx + 2);
      leave.forward_to_role_id = nextRoleId;
      leave.forward_to_emp_id = nextApprover?.emp_id || nextStep.emp_id || null;
      leave.current_holder_emp_id = nextApprover?.emp_id || nextStep.emp_id || null;
      leave.approval_chain = chain;
      await leave.save();

      // Write LeaveFlow audit row
      await LeaveFlow.create({
        leave_id,
        from_emp_id: approverEmpId,
        from_emp_name: actingApproverName,
        from_role_id: actingRoleId,
        from_role_name: actingRoleName,
        to_emp_id: nextApprover?.emp_id || nextStep.emp_id || null,
        to_emp_name: nextApprover?.emp_name || nextStep.emp_name || nextStep.role_name,
        to_role_id: nextRoleId,
        to_role_name: nextStep.role_name,
        to_dept_id: leave.dept_id,
        action: "APPROVED",
        remark: [finalRemark],
        level: currentStepIdx + 1,
        final_status: "PENDING",
      });

      // Notify next approver that a leave application has been forwarded
      if (req.app?.get("io") && nextApprover) {
        sendNotification(req.app.get("io"), {
          emp_id: nextApprover.emp_id,
          role_id: nextRoleId,
          type: "RECEIVED",
          reference_id: leave_id,
          reference_type: "Leave",
          title: "Leave Application Forwarded for Approval",
          message: `${approver?.emp_name || "Approver"} (${approverRole?.role_name || "Authority"}) has approved and forwarded leave application (${leave_id}) for your review.`,
        }).catch((err) => console.error("Notification error:", err));
      }

      // Notify applicant that it was approved by current level and forwarded to next
      if (req.app?.get("io")) {
        sendNotification(req.app.get("io"), {
          emp_id: leave.emp_id,
          type: "APPROVED",
          reference_id: leave_id,
          reference_type: "Leave",
          title: "Leave Application Approved & Forwarded",
          message: `Your leave (${leave_id}) was approved by ${approverRole?.role_name || "Authority"} and forwarded to ${nextStep.role_name} for next level review.`,
        }).catch((err) => console.error("Notification error:", err));
      }

      if (req.app?.get("io")) {
        req.app.get("io").emit("data:updated", { entity: "leave", action: "FORWARDED", leave_id });
      }

      return res.status(200).json({
        success: true,
        message: `Leave application approved and forwarded to ${nextStep.role_name}.`,
        is_final_approval: false,
        forwarded_to: {
          role_name: nextStep.role_name,
          emp_name: nextApprover?.emp_name || nextStep.emp_name || "Next Authority",
        },
        data: leave,
      });
    } else {
      // ─────────────────────────────────────────────────────────────
      // FINAL APPROVAL: The last authority in the chain has approved!
      // ─────────────────────────────────────────────────────────────
      if (chain && currentStepIdx !== -1 && chain[currentStepIdx]) {
        chain[currentStepIdx].status = "APPROVED";
        chain[currentStepIdx].action_date = new Date();
        chain[currentStepIdx].remark = finalRemark;
        chain[currentStepIdx].emp_id = approverEmpId;
        chain[currentStepIdx].emp_name = actingApproverName;
        leave.approval_chain = chain;
      }

      // Mark leave as fully APPROVED and CLOSED!
      leave.status = "APPROVED";
      leave.lifecycle_status = "CLOSED";
      leave.current_holder_emp_id = null;
      leave.forward_to_role_id = null;
      leave.forward_to_emp_id = null;
      await leave.save();

      // Deduct from LeaveBalance.used_days ONLY on final approval (role-specific if exists, else base)
      const year = new Date(leave.from_date).getFullYear();
      const targetRoleId = leave.created_by_role_id || null;
      const hasRoleBal = targetRoleId
        ? await LeaveBalance.exists({ emp_id: leave.emp_id, role_id: targetRoleId, leave_type_id: leave.leave_type_id, year })
        : false;

      await LeaveBalance.findOneAndUpdate(
        { emp_id: leave.emp_id, role_id: hasRoleBal ? targetRoleId : null, leave_type_id: leave.leave_type_id, year },
        { $inc: { used_days: leave.no_of_days } },
        { upsert: true, returnDocument: "after" }
      );

      // Write Final LeaveFlow row
      await LeaveFlow.create({
        leave_id,
        from_emp_id: approverEmpId,
        from_emp_name: actingApproverName,
        from_role_id: actingRoleId,
        from_role_name: actingRoleName,
        action: "APPROVED",
        remark: [finalRemark],
        level: chain ? chain.length : (leave.level || 1),
        final_status: "APPROVED",
      });

      // Send Final Approval Notification to Applicant
      if (req.app?.get("io")) {
        sendNotification(req.app.get("io"), {
          emp_id: leave.emp_id,
          type: "APPROVED",
          reference_id: leave_id,
          reference_type: "Leave",
          title: "Leave Application Fully Approved",
          message: `Congratulations! Your leave application (${leave_id}) for ${leave.no_of_days} days has received final approval.`,
        }).catch((err) => console.error("Notification error:", err));
      }

      // =========================================================================
      // FINAL APPROVAL: TEMPORARY IN-CHARGE ROLE HANDOVER & CLASS SUBSTITUTION
      // =========================================================================
      try {
        const applicantEmp = await Employee.findOne({ emp_id: leave.emp_id }).lean();
        const applicantHasRoles = applicantEmp?.role_ids && applicantEmp.role_ids.length > 0;

        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const leaveFrom = new Date(leave.from_date);
        leaveFrom.setHours(0, 0, 0, 0);
        const leaveTo = new Date(leave.to_date);
        leaveTo.setHours(23, 59, 59, 999);
        const isStartingTodayOrPast = todayMidnight >= leaveFrom && todayMidnight <= leaveTo;

        // 1. Temporary In-Charge Role Handover
        if (leave.delegation && leave.delegation.delegate_emp_id) {
          const interimEmpId = Number(leave.delegation.delegate_emp_id);
          const interimEmp = await Employee.findOne({ emp_id: interimEmpId }).lean();
          const targetRoleId = leave.delegation.role_id || leave.created_by_role_id || applicantEmp?.role_ids?.[0];
          const targetRole = await Role.findOne({ role_id: targetRoleId }).lean();
          const targetRoleName = leave.delegation.role_name || targetRole?.role_name || "Administrative Authority";

          let tempRoleStatus = "SCHEDULED";

          if (isStartingTodayOrPast) {
            // Active immediately as leave starts today (or already ongoing)
            tempRoleStatus = "ACTIVE";
            await Employee.updateOne(
              { emp_id: interimEmpId },
              {
                $addToSet: {
                  role_ids: targetRoleId,
                  temporary_role_ids: targetRoleId,
                },
              }
            );
          } else {
            // Future leave: Scheduled to activate on leave.from_date
            tempRoleStatus = "SCHEDULED";
          }

          // Create or update LeaveTemporaryRole
          await LeaveTemporaryRole.findOneAndUpdate(
            { leave_id: leave.leave_id },
            {
              leave_id: leave.leave_id,
              role_id: targetRoleId,
              role_name: targetRoleName,
              original_emp_id: leave.emp_id,
              original_emp_name: applicantEmp?.emp_name || leave.created_by_name,
              interim_emp_id: interimEmpId,
              interim_emp_name: interimEmp?.emp_name || leave.delegation.delegate_emp_name,
              interim_designation: interimEmp?.designation || "Faculty",
              start_date: leave.from_date,
              end_date: leave.to_date,
              status: tempRoleStatus,
              assigned_by_admin_id: approverEmpId,
              assigned_by_name: `${actingApproverName} (Sanctioning Authority)`,
              assigned_at: new Date(),
              admin_notes: `Sanctioned via Leave Final Approval by ${actingApproverName}. Instructions: ${leave.delegation.instructions || "None"}`,
            },
            { upsert: true, returnDocument: "after" }
          );

          // Mark delegation as APPROVED on the leave document
          leave.delegation.status = "APPROVED";
          leave.delegation.approved_at = new Date();
          leave.delegation.approved_by_name = actingApproverName;
          leave.delegation.approved_by_emp_id = approverEmpId;
          await leave.save();

          // Dispatch in-app notification to Interim Faculty
          if (req.app?.get("io") && interimEmpId) {
            const notifTitle = tempRoleStatus === "ACTIVE"
              ? "Temporary Role Charge Now Active"
              : "Temporary Role Charge Approved & Scheduled";
            const notifMsg = tempRoleStatus === "ACTIVE"
              ? `Your temporary charge as In-Charge ${targetRoleName} has been approved and is ACTIVE as of today until ${new Date(leave.to_date).toLocaleDateString("en-IN")}.`
              : `Your temporary charge as In-Charge ${targetRoleName} has been APPROVED by ${actingApproverName}. It is scheduled to activate on ${new Date(leave.from_date).toLocaleDateString("en-IN")} until ${new Date(leave.to_date).toLocaleDateString("en-IN")}.`;

            sendNotification(req.app.get("io"), {
              emp_id: interimEmpId,
              type: "APPROVED",
              reference_id: leave_id,
              reference_type: "Leave",
              title: notifTitle,
              message: notifMsg,
            }).catch(() => {});
          }

          // Dispatch Email to Interim Faculty
          if (interimEmp?.email) {
            const isNowActive = tempRoleStatus === "ACTIVE";
            sendMail({
              to: interimEmp.email,
              name: interimEmp.emp_name,
              subject: isNowActive
                ? `Temporary Role Charge ACTIVE: In-Charge ${targetRoleName}`
                : `Temporary Role Charge Approved & Scheduled: In-Charge ${targetRoleName}`,
              html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
                  <h2 style="color: #2563eb; margin-top: 0;">
                    ${isNowActive ? "Temporary Role Charge Now Active" : "Temporary Role Charge Approved & Scheduled"}
                  </h2>
                  <p>Dear <strong>${interimEmp.emp_name}</strong>,</p>
                  <p>The leave application of <strong>${applicantEmp?.emp_name}</strong> has received <strong>Final Approval</strong> by <strong>${actingApproverName}</strong>.</p>
                  <p>Accordingly, your temporary charge as <strong>In-Charge ${targetRoleName}</strong> has been sanctioned.</p>
                  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 16px 0;">
                    <p style="margin: 4px 0;"><strong>Authority:</strong> ${applicantEmp?.emp_name}</p>
                    <p style="margin: 4px 0;"><strong>Role Assigned:</strong> ${targetRoleName}</p>
                    <p style="margin: 4px 0;"><strong>Duration:</strong> ${new Date(leave.from_date).toLocaleDateString("en-IN")} to ${new Date(leave.to_date).toLocaleDateString("en-IN")} (${leave.no_of_days} days)</p>
                    <p style="margin: 4px 0;"><strong>Status:</strong> <span style="color: ${isNowActive ? '#16a34a' : '#d97706'}; font-weight: bold;">${isNowActive ? 'ACTIVE NOW' : 'SCHEDULED (Starts ' + new Date(leave.from_date).toLocaleDateString("en-IN") + ')'}</span></p>
                    <p style="margin: 4px 0;"><strong>Sanctioned By:</strong> ${actingApproverName}</p>
                    <p style="margin: 4px 0;"><strong>Handover Notes:</strong> ${leave.delegation.instructions || "Authorized to handle departmental approvals"}</p>
                  </div>
                  <p style="font-size: 13px; color: #475569;">
                    ${isNowActive ? "You now have administrative access to review and sanction departmental leaves and notesheets." : "This charge will activate automatically into your profile on the start date and conclude at the end of the leave period."}
                  </p>
                  <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">IQPaths HRMS & Leave Management System</p>
                </div>
              `,
            }).catch((err) => console.error("Interim role approval email error:", err));
          }
        } else if (applicantHasRoles) {
          // Fallback: applicant is an authority but did not designate someone in apply form
          const targetRoleId = leave.created_by_role_id || applicantEmp.role_ids[0];
          const targetRole = await Role.findOne({ role_id: targetRoleId }).lean();

          const existingTemp = await LeaveTemporaryRole.findOne({ leave_id: leave.leave_id });
          if (!existingTemp) {
            await LeaveTemporaryRole.create({
              leave_id: leave.leave_id,
              role_id: targetRoleId,
              role_name: targetRole?.role_name || "Administrative Authority",
              original_emp_id: leave.emp_id,
              original_emp_name: applicantEmp.emp_name,
              start_date: leave.from_date,
              end_date: leave.to_date,
              status: "PENDING_ADMIN_ASSIGNMENT",
            });
          }

          // Alert active Admins
          const activeAdmins = await Admin.find({ is_active: true }).lean();
          for (const adm of activeAdmins) {
            if (adm.admin_id) {
              sendNotification(req.app?.get("io"), {
                emp_id: adm.admin_id,
                type: "INFO",
                reference_id: leave_id,
                reference_type: "Leave",
                title: "Authority on Leave — Temporary Charge Required",
                message: `${applicantEmp.emp_name} (${targetRole?.role_name || "Authority"}) is on approved leave from ${new Date(leave.from_date).toLocaleDateString("en-IN")} to ${new Date(leave.to_date).toLocaleDateString("en-IN")} (${leave.no_of_days} days). Assign temporary charge to keep workflows running.`,
              }).catch(() => {});
            }
          }
        }

        // 2. Class Handover Confirmation: Dispatch Notification & Email to Class Substitute
        if (leave.handover && leave.handover.assigned_to_emp_id) {
          const classSubId = Number(leave.handover.assigned_to_emp_id);
          const classSubEmp = await Employee.findOne({ emp_id: classSubId }).lean();
          const classCountStr = leave.handover.classes_count ? `${leave.handover.classes_count} classes` : "classes/duties";

          if (req.app?.get("io") && classSubId) {
            sendNotification(req.app.get("io"), {
              emp_id: classSubId,
              type: "INFO",
              reference_id: leave_id,
              reference_type: "Leave",
              title: "Leave Approved — Class Handover Confirmed",
              message: `The leave application of ${applicantEmp?.emp_name || "Colleague"} (${new Date(leave.from_date).toLocaleDateString("en-IN")} to ${new Date(leave.to_date).toLocaleDateString("en-IN")}) has received final approval. Please ensure assigned ${classCountStr} are covered.`,
            }).catch(() => {});
          }

          if (classSubEmp?.email) {
            sendMail({
              to: classSubEmp.email,
              name: classSubEmp.emp_name,
              subject: `Confirmed: Class Handover for ${applicantEmp?.emp_name || "Colleague"}`,
              html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
                  <h2 style="color: #16a34a; margin-top: 0;">Class Handover Confirmed</h2>
                  <p>Dear <strong>${classSubEmp.emp_name}</strong>,</p>
                  <p>The leave application of your colleague <strong>${applicantEmp?.emp_name}</strong> has received <strong>Final Approval</strong>.</p>
                  <p>Your arrangement to cover their lectures/work duties is now confirmed:</p>
                  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 15px; margin: 16px 0;">
                    <p style="margin: 4px 0;"><strong>Faculty Member:</strong> ${applicantEmp?.emp_name}</p>
                    <p style="margin: 4px 0;"><strong>Leave Period:</strong> ${new Date(leave.from_date).toLocaleDateString("en-IN")} to ${new Date(leave.to_date).toLocaleDateString("en-IN")} (${leave.no_of_days} days)</p>
                    <p style="margin: 4px 0;"><strong>Assigned Classes / Lectures:</strong> ${leave.handover.classes_count || "As arranged"}</p>
                    <p style="margin: 4px 0;"><strong>Arrangement Notes:</strong> ${leave.handover.notes || "None"}</p>
                    <p style="margin: 4px 0;"><strong>Application ID:</strong> ${leave.leave_id}</p>
                  </div>
                  <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">IQPaths HRMS & Leave Management System</p>
                </div>
              `,
            }).catch((err) => console.error("Class handover confirmation email error:", err));
          }
        }
      } catch (roleAlertErr) {
        console.error("Temporary role / handover final sanction error:", roleAlertErr);
      }

      if (req.app?.get("io")) {
        req.app.get("io").emit("data:updated", { entity: "leave", action: "FINAL_APPROVED", leave_id });
      }

      return res.status(200).json({
        success: true,
        message: "Leave application granted final approval.",
        is_final_approval: true,
        data: leave,
      });
    }
  } catch (error) {
    console.error("approveLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to approve leave application." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. REJECT LEAVE (Approver)
//    POST /api/leave/:leave_id/reject
// ─────────────────────────────────────────────────────────────────────────────
export const rejectLeave = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { remark } = req.body;
    const approverEmpId = Number(req.user?.emp_id);

    if (!remark || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason/remark is mandatory.",
      });
    }

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    if (leave.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Leave request cannot be rejected as current status is ${leave.status}.`,
      });
    }

    const approver = await Employee.findOne({ emp_id: approverEmpId }).lean();
    const activeRoleId = Number(
      req.headers["x-active-role-id"] ||
      req.query.active_role_id ||
      req.user?.active_role_id
    ) || null;
    const approverRole = activeRoleId
      ? await Role.findOne({ role_id: activeRoleId }).lean()
      : null;

    // Check if current approver is acting via an active approved delegation
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let activeDelegation = null;
    let isActingApprover = false;
    let delegatedFrom = null;
    let delegatedRoleName = null;

    const targetRoleId = leave.forward_to_role_id;
    const targetEmpId = leave.current_holder_emp_id || leave.forward_to_emp_id;

    const delegationQuery = {
      status: "APPROVED",
      from_date: { $lte: endOfToday },
      to_date: { $gte: startOfToday },
      "delegation.delegate_emp_id": approverEmpId,
      is_deleted: { $ne: true },
    };

    if (targetRoleId || targetEmpId) {
      const orConditions = [];
      if (targetRoleId) orConditions.push({ "delegation.role_id": targetRoleId });
      if (targetEmpId) orConditions.push({ emp_id: targetEmpId });
      delegationQuery.$or = orConditions;
    }

    activeDelegation = await LeaveRequest.findOne(delegationQuery).lean();

    if (activeDelegation) {
      isActingApprover = true;
      delegatedFrom = activeDelegation.emp_name || activeDelegation.created_by_name;
      delegatedRoleName = activeDelegation.delegation?.role_name || "Authority";
    }

    const actingApproverName = isActingApprover
      ? `${approver?.emp_name || "Approver"} (Acting for ${delegatedFrom})`
      : (approver?.emp_name || "Approver");

    const actingRoleName = isActingApprover
      ? `${delegatedRoleName} (Officiating)`
      : (approverRole?.role_name || "Approver");

    const actingRoleId = isActingApprover
      ? (activeDelegation.delegation?.role_id || activeRoleId)
      : activeRoleId;

    const actingRemarkSuffix = isActingApprover
      ? ` [Acting Leave Approver on behalf of ${delegatedFrom}]`
      : "";
    const finalRemark = (remark.trim() + (actingRemarkSuffix ? ` ${actingRemarkSuffix}` : "")).trim();

    // Update approval chain step statuses
    if (leave.approval_chain && leave.approval_chain.length > 0) {
      let currentStepIdx = leave.forward_to_role_id
        ? leave.approval_chain.findIndex((c) => c.role_id === leave.forward_to_role_id)
        : -1;
      if (currentStepIdx === -1 && isActingApprover && activeDelegation.delegation?.role_id) {
        currentStepIdx = leave.approval_chain.findIndex((c) => c.role_id === activeDelegation.delegation.role_id);
      }
      if (currentStepIdx === -1 && activeRoleId) {
        currentStepIdx = leave.approval_chain.findIndex((c) => c.role_id === activeRoleId);
      }
      if (currentStepIdx === -1) {
        currentStepIdx = leave.approval_chain.findIndex((c) => c.emp_id === approverEmpId);
      }
      if (currentStepIdx === -1 && isActingApprover && activeDelegation.emp_id) {
        currentStepIdx = leave.approval_chain.findIndex((c) => c.emp_id === activeDelegation.emp_id);
      }
      if (currentStepIdx === -1) {
        currentStepIdx = leave.current_step_index || 0;
      }

      leave.approval_chain.forEach((step, idx) => {
        if (idx === currentStepIdx) {
          step.status = "REJECTED";
          step.action_date = new Date();
          step.remark = finalRemark;
          step.emp_id = approverEmpId;
          step.emp_name = actingApproverName;
        } else if (idx > currentStepIdx) {
          step.status = "CANCELLED";
        }
      });
    }

    leave.status = "REJECTED";
    leave.lifecycle_status = "CLOSED";
    leave.current_holder_emp_id = null;
    leave.forward_to_role_id = null;
    leave.forward_to_emp_id = null;
    await leave.save();

    await LeaveFlow.create({
      leave_id,
      from_emp_id: approverEmpId,
      from_emp_name: actingApproverName,
      from_role_id: actingRoleId,
      from_role_name: actingRoleName,
      action: "REJECTED",
      remark: [finalRemark],
      level: (leave.level || 0) + 1,
      final_status: "REJECTED",
    });

    if (req.app?.get("io")) {
      sendNotification(req.app.get("io"), {
        emp_id: leave.emp_id,
        type: "REJECTED",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Leave Application Rejected",
        message: `Your leave application (${leave_id}) was rejected by ${approverRole?.role_name || "Authority"}. Reason: ${remark.trim()}`,
      }).catch((err) => console.error("Notification error:", err));
    }

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "leave", action: "REJECTED", leave_id });
    }

    return res.status(200).json({
      success: true,
      message: "Leave application rejected.",
      data: leave,
    });
  } catch (error) {
    console.error("rejectLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to reject leave application." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. QUERY LEAVE & QUERY REPLY
// ─────────────────────────────────────────────────────────────────────────────
export const queryLeave = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { remark } = req.body;
    const approverEmpId = Number(req.user?.emp_id);

    if (!remark || !remark.trim()) {
      return res.status(400).json({ success: false, message: "Query message is required." });
    }

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    const approver = await Employee.findOne({ emp_id: approverEmpId }).lean();
    const approverRole = req.user?.active_role_id
      ? await Role.findOne({ role_id: req.user.active_role_id }).lean()
      : null;

    leave.current_holder_emp_id = leave.emp_id; // Hand over to applicant for query response
    await leave.save();

    await LeaveFlow.create({
      leave_id,
      from_emp_id: approverEmpId,
      from_emp_name: approver?.emp_name || "Approver",
      from_role_id: req.user?.active_role_id || null,
      from_role_name: approverRole?.role_name || "Approver",
      to_emp_id: leave.emp_id,
      to_emp_name: "Applicant",
      action: "QUERY",
      remark: [remark.trim()],
      final_status: "QUERY_RAISED",
    });

    if (req.app?.get("io")) {
      sendNotification(req.app.get("io"), {
        emp_id: leave.emp_id,
        type: "QUERY",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Query Raised on Leave Application",
        message: `A query was raised on your leave application (${leave_id}): ${remark.trim()}`,
      }).catch((err) => console.error("Notification error:", err));
    }

    return res.status(200).json({ success: true, message: "Query raised successfully.", data: leave });
  } catch (error) {
    console.error("queryLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to raise query." });
  }
};

export const queryReplyLeave = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { remark } = req.body;
    const empId = Number(req.user?.emp_id);

    if (!remark || !remark.trim()) {
      return res.status(400).json({ success: false, message: "Reply message is required." });
    }

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    // Find the last person who raised query
    const lastQueryFlow = await LeaveFlow.findOne({ leave_id, action: "QUERY" }).sort({ createdAt: -1 });
    const targetApproverEmpId = lastQueryFlow?.from_emp_id || leave.forward_to_emp_id;

    leave.current_holder_emp_id = targetApproverEmpId;
    await leave.save();

    await LeaveFlow.create({
      leave_id,
      from_emp_id: empId,
      from_emp_name: req.user?.emp_name || "Applicant",
      to_emp_id: targetApproverEmpId,
      action: "QUERY_REPLY",
      remark: [remark.trim()],
      final_status: "QUERY_REPLIED",
    });

    if (req.app?.get("io") && targetApproverEmpId) {
      sendNotification(req.app.get("io"), {
        emp_id: targetApproverEmpId,
        type: "RECEIVED",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Query Replied on Leave Application",
        message: `Applicant has replied to the query for leave ${leave_id}.`,
      }).catch((err) => console.error("Notification error:", err));
    }

    return res.status(200).json({ success: true, message: "Query replied successfully.", data: leave });
  } catch (error) {
    console.error("queryReplyLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to reply to query." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HR SCOPE HELPER: Multi-College / Campus Isolation vs Group HR
// ─────────────────────────────────────────────────────────────────────────────
export const getHrScope = async (user) => {
  if (!user) {
    return { isGlobal: false, schoolId: null, schoolName: "Unknown", canAccessAll: false, scopeLabel: "No Access" };
  }
  if (user.isAdmin) {
    return {
      isGlobal: true,
      schoolId: null,
      schoolName: "All Campuses",
      canAccessAll: true,
      scopeLabel: "Group HR / Super Admin (All Campuses)",
    };
  }

  const emp = await Employee.findOne({ emp_id: user.emp_id }).lean();
  if (!emp) {
    return { isGlobal: false, schoolId: null, schoolName: "Unknown", canAccessAll: false, scopeLabel: "No Access" };
  }

  const roleIds = Array.from(new Set([...(user.role_ids || []), ...(emp.role_ids || [])]));
  const roles = await Role.find({ role_id: { $in: roleIds } }).lean();

  // Group Head HR: explicitly identified by Group HR / Central HR role or designation,
  // or user who belongs to central group office (no school_id)
  const isGroupRole = roles.some((r) =>
    /group\s*hr|group.*head.*hr|central\s*hr|super\s*hr/i.test(r.role_name)
  );
  const isGroupDesignation = /group\s*hr|central\s*hr/i.test(emp.designation || "");

  if (isGroupRole || isGroupDesignation || !emp.school_id) {
    return {
      isGlobal: true,
      schoolId: null,
      schoolName: "All Campuses",
      canAccessAll: true,
      scopeLabel: "Group Head HR (All Campuses)",
      employeeSchoolId: emp.school_id || null,
    };
  }

  // Campus HR: restricted strictly to their assigned school (e.g. BIST HR)
  let schoolName = "Campus";
  if (emp.school_id) {
    const school = await School.findOne({ school_id: emp.school_id }).lean();
    if (school?.school_name) schoolName = school.school_name;
  }

  return {
    isGlobal: false,
    schoolId: emp.school_id,
    schoolName,
    canAccessAll: false,
    scopeLabel: `Campus HR (${schoolName})`,
    employeeSchoolId: emp.school_id,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET HR SCOPE & CAMPUS METADATA
// GET /api/leave/hr/scope
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetScope = async (req, res) => {
  try {
    const scope = await getHrScope(req.user);
    const schools = await School.find().select("school_id school_name").lean();
    return res.status(200).json({
      success: true,
      data: {
        ...scope,
        schools,
      },
    });
  } catch (error) {
    console.error("hrGetScope error:", error);
    return res.status(500).json({ success: false, message: "Failed to resolve HR scope." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 11. HR: ALL LEAVES (Master View)
//     GET /api/leave/hr/all
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetAllLeaves = async (req, res) => {
  try {
    const {
      dept_id,
      school_id,
      status,
      emp_id,
      leave_type_id,
      year,
      month,
      startDate,
      endDate,
      search,
      early_resumed,
      page = 1,
      limit = 50,
    } = req.query;

    const hrScope = await getHrScope(req.user);
    let effectiveSchoolId = school_id ? Number(school_id) : null;
    if (!hrScope.canAccessAll && hrScope.schoolId) {
      effectiveSchoolId = hrScope.schoolId;
    }

    const filter = { is_deleted: false };

    if (status && status !== "ALL") filter.status = String(status).toUpperCase();
    if (emp_id) filter.emp_id = Number(emp_id);
    if (leave_type_id) filter.leave_type_id = Number(leave_type_id);

    if (early_resumed === "true" || early_resumed === true) {
      filter.is_early_resumed = true;
    }

    // Filter by Dept or School
    if (dept_id) {
      filter.dept_id = Number(dept_id);
    } else if (effectiveSchoolId) {
      const [schoolDepts, schoolEmps] = await Promise.all([
        Department.find({ school_id: effectiveSchoolId }).select("dept_id").lean(),
        Employee.find({ school_id: effectiveSchoolId }).select("emp_id").lean(),
      ]);
      const schoolDeptIds = schoolDepts.map((d) => d.dept_id);
      const schoolEmpIds = schoolEmps.map((e) => e.emp_id);
      filter.$or = [
        { dept_id: { $in: schoolDeptIds } },
        { emp_id: { $in: schoolEmpIds } },
      ];
    }

    // Search by Employee Name, Emp ID, or Leave ID
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const numSearch = !isNaN(Number(s)) ? Number(s) : null;

      const matchingEmps = await Employee.find({
        $or: [
          { emp_name: { $regex: s, $options: "i" } },
          ...(numSearch !== null ? [{ emp_id: numSearch }] : []),
        ],
      }).select("emp_id").lean();

      const matchedEmpIds = matchingEmps.map((e) => e.emp_id);
      const searchConditions = [
        { leave_id: { $regex: s, $options: "i" } },
        ...(matchedEmpIds.length > 0 ? [{ emp_id: { $in: matchedEmpIds } }] : []),
      ];

      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchConditions },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    // Date filtering (Custom range or Month & Year)
    if (startDate && endDate) {
      const sDate = new Date(startDate);
      sDate.setHours(0, 0, 0, 0);
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      filter.from_date = { $lte: eDate };
      filter.to_date = { $gte: sDate };
    } else if (startDate) {
      const sDate = new Date(startDate);
      sDate.setHours(0, 0, 0, 0);
      filter.to_date = { $gte: sDate };
    } else if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      filter.from_date = { $lte: eDate };
    } else if (month && year) {
      const m = Number(month);
      const y = Number(year);
      const mStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const mEnd = new Date(y, m, 0, 23, 59, 59, 999);
      filter.from_date = { $lte: mEnd };
      filter.to_date = { $gte: mStart };
    } else if (year) {
      const y = Number(year);
      const yStart = new Date(y, 0, 1, 0, 0, 0, 0);
      const yEnd = new Date(y, 11, 31, 23, 59, 59, 999);
      filter.from_date = { $lte: yEnd };
      filter.to_date = { $gte: yStart };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [leaves, totalCount, leaveTypes, employees, departments, schools] = await Promise.all([
      LeaveRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      LeaveRequest.countDocuments(filter),
      LeaveType.find().lean(),
      Employee.find().select("emp_id emp_name designation dept_id school_id").lean(),
      Department.find().select("dept_id dept_name dept_code school_id").lean(),
      School.find().select("school_id school_name").lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d]));
    const schoolMap = Object.fromEntries(schools.map((s) => [s.school_id, s]));

    const enriched = leaves.map((l) => {
      const isHrEntry = Boolean(l.is_hr_entry || (l.created_by_emp_id && l.created_by_emp_id !== l.emp_id));
      const emp = empMap[l.emp_id];
      const dept = deptMap[l.dept_id];
      const schoolId = emp?.school_id || dept?.school_id || null;
      const school = schoolMap[schoolId];

      const isEarly = Boolean(l.is_early_resumed);
      const refundedDays = Number(l.refunded_days ?? l.early_resumed_refund_days ?? 0);
      const actualAvailedDays = isEarly
        ? Number(l.actual_days_used ?? l.actual_working_days ?? Math.max(0, l.no_of_days - refundedDays))
        : l.no_of_days;

      const typeCode = typeMap[l.leave_type_id]?.code || "LV";
      const isLwp = typeCode === "LWP";

      return {
        ...l,
        is_hr_entry: isHrEntry,
        created_by_name: l.created_by_name || (isHrEntry ? "HR Administration" : null),
        leave_type_name: typeMap[l.leave_type_id]?.name || "Leave",
        leave_type_code: typeCode,
        is_lwp: isLwp,
        applicant_name: emp?.emp_name || `Emp ${l.emp_id}`,
        applicant_designation: emp?.designation || "",
        department_name: dept?.dept_name || "General",
        school_id: schoolId,
        school_name: school?.school_name || "Central Campus",
        college_name: school?.school_name || "Central Campus",
        created_at: l.createdAt || l.created_at,
        createdAt: l.createdAt || l.created_at,
        is_early_resumed: isEarly,
        resumed_duty_date: l.resumed_duty_date || null,
        actual_availed_days: actualAvailedDays,
        refunded_days: refundedDays,
        hr_payroll_status: l.hr_payroll_status || (isEarly ? "PENDING_HR_VERIFICATION" : "NOT_APPLICABLE"),
        hr_payroll_remarks: l.hr_payroll_remarks || "",
        hr_reconciled_at: l.hr_reconciled_at || null,
        hr_reconciled_by_name: l.hr_reconciled_by_name || null,
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      hrScope,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error) {
    console.error("hrGetAllLeaves error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch employee leaves." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 12. HR: MANUAL ADD LEAVE ENTRY
//     POST /api/leave/hr/add
// ─────────────────────────────────────────────────────────────────────────────
export const hrAddLeave = async (req, res) => {
  try {
    const {
      emp_id,
      leave_type_id,
      from_date,
      to_date,
      duration_type = "FULL_DAY",
      reason,
      status = "APPROVED",
      override_balance_check = false,
    } = req.body;

    const hrEmpId = Number(req.user?.emp_id) || 1;

    if (!emp_id || !leave_type_id || !from_date || !to_date || !reason) {
      return res.status(400).json({
        success: false,
        message: "emp_id, leave_type_id, from_date, to_date, and reason are required.",
      });
    }

    const [employee, leaveType] = await Promise.all([
      Employee.findOne({ emp_id: Number(emp_id) }).lean(),
      LeaveType.findOne({ leave_type_id: Number(leave_type_id) }).lean(),
    ]);

    if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });
    if (!leaveType) return res.status(404).json({ success: false, message: "Leave type not found." });

    const deptId = Number(employee.dept_id) || 1;
    const department = await Department.findOne({ dept_id: deptId }).lean();
    const deptCode = department?.dept_code || generateDeptCode(department?.dept_name);

    const calculation = await calculateLeaveDays(from_date, to_date, duration_type, employee.school_id || 0);
    const no_of_days = calculation.no_of_days;

    const currentYear = new Date(from_date).getFullYear();
    const balance = await getOrInitLeaveBalance(emp_id, leave_type_id, currentYear);

    if (!override_balance_check) {
      const remaining = Math.max(
        0,
        (balance.allocated_days || 0) + (balance.carried_forward_days || 0) - (balance.used_days || 0)
      );
      if (no_of_days > remaining) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance (${remaining} days remaining). Enable override to force insert.`,
        });
      }
    }

    const counter = await Counter.findOneAndUpdate(
      { name: `leave_id_${deptCode}` },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );
    const leave_id = `LV_${deptCode}_${String(counter.seq).padStart(3, "0")}`;

    const isApproved = status.toUpperCase() === "APPROVED";
    let approval_chain = [];
    let current_holder_emp_id = null;
    let forward_to_role_id = null;

    if (!isApproved) {
      const dynamicChain = await resolveApprovalChainForApplicant(employee);
      if (dynamicChain && dynamicChain.length > 0) {
        approval_chain = dynamicChain.map((step, idx) => ({
          step: step.step || idx + 1,
          label: step.label || (idx === dynamicChain.length - 1 ? "Final Authority" : `Authority Level ${idx + 1}`),
          role_id: step.role_id,
          role_name: step.role_name,
          emp_id: step.emp_id || null,
          emp_name: step.emp_name || null,
          status: idx === 0 ? "PENDING" : "UPCOMING",
        }));
        const firstAuth = dynamicChain[0];
        forward_to_role_id = firstAuth.role_id || null;
        current_holder_emp_id = firstAuth.emp_id || null;
      }
    }

    const hrName = req.user?.emp_name ? `${req.user.emp_name} (HR Admin)` : "HR Admin";
    const hrRoleId = Number(req.user?.active_role_id) || 151;

    // For direct APPROVED HR entries, create a definitive approval step so the approval date and officer are preserved
    if (isApproved) {
      approval_chain = [
        {
          step: 1,
          label: "HR Direct Approval",
          role_id: hrRoleId,
          role_name: "HR Administration",
          emp_id: hrEmpId,
          emp_name: req.user?.emp_name || "HR Admin",
          status: "APPROVED",
          action_date: new Date(),
          remark: `Direct manual leave entry and balance deduction recorded by HR: ${reason.trim()}`,
        },
      ];
    }

    const leaveRequest = await LeaveRequest.create({
      leave_id,
      emp_id: Number(emp_id),
      dept_id: deptId,
      leave_type_id: Number(leave_type_id),
      from_date: new Date(from_date),
      to_date: new Date(to_date),
      duration_type,
      no_of_days,
      reason: reason.trim(),
      status: isApproved ? "APPROVED" : "PENDING",
      lifecycle_status: isApproved ? "CLOSED" : "OPEN",
      approval_chain,
      current_holder_emp_id,
      forward_to_role_id,
      created_by_emp_id: hrEmpId,
      created_by_name: hrName,
      is_hr_entry: true,
      received_at: new Date(),
    });

    if (isApproved) {
      await LeaveBalance.findOneAndUpdate(
        { emp_id: Number(emp_id), leave_type_id: Number(leave_type_id), year: currentYear },
        { $inc: { used_days: no_of_days } }
      );
    }

    await LeaveFlow.create({
      leave_id,
      from_emp_id: hrEmpId,
      from_emp_name: hrName,
      from_role_id: hrRoleId,
      from_role_name: "HR Administration",
      to_emp_id: isApproved ? Number(emp_id) : (current_holder_emp_id || Number(emp_id)),
      to_emp_name: isApproved ? employee.emp_name : (approval_chain[0]?.emp_name || employee.emp_name),
      action: isApproved ? "APPROVED" : "CREATED",
      remark: [`Manual entry by HR: ${reason.trim()}`],
      level: 1,
      final_status: isApproved ? "APPROVED" : "PENDING",
    });

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "leave", action: "CREATED" });
    }

    return res.status(201).json({
      success: true,
      message: "Leave record created by HR successfully.",
      data: leaveRequest,
    });
  } catch (error) {
    console.error("hrAddLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to create leave record." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 13. HR: BALANCE ADJUSTMENT
//     POST /api/leave/hr/adjust
// ─────────────────────────────────────────────────────────────────────────────
export const hrAdjustBalance = async (req, res) => {
  try {
    const {
      emp_id,
      leave_type_id,
      year = new Date().getFullYear(),
      adjustment_type, // "CREDIT" or "DEBIT"
      target_field = "USED_DAYS", // "USED_DAYS" or "ALLOCATED_DAYS"
      scope = "EMPLOYEE_WIDE", // "EMPLOYEE_WIDE" or "ROLE_BASED"
      role_id = null,
      role_name = null,
      days,
      reason,
    } = req.body;

    const hrEmpId = Number(req.user?.emp_id) || 1;

    if (!emp_id || !leave_type_id || !adjustment_type || !days || !reason) {
      return res.status(400).json({
        success: false,
        message: "emp_id, leave_type_id, adjustment_type (CREDIT/DEBIT), days, and reason are required.",
      });
    }

    const empNum = Number(emp_id);
    const typeNum = Number(leave_type_id);
    const yearNum = Number(year);
    const daysNum = Math.abs(Number(days));
    const isCredit = String(adjustment_type).toUpperCase() === "CREDIT";

    // Enforce Multi-College Campus HR Scope
    const hrScope = await getHrScope(req.user);
    if (!hrScope.canAccessAll && hrScope.schoolId) {
      const targetEmp = await Employee.findOne({ emp_id: empNum }).lean();
      if (!targetEmp || targetEmp.school_id !== hrScope.schoolId) {
        return res.status(403).json({
          success: false,
          message: `Access denied: You are Campus HR for ${hrScope.schoolName} and cannot adjust leave balances for staff in other colleges.`,
        });
      }
    }

    // Resolve Scope and Target Role
    let targetRoleId = null;
    let targetRoleName = null;

    if (
      scope === "ROLE_BASED" ||
      (role_id !== null && role_id !== undefined && role_id !== "" && role_id !== "null")
    ) {
      targetRoleId = Number(role_id);
      if (isNaN(targetRoleId) || targetRoleId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid role_id is required for Role-Based balance adjustment.",
        });
      }
      if (role_name) {
        targetRoleName = String(role_name).trim();
      } else {
        const r = await Role.findOne({ role_id: targetRoleId }).lean();
        targetRoleName = r?.role_name || `Role #${targetRoleId}`;
      }
    } else {
      targetRoleName = "Employee-Wide (Base)";
    }

    // Ensure balance exists for target scope (role-specific or base)
    const balance = await getOrInitLeaveBalance(empNum, typeNum, yearNum, targetRoleId);

    // If adjusting used_days: CREDIT means refunding used days (decreases used_days), DEBIT increases used_days
    // If adjusting allocated_days: CREDIT increases allocated_days, DEBIT decreases allocated_days
    const incField = target_field === "ALLOCATED_DAYS" ? "allocated_days" : "used_days";
    let delta = 0;

    if (target_field === "ALLOCATED_DAYS") {
      delta = isCredit ? daysNum : -daysNum;
    } else {
      // used_days target: Credit = refund used days (-daysNum), Debit = consume (+daysNum)
      delta = isCredit ? -daysNum : daysNum;
    }

    const updatedBalance = await LeaveBalance.findOneAndUpdate(
      { emp_id: empNum, role_id: targetRoleId, leave_type_id: typeNum, year: yearNum },
      { $inc: { [incField]: delta } },
      { new: true }
    );

    const adjustment = await LeaveAdjustment.create({
      emp_id: empNum,
      role_id: targetRoleId,
      role_name: targetRoleName,
      scope: targetRoleId ? "ROLE_BASED" : "EMPLOYEE_WIDE",
      leave_type_id: typeNum,
      year: yearNum,
      target_field,
      adjustment_type: isCredit ? "CREDIT" : "DEBIT",
      days: daysNum,
      reason: reason.trim(),
      adjusted_by_emp_id: hrEmpId,
      adjusted_at: new Date(),
    });

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", {
        entity: "leave_balance_adjusted",
        emp_id: empNum,
        role_id: targetRoleId,
        scope: targetRoleId ? "ROLE_BASED" : "EMPLOYEE_WIDE",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Leave balance adjusted successfully for ${targetRoleName}.`,
      data: {
        adjustment,
        balance: updatedBalance,
      },
    });
  } catch (error) {
    console.error("hrAdjustBalance error:", error);
    return res.status(500).json({ success: false, message: "Failed to adjust leave balance." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 13b. HR: GET ADJUSTMENT AUDIT LOGS
//      GET /api/leave/hr/adjustments
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetAdjustments = async (req, res) => {
  try {
    const { emp_id, role_id, scope, year, page = 1, limit = 50 } = req.query;
    const filter = {};

    const hrScope = await getHrScope(req.user);
    if (!hrScope.canAccessAll && hrScope.schoolId) {
      const campusEmps = await Employee.find({ school_id: hrScope.schoolId }).select("emp_id").lean();
      const campusEmpIds = campusEmps.map((e) => e.emp_id);
      if (emp_id) {
        if (!campusEmpIds.includes(Number(emp_id))) {
          return res.status(200).json({
            success: true,
            data: [],
            hrScope,
            pagination: { total: 0, page: 1, limit: Number(limit), totalPages: 0 },
          });
        }
        filter.emp_id = Number(emp_id);
      } else {
        filter.emp_id = { $in: campusEmpIds };
      }
    } else if (emp_id) {
      filter.emp_id = Number(emp_id);
    }

    if (year) filter.year = Number(year);
    if (scope) filter.scope = scope;
    if (role_id !== undefined && role_id !== null && role_id !== "" && role_id !== "null") {
      filter.role_id = Number(role_id);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [adjustments, total, leaveTypes, schools] = await Promise.all([
      LeaveAdjustment.find(filter).sort({ adjusted_at: -1 }).skip(skip).limit(Number(limit)).lean(),
      LeaveAdjustment.countDocuments(filter),
      LeaveType.find().lean(),
      School.find().lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const schoolMap = Object.fromEntries(schools.map((s) => [s.school_id, s.school_name]));

    const empIds = [
      ...new Set(
        adjustments
          .map((a) => a.emp_id)
          .concat(adjustments.map((a) => a.adjusted_by_emp_id))
          .filter(Boolean)
      ),
    ];
    const employees = await Employee.find({ emp_id: { $in: empIds } })
      .select("emp_id emp_name designation dept_id school_id")
      .lean();
    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));

    const enriched = adjustments.map((adj) => {
      const emp = empMap[adj.emp_id];
      const adjuster = empMap[adj.adjusted_by_emp_id];
      const lt = typeMap[adj.leave_type_id];

      return {
        ...adj,
        emp_name: emp?.emp_name || `Employee #${adj.emp_id}`,
        emp_designation: emp?.designation || "Staff",
        school_id: emp?.school_id || null,
        college_name: emp?.school_id ? schoolMap[emp.school_id] || `College #${emp.school_id}` : "—",
        leave_type_name: lt?.name || `Type ${adj.leave_type_id}`,
        leave_type_code: lt?.code || "LV",
        adjusted_by_name: adjuster?.emp_name || `Admin #${adj.adjusted_by_emp_id}`,
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      hrScope,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("hrGetAdjustments error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch adjustment logs." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 14. HR: ORG-WIDE LEAVE REPORTS
//     GET /api/leave/hr/report
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetReport = async (req, res) => {
  try {
    const { dept_id, year = new Date().getFullYear(), month, start_date, end_date, filter_type = "year" } = req.query;
    const yearNum = Number(year) || new Date().getFullYear();

    let periodStart, periodEnd, periodLabel;
    if (start_date && end_date) {
      periodStart = new Date(start_date);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(end_date);
      periodEnd.setHours(23, 59, 59, 999);
      periodLabel = `${periodStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} – ${periodEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    } else if (month) {
      const m = Number(month) - 1; // 0-indexed
      periodStart = new Date(yearNum, m, 1, 0, 0, 0, 0);
      periodEnd = new Date(yearNum, m + 1, 0, 23, 59, 59, 999);
      const monthName = periodStart.toLocaleString("en-IN", { month: "long" });
      periodLabel = `${monthName} ${yearNum}`;
    } else {
      periodStart = new Date(yearNum, 0, 1, 0, 0, 0, 0);
      periodEnd = new Date(yearNum, 11, 31, 23, 59, 59, 999);
      periodLabel = `Year ${yearNum}`;
    }

    const filter = {
      is_deleted: false,
      from_date: { $lte: periodEnd },
      to_date: { $gte: periodStart },
    };
    if (dept_id) filter.dept_id = Number(dept_id);

    const [allLeaves, leaveTypes, departments, employees, roles] = await Promise.all([
      LeaveRequest.find(filter).lean(),
      LeaveType.find().lean(),
      Department.find().lean(),
      Employee.find({ is_active: true }, "emp_id emp_name designation dept_id school_id role_ids").lean(),
      Role.find({}, "role_id role_name").lean(),
    ]);

    const totalRequests = allLeaves.length;
    const totalApproved = allLeaves.filter((l) => l.status === "APPROVED").length;
    const totalRejected = allLeaves.filter((l) => l.status === "REJECTED").length;
    const totalPending = allLeaves.filter((l) => l.status === "PENDING").length;

    // Actual utilized days takes into account early duty resumptions
    const totalDaysTaken = allLeaves
      .filter((l) => l.status === "APPROVED")
      .reduce((sum, l) => {
        const days = l.is_early_resumed && l.actual_days_used !== undefined
          ? l.actual_days_used
          : (l.no_of_days || 0);
        return sum + days;
      }, 0);

    // Group by Leave Type
    const typeBreakdown = leaveTypes.map((lt) => {
      const matching = allLeaves.filter((l) => l.leave_type_id === lt.leave_type_id);
      return {
        leave_type_id: lt.leave_type_id,
        name: lt.name,
        code: lt.code,
        count: matching.length,
        approvedDays: matching
          .filter((l) => l.status === "APPROVED")
          .reduce((sum, l) => {
            const days = l.is_early_resumed && l.actual_days_used !== undefined
              ? l.actual_days_used
              : (l.no_of_days || 0);
            return sum + days;
          }, 0),
      };
    });

    // Group by Department
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r.role_name]));
    const typeMap = Object.fromEntries(leaveTypes.map((lt) => [lt.leave_type_id, lt]));

    const deptBreakdown = {};
    allLeaves.forEach((l) => {
      const dName = deptMap[l.dept_id] || `Dept ${l.dept_id}`;
      if (!deptBreakdown[dName]) {
        deptBreakdown[dName] = { total: 0, approved: 0, rejected: 0, pending: 0, days: 0 };
      }
      deptBreakdown[dName].total++;
      if (l.status === "APPROVED") {
        deptBreakdown[dName].approved++;
        const days = l.is_early_resumed && l.actual_days_used !== undefined
          ? l.actual_days_used
          : (l.no_of_days || 0);
        deptBreakdown[dName].days += days;
      } else if (l.status === "REJECTED") {
        deptBreakdown[dName].rejected++;
      } else {
        deptBreakdown[dName].pending++;
      }
    });

    // Group leaves by employee for Payroll & Salary Deduction Calculation
    const empLeaveMap = {};
    allLeaves.forEach((l) => {
      if (!empLeaveMap[l.emp_id]) empLeaveMap[l.emp_id] = [];
      empLeaveMap[l.emp_id].push(l);
    });

    const employeePayrollSummary = employees
      .filter((emp) => {
        if (dept_id && emp.dept_id !== Number(dept_id)) return false;
        return empLeaveMap[emp.emp_id] && empLeaveMap[emp.emp_id].length > 0;
      })
      .map((emp) => {
        const empLeaves = empLeaveMap[emp.emp_id] || [];
        const empApproved = empLeaves.filter((l) => l.status === "APPROVED");

        let totalAppliedDays = 0;
        let actualUtilizedDays = 0;
        let refundedDays = 0;
        let unpaidDays = 0;
        const leaveTypeCounts = {};
        let earlyResumedCount = 0;
        let pendingReconciliationCount = 0;

        empApproved.forEach((l) => {
          const applied = l.original_no_of_days || l.no_of_days || 0;
          totalAppliedDays += applied;

          if (l.is_early_resumed) {
            earlyResumedCount++;
            const used = l.actual_days_used !== undefined ? l.actual_days_used : applied;
            actualUtilizedDays += used;
            refundedDays += l.refunded_days || Math.max(0, applied - used);
            if (l.hr_payroll_status !== "RECONCILED") {
              pendingReconciliationCount++;
            }
          } else {
            actualUtilizedDays += applied;
          }

          const typeName = typeMap[l.leave_type_id]?.name || `Type ${l.leave_type_id}`;
          const isLwp = typeMap[l.leave_type_id]?.code === "LWP" || /without pay|unpaid/i.test(typeName);
          if (isLwp) {
            unpaidDays += l.is_early_resumed ? (l.actual_days_used || 0) : applied;
          }

          const usedForType = l.is_early_resumed ? (l.actual_days_used || 0) : applied;
          leaveTypeCounts[typeName] = (leaveTypeCounts[typeName] || 0) + usedForType;
        });

        const primaryRoleName = emp.role_ids?.length ? roleMap[emp.role_ids[0]] : null;

        return {
          emp_id: emp.emp_id,
          emp_name: emp.emp_name,
          designation: emp.designation || "Faculty",
          department_name: deptMap[emp.dept_id] || "Department",
          role_name: primaryRoleName,
          total_leaves_count: empLeaves.length,
          approved_leaves_count: empApproved.length,
          total_applied_days: totalAppliedDays,
          actual_utilized_days: actualUtilizedDays,
          refunded_days: refundedDays,
          unpaid_days: unpaidDays,
          type_breakdown: leaveTypeCounts,
          early_resumed_count: earlyResumedCount,
          pending_reconciliation_count: pendingReconciliationCount,
          leaves: empLeaves.map((l) => ({
            leave_id: l.leave_id,
            leave_type_name: typeMap[l.leave_type_id]?.name || "Leave",
            leave_type_code: typeMap[l.leave_type_id]?.code || "LV",
            from_date: l.from_date,
            to_date: l.to_date,
            no_of_days: l.no_of_days,
            original_no_of_days: l.original_no_of_days,
            actual_days_used: l.actual_days_used,
            refunded_days: l.refunded_days,
            is_early_resumed: l.is_early_resumed,
            hr_payroll_status: l.hr_payroll_status,
            status: l.status,
          })),
        };
      })
      .sort((a, b) => b.actual_utilized_days - a.actual_utilized_days);

    return res.status(200).json({
      success: true,
      data: {
        period: {
          label: periodLabel,
          start: periodStart,
          end: periodEnd,
          filter_type,
          year: yearNum,
          month: month ? Number(month) : null,
        },
        summary: {
          totalRequests,
          totalApproved,
          totalRejected,
          totalPending,
          totalDaysTaken,
          approvalRate: totalRequests ? Math.round((totalApproved / totalRequests) * 100) : 0,
        },
        typeBreakdown,
        deptBreakdown: Object.entries(deptBreakdown).map(([name, stats]) => ({
          department: name,
          ...stats,
        })),
        employeePayrollSummary,
      },
    });
  } catch (error) {
    console.error("hrGetReport error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate HR leave report." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 14c. HR: DAILY STAFF PRESENCE & ON-LEAVE ROSTER (DAY-WISE TRACKER)
//      GET /api/leave/hr/daily-presence
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetDailyPresence = async (req, res) => {
  try {
    const {
      date,
      school_id,
      dept_id,
      range_days = 7,
    } = req.query;

    const hrScope = await getHrScope(req.user);
    let effectiveSchoolId = school_id && school_id !== "ALL" ? Number(school_id) : null;
    if (!hrScope.canAccessAll) {
      if (!hrScope.schoolId) {
        return res.status(403).json({ success: false, message: "You do not have permission to access attendance data." });
      }
      effectiveSchoolId = hrScope.schoolId;
    }

    const formatLocalDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    let targetDate;
    if (date && typeof date === "string" && date.includes("-")) {
      const [y, m, d] = date.split("-").map(Number);
      targetDate = new Date(y, m - 1, d);
    } else if (date) {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
    }

    if (isNaN(targetDate.getTime())) {
      targetDate = new Date();
    }
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const targetDateStr = formatLocalDate(dayStart);

    const empFilter = { is_active: true };
    if (effectiveSchoolId) empFilter.school_id = effectiveSchoolId;
    if (dept_id && dept_id !== "ALL") empFilter.dept_id = Number(dept_id);

    const [allMatchingEmps, departments, schools, leaveTypes] = await Promise.all([
      Employee.find(empFilter).select("emp_id emp_name designation dept_id school_id role_ids").lean(),
      Department.find().lean(),
      School.find().lean(),
      LeaveType.find().lean(),
    ]);

    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const schoolMap = Object.fromEntries(schools.map((s) => [s.school_id, s.school_name]));
    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));

    const matchingEmpIds = allMatchingEmps.map((e) => e.emp_id);

    // Find APPROVED leaves overlapping targetDate
    const approvedLeaves = await LeaveRequest.find({
      emp_id: { $in: matchingEmpIds },
      status: "APPROVED",
      is_deleted: false,
      from_date: { $lte: dayEnd },
      to_date: { $gte: dayStart },
    }).lean();

    const activeLeaveByEmp = {};
    for (const l of approvedLeaves) {
      if (l.is_early_resumed && l.early_resumption_date) {
        const resumeDate = new Date(l.early_resumption_date);
        resumeDate.setHours(0, 0, 0, 0);
        if (dayStart >= resumeDate) {
          continue;
        }
      }
      activeLeaveByEmp[l.emp_id] = l;
    }

    const onLeaveList = [];
    const onDutyList = [];

    for (const emp of allMatchingEmps) {
      const activeLeave = activeLeaveByEmp[emp.emp_id];
      const deptName = deptMap[emp.dept_id] || "General";
      const schoolName = schoolMap[emp.school_id] || "Main Campus";

      if (activeLeave) {
        const lt = typeMap[activeLeave.leave_type_id];
        onLeaveList.push({
          emp_id: emp.emp_id,
          emp_name: emp.emp_name,
          designation: emp.designation || "Staff",
          dept_id: emp.dept_id,
          department_name: deptName,
          school_id: emp.school_id,
          school_name: schoolName,
          leave_id: activeLeave.leave_id,
          leave_type_id: activeLeave.leave_type_id,
          leave_type_name: lt?.name || "Leave",
          leave_type_code: lt?.code || "LV",
          from_date: activeLeave.from_date,
          to_date: activeLeave.to_date,
          no_of_days: activeLeave.no_of_days,
          reason: activeLeave.reason,
          handover_emp_id: activeLeave.handover_emp_id || null,
          handover_emp_name: activeLeave.handover_emp_name || null,
          handover_tasks: activeLeave.handover_tasks || [],
          status: "ON_LEAVE",
        });
      } else {
        onDutyList.push({
          emp_id: emp.emp_id,
          emp_name: emp.emp_name,
          designation: emp.designation || "Staff",
          dept_id: emp.dept_id,
          department_name: deptName,
          school_id: emp.school_id,
          school_name: schoolName,
          status: "PRESENT",
        });
      }
    }

    const totalStaff = allMatchingEmps.length;
    const onLeaveCount = onLeaveList.length;
    const onDutyCount = onDutyList.length;
    const presencePercentage = totalStaff > 0 ? Math.round((onDutyCount / totalStaff) * 100) : 100;

    // Department presence breakdown
    const deptPresenceMap = {};
    for (const emp of allMatchingEmps) {
      const dId = emp.dept_id || 0;
      const dName = deptMap[dId] || "Other";
      if (!deptPresenceMap[dId]) {
        deptPresenceMap[dId] = { dept_id: dId, department_name: dName, total: 0, onDuty: 0, onLeave: 0 };
      }
      deptPresenceMap[dId].total++;
      if (activeLeaveByEmp[emp.emp_id]) {
        deptPresenceMap[dId].onLeave++;
      } else {
        deptPresenceMap[dId].onDuty++;
      }
    }
    const departmentPresence = Object.values(deptPresenceMap).map((dp) => ({
      ...dp,
      presencePercentage: dp.total > 0 ? Math.round((dp.onDuty / dp.total) * 100) : 100,
    }));

    // 7-day day-wise presence strip around targetDate (-3 days to +3 days)
    const rangeDaysCount = Math.min(14, Math.max(3, Number(range_days) || 7));
    const halfRange = Math.floor(rangeDaysCount / 2);
    const stripStart = new Date(dayStart);
    stripStart.setDate(stripStart.getDate() - halfRange);

    const stripDates = [];
    for (let i = 0; i < rangeDaysCount; i++) {
      const d = new Date(stripStart);
      d.setDate(d.getDate() + i);
      stripDates.push(d);
    }

    const rangeMinDate = new Date(stripDates[0]);
    rangeMinDate.setHours(0, 0, 0, 0);
    const rangeMaxDate = new Date(stripDates[stripDates.length - 1]);
    rangeMaxDate.setHours(23, 59, 59, 999);

    const rangeApprovedLeaves = await LeaveRequest.find({
      emp_id: { $in: matchingEmpIds },
      status: "APPROVED",
      is_deleted: false,
      from_date: { $lte: rangeMaxDate },
      to_date: { $gte: rangeMinDate },
    }).lean();

    const dayWiseTrend = stripDates.map((curDate) => {
      const curStart = new Date(curDate);
      curStart.setHours(0, 0, 0, 0);
      const curEnd = new Date(curDate);
      curEnd.setHours(23, 59, 59, 999);

      const onLeaveEmpSet = new Set();
      for (const l of rangeApprovedLeaves) {
        const lFrom = new Date(l.from_date);
        const lTo = new Date(l.to_date);
        if (lFrom <= curEnd && lTo >= curStart) {
          if (l.is_early_resumed && l.early_resumption_date) {
            const resDate = new Date(l.early_resumption_date);
            resDate.setHours(0, 0, 0, 0);
            if (curStart >= resDate) continue;
          }
          onLeaveEmpSet.add(l.emp_id);
        }
      }

      const leaveCount = onLeaveEmpSet.size;
      const dutyCount = Math.max(0, totalStaff - leaveCount);
      const rate = totalStaff > 0 ? Math.round((dutyCount / totalStaff) * 100) : 100;

      const dateStr = formatLocalDate(curStart);
      const dayName = curStart.toLocaleDateString("en-IN", { weekday: "short" });

      return {
        date: dateStr,
        dayName,
        isTargetDate: dateStr === targetDateStr,
        totalStaff,
        onDutyCount: dutyCount,
        onLeaveCount: leaveCount,
        presencePercentage: rate,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        date: targetDateStr,
        displayDate: dayStart.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        isToday: targetDateStr === new Date().toISOString().split("T")[0],
        hrScope,
        summary: {
          totalStaff,
          onDutyCount,
          onLeaveCount,
          presencePercentage,
        },
        dayWiseTrend,
        departmentPresence,
        onLeaveList,
        onDutyList,
      },
    });
  } catch (error) {
    console.error("hrGetDailyPresence error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch daily presence data." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 14b. HR: MONTHLY PAYROLL & SALARY DEDUCTION SUMMARY (ACCOUNTS EXPORT)
//      GET /api/leave/hr/payroll-summary
// ─────────────────────────────────────────────────────────────────────────────
export const hrGetPayrollSummary = async (req, res) => {
  try {
    const {
      year = new Date().getFullYear(),
      month = new Date().getMonth() + 1,
      school_id,
      dept_id,
      category = "ALL", // "ALL" | "TEACHING" | "NON_TEACHING"
      show_all = "false", // "true" => all active staff, "false" => only staff with leave in month
    } = req.query;

    const hrScope = await getHrScope(req.user);
    let effectiveSchoolId = school_id && school_id !== "ALL" ? Number(school_id) : null;
    if (!hrScope.canAccessAll && hrScope.schoolId) {
      effectiveSchoolId = hrScope.schoolId;
    }

    const yearNum = Number(year) || new Date().getFullYear();
    const monthNum = Number(month) || new Date().getMonth() + 1; // 1-12
    const periodStart = new Date(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
    const periodEnd = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
    const monthName = periodStart.toLocaleString("en-IN", { month: "long" });
    const periodLabel = `${monthName} ${yearNum}`;

    // Build Active Employee Query
    const empFilter = { is_active: true };
    if (effectiveSchoolId) empFilter.school_id = effectiveSchoolId;
    if (dept_id && dept_id !== "ALL") empFilter.dept_id = Number(dept_id);

    const [employees, departments, schools, leaveTypes, roles] = await Promise.all([
      Employee.find(empFilter).select("emp_id emp_name designation dept_id school_id role_ids").lean(),
      Department.find().lean(),
      School.find().lean(),
      LeaveType.find().lean(),
      Role.find().lean(),
    ]);

    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const schoolMap = Object.fromEntries(schools.map((s) => [s.school_id, s.school_name]));
    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r.role_name]));

    // Teaching vs Non-Teaching classification based on designation
    const isTeachingDesignation = (desig = "") =>
      /prof|faculty|lecturer|teacher|instructor|dean|hod|mentor|principal/i.test(desig);

    let filteredEmployees = employees;
    if (category === "TEACHING") {
      filteredEmployees = employees.filter((e) => isTeachingDesignation(e.designation));
    } else if (category === "NON_TEACHING") {
      filteredEmployees = employees.filter((e) => !isTeachingDesignation(e.designation));
    }

    const empIds = filteredEmployees.map((e) => e.emp_id);

    // Approved leaves overlapping with selected month
    const approvedLeaves = await LeaveRequest.find({
      emp_id: { $in: empIds },
      is_deleted: false,
      status: "APPROVED",
      from_date: { $lte: periodEnd },
      to_date: { $gte: periodStart },
    }).lean();

    const empLeaveMap = {};
    approvedLeaves.forEach((l) => {
      if (!empLeaveMap[l.emp_id]) empLeaveMap[l.emp_id] = [];
      empLeaveMap[l.emp_id].push(l);
    });

    const isShowAll = show_all === "true" || show_all === true;
    const rows = [];
    let totalPaidDaysAll = 0;
    let totalLwpDaysAll = 0;
    let employeesWithDeductionsCount = 0;

    for (const emp of filteredEmployees) {
      const empLeaves = empLeaveMap[emp.emp_id] || [];
      if (!isShowAll && empLeaves.length === 0) continue;

      let paidDays = 0;
      let lwpDays = 0;
      const typeDaysMap = {};
      let earlyResumedCases = 0;
      let refundedDays = 0;

      for (const leave of empLeaves) {
        const lt = typeMap[leave.leave_type_id];
        const isLwp =
          lt?.code === "LWP" ||
          /without pay|loss of pay|unpaid|lwp/i.test(lt?.name || "");

        // Calculate overlap with this specific month
        const lStart = new Date(Math.max(new Date(leave.from_date).getTime(), periodStart.getTime()));
        let effectiveLeaveEnd = new Date(leave.to_date);
        if (leave.is_early_resumed && leave.resumed_duty_date) {
          effectiveLeaveEnd = new Date(new Date(leave.resumed_duty_date).getTime() - 24 * 60 * 60 * 1000);
          earlyResumedCases++;
          refundedDays += leave.refunded_days || 0;
        }

        if (effectiveLeaveEnd >= lStart) {
          const lEnd = new Date(Math.min(effectiveLeaveEnd.getTime(), periodEnd.getTime()));
          const diffMs = lEnd.getTime() - lStart.getTime();
          const overlapDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);

          if (isLwp) {
            lwpDays += overlapDays;
          } else {
            paidDays += overlapDays;
            const tCode = lt?.code || "LV";
            typeDaysMap[tCode] = (typeDaysMap[tCode] || 0) + overlapDays;
          }
        }
      }

      const netDaysToDeduct = lwpDays;
      if (netDaysToDeduct > 0) employeesWithDeductionsCount++;
      totalPaidDaysAll += paidDays;
      totalLwpDaysAll += lwpDays;

      const isTeaching = isTeachingDesignation(emp.designation);
      const paidBreakdown = Object.entries(typeDaysMap)
        .map(([code, d]) => `${d} ${code}`)
        .join(", ") || (paidDays > 0 ? `${paidDays}d` : "—");

      rows.push({
        emp_id: emp.emp_id,
        emp_name: emp.emp_name,
        designation: emp.designation || "Staff",
        category: isTeaching ? "Teaching" : "Non-Teaching",
        college_id: emp.school_id,
        college_name: schoolMap[emp.school_id] || `College #${emp.school_id}`,
        dept_id: emp.dept_id,
        department_name: deptMap[emp.dept_id] || `Dept #${emp.dept_id}`,
        role_name: emp.role_ids?.length ? roleMap[emp.role_ids[0]] : null,
        total_leaves_count: empLeaves.length,
        paid_leaves_days: paidDays,
        paid_breakdown: paidBreakdown,
        lwp_days: lwpDays,
        net_days_to_deduct: netDaysToDeduct,
        early_resumed_cases: earlyResumedCases,
        refunded_days: refundedDays,
      });
    }

    // Sort: employees with deductions first, then alphabetical by name
    rows.sort((a, b) => b.net_days_to_deduct - a.net_days_to_deduct || a.emp_name.localeCompare(b.emp_name));

    return res.status(200).json({
      success: true,
      data: {
        rows,
        summary: {
          totalEmployees: rows.length,
          totalPaidDays: totalPaidDaysAll,
          totalLwpDays: totalLwpDaysAll,
          employeesWithDeductions: employeesWithDeductionsCount,
        },
        period: {
          year: yearNum,
          month: monthNum,
          label: periodLabel,
        },
        hrScope,
      },
    });
  } catch (error) {
    console.error("hrGetPayrollSummary error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate payroll summary." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 14c. HR: 1-CLICK BULK ANNUAL LEAVE QUOTA ALLOTMENT (SESSION START)
//      POST /api/leave/hr/bulk-allot
// ─────────────────────────────────────────────────────────────────────────────
export const hrBulkAllotQuota = async (req, res) => {
  try {
    const {
      school_id,
      dept_id,
      category = "ALL", // "ALL" | "TEACHING" | "NON_TEACHING"
      leave_type_id,
      days,
      mode = "SET", // "SET" (standard quota overwrite) or "ADD" (credit bonus/extra days)
      year = new Date().getFullYear(),
      reason,
    } = req.body;

    const hrEmpId = Number(req.user?.emp_id) || 1;

    if (!leave_type_id || days === undefined || days === null || !reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "leave_type_id, days (quota), and mandatory reason / remarks are required.",
      });
    }

    if (reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid descriptive reason for institutional quota allotment (min 5 chars).",
      });
    }

    const typeNum = Number(leave_type_id);
    const daysNum = Math.abs(Number(days));
    const yearNum = Number(year);

    const lt = await LeaveType.findOne({ leave_type_id: typeNum }).lean();
    if (!lt) {
      return res.status(404).json({ success: false, message: "Invalid leave type selected." });
    }

    const hrScope = await getHrScope(req.user);
    let effectiveSchoolId = school_id && school_id !== "ALL" ? Number(school_id) : null;
    if (!hrScope.canAccessAll) {
      if (!hrScope.schoolId) {
        return res.status(403).json({ success: false, message: "You do not have permission to allot quotas." });
      }
      effectiveSchoolId = hrScope.schoolId;
    }

    const empFilter = { is_active: true };
    if (effectiveSchoolId) empFilter.school_id = effectiveSchoolId;
    if (dept_id && dept_id !== "ALL") empFilter.dept_id = Number(dept_id);

    const isTeachingDesignation = (desig = "") =>
      /prof|faculty|lecturer|teacher|instructor|dean|hod|mentor|principal/i.test(desig);

    const allMatchingEmps = await Employee.find(empFilter).select("emp_id emp_name designation dept_id school_id").lean();

    let targetEmps = allMatchingEmps;
    if (category === "TEACHING") {
      targetEmps = allMatchingEmps.filter((e) => isTeachingDesignation(e.designation));
    } else if (category === "NON_TEACHING") {
      targetEmps = allMatchingEmps.filter((e) => !isTeachingDesignation(e.designation));
    }

    if (targetEmps.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No active staff found matching the specified college, department, and category criteria.",
      });
    }

    const isAddMode = String(mode).toUpperCase() === "ADD" || String(mode).toUpperCase() === "CREDIT";
    const isDeductMode = String(mode).toUpperCase() === "DEDUCT" || String(mode).toUpperCase() === "DEBIT";
    const auditRecords = [];
    const now = new Date();

    for (const emp of targetEmps) {
      const existing = await getOrInitLeaveBalance(emp.emp_id, typeNum, yearNum, null);
      const oldAllocated = existing.allocated_days || 0;
      let newAllocated;
      if (isAddMode) {
        newAllocated = oldAllocated + daysNum;
      } else if (isDeductMode) {
        newAllocated = Math.max(0, oldAllocated - daysNum);
      } else {
        newAllocated = daysNum;
      }

      await LeaveBalance.findOneAndUpdate(
        { emp_id: emp.emp_id, role_id: null, leave_type_id: typeNum, year: yearNum },
        { $set: { allocated_days: newAllocated } },
        { new: true, upsert: true }
      );

      auditRecords.push({
        emp_id: emp.emp_id,
        role_id: null,
        role_name: "Employee-Wide (Base)",
        scope: "EMPLOYEE_WIDE",
        leave_type_id: typeNum,
        year: yearNum,
        target_field: "ALLOCATED_DAYS",
        adjustment_type: isDeductMode ? "DEBIT" : "CREDIT",
        days: (isAddMode || isDeductMode) ? daysNum : Math.abs(newAllocated - oldAllocated),
        reason: `[Bulk Session Allotment - ${mode}]: ${reason.trim()}`,
        adjusted_by_emp_id: hrEmpId,
        adjusted_at: now,
      });
    }

    if (auditRecords.length > 0) {
      await LeaveAdjustment.insertMany(auditRecords);
    }

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", {
        entity: "leave_balance_adjusted",
        bulk: true,
        count: targetEmps.length,
      });
    }

    const actionText = isAddMode ? "added (credited)" : isDeductMode ? "deducted (debited)" : "allocated";
    return res.status(200).json({
      success: true,
      count: targetEmps.length,
      message: `Successfully ${actionText} ${daysNum} days of ${lt.name} (${lt.code}) for ${targetEmps.length} staff members.`,
    });
  } catch (error) {
    console.error("hrBulkAllotQuota error:", error);
    return res.status(500).json({ success: false, message: "Failed to perform bulk quota allotment." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 15. HR: BULK UPLOAD LEAVES
//     POST /api/leave/hr/bulk-upload
// ─────────────────────────────────────────────────────────────────────────────
export const hrBulkUpload = async (req, res) => {
  try {
    const { rows = [], file_name = "bulk_upload.xlsx", upload_mode } = req.body;
    const hrEmpId = Number(req.user?.emp_id) || 1;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "No data rows provided for bulk upload." });
    }

    // Normalize keys of each row to strip leading/trailing whitespace
    const cleanRows = rows.map((r) => {
      const clean = {};
      for (const [k, v] of Object.entries(r || {})) {
        clean[k.trim()] = typeof v === "string" ? v.trim() : v;
      }
      return clean;
    });

    const counter = await Counter.findOneAndUpdate(
      { name: "leave_bulk_upload" },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );
    const upload_id = `LBU_${String(counter.seq).padStart(3, "0")}`;

    const errorLog = [];
    let successCount = 0;
    let failedCount = 0;

    const leaveTypes = await LeaveType.find().lean();
    const typeByName = Object.fromEntries(leaveTypes.map((t) => [t.name.toLowerCase().trim(), t.leave_type_id]));
    const typeByCode = Object.fromEntries(leaveTypes.map((t) => [String(t.code || "").toLowerCase().trim(), t.leave_type_id]));

    // Auto-detect mode if not explicitly provided
    const firstRow = cleanRows[0] || {};
    const isAllocationMode =
      upload_mode === "ALLOCATION" ||
      firstRow["Target Type"] !== undefined ||
      firstRow["target_type"] !== undefined ||
      firstRow["Number of Leaves"] !== undefined ||
      firstRow["allocated_days"] !== undefined ||
      firstRow["Allocated Days"] !== undefined ||
      firstRow["Quota"] !== undefined;

    if (isAllocationMode) {
      // ─────────────────────────────────────────────────────────────
      // MODE A: BULK LEAVE ALLOCATION (EMPLOYEE OR DEPARTMENT BASED)
      // ─────────────────────────────────────────────────────────────
      const buildBalanceUpdateDoc = (allocatedDays, carriedForward) => {
        const doc = {
          $set: { allocated_days: allocatedDays },
          $setOnInsert: { used_days: 0 },
        };
        if (carriedForward > 0) {
          doc.$set.carried_forward_days = carriedForward;
        } else {
          doc.$setOnInsert.carried_forward_days = 0;
        }
        return doc;
      };

      for (let i = 0; i < cleanRows.length; i++) {
        const row = cleanRows[i];
        const rowNum = i + 1;
        try {
          const rawTargetType = String(
            row["Target Type"] || row.target_type || row.Target || ""
          ).toUpperCase().trim();

          const identifier = String(
            row["Employee ID / Dept Code"] ||
            row.identifier ||
            row.emp_id ||
            row["Employee ID"] ||
            row.dept_code ||
            row["Dept Code"] ||
            row.dept_name ||
            row["Department"] ||
            ""
          ).trim();

          const optionalEmpName = String(
            row["Employee Name (Optional)"] ||
            row["Employee Name"] ||
            row.emp_name ||
            row.name ||
            ""
          ).trim();

          if (!identifier && !optionalEmpName) {
            errorLog.push(`Row ${rowNum}: Missing Employee ID, Department Code, or Name.`);
            failedCount++;
            continue;
          }

          // Smarter Leave Type Resolution
          const rawType = String(
            row["Leave Type"] || row.leave_type || row.code || row.type || "CL"
          ).trim();

          let leaveTypeId = null;
          if (!isNaN(Number(rawType)) && Number(rawType) > 0) {
            const foundLt = leaveTypes.find((t) => t.leave_type_id === Number(rawType));
            if (foundLt) leaveTypeId = foundLt.leave_type_id;
          }
          if (!leaveTypeId) {
            const lowerRaw = rawType.toLowerCase();
            const foundLt = leaveTypes.find(
              (t) =>
                (t.code && t.code.toLowerCase() === lowerRaw) ||
                (t.name && t.name.toLowerCase() === lowerRaw)
            );
            if (foundLt) leaveTypeId = foundLt.leave_type_id;
          }
          if (!leaveTypeId) {
            const lowerRaw = rawType.toLowerCase();
            if (lowerRaw.includes("casual") || lowerRaw === "cl") {
              leaveTypeId = typeByCode["cl"] || 1;
            } else if (lowerRaw.includes("sick") || lowerRaw.includes("med") || lowerRaw === "sl") {
              leaveTypeId = typeByCode["sl"] || 2;
            } else if (lowerRaw.includes("earn") || lowerRaw.includes("priv") || lowerRaw === "el" || lowerRaw === "pl") {
              leaveTypeId = typeByCode["el"] || 3;
            } else if (lowerRaw.includes("option") || lowerRaw.includes("rest") || lowerRaw === "ol" || lowerRaw === "rh") {
              leaveTypeId = typeByCode["ol"] || 4;
            } else if (lowerRaw.includes("mat") || lowerRaw === "ml") {
              leaveTypeId = typeByCode["ml"] || 5;
            } else {
              leaveTypeId = typeByCode["cl"] || 1;
            }
          }

          const allocatedDays = Number(
            row["Number of Leaves"] ??
            row.allocated_days ??
            row["Allocated Days"] ??
            row.days ??
            row.quota ??
            0
          );

          const carriedForward = Number(
            row["Carried Forward (Optional)"] ??
            row["Carried Forward"] ??
            row.carried_forward_days ??
            row.carried_forward ??
            0
          );

          const year = Number(row.Year || row.year) || new Date().getFullYear();
          const remarks = String(
            row["Reason / Remarks"] || row.remarks || row.reason || "Bulk Leave Allocation"
          ).trim();

          // Department check
          const isDept =
            rawTargetType.includes("DEPT") ||
            rawTargetType.includes("DEPARTMENT") ||
            rawTargetType.startsWith("DEP") ||
            rawTargetType === "D";

          let department = null;
          if (identifier) {
            if (!isNaN(Number(identifier))) {
              department = await Department.findOne({ dept_id: Number(identifier) }).lean();
            }
            if (!department) {
              department = await Department.findOne({
                $or: [
                  { dept_code: { $regex: new RegExp(`^${identifier}$`, "i") } },
                  { dept_name: { $regex: new RegExp(`^${identifier}$`, "i") } },
                ],
              }).lean();
            }
          }

          if (isDept || (department && !rawTargetType)) {
            // Target is an entire Department
            if (!department) {
              errorLog.push(`Row ${rowNum}: Department '${identifier}' not found.`);
              failedCount++;
              continue;
            }

            const deptEmployees = await Employee.find({ dept_id: department.dept_id, is_active: true }).lean();
            if (deptEmployees.length === 0) {
              errorLog.push(`Row ${rowNum}: No active employees found in department '${department.dept_name}'.`);
              failedCount++;
              continue;
            }

            for (const emp of deptEmployees) {
              await LeaveBalance.findOneAndUpdate(
                { emp_id: emp.emp_id, leave_type_id: leaveTypeId, year },
                buildBalanceUpdateDoc(allocatedDays, carriedForward),
                { upsert: true, returnDocument: "after" }
              );

              await LeaveAdjustment.create({
                emp_id: emp.emp_id,
                leave_type_id: leaveTypeId,
                year,
                target_field: "ALLOCATED_DAYS",
                adjustment_type: "CREDIT",
                days: allocatedDays,
                reason: `Bulk Dept Allocation: ${remarks} (${department.dept_name})`,
                adjusted_by_emp_id: hrEmpId,
              });
            }

            successCount++;
          } else {
            // Target is an Individual Employee
            let employee = null;
            const searchId = identifier || optionalEmpName;

            if (!isNaN(Number(searchId))) {
              employee = await Employee.findOne({ emp_id: Number(searchId) }).lean();
            }
            if (!employee && searchId.includes("@")) {
              employee = await Employee.findOne({ email: searchId.toLowerCase() }).lean();
            }
            if (!employee) {
              employee = await Employee.findOne({
                emp_name: { $regex: new RegExp(`^${searchId}$`, "i") },
              }).lean();
            }
            if (!employee && optionalEmpName && optionalEmpName !== searchId) {
              employee = await Employee.findOne({
                emp_name: { $regex: new RegExp(`^${optionalEmpName}$`, "i") },
              }).lean();
            }

            // Fallback: If identifier matched department but wasn't caught
            if (!employee && department) {
              const deptEmployees = await Employee.find({ dept_id: department.dept_id, is_active: true }).lean();
              for (const emp of deptEmployees) {
                await LeaveBalance.findOneAndUpdate(
                  { emp_id: emp.emp_id, leave_type_id: leaveTypeId, year },
                  buildBalanceUpdateDoc(allocatedDays, carriedForward),
                  { upsert: true, returnDocument: "after" }
                );

                await LeaveAdjustment.create({
                  emp_id: emp.emp_id,
                  leave_type_id: leaveTypeId,
                  year,
                  target_field: "ALLOCATED_DAYS",
                  adjustment_type: "CREDIT",
                  days: allocatedDays,
                  reason: `Bulk Dept Allocation: ${remarks} (${department.dept_name})`,
                  adjusted_by_emp_id: hrEmpId,
                });
              }
              successCount++;
              continue;
            }

            if (!employee) {
              errorLog.push(`Row ${rowNum}: Employee '${identifier || optionalEmpName}' not found.`);
              failedCount++;
              continue;
            }

            await LeaveBalance.findOneAndUpdate(
              { emp_id: employee.emp_id, leave_type_id: leaveTypeId, year },
              buildBalanceUpdateDoc(allocatedDays, carriedForward),
              { upsert: true, returnDocument: "after" }
            );

            await LeaveAdjustment.create({
              emp_id: employee.emp_id,
              leave_type_id: leaveTypeId,
              year,
              target_field: "ALLOCATED_DAYS",
              adjustment_type: "CREDIT",
              days: allocatedDays,
              reason: `Bulk Emp Allocation: ${remarks}`,
              adjusted_by_emp_id: hrEmpId,
            });

            successCount++;
          }
        } catch (err) {
          errorLog.push(`Row ${rowNum}: ${err.message}`);
          failedCount++;
        }
      }
    } else {
      // ─────────────────────────────────────────────────────────────
      // MODE B: BULK LEAVE APPLICATION / ATTENDANCE RECORDS
      // ─────────────────────────────────────────────────────────────
      for (let i = 0; i < cleanRows.length; i++) {
        const row = cleanRows[i];
        const rowNum = i + 1;
        try {
          const empId = Number(row.emp_id || row["Employee ID"]);
          if (!empId) {
            errorLog.push(`Row ${rowNum}: Missing or invalid Employee ID.`);
            failedCount++;
            continue;
          }

          const employee = await Employee.findOne({ emp_id: empId }).lean();
          if (!employee) {
            errorLog.push(`Row ${rowNum}: Employee ID ${empId} does not exist in system.`);
            failedCount++;
            continue;
          }

          const rawType = String(row.leave_type || row["Leave Type"] || row.code || "").toLowerCase().trim();
          const leaveTypeId = typeByName[rawType] || typeByCode[rawType] || Number(row.leave_type_id) || 1;

          const fromDateStr = row.from_date || row["From Date"] || row.fromDate;
          const toDateStr = row.to_date || row["To Date"] || row.toDate || fromDateStr;
          const reason = row.reason || row["Reason"] || "Bulk uploaded leave record";

          if (!fromDateStr) {
            errorLog.push(`Row ${rowNum}: Missing From Date.`);
            failedCount++;
            continue;
          }

          const calculation = await calculateLeaveDays(fromDateStr, toDateStr, "FULL_DAY", employee.school_id || 0);
          const no_of_days = calculation.no_of_days || 1;

          const deptId = Number(employee.dept_id) || 1;
          const department = await Department.findOne({ dept_id: deptId }).lean();
          const deptCode = department?.dept_code || generateDeptCode(department?.dept_name);

          const rowCounter = await Counter.findOneAndUpdate(
            { name: `leave_id_${deptCode}` },
            { $inc: { seq: 1 } },
            { returnDocument: "after", upsert: true }
          );
          const leave_id = `LV_${deptCode}_${String(rowCounter.seq).padStart(3, "0")}`;

          await LeaveRequest.create({
            leave_id,
            emp_id: empId,
            dept_id: deptId,
            leave_type_id: leaveTypeId,
            from_date: new Date(fromDateStr),
            to_date: new Date(toDateStr),
            duration_type: "FULL_DAY",
            no_of_days,
            reason,
            status: "APPROVED",
            lifecycle_status: "CLOSED",
            created_by_emp_id: hrEmpId,
          });

          const year = new Date(fromDateStr).getFullYear();
          await LeaveBalance.findOneAndUpdate(
            { emp_id: empId, leave_type_id: leaveTypeId, year },
            {
              $inc: { used_days: no_of_days },
              $setOnInsert: { allocated_days: 12, carried_forward_days: 0 },
            },
            { upsert: true, returnDocument: "after" }
          );

          await LeaveFlow.create({
            leave_id,
            from_emp_id: hrEmpId,
            from_emp_name: "Bulk Upload HR",
            to_emp_id: empId,
            to_emp_name: employee.emp_name,
            action: "CREATED",
            remark: [`Bulk Upload: ${reason}`],
            final_status: "APPROVED",
          });

          successCount++;
        } catch (err) {
          errorLog.push(`Row ${rowNum}: ${err.message}`);
          failedCount++;
        }
      }
    }

    const uploadRecord = await LeaveBulkUpload.create({
      upload_id,
      uploaded_by_emp_id: hrEmpId,
      file_name,
      total_rows: cleanRows.length,
      success_count: successCount,
      failed_count: failedCount,
      status: failedCount === cleanRows.length ? "FAILED" : "COMPLETED",
      error_log: errorLog,
    });

    // Real-time broadcast to all connected clients that leave balances/records have been updated
    try {
      const io = req.app?.get?.("io");
      if (io) {
        io.emit("data:updated", {
          entity: "leave",
          action: "BALANCE_UPDATED",
          upload_id,
          success_count: successCount,
        });
      }
    } catch (socketErr) {
      console.warn("Socket broadcast error in hrBulkUpload:", socketErr);
    }

    return res.status(200).json({
      success: true,
      message:
        failedCount === 0
          ? `Bulk processing completed successfully! All ${successCount} entries processed.`
          : `Bulk processing completed with ${successCount} successful operations and ${failedCount} issues. Check log below.`,
      data: uploadRecord,
    });
  } catch (error) {
    console.error("hrBulkUpload error:", error);
    return res.status(500).json({ success: false, message: "Failed to process bulk upload." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 16. GET APPROVER PROCESSED LEAVES HISTORY
//     GET /api/leave/approver/history
// ─────────────────────────────────────────────────────────────────────────────
export const getApproverHistory = async (req, res) => {
  try {
    const approverEmpId = Number(req.user?.emp_id);
    const activeRoleId = Number(
      req.headers["x-active-role-id"] ||
      req.query.active_role_id ||
      req.user?.active_role_id
    ) || null;

    // Find all flow records where this approver took an action under the active role
    const flowQuery = {
      action: { $in: ["APPROVED", "REJECTED"] },
    };

    if (activeRoleId) {
      flowQuery.from_role_id = activeRoleId;
    } else {
      flowQuery.from_emp_id = approverEmpId;
      flowQuery.from_role_id = null;
    }

    const flows = await LeaveFlow.find(flowQuery).sort({ createdAt: -1 }).lean();

    if (!flows.length) {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }

    const leaveIds = [...new Set(flows.map((f) => f.leave_id))];
    const leaves = await LeaveRequest.find({ leave_id: { $in: leaveIds } }).lean();
    const leaveMap = Object.fromEntries(leaves.map((l) => [l.leave_id, l]));

    // Fetch related metadata
    const empIds = [...new Set(leaves.map((l) => l.emp_id))];
    const typeIds = [...new Set(leaves.map((l) => l.leave_type_id))];
    const deptIds = [...new Set(leaves.map((l) => l.dept_id))];
    const currentHolderEmpIds = [...new Set(leaves.map((l) => l.current_holder_emp_id).filter(Boolean))];
    const forwardRoleIds = [...new Set(leaves.map((l) => l.forward_to_role_id).filter(Boolean))];

    const [leaveTypes, employees, departments, holderEmps, forwardRoles] = await Promise.all([
      LeaveType.find({ leave_type_id: { $in: typeIds } }).lean(),
      Employee.find({ emp_id: { $in: empIds } }, "emp_id emp_name designation email dept_id").lean(),
      Department.find({ dept_id: { $in: deptIds } }, "dept_id dept_name dept_code").lean(),
      Employee.find({ emp_id: { $in: currentHolderEmpIds } }, "emp_id emp_name designation").lean(),
      Role.find({ role_id: { $in: forwardRoleIds } }, "role_id role_name").lean(),
    ]);

    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const holderMap = Object.fromEntries(holderEmps.map((e) => [e.emp_id, e]));
    const roleMap = Object.fromEntries(forwardRoles.map((r) => [r.role_id, r]));

    // Map each flow action
    const processedHistory = flows.map((f) => {
      const leave = leaveMap[f.leave_id] || {};
      const applicant = empMap[leave.emp_id] || {};
      const holder = holderMap[leave.current_holder_emp_id];
      const role = roleMap[leave.forward_to_role_id];
      const pendingWith = leave.status === "PENDING"
        ? (role ? `${role.role_name}${holder ? ` (${holder.emp_name})` : ""}` : (holder?.emp_name || "Next Authority"))
        : null;

      return {
        flow_id: f._id,
        leave_id: f.leave_id,
        emp_id: leave.emp_id,
        applicant_name: applicant.emp_name || `Emp ${leave.emp_id}`,
        applicant_designation: applicant.designation || "",
        department_name: deptMap[leave.dept_id] || "General",
        leave_type_name: typeMap[leave.leave_type_id]?.name || "Leave",
        leave_type_code: typeMap[leave.leave_type_id]?.code || "LV",
        from_date: leave.from_date,
        to_date: leave.to_date,
        no_of_days: leave.no_of_days,
        reason: leave.reason,
        my_action: f.action,
        my_remark: Array.isArray(f.remark) ? f.remark[f.remark.length - 1] : f.remark,
        action_date: f.createdAt,
        current_status: leave.status || f.final_status,
        pending_with: pendingWith,
        forwarded_to_role: f.to_role_name || null,
        forwarded_to_emp: f.to_emp_name || null,
      };
    });

    return res.status(200).json({
      success: true,
      data: processedHistory,
      count: processedHistory.length,
    });
  } catch (error) {
    console.error("getApproverHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch approver history." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 17. RESOLVE APPROVAL CHAIN (Dynamic Workflow Engine using Existing Roles)
// ─────────────────────────────────────────────────────────────────────────────
export const resolveApprovalChainForApplicant = async (applicant) => {
  const empId = Number(applicant.emp_id);
  const deptId = Number(applicant.dept_id);
  
  // If applicant has assigned roles, they strictly submit in their official role capacity.
  // If applicant has no roles, applicantRoleId is null and they route via Employee/Faculty workflow.
  const hasAssignedRoles = applicant.role_ids && applicant.role_ids.length > 0;
  let applicantRoleId = null;
  if (hasAssignedRoles) {
    applicantRoleId = (applicant.active_role_id && applicant.role_ids.includes(Number(applicant.active_role_id)))
      ? Number(applicant.active_role_id)
      : Number(applicant.role_ids[0]);
  }

  // 1. Check for matching dynamic LeaveWorkflow:
  let matchedWorkflow = null;
  if (applicantRoleId) {
    matchedWorkflow = await LeaveWorkflow.findOne({
      is_active: true,
      applies_to_type: "SPECIFIC_ROLE",
      target_role_id: Number(applicantRoleId),
    }).lean();
  }

  if (!matchedWorkflow && deptId) {
    matchedWorkflow = await LeaveWorkflow.findOne({
      is_active: true,
      applies_to_type: "DEPARTMENT",
      dept_id: deptId,
    }).lean();
  }

  if (!matchedWorkflow) {
    matchedWorkflow = await LeaveWorkflow.findOne({
      is_active: true,
      applies_to_type: "ALL_FACULTY",
    }).lean();
  }

  // 2. If dynamic workflow steps exist, resolve each step using existing Roles
  if (matchedWorkflow?.steps?.length > 0) {
    const chain = [];
    const allRoles = await Role.find().lean();
    const allPowers = await Power.find().lean();
    const roleMap = Object.fromEntries(allRoles.map((r) => [r.role_id, r]));
    const powerMap = Object.fromEntries(allPowers.map((p) => [p.power_id, p]));

    for (let i = 0; i < matchedWorkflow.steps.length; i++) {
      const step = matchedWorkflow.steps[i];
      const targetRole = roleMap[step.role_id];
      const targetPower = targetRole ? powerMap[targetRole.power_id] : null;

      // Find employee assigned to this role in applicant's department first, then global
      let approverEmp = null;
      if (step.specific_emp_id) {
        approverEmp = await Employee.findOne({ emp_id: step.specific_emp_id, is_active: true }).lean();
      }

      if (!approverEmp) {
        approverEmp = await Employee.findOne({
          $or: [{ role_ids: { $in: [step.role_id] } }, { active_role_id: step.role_id }],
          dept_id: deptId,
          is_active: true,
        }).lean();
      }

      if (!approverEmp) {
        approverEmp = await Employee.findOne({
          $or: [{ role_ids: { $in: [step.role_id] } }, { active_role_id: step.role_id }],
          is_active: true,
        }).lean();
      }

      // Do not route to self if applicant is submitting in this role capacity
      if (applicantRoleId && Number(applicantRoleId) === Number(step.role_id)) {
        continue;
      }

      const approverDept = approverEmp?.dept_id
        ? await Department.findOne({ dept_id: approverEmp.dept_id }).lean()
        : null;

      chain.push({
        step: chain.length + 1,
        label: step.step_label || (i === matchedWorkflow.steps.length - 1 ? "Final Approval Authority" : ("Authority Level " + (chain.length + 1))),
        role_id: step.role_id,
        role_name: targetRole?.role_name || ("Role " + step.role_id),
        role_level: targetPower?.power_level || (i + 1),
        emp_id: approverEmp?.emp_id || null,
        emp_name: approverEmp?.emp_name || targetRole?.role_name || "Assigned Authority",
        emp_designation: approverEmp?.designation || "",
        dept_id: approverDept?.dept_id || deptId,
        dept_name: approverDept?.dept_name || "Department",
        is_final_step: step.is_final_step || (i === matchedWorkflow.steps.length - 1),
      });
    }

    if (chain.length > 0) {
      return chain;
    }
  }

  // Fallback: Legacy power-based chain
  let applicantPowerLevel = 0;
  if (applicantRoleId) {
    const myRole = await Role.findOne({ role_id: applicantRoleId }).lean();
    if (myRole?.power_id) {
      const myPower = await Power.findOne({ power_id: myRole.power_id }).lean();
      applicantPowerLevel = myPower?.power_level || 0;
    }
  }

  const allEligibleRoles = await Role.find({
    canReceiveLeaveRequest: true,
  }).lean();

  const powerIds = [...new Set(allEligibleRoles.map((r) => r.power_id).filter(Boolean))];
  const powers = await Power.find({
    power_id: { $in: powerIds },
  }).lean();

  const powerMap = Object.fromEntries(powers.map((p) => [p.power_id, p]));

  const isVCRole = (rName = "") => {
    const n = (rName || "").toLowerCase();
    return n === "vc" || n.includes("vice chancellor") || n.includes("vice_chancellor");
  };

  const eligibleRoles = allEligibleRoles
    .map((r) => ({ role: r, power: powerMap[r.power_id] }))
    .filter((item) => {
      if (!item.power) return false;
      if (applicantPowerLevel > 0 && item.power.power_level <= applicantPowerLevel) return false;
      // Normal employee / faculty (applicantPowerLevel < 3): Hierarchy terminates at Dean (power_level <= 3).
      // VC (power_level > 3 or VC role) is excluded so Dean is the final authority.
      if (applicantPowerLevel < 3 && (item.power.power_level > 3 || isVCRole(item.role.role_name))) return false;
      const depts = item.role.dept_ids || [];
      return depts.includes(deptId) || depts.length === 0;
    })
    .sort((a, b) => a.power.power_level - b.power.power_level);

  const levelMap = new Map();
  for (const item of eligibleRoles) {
    const lvl = item.power.power_level;
    if (!levelMap.has(lvl)) {
      levelMap.set(lvl, item);
    } else {
      const existing = levelMap.get(lvl);
      const existingHasDept = existing.role.dept_ids?.includes(deptId);
      const currentHasDept = item.role.dept_ids?.includes(deptId);
      if (!existingHasDept && currentHasDept) {
        levelMap.set(lvl, item);
      }
    }
  }

  const sortedLevels = Array.from(levelMap.values()).sort(
    (a, b) => a.power.power_level - b.power.power_level
  );

  const rawChain = [];
  for (const item of sortedLevels) {
    const roleId = Number(item.role.role_id);
    // Don't include applicant's OWN active role as approver of their own leave
    if (applicant.active_role_id && Number(applicant.active_role_id) === roleId) {
      continue;
    }

    let approverEmp = await Employee.findOne({
      role_ids: { $in: [roleId] },
      dept_id: deptId,
      is_active: true,
    }).lean();

    if (!approverEmp) {
      approverEmp = await Employee.findOne({
        $or: [{ role_ids: { $in: [roleId] } }, { active_role_id: roleId }],
        is_active: true,
      }).lean();
    }

    const approverDept = approverEmp?.dept_id
      ? await Department.findOne({ dept_id: approverEmp.dept_id }).lean()
      : null;

    rawChain.push({
      power_name: item.power.power_name,
      power_level: item.power.power_level,
      role_id: roleId,
      role_name: item.role.role_name,
      emp_id: approverEmp?.emp_id || null,
      emp_name: approverEmp?.emp_name || "Assigned Authority",
      emp_designation: approverEmp?.designation || "",
      dept_id: approverDept?.dept_id || deptId,
      dept_name: approverDept?.dept_name || "Department",
    });
  }

  const chain = rawChain.map((step, idx) => {
    const isFinal = idx === rawChain.length - 1;
    return {
      ...step,
      step: idx + 1,
      label: isFinal
        ? "Final Authority"
        : idx === 0
        ? "First Authority"
        : idx === 1
        ? "Second Authority"
        : `Authority Level ${idx + 1}`,
      is_final_step: isFinal,
    };
  });

  return chain;
};

// 18. GET APPROVAL CHAIN ENDPOINT
//     GET /api/leave/approval-chain
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveApprovalChain = async (req, res) => {
  try {
    const empId = Number(req.user?.emp_id);
    const applicant = await Employee.findOne({ emp_id: empId }).lean();
    if (!applicant) {
      return res.status(404).json({ success: false, message: "Applicant employee record not found." });
    }

    const headerRoleId = Number(req.headers["x-active-role-id"] || req.query.active_role_id);
    const hasAssignedRoles = applicant.role_ids && applicant.role_ids.length > 0;
    const applicantRoleId = hasAssignedRoles
      ? ((headerRoleId && applicant.role_ids.includes(headerRoleId))
          ? headerRoleId
          : ((applicant.active_role_id && applicant.role_ids.includes(Number(applicant.active_role_id)))
              ? Number(applicant.active_role_id)
              : Number(applicant.role_ids[0])))
      : null;

    const applicantRole = applicantRoleId ? await Role.findOne({ role_id: applicantRoleId }).lean() : null;
    const chain = await resolveApprovalChainForApplicant({
      ...applicant,
      active_role_id: applicantRoleId,
    });

    return res.status(200).json({
      success: true,
      data: chain,
      applicant: {
        emp_id: applicant.emp_id,
        emp_name: applicant.emp_name,
        dept_id: applicant.dept_id,
        role_id: applicantRoleId,
        role_name: applicantRole?.role_name || null,
        is_role_applicant: Boolean(applicantRoleId),
      },
    });
  } catch (error) {
    console.error("getLeaveApprovalChain error:", error);
    return res.status(500).json({ success: false, message: "Failed to resolve leave approval chain." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 19. HR LEAVE TYPE & POLICY MANAGEMENT (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/leave/hr/types
 * Get all leave types (active and inactive) with usage analytics
 */
export const getAllLeaveTypesAdmin = async (req, res) => {
  try {
    await seedInitialLeaveTypes();
    const types = await LeaveType.find().sort({ leave_type_id: 1 }).lean();

    const leaveCounts = await LeaveRequest.aggregate([
      { $group: { _id: "$leave_type_id", count: { $sum: 1 } } },
    ]);
    const countMap = new Map();
    leaveCounts.forEach((c) => countMap.set(c._id, c.count));

    const enriched = types.map((t) => ({
      ...t,
      usage_count: countMap.get(t.leave_type_id) || 0,
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error("getAllLeaveTypesAdmin error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave types" });
  }
};

/**
 * POST /api/leave/hr/types
 * Create a new Leave Type
 */
export const createLeaveType = async (req, res) => {
  try {
    const {
      name,
      code,
      annual_quota,
      carry_forward_allowed,
      max_carry_forward_days,
      allows_half_day,
      description,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Leave type name is required." });
    }

    const trimmedName = name.trim();
    const rawCode = code && code.trim()
      ? code.trim().toUpperCase()
      : trimmedName.split(" ").map((w) => w[0]).join("").toUpperCase().substring(0, 5);

    const existing = await LeaveType.findOne({
      $or: [
        { code: rawCode },
        { name: { $regex: new RegExp(`^${trimmedName}$`, "i") } },
      ],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Leave type with code '${rawCode}' or name '${trimmedName}' already exists.`,
      });
    }

    const lastType = await LeaveType.findOne().sort({ leave_type_id: -1 }).lean();
    const nextId = (lastType?.leave_type_id || 0) + 1;

    const quota = Math.max(0, Number(annual_quota) || 0);
    const isCarry = Boolean(carry_forward_allowed);
    const maxCarry = isCarry ? Math.max(0, Number(max_carry_forward_days) || 0) : 0;
    const canHalf = Boolean(allows_half_day);

    const newType = await LeaveType.create({
      leave_type_id: nextId,
      name: trimmedName,
      code: rawCode,
      annual_quota: quota,
      carry_forward_allowed: isCarry,
      max_carry_forward_days: maxCarry,
      allows_half_day: canHalf,
      description: (description || "").trim(),
      is_active: true,
    });

    return res.status(201).json({
      success: true,
      message: `Leave type '${trimmedName}' (${rawCode}) created successfully.`,
      data: newType,
    });
  } catch (error) {
    console.error("createLeaveType error:", error);
    return res.status(500).json({ success: false, message: "Failed to create leave type." });
  }
};

/**
 * PUT /api/leave/hr/types/:id
 * Update an existing Leave Type
 */
export const updateLeaveType = async (req, res) => {
  try {
    const leaveTypeId = Number(req.params.id);
    const {
      name,
      code,
      annual_quota,
      carry_forward_allowed,
      max_carry_forward_days,
      allows_half_day,
      description,
      is_active,
    } = req.body;

    const existing = await LeaveType.findOne({ leave_type_id: leaveTypeId });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Leave type not found." });
    }

    if (name && name.trim()) {
      existing.name = name.trim();
    }
    if (code && code.trim()) {
      const newCode = code.trim().toUpperCase();
      const conflict = await LeaveType.findOne({
        code: newCode,
        leave_type_id: { $ne: leaveTypeId },
      });
      if (conflict) {
        return res.status(400).json({ success: false, message: `Code '${newCode}' is already taken.` });
      }
      existing.code = newCode;
    }
    if (annual_quota !== undefined) {
      existing.annual_quota = Math.max(0, Number(annual_quota) || 0);
    }
    if (carry_forward_allowed !== undefined) {
      existing.carry_forward_allowed = Boolean(carry_forward_allowed);
    }
    if (max_carry_forward_days !== undefined) {
      existing.max_carry_forward_days = existing.carry_forward_allowed
        ? Math.max(0, Number(max_carry_forward_days) || 0)
        : 0;
    }
    if (allows_half_day !== undefined) {
      existing.allows_half_day = Boolean(allows_half_day);
    }
    if (description !== undefined) {
      existing.description = description.trim();
    }
    if (is_active !== undefined) {
      existing.is_active = Boolean(is_active);
    }

    await existing.save();

    return res.status(200).json({
      success: true,
      message: `Leave type '${existing.name}' updated successfully.`,
      data: existing,
    });
  } catch (error) {
    console.error("updateLeaveType error:", error);
    return res.status(500).json({ success: false, message: "Failed to update leave type." });
  }
};

/**
 * PATCH /api/leave/hr/types/:id/toggle
 * Toggle active status of a Leave Type
 */
export const toggleLeaveTypeStatus = async (req, res) => {
  try {
    const leaveTypeId = Number(req.params.id);
    const existing = await LeaveType.findOne({ leave_type_id: leaveTypeId });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Leave type not found." });
    }

    existing.is_active = !existing.is_active;
    await existing.save();

    return res.status(200).json({
      success: true,
      message: `Leave type '${existing.name}' is now ${existing.is_active ? "Active" : "Inactive"}.`,
      data: existing,
    });
  } catch (error) {
    console.error("toggleLeaveTypeStatus error:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle status." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 19. TEMPORARY ROLE ASSIGNMENT & CHARGE HANDOVER (ADMIN ENGINE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Background / on-demand helper to automatically synchronize temporary role lifecycles:
 * 1. Activates SCHEDULED roles whose start_date has arrived.
 * 2. Expires ACTIVE roles whose end_date has passed, cleanly restoring charge to original authority.
 */
export const syncTemporaryRoleLifecycle = async (io) => {
  try {
    const now = new Date();

    // 1. ACTIVATE SCHEDULED ASSIGNMENTS (start_date <= now <= end_date)
    const scheduledToActivate = await LeaveTemporaryRole.find({
      status: "SCHEDULED",
      start_date: { $lte: now },
      end_date: { $gte: now },
    });

    for (const item of scheduledToActivate) {
      if (item.interim_emp_id && item.role_id) {
        const roleIdNum = Number(item.role_id);
        const interimEmpId = Number(item.interim_emp_id);

        await Employee.updateOne(
          { emp_id: interimEmpId },
          {
            $addToSet: {
              role_ids: roleIdNum,
              temporary_role_ids: roleIdNum,
            },
          }
        );

        item.status = "ACTIVE";
        await item.save();

        if (io) {
          sendNotification(io, {
            emp_id: interimEmpId,
            type: "INFO",
            reference_id: item.leave_id,
            reference_type: "Leave",
            title: "Temporary Role Charge Now Active",
            message: `Your scheduled temporary charge of ${item.role_name} is now ACTIVE as of today until ${new Date(item.end_date).toLocaleDateString("en-IN")}.`,
          }).catch(() => {});
        }

        const interimEmp = await Employee.findOne({ emp_id: interimEmpId }).lean();
        if (interimEmp?.email) {
          sendMail({
            to: interimEmp.email,
            name: interimEmp.emp_name,
            subject: `Temporary Role Charge Now Active: ${item.role_name}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
                <h2 style="color: #16a34a; margin-top: 0;">Temporary Role Charge Now Active</h2>
                <p>Dear <strong>${interimEmp.emp_name}</strong>,</p>
                <p>Your scheduled temporary charge as <strong>In-Charge ${item.role_name}</strong> has commenced today.</p>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 15px; margin: 16px 0;">
                  <p style="margin: 4px 0;"><strong>Role Capacity:</strong> ${item.role_name}</p>
                  <p style="margin: 4px 0;"><strong>Original Authority:</strong> ${item.original_emp_name}</p>
                  <p style="margin: 4px 0;"><strong>Duration:</strong> Active today until ${new Date(item.end_date).toLocaleDateString("en-IN")}</p>
                  <p style="margin: 4px 0;"><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">ACTIVE</span></p>
                </div>
                <p style="font-size: 13px; color: #475569;">You now have administrative access to review and sanction departmental leaves and notesheets.</p>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">IQPaths HRMS & Leave Management System</p>
              </div>
            `,
          }).catch(() => {});
        }
      }
    }

    // 2. EXPIRE ACTIVE ASSIGNMENTS (end_date < now)
    const activeAssignments = await LeaveTemporaryRole.find({
      status: "ACTIVE",
      end_date: { $lt: now },
    });

    for (const item of activeAssignments) {
      if (item.role_id) {
        const roleIdNum = Number(item.role_id);
        if (item.interim_emp_id) {
          const interimEmpId = Number(item.interim_emp_id);
          await Employee.updateOne(
            { emp_id: interimEmpId },
            {
              $pull: {
                role_ids: roleIdNum,
                temporary_role_ids: roleIdNum,
              },
            }
          );
          const interim = await Employee.findOne({ emp_id: interimEmpId });
          if (interim && Number(interim.active_role_id) === roleIdNum) {
            interim.active_role_id = interim.role_ids?.[0] || null;
            await interim.save();
          }
        }

        // Safety sweep: ensure role is removed from any temporary assignee
        await Employee.updateMany(
          { temporary_role_ids: roleIdNum },
          {
            $pull: {
              role_ids: roleIdNum,
              temporary_role_ids: roleIdNum,
            },
          }
        );
      }

      if (item.original_emp_id && item.role_id) {
        await Employee.findOneAndUpdate(
          { emp_id: item.original_emp_id },
          { $addToSet: { role_ids: item.role_id } }
        );
      }

      item.status = "EXPIRED_AND_RESTORED";
      await item.save();

      if (io) {
        if (item.interim_emp_id) {
          sendNotification(io, {
            emp_id: item.interim_emp_id,
            type: "INFO",
            reference_id: item.leave_id,
            reference_type: "Leave",
            title: "Temporary Role Charge Concluded",
            message: `Your temporary charge of ${item.role_name} has concluded as the leave period has ended.`,
          }).catch(() => {});
        }
        if (item.original_emp_id) {
          sendNotification(io, {
            emp_id: item.original_emp_id,
            type: "INFO",
            reference_id: item.leave_id,
            reference_type: "Leave",
            title: "Role Charge Restored",
            message: `Your approved leave period has ended. The temporary charge of ${item.role_name} has concluded and your role is fully restored.`,
          }).catch(() => {});
        }
      }

      if (item.interim_emp_id) {
        const interimEmp = await Employee.findOne({ emp_id: item.interim_emp_id }).lean();
        if (interimEmp?.email) {
          sendMail({
            to: interimEmp.email,
            name: interimEmp.emp_name,
            subject: `Temporary Role Charge Concluded: ${item.role_name}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
                <h2 style="color: #475569; margin-top: 0;">Temporary Role Charge Concluded</h2>
                <p>Dear <strong>${interimEmp.emp_name}</strong>,</p>
                <p>The leave period for <strong>${item.original_emp_name}</strong> has concluded. Your temporary charge of <strong>${item.role_name}</strong> has ended and been restored to the authority.</p>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">IQPaths HRMS & Leave Management System</p>
              </div>
            `,
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("syncTemporaryRoleLifecycle error:", err);
  }
};

export const checkAndExpireTemporaryRoles = syncTemporaryRoleLifecycle;

/**
 * GET /api/leave/admin/temporary-roles
 * Fetch all temporary role delegation records and candidate colleagues for admin
 */
export const getAdminTemporaryRoleRequests = async (req, res) => {
  try {
    await checkAndExpireTemporaryRoles(req.app?.get("io"));

    const records = await LeaveTemporaryRole.find()
      .sort({ createdAt: -1 })
      .lean();

    const employees = await Employee.find({ is_active: true })
      .select("emp_id emp_name designation email dept_id school_id role_ids")
      .sort({ emp_name: 1 })
      .lean();

    const departments = await Department.find().lean();
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));

    const enriched = records.map((r) => {
      const origEmp = employees.find((e) => e.emp_id === r.original_emp_id);
      return {
        ...r,
        department_name: origEmp ? (deptMap[origEmp.dept_id] || "General") : "Department",
        orig_dept_id: origEmp?.dept_id || null,
      };
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      eligible_employees: employees,
    });
  } catch (error) {
    console.error("getAdminTemporaryRoleRequests error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch temporary role requests." });
  }
};

/**
 * POST /api/leave/admin/assign-temporary-role
 * Admin assigns temporary charge of an authority role to an interim faculty member
 */
export const assignTemporaryRole = async (req, res) => {
  try {
    const { leave_id, interim_emp_id, office_order_no, admin_notes, start_date, end_date } = req.body;
    const adminId = Number(req.user?.admin_id || req.user?.emp_id);
    const adminName = req.user?.admin_name || req.user?.emp_name || "System Administrator";

    if (!leave_id || !interim_emp_id) {
      return res.status(400).json({ success: false, message: "Leave ID and Interim Employee ID are required." });
    }

    const tempRecord = await LeaveTemporaryRole.findOne({ leave_id });
    if (!tempRecord) {
      return res.status(404).json({ success: false, message: "Temporary role request not found for this leave." });
    }

    const interimEmp = await Employee.findOne({ emp_id: Number(interim_emp_id), is_active: true });
    if (!interimEmp) {
      return res.status(404).json({ success: false, message: "Selected colleague not found or inactive." });
    }

    const roleId = Number(tempRecord.role_id);
    const role = await Role.findOne({ role_id: roleId }).lean();
    if (!role) {
      return res.status(404).json({ success: false, message: "Target role not found in system." });
    }

    // Assign role to interim employee (marked as temporary role for Leave module only)
    interimEmp.temporary_role_ids = interimEmp.temporary_role_ids || [];
    if (!interimEmp.temporary_role_ids.includes(roleId)) {
      interimEmp.temporary_role_ids.push(roleId);
    }
    if (!interimEmp.role_ids?.includes(roleId)) {
      interimEmp.role_ids = interimEmp.role_ids || [];
      interimEmp.role_ids.push(roleId);
    }
    await interimEmp.save();

    tempRecord.interim_emp_id = interimEmp.emp_id;
    tempRecord.interim_emp_name = interimEmp.emp_name;
    tempRecord.interim_designation = interimEmp.designation || "Faculty";
    tempRecord.status = "ACTIVE";
    tempRecord.assigned_by_admin_id = adminId;
    tempRecord.assigned_by_name = adminName;
    tempRecord.assigned_at = new Date();
    if (office_order_no) tempRecord.office_order_no = office_order_no.trim();
    if (admin_notes) tempRecord.admin_notes = admin_notes.trim();
    if (start_date) tempRecord.start_date = new Date(start_date);
    if (end_date) tempRecord.end_date = new Date(end_date);
    await tempRecord.save();

    // Dispatch Notifications
    if (req.app?.get("io")) {
      const io = req.app.get("io");

      sendNotification(io, {
        emp_id: interimEmp.emp_id,
        role_id: roleId,
        type: "INFO",
        reference_id: leave_id,
        reference_type: "Leave",
        title: `Temporary Charge Assigned: ${role.role_name}`,
        message: `You have been assigned temporary charge of ${role.role_name} by Administrator during ${tempRecord.original_emp_name}'s absence until ${new Date(tempRecord.end_date).toLocaleDateString("en-IN")}.`,
      }).catch(() => {});

      sendNotification(io, {
        emp_id: tempRecord.original_emp_id,
        role_id: roleId,
        type: "INFO",
        reference_id: leave_id,
        reference_type: "Leave",
        title: "Temporary Role Charge Handover Assigned",
        message: `Temporary charge of your role (${role.role_name}) has been officially assigned to ${interimEmp.emp_name} for your leave period.`,
      }).catch(() => {});

      io.emit("data:updated", { entity: "temporary_role", leave_id });
    }

    return res.status(200).json({
      success: true,
      message: `Temporary charge of ${role.role_name} officially assigned to ${interimEmp.emp_name}.`,
      data: tempRecord,
    });
  } catch (error) {
    console.error("assignTemporaryRole error:", error);
    return res.status(500).json({ success: false, message: "Failed to assign temporary role." });
  }
};

/**
 * POST /api/leave/admin/revoke-temporary-role
 * Admin manually revokes temporary role charge before expiry
 */
export const revokeTemporaryRole = async (req, res) => {
  try {
    const { leave_id, reason = "Revoked by Administrator" } = req.body;

    const tempRecord = await LeaveTemporaryRole.findOne({ leave_id });
    if (!tempRecord) {
      return res.status(404).json({ success: false, message: "Temporary role record not found." });
    }

    if (tempRecord.role_id) {
      const roleIdNum = Number(tempRecord.role_id);
      if (tempRecord.interim_emp_id) {
        const interimEmpId = Number(tempRecord.interim_emp_id);
        await Employee.updateOne(
          { emp_id: interimEmpId },
          {
            $pull: {
              role_ids: roleIdNum,
              temporary_role_ids: roleIdNum,
            },
          }
        );
        const interim = await Employee.findOne({ emp_id: interimEmpId });
        if (interim && Number(interim.active_role_id) === roleIdNum) {
          interim.active_role_id = interim.role_ids?.[0] || null;
          await interim.save();
        }
      }

      // Safety sweep: ensure role is removed from any temporary assignee
      await Employee.updateMany(
        { temporary_role_ids: roleIdNum },
        {
          $pull: {
            role_ids: roleIdNum,
            temporary_role_ids: roleIdNum,
          },
        }
      );
    }

    await Employee.findOneAndUpdate(
      { emp_id: tempRecord.original_emp_id },
      { $addToSet: { role_ids: tempRecord.role_id } }
    );

    tempRecord.status = "REVOKED_BY_ADMIN";
    tempRecord.revoked_at = new Date();
    tempRecord.revoked_reason = reason;
    await tempRecord.save();

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "temporary_role", leave_id });
      req.app.get("io").emit("data:updated", { entity: "role_updated", emp_id: tempRecord.interim_emp_id });
    }

    return res.status(200).json({
      success: true,
      message: "Temporary role charge revoked successfully.",
      data: tempRecord,
    });
  } catch (error) {
    console.error("revokeTemporaryRole error:", error);
    return res.status(500).json({ success: false, message: "Failed to revoke temporary role." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 20. EARLY DUTY RESUMPTION & ROLE RECLAIM (AUTHORITY SELF-SERVICE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/leave/:leave_id/resume-duty-early
 * Authority reports back to duty early:
 * 1. Instantly reclaims role from interim faculty.
 * 2. Recalculates actual days taken vs unutilized days.
 * 3. Refunds unused days to LeaveBalance.
 * 4. Logs audit flow and alerts Admin & HR.
 */
export const resumeDutyEarly = async (req, res) => {
  try {
    const { leave_id } = req.params;
    const { reason = "Reported back to duty early" } = req.body;
    const empId = Number(req.user?.emp_id);

    const leave = await LeaveRequest.findOne({ leave_id });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found." });
    }

    if (leave.emp_id !== empId && !req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "Only the applicant can resume duty for this leave." });
    }

    if (leave.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Only approved leaves can be resumed early. Current status is ${leave.status}.`,
      });
    }

    if (leave.is_early_resumed) {
      return res.status(400).json({
        success: false,
        message: "Duty has already been resumed for this leave application.",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromDate = new Date(leave.from_date);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(leave.to_date);
    toDate.setHours(23, 59, 59, 999);

    if (today > toDate) {
      return res.status(400).json({
        success: false,
        message: "This leave period has already naturally concluded.",
      });
    }

    const employee = await Employee.findOne({ emp_id: leave.emp_id }).lean();

    // 1. Calculate actual days used vs unused days to refund
    let actualDaysUsed = 0;
    if (today > fromDate) {
      try {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const calc = await calculateLeaveDays(
          fromDate,
          yesterday,
          "FULL_DAY",
          employee?.school_id || 0
        );
        actualDaysUsed = Math.min(leave.no_of_days, Math.max(0, calc.no_of_days || 0));
      } catch (calcErr) {
        console.warn("calculateLeaveDays warning in resumeDutyEarly:", calcErr.message);
        const msPerDay = 1000 * 60 * 60 * 24;
        const diffDays = Math.max(0, Math.floor((today - fromDate) / msPerDay));
        actualDaysUsed = Math.min(leave.no_of_days, diffDays);
      }
    }

    const refundedDays = Math.max(0, leave.no_of_days - actualDaysUsed);

    // 2. Reclaim role from interim employee if temporary assignment exists
    let tempAssignment = await LeaveTemporaryRole.findOne({
      leave_id: String(leave_id).trim(),
      status: { $in: ["ACTIVE", "SCHEDULED", "PENDING_ADMIN_ASSIGNMENT"] },
    });

    // Fallback search: by original_emp_id and role_id if created_by_role_id exists
    if (!tempAssignment && leave.created_by_role_id) {
      tempAssignment = await LeaveTemporaryRole.findOne({
        original_emp_id: leave.emp_id,
        role_id: Number(leave.created_by_role_id),
        status: { $in: ["ACTIVE", "SCHEDULED", "PENDING_ADMIN_ASSIGNMENT"] },
      });
    }

    let reclaimedRoleName = "Administrative Role";
    let interimEmpName = null;

    if (tempAssignment) {
      reclaimedRoleName = tempAssignment.role_name;
      interimEmpName = tempAssignment.interim_emp_name;

      if (tempAssignment.role_id) {
        const roleIdNum = Number(tempAssignment.role_id);
        if (tempAssignment.interim_emp_id) {
          const interimEmpId = Number(tempAssignment.interim_emp_id);
          await Employee.updateOne(
            { emp_id: interimEmpId },
            {
              $pull: {
                role_ids: roleIdNum,
                temporary_role_ids: roleIdNum,
              },
            }
          );
          const interim = await Employee.findOne({ emp_id: interimEmpId });
          if (interim && Number(interim.active_role_id) === roleIdNum) {
            interim.active_role_id = interim.role_ids?.[0] || null;
            await interim.save();
          }
        }

        // Safety sweep: ensure role is removed from any temporary assignee
        await Employee.updateMany(
          { temporary_role_ids: roleIdNum },
          {
            $pull: {
              role_ids: roleIdNum,
              temporary_role_ids: roleIdNum,
            },
          }
        );
      }

      tempAssignment.status = "RECLAIMED_EARLY";
      tempAssignment.reclaimed_at = new Date();
      tempAssignment.reclaimed_by_emp_id = empId;
      tempAssignment.reclaimed_reason = reason.trim();
      await tempAssignment.save();
    } else if (leave.created_by_role_id) {
      // Direct sweep for leave's role if no specific temp assignment record matched
      const roleIdNum = Number(leave.created_by_role_id);
      await Employee.updateMany(
        { temporary_role_ids: roleIdNum },
        {
          $pull: {
            role_ids: roleIdNum,
            temporary_role_ids: roleIdNum,
          },
        }
      );
    }

    // 3. Ensure original authority has role in role_ids and active_role_id
    const targetRoleId = tempAssignment?.role_id || leave.created_by_role_id;
    if (targetRoleId) {
      await Employee.findOneAndUpdate(
        { emp_id: leave.emp_id },
        {
          $addToSet: { role_ids: targetRoleId },
          $set: { active_role_id: targetRoleId },
        }
      );
    }

    // 4. Refund unused leave days back to LeaveBalance (role-specific if exists, else base)
    const year = new Date(leave.from_date).getFullYear();
    const createdRoleId = leave.created_by_role_id || null;
    const hasRoleBal = createdRoleId
      ? await LeaveBalance.exists({ emp_id: leave.emp_id, role_id: createdRoleId, leave_type_id: leave.leave_type_id, year })
      : false;

    if (refundedDays > 0) {
      await LeaveBalance.findOneAndUpdate(
        { emp_id: leave.emp_id, role_id: hasRoleBal ? createdRoleId : null, leave_type_id: leave.leave_type_id, year },
        { $inc: { used_days: -refundedDays } }
      );

      let refundRoleName = null;
      if (hasRoleBal) {
        const rRec = await Role.findOne({ role_id: createdRoleId }).lean();
        refundRoleName = rRec?.role_name || `Role #${createdRoleId}`;
      }

      await LeaveAdjustment.create({
        emp_id: leave.emp_id,
        role_id: hasRoleBal ? createdRoleId : null,
        role_name: hasRoleBal ? refundRoleName : "Employee-Wide (Base)",
        scope: hasRoleBal ? "ROLE_BASED" : "EMPLOYEE_WIDE",
        leave_type_id: leave.leave_type_id,
        year,
        target_field: "USED_DAYS",
        adjustment_type: "CREDIT",
        days: refundedDays,
        reason: `Early duty resumption on ${new Date().toLocaleDateString("en-IN")} for leave ${leave_id}. ${refundedDays} unused days refunded.`,
        adjusted_by_emp_id: empId,
      });
    }

    // 5. Update LeaveRequest document
    leave.is_early_resumed = true;
    leave.resumed_duty_date = new Date();
    leave.original_no_of_days = leave.no_of_days;
    leave.actual_days_used = actualDaysUsed;
    leave.refunded_days = refundedDays;
    leave.early_resume_reason = reason.trim();
    leave.hr_payroll_status = "PENDING_HR_VERIFICATION";
    await leave.save();

    // 6. Write LeaveFlow entry
    await LeaveFlow.create({
      leave_id,
      from_emp_id: empId,
      from_emp_name: employee?.emp_name || "Authority",
      from_role_id: targetRoleId || null,
      from_role_name: reclaimedRoleName,
      action: "RESUMED_EARLY",
      remark: [
        tempAssignment
          ? `Resumed duty early on ${new Date().toLocaleDateString("en-IN")}. Role charge reclaimed. Original leave: ${leave.original_no_of_days} days, Actual utilized: ${actualDaysUsed} days, Refunded: ${refundedDays} days. Reason: ${reason.trim()}`
          : `Resumed duty early on ${new Date().toLocaleDateString("en-IN")}. Original leave: ${leave.original_no_of_days} days, Actual utilized: ${actualDaysUsed} days, Refunded: ${refundedDays} days. Reason: ${reason.trim()}`,
      ],
      final_status: "DUTY_RESUMED",
    });

    // 7. Dispatch Notifications
    if (req.app?.get("io")) {
      const io = req.app.get("io");

      // Notify Admin
      const activeAdmins = await Admin.find({ is_active: true }).lean();
      const notifTitle = tempAssignment ? "Early Duty Resumption & Role Reclaimed" : "Early Duty Resumption";
      const notifMsg = tempAssignment
        ? `${employee?.emp_name || "Authority"} (${reclaimedRoleName}) has resumed duty early on ${new Date().toLocaleDateString("en-IN")}. Role has been reclaimed${interimEmpName ? ` from ${interimEmpName}` : ""}. ${refundedDays} unused leave days refunded.`
        : `${employee?.emp_name || "Employee"} has resumed duty early on ${new Date().toLocaleDateString("en-IN")}. ${refundedDays} unused leave days refunded to balance.`;

      for (const adm of activeAdmins) {
        if (adm.admin_id) {
          sendNotification(io, {
            emp_id: adm.admin_id,
            type: "INFO",
            reference_id: leave_id,
            reference_type: "Leave",
            title: notifTitle,
            message: notifMsg,
          }).catch(() => {});
        }
      }

      // Notify Interim Faculty if one was assigned
      if (tempAssignment?.interim_emp_id) {
        sendNotification(io, {
          emp_id: tempAssignment.interim_emp_id,
          type: "INFO",
          reference_id: leave_id,
          reference_type: "Leave",
          title: "Temporary Role Charge Concluded",
          message: `${employee?.emp_name} has resumed duty early. Temporary charge of ${reclaimedRoleName} has been concluded and handed back.`,
        }).catch(() => {});

        const interimEmpRec = await Employee.findOne({ emp_id: tempAssignment.interim_emp_id }).lean();
        if (interimEmpRec?.email) {
          sendMail({
            to: interimEmpRec.email,
            name: interimEmpRec.emp_name,
            subject: `Temporary Role Charge Concluded: ${reclaimedRoleName}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.6;">
                <h2 style="color: #475569; margin-top: 0;">Temporary Role Charge Concluded</h2>
                <p>Dear <strong>${interimEmpRec.emp_name}</strong>,</p>
                <p><strong>${employee?.emp_name || "The authority"}</strong> has resumed duty early. Your temporary charge of <strong>${reclaimedRoleName}</strong> has concluded and been restored to the authority.</p>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">IQPaths HRMS & Leave Management System</p>
              </div>
            `,
          }).catch(() => {});
        }
      }

      io.emit("data:updated", { entity: "leave", action: "RESUMED_EARLY", leave_id });
      io.emit("data:updated", { entity: "temporary_role", leave_id });
      if (tempAssignment?.interim_emp_id) {
        io.emit("data:updated", { entity: "role_updated", emp_id: tempAssignment.interim_emp_id });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Duty resumed successfully! Role ${reclaimedRoleName} reclaimed and ${refundedDays} unused leave days refunded to your balance.`,
      data: leave,
      refunded_days: refundedDays,
      actual_days_used: actualDaysUsed,
    });
  } catch (error) {
    console.error("resumeDutyEarly error:", error);
    return res.status(500).json({ success: false, message: "Failed to resume duty early." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 21. HR EARLY RESUMPTION & PAYROLL RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/leave/hr/early-resumptions
 * List all early duty resumption records for HR payroll and attendance reconciliation
 */
export const hrGetEarlyResumptions = async (req, res) => {
  try {
    const leaves = await LeaveRequest.find({ is_early_resumed: true })
      .sort({ resumed_duty_date: -1 })
      .lean();

    const empIds = [...new Set(leaves.map((l) => l.emp_id))];
    const deptIds = [...new Set(leaves.map((l) => l.dept_id))];
    const typeIds = [...new Set(leaves.map((l) => l.leave_type_id))];
    const roleIds = [...new Set(leaves.map((l) => l.created_by_role_id).filter(Boolean))];

    const [employees, departments, leaveTypes, roles] = await Promise.all([
      Employee.find({ emp_id: { $in: empIds } }, "emp_id emp_name designation email dept_id").lean(),
      Department.find({ dept_id: { $in: deptIds } }, "dept_id dept_name").lean(),
      LeaveType.find({ leave_type_id: { $in: typeIds } }, "leave_type_id name code").lean(),
      Role.find({ role_id: { $in: roleIds } }, "role_id role_name").lean(),
    ]);

    const empMap = Object.fromEntries(employees.map((e) => [e.emp_id, e]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));
    const typeMap = Object.fromEntries(leaveTypes.map((t) => [t.leave_type_id, t]));
    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r.role_name]));

    const enriched = leaves.map((l) => ({
      ...l,
      emp_name: empMap[l.emp_id]?.emp_name || `Emp ${l.emp_id}`,
      designation: empMap[l.emp_id]?.designation || "Faculty",
      department_name: deptMap[l.dept_id] || "General",
      leave_type_name: typeMap[l.leave_type_id]?.name || "Leave",
      leave_type_code: typeMap[l.leave_type_id]?.code || "LV",
      role_name: roleMap[l.created_by_role_id] || null,
    }));

    return res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length,
    });
  } catch (error) {
    console.error("hrGetEarlyResumptions error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch early resumptions." });
  }
};

/**
 * POST /api/leave/hr/early-resume-reconcile
 * HR confirms and reconciles early resumption for monthly salary / payroll calculation
 */
export const hrReconcileEarlyResume = async (req, res) => {
  try {
    const { leave_id, hr_payroll_remarks } = req.body;
    const hrEmpId = Number(req.user?.emp_id) || 1;
    const hrName = req.user?.emp_name || "HR Administrator";

    if (!leave_id) {
      return res.status(400).json({ success: false, message: "Leave ID is required." });
    }

    const leave = await LeaveRequest.findOne({ leave_id, is_early_resumed: true });
    if (!leave) {
      return res.status(404).json({ success: false, message: "Early resumed leave record not found." });
    }

    leave.hr_payroll_status = "RECONCILED";
    leave.hr_reconciled_by_emp_id = hrEmpId;
    leave.hr_reconciled_by_name = hrName;
    leave.hr_reconciled_at = new Date();
    if (hr_payroll_remarks) {
      leave.hr_payroll_remarks = hr_payroll_remarks.trim();
    }
    await leave.save();

    if (req.app?.get("io")) {
      req.app.get("io").emit("data:updated", { entity: "leave", action: "HR_RECONCILED", leave_id });
    }

    return res.status(200).json({
      success: true,
      message: `Leave ${leave_id} successfully verified & reconciled for payroll.`,
      data: leave,
    });
  } catch (error) {
    console.error("hrReconcileEarlyResume error:", error);
    return res.status(500).json({ success: false, message: "Failed to reconcile early resumption." });
  }
};
