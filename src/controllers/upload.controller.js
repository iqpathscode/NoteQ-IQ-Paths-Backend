import { v2 as cloudinary } from "cloudinary";

export const uploadAttachment = (req, res) => {
  try {
    console.log("File received:", req.file);

    res.json({
      success: true,
      fileUrl: req.file.secure_url || req.file.path, //  fallback
      originalName: req.file.originalname,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
