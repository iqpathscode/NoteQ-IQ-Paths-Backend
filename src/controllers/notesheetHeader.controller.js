import NotesheetHeader from "../models/counter/notesheetHeader.model.js";

// ======================================================
// CREATE HEADER
// ======================================================

export const createNotesheetHeader = async (req, res) => {
  try {
    const {
      college_name,
      autonomous_text,
      document_title,
      address,
      email,
      website,
      mobile,
      footer_text,
      is_active,
    } = req.body;

    // ================= FILES =================

    const left_logo =
      req.files?.left_logo?.[0]?.path || "";

    const right_logo =
      req.files?.right_logo?.[0]?.path || "";

    // ================= PARSE =================

    const approval_lines = req.body.approval_lines
      ? JSON.parse(req.body.approval_lines)
      : [];

    const extra_fields = req.body.extra_fields
      ? JSON.parse(req.body.extra_fields)
      : [];

    // ================= VALIDATION =================

    if (!college_name) {
      return res.status(400).json({
        success: false,
        message: "College name is required",
      });
    }

    // ================= ONLY ONE ACTIVE =================

    if (is_active === "true" || is_active === true) {
      await NotesheetHeader.updateMany(
        { is_active: true },
        { $set: { is_active: false } }
      );
    }

    // ================= CREATE =================

    const header = await NotesheetHeader.create({
      college_name,
      autonomous_text,
      document_title,
      approval_lines,
      extra_fields,
      address,
      email,
      website,
      mobile,
      left_logo,
      right_logo,
      footer_text,
      is_active:
        is_active === "true" || is_active === true,
    });

    return res.status(201).json({
      success: true,
      message: "Notesheet header created successfully",
      data: header,
    });
  } catch (err) {
    console.error("CREATE HEADER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to create notesheet header",
      error: err.message,
    });
  }
};



// ======================================================
// UPDATE HEADER
// ======================================================

export const updateNotesheetHeader = async (req, res) => {
  try {
    const { id } = req.params;

    // ================= CHECK =================

    const existing = await NotesheetHeader.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Header not found",
      });
    }

    // ================= PARSE =================

    const approval_lines = req.body.approval_lines
      ? JSON.parse(req.body.approval_lines)
      : [];

    const extra_fields = req.body.extra_fields
      ? JSON.parse(req.body.extra_fields)
      : [];

    // ================= ACTIVE SWITCH =================

    if (
      req.body.is_active === "true" ||
      req.body.is_active === true
    ) {
      await NotesheetHeader.updateMany(
        { is_active: true },
        { $set: { is_active: false } }
      );
    }

    // ================= FILES =================

    const left_logo =
      req.files?.left_logo?.[0]?.path;

    const right_logo =
      req.files?.right_logo?.[0]?.path;

    // ================= UPDATE DATA =================

    const updateData = {
      ...req.body,
      approval_lines,
      extra_fields,
      is_active:
        req.body.is_active === "true" ||
        req.body.is_active === true,
    };

    if (left_logo) {
      updateData.left_logo = left_logo;
    }

    if (right_logo) {
      updateData.right_logo = right_logo;
    }

    // ================= UPDATE =================

    const updated = await NotesheetHeader.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Header updated successfully",
      data: updated,
    });
  } catch (err) {
    console.error("UPDATE HEADER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update header",
      error: err.message,
    });
  }
};

// ======================================================
// GET ACTIVE HEADER
// ======================================================

export const getActiveNotesheetHeader = async (req, res) => {
  try {
    const header = await NotesheetHeader.findOne({
      is_active: true,
    }).sort({ createdAt: -1 });

    if (!header) {
      return res.status(404).json({
        success: false,
        message: "No active notesheet header found",
      });
    }

    return res.status(200).json({
      success: true,
      data: header,
    });
  } catch (err) {
    console.error("GET HEADER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notesheet header",
      error: err.message,
    });
  }
};

// ======================================================
// GET ALL HEADERS
// ======================================================

export const getAllNotesheetHeaders = async (req, res) => {
  try {
    const headers = await NotesheetHeader.find().sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      count: headers.length,
      data: headers,
    });
  } catch (err) {
    console.error("GET ALL HEADER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch headers",
      error: err.message,
    });
  }
};


// ======================================================
// DELETE HEADER
// ======================================================

export const deleteNotesheetHeader = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await NotesheetHeader.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Header not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Header deleted successfully",
    });
  } catch (err) {
    console.error("DELETE HEADER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to delete header",
      error: err.message,
    });
  }
};
