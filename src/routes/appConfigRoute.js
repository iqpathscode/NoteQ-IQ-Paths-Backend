// routes/appConfigRoute.js
import express from "express";
import {
  getAppConfig,
  updateLoginConfig,
  uploadCampusImage,
  addCategory,
  updateCategory,
  deleteCategory,
  addAppCategory,
  updateAppCategory,
  deleteAppCategory,
  updateModulesConfig,
} from "../controllers/appConfigController.js";

import { upload } from "../utility/cloudinary.js";
import { authenticate, isAdmin, isSuperAdmin } from "../middlewares/auth.middleware.js";

const handleImageUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "File nahi mili" });
  }
  req.fileUrl = req.file.path;
  next();
};

const router = express.Router();

// ─── Public ───────────────────────────────────────────────────────────────────
router.get("/", getAppConfig);

// ─── Admin only ───────────────────────────────────────────────────────────────
router.put("/", authenticate, isAdmin, updateLoginConfig);

// ─── Super Admin only (Licensing / Modules Toggle) ───────────────────────────
router.put("/modules", authenticate, isAdmin, isSuperAdmin, updateModulesConfig);

router.post(
  "/upload-image",
  authenticate,
  isAdmin,
  upload.single("campus_image"),
  handleImageUpload,
  uploadCampusImage
);

// ─── Notesheet Categories ─────────────────────────────────────────────────────
router.post("/categories",       authenticate, isAdmin, addCategory);
router.put("/categories/:id",    authenticate, isAdmin, updateCategory);
router.delete("/categories/:id", authenticate, isAdmin, deleteCategory);

// ─── Application Categories ───────────────────────────────────────────────────
router.post("/app-categories",       authenticate, isAdmin, addAppCategory);
router.put("/app-categories/:id",    authenticate, isAdmin, updateAppCategory);
router.delete("/app-categories/:id", authenticate, isAdmin, deleteAppCategory);

export default router;
