import { Router } from "express";
import { upload } from "../utility/cloudinary.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createApplication,
  getAllApplicationsByScope,
  getAllApplications,
  getReceivedApplications,
  getEmployeeApplicationSummary,
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
import { isAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authenticate);

// ── List Routes ───────────────────────────────────────────────────────────────
router.post("/", upload.array("attachments", 5), createApplication);
router.get("/my",authenticate, getAllApplicationsByScope);
router.get("/admin/all", isAdmin, getAllApplications);
router.get("/received",authenticate, getReceivedApplications);
router.get("/processed", authenticate, getProcessedApplications);
router.get("/approved-by-role", authenticate, getApprovedApplicationsByRole);
router.get("/execution", authenticate, getExecutionApplications);


//FIXED: ye 2 routes /:application_id se PEHLE aane chahiye,
//warna "/employee" aur "/applications" khud application_id maan liye jaate hain
router.get("/employee/:empId/applications/summary", authenticate, getEmployeeApplicationSummary);
router.get("/recent", authenticate, getRecentApplications);
router.get("/:application_id/approval-flow", authenticate, getApplicationApprovalFlow);
router.get("/:application_id/locate", authenticate, locateApplication);

// ── Single Application — KEEP LAST ───────────────────────────────────────────
router.get("/:application_id", authenticate, getApplicationById);
router.put("/:application_id/edit", authenticate, editApplication);
router.patch("/:application_id/approve/direct", authenticate, approveApplicationDirect);
router.patch("/:application_id/approve/chain", authenticate, approveApplicationChain);
router.patch("/:application_id/forward/direct", authenticate, forwardApplicationDirect);
router.patch("/:application_id/forward/chain", authenticate, forwardApplicationChain);
router.patch("/:application_id/close", authenticate, closeApplication);
router.patch("/:application_id/reject", authenticate, rejectApplication);
router.patch("/:application_id/query", authenticate, raiseQuery);
router.patch("/execution/start/:applicationId", authenticate, forwardExecutionApplication);
router.patch("/execution/complete/:applicationId", authenticate, completeExecutionApplication);
router.get("/:application_id/queries", authenticate, getQueriesByApplicationId);
router.patch("/:application_id/query-reply", authenticate, replyToQuery);
router.delete("/:application_id", authenticate, deleteApplication);

export default router;