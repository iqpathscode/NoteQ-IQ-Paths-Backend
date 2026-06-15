// controllers/appConfigController.js
import AppConfig from "../models/counter/AppConfig.js";

// ─── Single document key ──────────────────────────────────────────────────────
const CONFIG_KEY = "app_config";

// ─── Default values ───────────────────────────────────────────────────────────
const DEFAULT_LOGIN_CONFIG = {
  university_name:     "Medicaps University",
  university_subtitle: "Indore, Madhya Pradesh",
  tagline:             "Streamline your academic workflow with our professional notesheet management system",
  campus_image_url:    "",
  portal_title:        "NoteSheet Portal",
  portal_subtitle:     "Manage your academic notesheets efficiently with our streamlined digital workflow system.",
};

const DEFAULT_CATEGORIES = [
  { name: "Leave Request",      isActive: true, sortOrder: 1  },
  { name: "Budget Approval",    isActive: true, sortOrder: 2  },
  { name: "Equipment Purchase", isActive: true, sortOrder: 3  },
  { name: "Event Permission",   isActive: true, sortOrder: 4  },
  { name: "Research Grant",     isActive: true, sortOrder: 5  },
  { name: "Infrastructure",     isActive: true, sortOrder: 6  },
  { name: "Other",              isActive: true, sortOrder: 99 },
];

const DEFAULT_APP_CATEGORIES = [];

// ─── Helper: fetch config doc, seed if not found ──────────────────────────────
const getOrCreateConfig = async () => {
  let doc = await AppConfig.findOne({ key: CONFIG_KEY });
  if (!doc) {
    doc = await AppConfig.create({
      key:            CONFIG_KEY,
      value:          DEFAULT_LOGIN_CONFIG,
      categories:     DEFAULT_CATEGORIES,
      app_categories: DEFAULT_APP_CATEGORIES,
    });
  }
  return doc;
};

// ─── GET /api/admin/app-config ────────────────────────────────────────────────
export const getAppConfig = async (req, res) => {
  try {
    const doc = await getOrCreateConfig();

    const loginPage = { ...DEFAULT_LOGIN_CONFIG, ...doc.value };

    const categories = doc.categories
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c._id, name: c.name, is_active: c.isActive }));

    const app_categories = (doc.app_categories || [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c._id, name: c.name, is_active: c.isActive }));

    return res.status(200).json({
      success: true,
      data: { login_page: loginPage, categories, app_categories },
    });
  } catch (error) {
    console.error("getAppConfig error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch app config" });
  }
};

// ─── PUT /api/admin/app-config ────────────────────────────────────────────────
export const updateLoginConfig = async (req, res) => {
  try {
    const { university_name, university_subtitle, tagline, campus_image_url, portal_title, portal_subtitle } = req.body;

    const incoming = {};
    if (university_name     !== undefined) incoming.university_name     = university_name;
    if (university_subtitle !== undefined) incoming.university_subtitle = university_subtitle;
    if (tagline             !== undefined) incoming.tagline             = tagline;
    if (campus_image_url    !== undefined) incoming.campus_image_url    = campus_image_url;
    if (portal_title        !== undefined) incoming.portal_title        = portal_title;
    if (portal_subtitle     !== undefined) incoming.portal_subtitle     = portal_subtitle;

    if (Object.keys(incoming).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields found to update" });
    }

    const doc    = await getOrCreateConfig();
    const merged = { ...DEFAULT_LOGIN_CONFIG, ...doc.value, ...incoming };

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { value: merged } },
      // { new: true }
    { returnDocument: 'after'}
    );

    return res.status(200).json({
      success: true,
      message: "Login page config updated successfully",
      data:    updated.value,
    });
  } catch (error) {
    console.error("updateLoginConfig error:", error);
    return res.status(500).json({ success: false, message: "Error updating config" });
  }
};

// ─── POST /api/admin/app-config/upload-image ─────────────────────────────────
export const uploadCampusImage = async (req, res) => {
  try {
    const fileUrl = req.fileUrl;

    if (!fileUrl) {
      return res.status(400).json({ success: false, message: "Image upload failed" });
    }

    const doc    = await getOrCreateConfig();
    const merged = { ...DEFAULT_LOGIN_CONFIG, ...doc.value, campus_image_url: fileUrl };

    await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { value: merged } },
      // { new: true }
      { returnDocument: 'after' }
    );

    return res.status(200).json({
      success: true,
      message: "Campus image uploaded successfully",
      fileUrl,
    });
  } catch (error) {
    console.error("uploadCampusImage error:", error);
    return res.status(500).json({ success: false, message: "Error uploading image" });
  }
};

// ═══════════════════════════════════════════════════════════════
//  NOTESHEET CATEGORIES
// ═══════════════════════════════════════════════════════════════

// ─── POST /api/admin/app-config/categories ────────────────────────────────────
export const addCategory = async (req, res) => {
  try {
    const { name, sort_order } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const doc = await getOrCreateConfig();

    const duplicate = doc.categories.find(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ success: false, message: "This category already exists" });
    }

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      {
        $push: {
          categories: {
            name:      name.trim(),
            isActive:  true,
            sortOrder: sort_order ?? 0,
          },
        },
      },
      // { new: true }
      { returnDocument: 'after' }
    );

    const newCat = updated.categories[updated.categories.length - 1];

    return res.status(201).json({
      success: true,
      message: "Category added successfully",
      data:    { id: newCat._id, name: newCat.name, is_active: newCat.isActive },
    });
  } catch (error) {
    console.error("addCategory error:", error);
    return res.status(500).json({ success: false, message: "Error adding category" });
  }
};

// ─── PUT /api/admin/app-config/categories/:id ─────────────────────────────────
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active, sort_order } = req.body;

    const setFields = {};
    if (name       !== undefined) setFields["categories.$.name"]      = name.trim();
    if (is_active  !== undefined) setFields["categories.$.isActive"]  = Boolean(is_active);
    if (sort_order !== undefined) setFields["categories.$.sortOrder"] = Number(sort_order);

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields found to update" });
    }

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY, "categories._id": id },
      { $set: setFields },
      // { new: true }
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const updatedCat = updated.categories.find((c) => c._id.toString() === id);

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data:    { id: updatedCat._id, name: updatedCat.name, is_active: updatedCat.isActive },
    });
  } catch (error) {
    console.error("updateCategory error:", error);
    return res.status(500).json({ success: false, message: "Error updating category" });
  }
};

// ─── DELETE /api/admin/app-config/categories/:id ─────────────────────────────
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY, "categories._id": id },
      { $set: { "categories.$.isActive": false } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    return res.status(200).json({ success: true, message: "Category removed successfully" });
  } catch (error) {
    console.error("deleteCategory error:", error);
    return res.status(500).json({ success: false, message: "Error deleting category" });
  }
};

// ═══════════════════════════════════════════════════════════════
//  APPLICATION CATEGORIES
// ═══════════════════════════════════════════════════════════════

// ─── POST /api/admin/app-config/app-categories ───────────────────────────────
export const addAppCategory = async (req, res) => {
  try {
    const { name, sort_order } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Category name is required" });
    }

    const doc = await getOrCreateConfig();

    const duplicate = (doc.app_categories || []).find(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ success: false, message: "This application category already exists" });
    }

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      {
        $push: {
          app_categories: {
            name:      name.trim(),
            isActive:  true,
            sortOrder: sort_order ?? 0,
          },
        },
      },
      // { new: true }
      { returnDocument: 'after' }
    );

    const newCat = updated.app_categories[updated.app_categories.length - 1];

    return res.status(201).json({
      success: true,
      message: "Application category added successfully",
      data:    { id: newCat._id, name: newCat.name, is_active: newCat.isActive },
    });
  } catch (error) {
    console.error("addAppCategory error:", error);
    return res.status(500).json({ success: false, message: "Error adding application category" });
  }
};

// ─── PUT /api/admin/app-config/app-categories/:id ────────────────────────────
export const updateAppCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active, sort_order } = req.body;

    const setFields = {};
    if (name       !== undefined) setFields["app_categories.$.name"]      = name.trim();
    if (is_active  !== undefined) setFields["app_categories.$.isActive"]  = Boolean(is_active);
    if (sort_order !== undefined) setFields["app_categories.$.sortOrder"] = Number(sort_order);

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields found to update" });
    }

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY, "app_categories._id": id },
      { $set: setFields },
      // { new: true }
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Application category not found" });
    }

    const updatedCat = updated.app_categories.find((c) => c._id.toString() === id);

    return res.status(200).json({
      success: true,
      message: "Application category updated successfully",
      data:    { id: updatedCat._id, name: updatedCat.name, is_active: updatedCat.isActive },
    });
  } catch (error) {
    console.error("updateAppCategory error:", error);
    return res.status(500).json({ success: false, message: "Error updating application category" });
  }
};

// ─── DELETE /api/admin/app-config/app-categories/:id ─────────────────────────
export const deleteAppCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY, "app_categories._id": id },
      { $set: { "app_categories.$.isActive": false } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Application category not found" });
    }

    return res.status(200).json({ success: true, message: "Application category removed successfully" });
  } catch (error) {
    console.error("deleteAppCategory error:", error);
    return res.status(500).json({ success: false, message: "Error deleting application category" });
  }
};
