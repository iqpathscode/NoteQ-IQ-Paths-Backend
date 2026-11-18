import mongoose from "mongoose";

const poItemSchema = new mongoose.Schema({
  item_name: {
    type: String,
    required: true,
    trim: true,
  },
  specification: {
    type: String,
    trim: true,
    default: "",
  },
  hsn_code: {
    type: String,
    trim: true,
    default: "",
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  unit: {
    type: String,
    default: "Nos",
    trim: true,
  },
  unit_price: {
    type: Number,
    required: true,
    min: 0,
  },
  gst_rate: {
    type: Number,
    default: 18, // percentage e.g. 0, 5, 12, 18, 28
    min: 0,
  },
  tax_amount: {
    type: Number,
    default: 0,
  },
  total_amount: {
    type: Number,
    required: true,
  },
});

const purchaseOrderSchema = new mongoose.Schema(
  {
    po_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    // Vendor Information
    vendor: {
      name: { type: String, required: true, trim: true },
      contact_person: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      gstin: { type: String, trim: true, default: "" },
      pan: { type: String, trim: true, default: "" },
    },

    // Department & Budget
    department_name: {
      type: String,
      required: true,
      trim: true,
    },
    dept_id: {
      type: Number,
      default: null,
    },
    budget_head: {
      type: String,
      trim: true,
      default: "CENTRAL_CAPEX",
    },

    // Optional link to an approved Notesheet
    ref_notesheet_id: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    // Dates
    order_date: {
      type: Date,
      default: Date.now,
    },
    delivery_due_date: {
      type: Date,
      default: null,
    },

    // Terms
    delivery_location: {
      type: String,
      trim: true,
      default: "Central Store, Academic Block-B, University Campus",
    },
    payment_terms: {
      type: String,
      trim: true,
      default: "100% payment within 30 days after satisfactory delivery and physical inspection.",
    },

    // Line items
    items: {
      type: [poItemSchema],
      required: true,
      validate: [(val) => val.length > 0, "At least one item is required in a Purchase Order."],
    },

    // Financial calculations
    financials: {
      sub_total: { type: Number, required: true, default: 0 },
      tax_total: { type: Number, required: true, default: 0 },
      shipping_charges: { type: Number, default: 0 },
      grand_total: { type: Number, required: true, default: 0 },
      amount_in_words: { type: String, trim: true, default: "" },
    },

    terms_and_conditions: {
      type: [String],
      default: [
        "Material must strictly match technical specifications approved by the University.",
        "A penalty of 0.5% per week of delay will be levied, up to a maximum of 5% of order value.",
        "Delivery and installation must be carried out during official university working hours.",
        "Warranty obligations shall commence strictly from the date of final inspection and sign-off.",
      ],
    },

    remarks: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["ISSUED", "PARTIALLY_DELIVERED", "DELIVERED", "CANCELLED"],
      default: "ISSUED",
      index: true,
    },

    cancellation_reason: {
      type: String,
      default: null,
    },
    cancelled_at: {
      type: Date,
      default: null,
    },

    // Authorized Issuing Authority (Registrar)
    issued_by_emp_id: {
      type: Number,
      required: true,
    },
    issued_by_name: {
      type: String,
      required: true,
      trim: true,
    },
    issued_by_designation: {
      type: String,
      default: "Registrar",
      trim: true,
    },
    issued_by_signature: {
      type: String,
      default: null,
    },

    // Public QR Verification Token
    verification_token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    email_sent_at: {
      type: Date,
      default: null,
    },

    email_sent_count: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ po_number: 1, "vendor.name": 1 });
purchaseOrderSchema.index({ verification_token: 1 });

const PurchaseOrder = mongoose.model("PurchaseOrder", purchaseOrderSchema);
export default PurchaseOrder;
