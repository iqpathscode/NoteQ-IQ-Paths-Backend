import express from "express";
import { authenticate, isAdmin, requireModule } from "../middlewares/auth.middleware.js";
import {
  getLeaveTypes,
  applyLeave,
  getMyLeaves,
  getAssignedHandovers,
  getMyBalance,
  getTeamLeaveCalendar,
  getMyActiveDelegations,
  getLeaveDetail,
  cancelLeave,
  getReceivedLeaves,
  approveLeave,
  rejectLeave,
  queryLeave,
  queryReplyLeave,
  getApproverHistory,
  getLeaveApprovalChain,
  hrGetAllLeaves,
  hrAddLeave,
  hrAdjustBalance,
  hrGetAdjustments,
  hrGetReport,
  hrBulkUpload,
  getDepartmentColleagues,
  getAllLeaveTypesAdmin,
  createLeaveType,
  updateLeaveType,
  toggleLeaveTypeStatus,
  getAdminTemporaryRoleRequests,
  assignTemporaryRole,
  revokeTemporaryRole,
  resumeDutyEarly,
  hrGetEarlyResumptions,
  hrReconcileEarlyResume,
  hrGetScope,
  hrGetPayrollSummary,
  hrBulkAllotQuota,
  hrGetDailyPresence,
} from "../controllers/leave.controller.js";

const router = express.Router();
router.use(requireModule("leave"));

// ======================== PUBLIC / METADATA ========================
router.get("/types", authenticate, getLeaveTypes);
router.get("/team-calendar", authenticate, getTeamLeaveCalendar);
router.get("/approval-chain", authenticate, getLeaveApprovalChain);
router.get("/colleagues", authenticate, getDepartmentColleagues);
router.get("/active-delegations", authenticate, getMyActiveDelegations);

// ======================== ADMIN TEMPORARY ROLE DELEGATION ========================
router.get("/admin/temporary-roles", authenticate, isAdmin, getAdminTemporaryRoleRequests);
router.post("/admin/assign-temporary-role", authenticate, isAdmin, assignTemporaryRole);
router.post("/admin/revoke-temporary-role", authenticate, isAdmin, revokeTemporaryRole);

// ======================== HR MANAGEMENT & RECONCILIATION ========================
router.get("/hr/scope", authenticate, hrGetScope);
router.get("/hr/early-resumptions", authenticate, hrGetEarlyResumptions);
router.post("/hr/early-resume-reconcile", authenticate, hrReconcileEarlyResume);
router.get("/hr/all", authenticate, hrGetAllLeaves);
router.post("/hr/add", authenticate, hrAddLeave);
router.post("/hr/adjust", authenticate, hrAdjustBalance);
router.get("/hr/adjustments", authenticate, hrGetAdjustments);
router.get("/hr/report", authenticate, hrGetReport);
router.get("/hr/payroll-summary", authenticate, hrGetPayrollSummary);
router.get("/hr/daily-presence", authenticate, hrGetDailyPresence);
router.post("/hr/bulk-allot", authenticate, hrBulkAllotQuota);
router.post("/hr/bulk-upload", authenticate, hrBulkUpload);
router.get("/hr/types", authenticate, getAllLeaveTypesAdmin);
router.post("/hr/types", authenticate, createLeaveType);
router.put("/hr/types/:id", authenticate, updateLeaveType);
router.patch("/hr/types/:id/toggle", authenticate, toggleLeaveTypeStatus);

// ======================== APPROVER ACTIONS & HISTORY ========================
router.get("/approver/history", authenticate, getApproverHistory);
router.post("/:leave_id/approve", authenticate, approveLeave);
router.post("/:leave_id/reject", authenticate, rejectLeave);
router.post("/:leave_id/query", authenticate, queryLeave);
router.post("/:leave_id/query-reply", authenticate, queryReplyLeave);

// ======================== EARLY DUTY RESUMPTION & ROLE RECLAIM ========================
router.post("/:leave_id/resume-duty-early", authenticate, resumeDutyEarly);

// ======================== EMPLOYEE ROUTES ========================
router.post("/apply", authenticate, applyLeave);
router.get("/my", authenticate, getMyLeaves);
router.get("/assigned-handovers", authenticate, getAssignedHandovers);
router.get("/my/balance", authenticate, getMyBalance);
router.get("/received", authenticate, getReceivedLeaves);
router.get("/:leave_id", authenticate, getLeaveDetail);
router.post("/:leave_id/cancel", authenticate, cancelLeave);

export default router;
