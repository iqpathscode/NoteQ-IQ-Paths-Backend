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

export const DEFAULT_ORG_CONFIG = {
  // 1. Organization & Legal Identifiers
  org_name: "Medi-Caps University",
  org_legal_name: "MEDICAPS UNIVERSITY, INDORE",
  org_subtitle: "(Recognized by UGC under Section 2(f) & NAAC Accredited Autonomous Institution)",
  org_address: "A.B. Road, Pigdamber, Rau, Indore, Madhya Pradesh - 453331",
  org_contact_email: "registrar@medicaps.ac.in",
  org_contact_phone: "+91-731-3111150",
  org_website: "www.medicaps.ac.in",
  org_gstin: "23AAAAU0000A1Z2",
  org_pan: "AAAAU0000A",
  org_logo_url: "",

  // 2. NOC Desk Format Template
  noc_format: {
    section_title: "Office of the Registrar",
    portal_header: "MEDICAPS UNIVERSITY ACADEMIC & ADMINISTRATIVE PORTAL",
    accreditation_text: "(Recognized by UGC under Section 2(f) & NAAC Accredited Autonomous Institution)",
    watermark_text: "MEDICAPS",
    issuing_authority_title: "Registrar",
    contact_email: "registrar@medicaps.ac.in",
    declaration_text: "The Institute and the Office of the Registrar have No Objection to the candidate undertaking / participating in the specified activity.",
  },

  // 3. Purchase Order (PO) Format Template & Standard Terms
  po_format: {
    section_title: "Central Procurement & Store Section",
    portal_header: "MEDICAPS UNIVERSITY ACADEMIC & ADMINISTRATIVE PORTAL",
    contact_email: "purchase@medicaps.ac.in",
    delivery_location: "Central Store, Academic Block-B, Medi-Caps Campus",
    payment_terms: "100% payment within 30 days after satisfactory delivery and physical inspection.",
    terms_and_conditions: [
      "Material must strictly match technical specifications approved by the University.",
      "A penalty of 0.5% per week of delay will be levied, up to a maximum of 5% of order value.",
      "Delivery and installation must be carried out during official university working hours.",
      "Warranty obligations shall commence strictly from the date of final inspection and sign-off.",
    ],
  },
};

// ─── Helper: fetch config doc, seed if not found ──────────────────────────────
const getOrCreateConfig = async () => {
  let doc = await AppConfig.findOne({ key: CONFIG_KEY });
  if (!doc) {
    doc = await AppConfig.create({
      key:            CONFIG_KEY,
      value:          DEFAULT_LOGIN_CONFIG,
      categories:     DEFAULT_CATEGORIES,
      app_categories: DEFAULT_APP_CATEGORIES,
      modules:        { notesheet: true, application: true, leave: true },
    });
  }
  return doc;
};

// ─── GET /api/admin/app-config ────────────────────────────────────────────────
export const getAppConfig = async (req, res) => {
  try {
    const doc = await getOrCreateConfig();

    const loginPage = { ...DEFAULT_LOGIN_CONFIG, ...doc.value };

    const orgConfig = {
      ...DEFAULT_ORG_CONFIG,
      ...(doc.value?.org_config || {}),
      noc_format: {
        ...DEFAULT_ORG_CONFIG.noc_format,
        ...(doc.value?.org_config?.noc_format || {}),
      },
      po_format: {
        ...DEFAULT_ORG_CONFIG.po_format,
        ...(doc.value?.org_config?.po_format || {}),
      },
    };

    const categories = (doc.categories || [])
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((c) => ({ id: c._id, name: c.name, is_active: c.isActive }));

    const app_categories = (doc.app_categories || [])
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((c) => ({ id: c._id, name: c.name, is_active: c.isActive }));

    const modules = doc.modules || { notesheet: true, application: true, leave: true };

    return res.status(200).json({
      success: true,
      data: { login_page: loginPage, org_config: orgConfig, categories, app_categories, modules },
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
      { returnDocument: 'after' }
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

// ─── PUT /api/admin/app-config/document-formats ──────────────────────────────
export const updateDocumentFormats = async (req, res) => {
  try {
    const incomingOrg = req.body || {};
    const doc = await getOrCreateConfig();

    const currentOrg = doc.value?.org_config || {};
    const updatedOrg = {
      ...DEFAULT_ORG_CONFIG,
      ...currentOrg,
      ...incomingOrg,
      noc_format: {
        ...DEFAULT_ORG_CONFIG.noc_format,
        ...(currentOrg.noc_format || {}),
        ...(incomingOrg.noc_format || {}),
      },
      po_format: {
        ...DEFAULT_ORG_CONFIG.po_format,
        ...(currentOrg.po_format || {}),
        ...(incomingOrg.po_format || {}),
      },
    };

    const mergedValue = {
      ...(doc.value || {}),
      org_config: updatedOrg,
    };

    const updated = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { value: mergedValue } },
      { returnDocument: "after" }
    );

    return res.status(200).json({
      success: true,
      message: "Organization & Document Formats (NOC/PO) updated successfully",
      data: updated.value?.org_config,
    });
  } catch (error) {
    console.error("updateDocumentFormats error:", error);
    return res.status(500).json({ success: false, message: "Error updating document formats" });
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

    const duplicate = (doc.categories || []).find(
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
            sortOrder: sort_order ?? ((doc.categories?.length || 0) + 1),
          },
        },
      },
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
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const updatedCat = (updated.categories || []).find(
      (c) => c && c._id && c._id.toString() === String(id)
    );

    if (!updatedCat) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

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
      { key: CONFIG_KEY },
      { $pull: { categories: { _id: id } } },
      { returnDocument: 'after' }
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
            sortOrder: sort_order ?? ((doc.app_categories?.length || 0) + 1),
          },
        },
      },
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
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Application category not found" });
    }

    const updatedCat = (updated.app_categories || []).find(
      (c) => c && c._id && c._id.toString() === String(id)
    );

    if (!updatedCat) {
      return res.status(404).json({ success: false, message: "Application category not found" });
    }

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
      { key: CONFIG_KEY },
      { $pull: { app_categories: { _id: id } } },
      { returnDocument: 'after' }
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

// ─── PUT /api/admin/app-config/modules (Super Admin only) ────────────────────
export const updateModulesConfig = async (req, res) => {
  try {
    const { notesheet, application, leave } = req.body;

    const currentDoc = await getOrCreateConfig();
    const currentModules = currentDoc.modules || { notesheet: true, application: true, leave: true };

    const updatedModules = {
      notesheet: typeof notesheet === "boolean" ? notesheet : (currentModules.notesheet ?? true),
      application: typeof application === "boolean" ? application : (currentModules.application ?? true),
      leave: typeof leave === "boolean" ? leave : (currentModules.leave ?? true),
    };

    // At least one module must be enabled
    if (!updatedModules.notesheet && !updatedModules.application && !updatedModules.leave) {
      return res.status(400).json({
        success: false,
        message: "At least one module must remain enabled.",
      });
    }

    const doc = await AppConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $set: { modules: updatedModules } },
      { returnDocument: 'after', upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "System modules licensing updated successfully",
      data: doc.modules,
    });
  } catch (error) {
    console.error("updateModulesConfig error:", error);
    return res.status(500).json({ success: false, message: "Error updating module configuration" });
  }
};
