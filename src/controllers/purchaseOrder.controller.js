import crypto from "crypto";
import PurchaseOrder from "../models/po/purchaseOrder.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Notesheet from "../models/notes/notesheet.model.js";
import AppConfig from "../models/counter/AppConfig.js";
import { sendMail } from "../utility/sendMail.js";
import { poMailTemplate } from "../utility/officialDocMailTemplate.js";
import { env } from "../config/env.config.js";

/**
 * Helper: Convert Number to Indian Currency Words
 */
function numberToIndianWords(num) {
  if (!num || isNaN(num)) return "Zero Rupees Only";
  const a = [
    "", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ",
    "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ",
    "Seventeen ", "Eighteen ", "Nineteen "
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const inWords = (n) => {
    let str = "";
    if (n > 19) {
      str += b[Math.floor(n / 10)] + " " + a[n % 10];
    } else {
      str += a[n];
    }
    return str.trim();
  };

  let n = Math.floor(num);
  let crore = Math.floor(n / 10000000);
  n %= 10000000;
  let lakh = Math.floor(n / 100000);
  n %= 100000;
  let thousand = Math.floor(n / 1000);
  n %= 1000;
  let hundred = Math.floor(n / 100);
  let rem = n % 100;

  let res = "";
  if (crore > 0) res += inWords(crore) + " Crore ";
  if (lakh > 0) res += inWords(lakh) + " Lakh ";
  if (thousand > 0) res += inWords(thousand) + " Thousand ";
  if (hundred > 0) res += inWords(hundred) + " Hundred ";
  if (rem > 0) res += (res !== "" ? "and " : "") + inWords(rem) + " ";

  return "Rupees " + res.trim() + " Only";
}

/**
 * 1. Create Purchase Order (Registrar Only)
 */
export const createPurchaseOrder = async (req, res) => {
  try {
    const {
      vendor,
      department_name,
      dept_id,
      budget_head,
      ref_notesheet_id,
      order_date,
      delivery_due_date,
      delivery_location,
      payment_terms,
      items,
      shipping_charges = 0,
      terms_and_conditions,
      remarks,
    } = req.body;

    // Validation
    if (!vendor || !vendor.name || !vendor.name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Vendor name is required.",
      });
    }

    if (!department_name || !department_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Department name is required.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one item is required in the Purchase Order.",
      });
    }

    // Process and calculate line items
    let calculatedSubTotal = 0;
    let calculatedTaxTotal = 0;

    const processedItems = items.map((it) => {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const gstPercent = Number(it.gst_rate) || 0;

      const lineBase = qty * rate;
      const lineTax = (lineBase * gstPercent) / 100;
      const lineTotal = lineBase + lineTax;

      calculatedSubTotal += lineBase;
      calculatedTaxTotal += lineTax;

      return {
        item_name: it.item_name,
        specification: it.specification || "",
        hsn_code: it.hsn_code || "",
        quantity: qty,
        unit: it.unit || "Nos",
        unit_price: rate,
        gst_rate: gstPercent,
        tax_amount: Math.round(lineTax * 100) / 100,
        total_amount: Math.round(lineTotal * 100) / 100,
      };
    });

    const parsedShipping = Number(shipping_charges) || 0;
    const calculatedGrandTotal =
      Math.round((calculatedSubTotal + calculatedTaxTotal + parsedShipping) * 100) / 100;

    // Generate Sequential PO Number
    const currentYear = new Date().getFullYear();
    const counter = await Counter.findOneAndUpdate(
      { name: `po_seq_${currentYear}` },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );
    const formattedSeq = String(counter.seq).padStart(4, "0");
    const po_number = `UNIV/PO/${currentYear}/${formattedSeq}`;

    // Unique Public Verification Token
    const verification_token = crypto.randomBytes(16).toString("hex");

    // Registrar info
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

    const newPO = await PurchaseOrder.create({
      po_number,
      vendor: {
        name: vendor.name.trim(),
        contact_person: vendor.contact_person || "",
        email: vendor.email || "",
        phone: vendor.phone || "",
        address: vendor.address || "",
        gstin: vendor.gstin || "",
        pan: vendor.pan || "",
      },
      department_name: department_name.trim(),
      dept_id: dept_id || null,
      budget_head: budget_head || "CENTRAL_CAPEX",
      ref_notesheet_id: ref_notesheet_id || null,
      order_date: order_date ? new Date(order_date) : new Date(),
      delivery_due_date: delivery_due_date ? new Date(delivery_due_date) : null,
      delivery_location:
        delivery_location || "Central Store, Academic Block-B, University Campus",
      payment_terms:
        payment_terms ||
        "100% payment within 30 days after satisfactory delivery and physical inspection.",
      items: processedItems,
      financials: {
        sub_total: Math.round(calculatedSubTotal * 100) / 100,
        tax_total: Math.round(calculatedTaxTotal * 100) / 100,
        shipping_charges: parsedShipping,
        grand_total: calculatedGrandTotal,
        amount_in_words: numberToIndianWords(calculatedGrandTotal),
      },
      terms_and_conditions: Array.isArray(terms_and_conditions) && terms_and_conditions.length > 0
        ? terms_and_conditions
        : undefined, // fallback to schema default
      remarks: remarks || "",
      issued_by_emp_id,
      issued_by_name,
      issued_by_designation,
      issued_by_signature,
      verification_token,
    });

    return res.status(201).json({
      success: true,
      message: `Purchase Order ${po_number} generated successfully.`,
      data: newPO,
    });
  } catch (error) {
    console.error("[createPurchaseOrder Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create Purchase Order",
    });
  }
};

/**
 * 2. Get All Purchase Orders (Registrar / Admin View with Filter & Search)
 */
export const getAllPurchaseOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", status = "" } = req.query;

    const query = {};

    if (status) {
      query.status = status.toUpperCase();
    }

    if (search) {
      query.$or = [
        { po_number: { $regex: search, $options: "i" } },
        { "vendor.name": { $regex: search, $options: "i" } },
        { department_name: { $regex: search, $options: "i" } },
        { budget_head: { $regex: search, $options: "i" } },
        { ref_notesheet_id: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [total, orders] = await Promise.all([
      PurchaseOrder.countDocuments(query),
      PurchaseOrder.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    // Populate signature fallback if missing
    const issuerEmpIds = [...new Set(orders.map((o) => o.issued_by_emp_id).filter(Boolean))];
    const issuers = await Employee.find({ emp_id: { $in: issuerEmpIds } })
      .select("emp_id signature")
      .lean();
    const sigMap = Object.fromEntries(issuers.map((e) => [e.emp_id, e.signature]));

    const enrichedOrders = orders.map((o) => ({
      ...o,
      issued_by_signature: o.issued_by_signature || sigMap[o.issued_by_emp_id] || null,
    }));

    return res.status(200).json({
      success: true,
      data: enrichedOrders,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("[getAllPurchaseOrders Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch Purchase Orders",
    });
  }
};

/**
 * 3. Get Single Purchase Order by ID
 */
export const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await PurchaseOrder.findById(id).lean();
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    if (!order.issued_by_signature && order.issued_by_emp_id) {
      const issuer = await Employee.findOne({ emp_id: order.issued_by_emp_id })
        .select("signature")
        .lean();
      order.issued_by_signature = issuer?.signature || null;
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("[getPurchaseOrderById Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve Purchase Order",
    });
  }
};

/**
 * 4. Update Status / Cancel PO (Registrar Only)
 */
export const updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancellation_reason } = req.body;

    const validStatuses = ["ISSUED", "PARTIALLY_DELIVERED", "DELIVERED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value provided.",
      });
    }

    const order = await PurchaseOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found.",
      });
    }

    order.status = status;

    if (status === "CANCELLED") {
      order.cancellation_reason = cancellation_reason || "Cancelled by Registrar";
      order.cancelled_at = new Date();
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Purchase Order status updated to ${status}.`,
      data: order,
    });
  } catch (error) {
    console.error("[updatePurchaseOrderStatus Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update Purchase Order status",
    });
  }
};

/**
 * 5. Public Verification Endpoint for Purchase Orders (NO LOGIN REQUIRED)
 * Vendors, auditors, and receiving stores can scan the QR code to verify.
 */
export const verifyPOPublic = async (req, res) => {
  try {
    const { token } = req.params;

    const order = await PurchaseOrder.findOne({ verification_token: token }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: "Invalid or forged Purchase Order. No record found in university registry.",
      });
    }

    if (!order.issued_by_signature && order.issued_by_emp_id) {
      const issuer = await Employee.findOne({ emp_id: order.issued_by_emp_id })
        .select("signature")
        .lean();
      order.issued_by_signature = issuer?.signature || null;
    }

    return res.status(200).json({
      success: true,
      verified: true,
      status: order.status,
      data: {
        po_number: order.po_number,
        vendor_name: order.vendor?.name,
        department_name: order.department_name,
        budget_head: order.budget_head,
        order_date: order.order_date,
        delivery_due_date: order.delivery_due_date,
        grand_total: order.financials?.grand_total,
        amount_in_words: order.financials?.amount_in_words,
        items_count: order.items?.length,
        issued_by_name: order.issued_by_name,
        issued_by_designation: order.issued_by_designation,
        issued_by_signature: order.issued_by_signature,
        is_active: order.status !== "CANCELLED",
        cancellation_reason: order.status === "CANCELLED" ? order.cancellation_reason : null,
      },
    });
  } catch (error) {
    console.error("[verifyPOPublic Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify Purchase Order",
    });
  }
};

/**
 * 6. Quick Helper: Search Approved Notesheets for reference link
 */
export const getApprovedNotesheetsHelper = async (req, res) => {
  try {
    const { q = "" } = req.query;

    const query = {
      status: "APPROVED",
    };

    if (q) {
      query.$or = [
        { note_id: { $regex: q, $options: "i" } },
        { subject: { $regex: q, $options: "i" } },
      ];
    }

    const notes = await Notesheet.find(query)
      .select("note_id subject department_name school_name createdAt")
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    return res.status(200).json({
      success: true,
      data: notes,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Send Purchase Order via Email to Vendor (Registrar Only)
 */
export const sendPoEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, remarks } = req.body;

    const order = await PurchaseOrder.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found.",
      });
    }

    const targetEmail = (email || order.vendor?.email || "").trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid vendor email address.",
      });
    }

    const frontendBaseUrl = (env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const verificationUrl = `${frontendBaseUrl}/verify-po/${order.verification_token}`;

    const cfgDoc = await AppConfig.findOne({ key: "app_config" }).lean();
    const orgConfig = cfgDoc?.value?.org_config || null;

    const html = poMailTemplate({
      po: order,
      targetEmail,
      customMessage: remarks || "",
      verificationUrl,
      orgConfig,
    });

    const mailResult = await sendMail({
      to: targetEmail,
      name: order.vendor?.name || "Vendor",
      subject: `Official Purchase Order - ${order.po_number} (${order.vendor?.name})`,
      html,
    });

    if (mailResult && !mailResult.success) {
      return res.status(502).json({
        success: false,
        message: mailResult.error || "Failed to dispatch email via mail service.",
        details: mailResult.details,
      });
    }

    // Update vendor email and tracking
    if (!order.vendor) order.vendor = {};
    order.vendor.email = targetEmail;
    order.email_sent_at = new Date();
    order.email_sent_count = (order.email_sent_count || 0) + 1;
    await order.save();

    return res.status(200).json({
      success: true,
      message: `Purchase Order successfully emailed to ${targetEmail}`,
      data: {
        po_number: order.po_number,
        vendor_email: targetEmail,
        email_sent_at: order.email_sent_at,
        email_sent_count: order.email_sent_count,
      },
    });
  } catch (error) {
    console.error("[sendPoEmail Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to dispatch Purchase Order email",
    });
  }
};
