/// routes/appConfigRoute.js
import express from "express";
import {
  getAppConfig,
  updateLoginConfig,
  uploadCampusImage,
  addCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/appConfigController.js";

import { upload } from "../utility/cloudinary.js";
import { authenticate, isAdmin  } from "../middlewares/auth.middleware.js";


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

router.post(
  "/upload-image",
  upload.single("campus_image"),
  handleImageUpload,
  uploadCampusImage
);

// Categories
router.post("/categories",       authenticate, isAdmin, addCategory);
router.put("/categories/:id",    authenticate, isAdmin, updateCategory);
router.delete("/categories/:id", authenticate, isAdmin, deleteCategory);

export default router;
