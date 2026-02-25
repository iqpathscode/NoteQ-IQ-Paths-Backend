import express from "express";
import { upload } from "../utility/cloudinary.js";
import { uploadAttachment } from "../controllers/upload.controller.js";

const router = express.Router();

router.post("/upload", upload.single("file"), uploadAttachment);

export default router;
