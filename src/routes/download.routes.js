import express from "express";
import { logDownload, getDownloadAnalytics } from "../controllers/download.controller.js";
import { authenticate, requireAnyModule } from "../middlewares/auth.middleware.js";

const router = express.Router();

// ======================== DOWNLOAD TRACKING ROUTES ========================
router.use(authenticate);
router.use(requireAnyModule(["notesheet", "application"]));

router.post("/log", logDownload);
router.get("/analytics", getDownloadAnalytics);

export default router;
