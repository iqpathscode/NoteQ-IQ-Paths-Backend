import express from "express";
import { authenticate, isAdmin, requireModule } from "../middlewares/auth.middleware.js";
import {
  getPublicJobs,
  getPublicJobById,
  applyForJob,
  trackApplication,
  createJobOpening,
  getAllJobsAdmin,
  updateJobOpening,
  getApplicationsForJob,
  updateApplicationScrutiny,
  scheduleInterview,
  submitPanelEvaluation,
  getJobMeritList,
  onboardCandidate,
} from "../controllers/recruitment.controller.js";

const router = express.Router();
router.use(requireModule("recruitment"));

// ======================== PUBLIC APIS ========================
router.get("/jobs", getPublicJobs);
router.get("/jobs/:jobId", getPublicJobById);
router.post("/apply", applyForJob);
router.get("/track/:appNo", trackApplication);

// ======================== ADMIN APIS ========================
router.post("/admin/jobs", authenticate, isAdmin, createJobOpening);
router.get("/admin/jobs", authenticate, isAdmin, getAllJobsAdmin);
router.put("/admin/jobs/:jobId", authenticate, isAdmin, updateJobOpening);
router.get("/admin/applications", authenticate, isAdmin, getApplicationsForJob);
router.patch("/admin/applications/:id/scrutiny", authenticate, isAdmin, updateApplicationScrutiny);
router.post("/admin/applications/:id/schedule-interview", authenticate, isAdmin, scheduleInterview);
router.post("/admin/evaluations", authenticate, isAdmin, submitPanelEvaluation);
router.get("/admin/jobs/:jobId/merit-list", authenticate, isAdmin, getJobMeritList);
router.post("/admin/applications/:id/onboard", authenticate, isAdmin, onboardCandidate);

export default router;
