import NotesheetHeader from "../models/counter/notesheetHeader.model.js";

// ======================================================
// CREATE HEADER
// ======================================================

export const createNotesheetHeader = async (req, res) => {
  try {
    const {
      school_id,
      school_name,
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

    const parsedSchoolId =
      school_id !== undefined &&
      school_id !== null &&
      school_id !== "" &&
      school_id !== "null"
        ? Number(school_id)
        : null;

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

    // ================= ONLY ONE ACTIVE PER SCHOOL / DEFAULT =================

    const shouldBeActive = is_active === "true" || is_active === true;
    if (shouldBeActive) {
      await NotesheetHeader.updateMany(
        { school_id: parsedSchoolId, is_active: true },
        { $set: { is_active: false } }
      );
    }

    // ================= CREATE =================

    const header = await NotesheetHeader.create({
      school_id: parsedSchoolId,
      school_name: school_name?.trim() || "",
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
      is_active: shouldBeActive,
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

    const parsedSchoolId =
      req.body.school_id !== undefined
        ? req.body.school_id !== "" &&
          req.body.school_id !== "null" &&
          req.body.school_id !== null
          ? Number(req.body.school_id)
          : null
        : existing.school_id;

    // ================= PARSE =================

    const approval_lines = req.body.approval_lines
      ? JSON.parse(req.body.approval_lines)
      : existing.approval_lines;

    const extra_fields = req.body.extra_fields
      ? JSON.parse(req.body.extra_fields)
      : existing.extra_fields;

    // ================= ACTIVE SWITCH =================

    const willBeActive =
      req.body.is_active === "true" || req.body.is_active === true;

    if (willBeActive) {
      await NotesheetHeader.updateMany(
        { _id: { $ne: id }, school_id: parsedSchoolId, is_active: true },
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
      school_id: parsedSchoolId,
      approval_lines,
      extra_fields,
    };

    if (req.body.is_active !== undefined) {
      updateData.is_active = willBeActive;
    }

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
    const { school_id } = req.query;

    let header = null;

    // 1. If school_id is provided, try finding active header for that specific school/college
    if (
      school_id !== undefined &&
      school_id !== null &&
      school_id !== "" &&
      school_id !== "null"
    ) {
      const parsedSchoolId = Number(school_id);
      if (!isNaN(parsedSchoolId)) {
        header = await NotesheetHeader.findOne({
          school_id: parsedSchoolId,
          is_active: true,
        }).sort({ createdAt: -1 });
      }
    }

    // 2. If not found or school_id not provided, fallback to default (school_id: null) active header
    if (!header) {
      header = await NotesheetHeader.findOne({
        $or: [{ school_id: null }, { school_id: { $exists: false } }],
        is_active: true,
      }).sort({ createdAt: -1 });
    }

    // 3. If still not found, fallback to any active header in the system
    if (!header) {
      header = await NotesheetHeader.findOne({
        is_active: true,
      }).sort({ createdAt: -1 });
    }

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
