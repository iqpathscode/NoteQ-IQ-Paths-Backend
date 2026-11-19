import crypto from "crypto";
import NOC from "../models/noc/noc.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import AppConfig from "../models/counter/AppConfig.js";
import { sendMail } from "../utility/sendMail.js";
import { nocMailTemplate } from "../utility/officialDocMailTemplate.js";
import { env } from "../config/env.config.js";

/**
 * 1. Create / Issue NOC (Registrar Only)
 */
export const createNOC = async (req, res) => {
  try {
    const {
      recipient_type,
      recipient_name,
      recipient_id,
      recipient_email,
      recipient_phone,
      department_name,
      dept_id,
      designation_or_course,
      semester_or_year,
      noc_category,
      organization_name,
      purpose,
      start_date,
      end_date,
      valid_until,
      remarks,
      ref_notesheet_id,
      supporting_documents,
    } = req.body;

    // Basic Validation
    if (
      !recipient_name ||
      !recipient_id ||
      !department_name ||
      !designation_or_course ||
      !organization_name ||
      !purpose
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required fields (Name, ID, Department, Course/Designation, Target Organization, and Purpose).",
      });
    }

    // Auto-generate Sequential NOC Number
    const currentYear = new Date().getFullYear();
    const counter = await Counter.findOneAndUpdate(
      { name: `noc_seq_${currentYear}` },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );

    const formattedSeq = String(counter.seq).padStart(4, "0");
    const noc_number = `UNIV/NOC/${currentYear}/${formattedSeq}`;

    // Unique Public Verification Token (for QR code verification)
    const verification_token = crypto.randomBytes(16).toString("hex");

    // Registrar info from middleware (or req.user)
    const registrarInfo = req.registrar || {};
    const issued_by_emp_id = registrarInfo.emp_id || req.user.emp_id || 0;
    const issued_by_name =
      registrarInfo.emp_name || req.user.name || "Registrar Office";
    const issued_by_designation =
      registrarInfo.designation || "Registrar";

    // Fetch official signature saved in Employee profile
    let issued_by_signature = registrarInfo.signature || null;
    if (!issued_by_signature && issued_by_emp_id) {
      const issuerEmp = await Employee.findOne({ emp_id: issued_by_emp_id })
        .select("signature")
        .lean();
      issued_by_signature = issuerEmp?.signature || null;
    }

    const newNoc = await NOC.create({
      noc_number,
      recipient_type: recipient_type || "STUDENT",
      recipient_name,
      recipient_id,
      recipient_email,
      recipient_phone,
      department_name,
      dept_id: dept_id || null,
      designation_or_course,
      semester_or_year: semester_or_year || "",
      noc_category: noc_category || "INTERNSHIP",
      organization_name,
      purpose,
      start_date: start_date ? new Date(start_date) : null,
      end_date: end_date ? new Date(end_date) : null,
      valid_until: valid_until ? new Date(valid_until) : null,
      remarks: remarks || "",
      issued_by_emp_id,
      issued_by_name,
      issued_by_designation,
      issued_by_signature,
      issue_date: new Date(),
      verification_token,
      ref_notesheet_id: ref_notesheet_id || null,
      supporting_documents: Array.isArray(supporting_documents)
        ? supporting_documents
        : [],
    });

    return res.status(201).json({
      success: true,
      message: "NOC successfully issued and registered.",
      data: newNoc,
    });
  } catch (error) {
    console.error("[createNOC Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create NOC",
    });
  }
};

/**
 * 2. Get All Issued NOCs (Registrar / Admin View with Filters & Search)
 */
export const getAllNOCs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      recipient_type,
      noc_category,
      status,
    } = req.query;

    const query = {};

    if (recipient_type) {
      query.recipient_type = recipient_type.toUpperCase();
    }

    if (noc_category) {
      query.noc_category = noc_category.toUpperCase();
    }

    if (status) {
      query.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { noc_number: { $regex: safeSearch, $options: "i" } },
        { recipient_name: { $regex: safeSearch, $options: "i" } },
        { recipient_id: { $regex: safeSearch, $options: "i" } },
        { recipient_type: { $regex: safeSearch, $options: "i" } },
        { recipient_email: { $regex: safeSearch, $options: "i" } },
        { recipient_phone: { $regex: safeSearch, $options: "i" } },
        { organization_name: { $regex: safeSearch, $options: "i" } },
        { department_name: { $regex: safeSearch, $options: "i" } },
        { designation_or_course: { $regex: safeSearch, $options: "i" } },
        { purpose: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [total, nocs] = await Promise.all([
      NOC.countDocuments(query),
      NOC.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    // Ensure signature is populated even if issued prior to signature field
    const issuerEmpIds = [...new Set(nocs.map((n) => n.issued_by_emp_id).filter(Boolean))];
    const issuers = await Employee.find({ emp_id: { $in: issuerEmpIds } })
      .select("emp_id signature")
      .lean();
    const sigMap = Object.fromEntries(issuers.map((e) => [e.emp_id, e.signature]));

    const enrichedNocs = nocs.map((n) => ({
      ...n,
      issued_by_signature: n.issued_by_signature || sigMap[n.issued_by_emp_id] || null,
    }));

    return res.status(200).json({
      success: true,
      data: enrichedNocs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("[getAllNOCs Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch NOC records",
    });
  }
};

/**
 * 3. Get Single NOC by ID or Token
 */
export const getNOCById = async (req, res) => {
  try {
    const { id } = req.params;

    const noc = await NOC.findById(id).lean();
    if (!noc) {
      return res.status(404).json({
        success: false,
        message: "NOC document not found",
      });
    }

    if (!noc.issued_by_signature && noc.issued_by_emp_id) {
      const issuer = await Employee.findOne({ emp_id: noc.issued_by_emp_id })
        .select("signature")
        .lean();
      noc.issued_by_signature = issuer?.signature || null;
    }

    return res.status(200).json({
      success: true,
      data: noc,
    });
  } catch (error) {
    console.error("[getNOCById Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve NOC details",
    });
  }
};

/**
 * 4. Revoke / Cancel NOC (Registrar Only)
 */
export const revokeNOC = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "A clear revocation reason is required to revoke an NOC.",
      });
    }

    const noc = await NOC.findById(id);
    if (!noc) {
      return res.status(404).json({
        success: false,
        message: "NOC document not found.",
      });
    }

    if (noc.status === "REVOKED") {
      return res.status(400).json({
        success: false,
        message: "This NOC has already been revoked.",
      });
    }

    noc.status = "REVOKED";
    noc.revoked_reason = reason.trim();
    noc.revoked_at = new Date();
    await noc.save();

    return res.status(200).json({
      success: true,
      message: "NOC has been revoked successfully.",
      data: noc,
    });
  } catch (error) {
    console.error("[revokeNOC Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to revoke NOC",
    });
  }
};

/**
 * 5. Public QR Verification Endpoint (NO LOGIN REQUIRED)
 * Anyone scanning the printed QR code hits this endpoint to verify authenticity.
 */
export const verifyNOCPublic = async (req, res) => {
  try {
    const { token } = req.params;

    const noc = await NOC.findOne({ verification_token: token }).lean();

    if (!noc) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: "Invalid or forged certificate. No record found.",
      });
    }

    if (!noc.issued_by_signature && noc.issued_by_emp_id) {
      const issuer = await Employee.findOne({ emp_id: noc.issued_by_emp_id })
        .select("signature")
        .lean();
      noc.issued_by_signature = issuer?.signature || null;
    }

    return res.status(200).json({
      success: true,
      verified: true,
      status: noc.status,
      data: {
        noc_number: noc.noc_number,
        recipient_name: noc.recipient_name,
        recipient_id: noc.recipient_id,
        recipient_type: noc.recipient_type,
        department_name: noc.department_name,
        designation_or_course: noc.designation_or_course,
        organization_name: noc.organization_name,
        noc_category: noc.noc_category,
        purpose: noc.purpose,
        issue_date: noc.issue_date,
        valid_until: noc.valid_until,
        issued_by_name: noc.issued_by_name,
        issued_by_designation: noc.issued_by_designation,
        issued_by_signature: noc.issued_by_signature,
        is_active: noc.status === "ISSUED",
        revocation_reason: noc.status === "REVOKED" ? noc.revoked_reason : null,
      },
    });
  } catch (error) {
    console.error("[verifyNOCPublic Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify certificate",
    });
  }
};

/**
 * 6. Quick Search for Autocomplete (Employees or Departments)
 */
export const searchRecipientHelper = async (req, res) => {
  try {
    const { q = "" } = req.query;
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const employees = await Employee.find({
      $or: [
        { emp_name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { designation: { $regex: q, $options: "i" } },
      ],
      is_active: true,
    })
      .select("emp_id emp_name designation email mobile_number dept_id")
      .limit(10)
      .lean();

    return res.status(200).json({
      success: true,
      data: employees,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Send NOC via Email to Recipient (Registrar Only)
 */
export const sendNocEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, remarks } = req.body;

    const noc = await NOC.findById(id);
    if (!noc) {
      return res.status(404).json({
        success: false,
        message: "NOC document not found.",
      });
    }

    const targetEmail = (email || noc.recipient_email || "").trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid recipient email address.",
      });
    }

    const frontendBaseUrl = (env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const verificationUrl = `${frontendBaseUrl}/verify-noc/${noc.verification_token}`;

    const cfgDoc = await AppConfig.findOne({ key: "app_config" }).lean();
    const orgConfig = cfgDoc?.value?.org_config || null;

    const html = nocMailTemplate({
      noc,
      targetEmail,
      customMessage: remarks || "",
      verificationUrl,
      orgConfig,
    });

    const mailResult = await sendMail({
      to: targetEmail,
      name: noc.recipient_name || "Recipient",
      subject: `Official No Objection Certificate (NOC) - ${noc.noc_number}`,
      html,
    });

    if (mailResult && !mailResult.success) {
      return res.status(502).json({
        success: false,
        message: mailResult.error || "Failed to dispatch email via mail service.",
        details: mailResult.details,
      });
    }

    // Update email tracking
    noc.recipient_email = targetEmail;
    noc.email_sent_at = new Date();
    noc.email_sent_count = (noc.email_sent_count || 0) + 1;
    await noc.save();

    return res.status(200).json({
      success: true,
      message: `NOC successfully emailed to ${targetEmail}`,
      data: {
        noc_number: noc.noc_number,
        recipient_email: targetEmail,
        email_sent_at: noc.email_sent_at,
        email_sent_count: noc.email_sent_count,
      },
    });
  } catch (error) {
    console.error("[sendNocEmail Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to dispatch NOC email",
    });
  }
};
