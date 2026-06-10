import { Router } from "express";
import { upload } from "../utility/cloudinary.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createApplication,
  getMyApplications,
  getReceivedApplications,
  getApplicationById,
  approveApplicationChain,
  approveApplicationDirect,
  forwardApplicationChain,
  forwardApplicationDirect,
  rejectApplication,
  raiseQuery,
  replyToQuery,
  deleteApplication,
} from "../controllers/application.controller.js";

const router = Router();

router.use(authenticate);

// ── List Routes ───────────────────────────────────────────────────────────────
router.post("/", upload.array("attachments", 5), createApplication);
router.get("/my", getMyApplications);
router.get("/received", getReceivedApplications);

// ── Single Application — KEEP LAST ───────────────────────────────────────────
router.get("/:application_id", getApplicationById);
router.patch("/:application_id/approve/direct", approveApplicationDirect);
router.patch("/:application_id/approve/chain",  approveApplicationChain);
router.patch("/:application_id/forward/direct", forwardApplicationDirect);
router.patch("/:application_id/forward/chain",  forwardApplicationChain);
router.patch("/:application_id/reject", rejectApplication);
router.patch("/:application_id/query", raiseQuery);
router.patch("/:application_id/query-reply", replyToQuery);
router.delete("/:application_id", deleteApplication);

export default router;
