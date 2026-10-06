import express from "express";
import {
  getReportFilterOptions,
  getReportSummary,
  generateReport,
  exportReport,
} from "../controllers/report.controller.js";
import { authenticate, requireAnyModule } from "../middlewares/auth.middleware.js";

const router = express.Router();

// ======================== REPORTING ROUTES ========================
// filter-options is shared across modules (including HR Leave filtering)
router.get("/filter-options", authenticate, getReportFilterOptions);

// Generic Notesheet & Application reporting endpoints
router.get("/summary", authenticate, requireAnyModule(["notesheet", "application"]), getReportSummary);
router.get("/generate", authenticate, requireAnyModule(["notesheet", "application"]), generateReport);
router.get("/export", authenticate, requireAnyModule(["notesheet", "application"]), exportReport);

export default router;
