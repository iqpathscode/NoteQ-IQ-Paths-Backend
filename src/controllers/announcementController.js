import Announcement from "../models/Announce/Announcement.js";
import { v2 as cloudinary } from "cloudinary";
// cloudinary.config() is already called once in your existing upload
// middleware file (the one with CloudinaryStorage) — that config is
// global, so as long as that file gets imported somewhere in the app
// (it will, via the routes below), .destroy() here just works. No
// need to call cloudinary.config() again in this file.

async function deleteAnnouncementImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    // Don't let a failed cleanup block the main request — just log it.
    console.error("Cloudinary delete failed:", publicId, err.message);
  }
}

const ALLOWED_PRIORITIES = ["normal", "important", "urgent"];

function validatePayload({ title, message, priority }) {
  const errors = {};
  if (!title || !title.trim()) errors.title = "Title is required";
  else if (title.length > 120) errors.title = "Title can't exceed 120 characters";

  if (!message || !message.trim()) errors.message = "Message is required";

  if (priority && !ALLOWED_PRIORITIES.includes(priority)) {
    errors.priority = "Invalid priority value";
  }
  return errors;
}

// ------------------------------------------------------------------
// GET /api/announcements
// Admin view — every announcement, newest first.
// ------------------------------------------------------------------
export const getAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.status(200).json(announcements);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch announcements", error: err.message });
  }
};

// ------------------------------------------------------------------
// GET /api/announcements/active
// User-portal view — not expired, newest first. No role filtering:
// every announcement is shown to every logged-in user.
// ------------------------------------------------------------------
export const getActiveAnnouncements = async (req, res) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }],
    }).sort({ createdAt: -1 });
    res.status(200).json(announcements);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch announcements", error: err.message });
  }
};

// ------------------------------------------------------------------
// POST /api/announcements
// Accepts either application/json, or multipart/form-data when an
// image file is attached (req.file comes from the multer middleware).
// ------------------------------------------------------------------
export const createAnnouncement = async (req, res) => {
  try {
    const { title, message, priority, expiresAt } = req.body;

    const errors = validatePayload({ title, message, priority });
    if (Object.keys(errors).length) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      // multer-storage-cloudinary already uploaded the image by the
      // time this controller runs — no manual upload step needed.
      imageUrl = req.file.path; // secure_url
      imagePublicId = req.file.filename; // public_id
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      priority: priority || "normal",
      expiresAt: expiresAt || null,
      imageUrl,
      imagePublicId,
      createdBy: req.user?._id, // set by your auth middleware, if available
    });

    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ message: "Failed to create announcement", error: err.message });
  }
};

// ------------------------------------------------------------------
// PUT /api/announcements/:id
// Same multipart rule as create. Handles three image scenarios:
//   1. New file attached          -> replace old image, delete old one
//   2. removeImage === "true"     -> clear image, delete old one
//   3. Neither                    -> leave existing image untouched
// ------------------------------------------------------------------
export const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, priority, expiresAt, removeImage } = req.body;

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    const errors = validatePayload({ title, message, priority });
    if (Object.keys(errors).length) {
      return res.status(400).json({ message: "Validation failed", errors });
    }

    announcement.title = title.trim();
    announcement.message = message.trim();
    announcement.priority = priority || "normal";
    announcement.expiresAt = expiresAt || null;

    const shouldRemoveImage = removeImage === "true" || removeImage === true;

    if (req.file) {
      // New image already uploaded by the middleware — just swap it in
      // and clean up the old one.
      await deleteAnnouncementImage(announcement.imagePublicId);
      announcement.imageUrl = req.file.path;
      announcement.imagePublicId = req.file.filename;
    } else if (shouldRemoveImage) {
      await deleteAnnouncementImage(announcement.imagePublicId);
      announcement.imageUrl = null;
      announcement.imagePublicId = null;
    }

    await announcement.save();
    res.status(200).json(announcement);
  } catch (err) {
    res.status(500).json({ message: "Failed to update announcement", error: err.message });
  }
};

// ------------------------------------------------------------------
// DELETE /api/announcements/:id
// ------------------------------------------------------------------
export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    await deleteAnnouncementImage(announcement.imagePublicId);
    await announcement.deleteOne();

    res.status(200).json({ message: "Announcement deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete announcement", error: err.message });
  }
};
