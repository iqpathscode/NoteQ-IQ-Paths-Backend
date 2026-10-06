import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { upload } from "../utility/cloudinary.js";
import {
  requestAttachment,
  fulfillAttachment,
  disableAttachmentRequest,
} from "../controllers/attachmentRequestController.js";

const router = express.Router();

router.post("/:noteId/request-attachment", authenticate, requestAttachment);
router.post(
  "/:noteId/fulfill-attachment/:requestId",
  authenticate,
  upload.array("attachments", 5),   
  fulfillAttachment
);
router.patch(
  "/:noteId/disable-attachment-request/:requestId",
  authenticate,
  disableAttachmentRequest
);

export default router;