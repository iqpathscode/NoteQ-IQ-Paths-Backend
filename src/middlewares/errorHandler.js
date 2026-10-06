import multer from "multer";

// Centralized error handler — keeps internal error details out of client responses.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large"
        : "File upload failed";
    return res.status(400).json({ success: false, message });
  }

  if (err && err.message === "Unsupported file type") {
    return res.status(400).json({ success: false, message: "Unsupported file type" });
  }

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Not allowed by CORS" });
  }

  console.error("[ErrorHandler]", err);
  return res.status(err?.status || 500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
};
