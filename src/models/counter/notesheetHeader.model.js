// models/master/notesheetHeader.model.js

import mongoose from "mongoose";

// ================= EXTRA FIELD SCHEMA =================
const extraFieldSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      trim: true,
    },

    value: {
      type: String,
      trim: true,
    },
  },
  { _id: false },
);

// ================= MAIN SCHEMA =================
const notesheetHeaderSchema = new mongoose.Schema(
  {
    // ================= REQUIRED =================

    college_name: {
      type: String,
      required: true,
      trim: true,
    },

    // ================= OPTIONAL =================

    autonomous_text: {
      type: String,
      trim: true,
      default: "",
    },

    // ================= MULTIPLE APPROVAL LINES =================

    approval_lines: [
      {
        type: String,
        trim: true,
      },
    ],

    // ================= CONTACT DETAILS =================

    address: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      default: "",
    },

    website: {
      type: String,
      trim: true,
      default: "",
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
    },

    // ================= LOGOS =================

    left_logo: {
      type: String,
      default: "",
    },

    right_logo: {
      type: String,
      default: "",
    },

    // ================= FOOTER =================

    footer_text: {
      type: String,
      trim: true,
      default: "",
    },

    // ================= EXTRA DYNAMIC FIELDS =================

    extra_fields: {
      type: [extraFieldSchema],
      default: [],
    },

    // ================= SETTINGS =================

    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const NotesheetHeader = mongoose.model(
  "NotesheetHeader",
  notesheetHeaderSchema,
);

export default NotesheetHeader;