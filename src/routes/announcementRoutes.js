import express from "express";
const router = express.Router();

import {
  getAllAnnouncements,
  getActiveAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "../controllers/announcementController.js";

import { uploadAttachment } from "../controllers/upload.controller.js";
import { upload } from "../utility/cloudinary.js";

// This is your existing Cloudinary/multer upload middleware (the one
// you already use for notesheets). Adjust the path below if it lives
// somewhere else, e.g. "../middleware/uploadFile.js".
router.post("/upload", authenticate, uploadAttachment);
import { authenticate, isAdmin } from "../middlewares/auth.middleware.js";

// Every logged-in user can read announcements.
router.get("/", authenticate, getAllAnnouncements);
router.get("/active", authenticate, getActiveAnnouncements);

// Only admins can create, edit, or delete announcements.
router.post("/", authenticate, isAdmin, upload.single("image"), createAnnouncement);
router.put("/:id", authenticate, isAdmin, upload.single("image"), updateAnnouncement);
router.delete("/:id", authenticate, isAdmin, deleteAnnouncement);

export default router;
