import { Router } from "express";
import { upload } from "../utility/cloudinary.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createApplication,
  getMyApplications,
  getAllApplications,
  getReceivedApplications,
  getProcessedApplications,
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
} from "../controllers/application.controller.js";
import { isAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authenticate);

// ── List Routes ───────────────────────────────────────────────────────────────
router.post("/", upload.array("attachments", 5), createApplication);
router.get("/my", getMyApplications);
router.get("/admin/all", isAdmin, getAllApplications);
router.get("/received", getReceivedApplications);
router.get("/processed", getProcessedApplications);

// ── Single Application — KEEP LAST ───────────────────────────────────────────
router.get("/:application_id", getApplicationById);
router.put("/:application_id/edit", editApplication);
router.patch("/:application_id/approve/direct", approveApplicationDirect);
router.patch("/:application_id/approve/chain",  approveApplicationChain);
router.patch("/:application_id/forward/direct", forwardApplicationDirect);
router.patch("/:application_id/forward/chain",  forwardApplicationChain);
router.patch("/:application_id/close", closeApplication);
router.patch("/:application_id/reject", rejectApplication);
router.patch("/:application_id/query", raiseQuery);
router.patch("/:application_id/query-reply", replyToQuery);
router.delete("/:application_id", deleteApplication);

export default router;
