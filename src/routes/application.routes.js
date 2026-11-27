import { Router } from "express";
import { upload } from "../utility/cloudinary.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createApplication,
  getAllApplicationsByScope,
  getAllApplications,
  getReceivedApplications,
  getEmployeeApplicationSummary,
  getApplicationsForEmployee,
  getRecentApplications,
  getProcessedApplications,
  getApplicationApprovalFlow,
  getApplicationById,
  editApplication,
  approveApplicationChain,
  approveApplicationDirect,
  forwardApplicationChain,
  forwardApplicationDirect,
  closeApplication,
  rejectApplication,
  raiseQuery,
  replyToQuery,
  deleteApplication,
  getQueriesByApplicationId,
  getApprovedApplicationsByRole,
  completeExecutionApplication,
  forwardExecutionApplication,
  getExecutionApplications,
  locateApplication
} from "../controllers/application.controller.js";
import { isAdmin, ensureNotTemporaryRole } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authenticate);

const blockTempRole = ensureNotTemporaryRole("Application");

// ── List Routes ───────────────────────────────────────────────────────────────
router.post("/", blockTempRole, upload.array("attachments", 5), createApplication);
router.get("/my", getAllApplicationsByScope);
router.get("/admin/all", isAdmin, getAllApplications);
router.get("/received", blockTempRole, getReceivedApplications);
router.get("/processed", getProcessedApplications);
router.get("/approved-by-role", getApprovedApplicationsByRole);
router.get("/execution", getExecutionApplications);


//FIXED: ye routes /:application_id se PEHLE aane chahiye,
//warna "/employee" aur "/applications" khud application_id maan liye jaate hain
router.get("/employee/:empId/applications/summary", getEmployeeApplicationSummary);
router.get("/employee/:empId/applications", getApplicationsForEmployee);
router.get("/recent", getRecentApplications);
router.get("/:application_id/approval-flow", getApplicationApprovalFlow);
router.get("/:application_id/locate", locateApplication);

// ── Single Application — KEEP LAST ───────────────────────────────────────────
router.get("/:application_id", getApplicationById);
router.put("/:application_id/edit", blockTempRole, editApplication);
router.patch("/:application_id/approve/direct", blockTempRole, approveApplicationDirect);
router.patch("/:application_id/approve/chain", blockTempRole, approveApplicationChain);
router.patch("/:application_id/forward/direct", blockTempRole, forwardApplicationDirect);
router.patch("/:application_id/forward/chain", blockTempRole, forwardApplicationChain);
router.patch("/:application_id/close", blockTempRole, closeApplication);
router.patch("/:application_id/reject", blockTempRole, rejectApplication);
router.patch("/:application_id/query", blockTempRole, raiseQuery);
router.patch("/execution/start/:applicationId", forwardExecutionApplication);
router.patch("/execution/complete/:applicationId", completeExecutionApplication);
router.get("/:application_id/queries", getQueriesByApplicationId);
router.patch("/:application_id/query-reply", replyToQuery);
router.delete("/:application_id", deleteApplication);

export default router;