// utils/attachmentHelper.js
import path from "path";

export const buildAttachments = (files = []) => {
  return files.map((file) => ({
    original_name: file.originalname,                              // ✅ "report.pdf"
    file_url:      file.path,                                      // cloudinary secure URL
    public_id:     file.filename,                                  // cloudinary public_id
    mime_type:     file.mimetype,                                  // "application/pdf"
    size:          file.size ?? null,
    extension:     path.extname(file.originalname).replace(".", "").toLowerCase(), // "pdf"
  }));
};