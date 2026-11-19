import mongoose from "mongoose";

const nocSchema = new mongoose.Schema(
  {
    noc_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    recipient_type: {
      type: String,
      enum: ["STUDENT", "FACULTY", "STAFF"],
      required: true,
      default: "STUDENT",
    },

    recipient_name: {
      type: String,
      required: true,
      trim: true,
    },

    recipient_id: {
      type: String, // Enrollment number (for student) or Employee ID (for staff/faculty)
      required: true,
      trim: true,
      index: true,
    },

    recipient_email: {
      type: String,
      trim: true,
      lowercase: true,
    },

    email_sent_at: {
      type: Date,
      default: null,
    },

    email_sent_count: {
      type: Number,
      default: 0,
    },

    recipient_phone: {
      type: String,
      trim: true,
    },

    department_name: {
      type: String,
      required: true,
      trim: true,
    },

    dept_id: {
      type: Number,
      default: null,
    },

    designation_or_course: {
      type: String, // e.g. "B.Tech Computer Science" or "Assistant Professor"
      required: true,
      trim: true,
    },

    semester_or_year: {
      type: String, // e.g. "7th Semester" or "4th Year"
      trim: true,
      default: "",
    },

    noc_category: {
      type: String,
      enum: [
        "INTERNSHIP",
        "JOB_APPLICATION",
        "PASSPORT_VISA",
        "HIGHER_STUDIES",
        "CONFERENCE",
        "TRAINING",
        "OTHER",
      ],
      required: true,
      default: "INTERNSHIP",
    },

    organization_name: {
      type: String, // e.g. "Google India", "UPSC", "Regional Passport Office"
      required: true,
      trim: true,
    },

    purpose: {
      type: String, // Detailed justification/content
      required: true,
      trim: true,
    },

    start_date: {
      type: Date,
      default: null,
    },

    end_date: {
      type: Date,
      default: null,
    },

    remarks: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["ISSUED", "REVOKED"],
      default: "ISSUED",
      index: true,
    },

    revoked_reason: {
      type: String,
      default: null,
    },

    revoked_at: {
      type: Date,
      default: null,
    },

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
      type: String, // Cloudinary URL or file path of Registrar's saved signature
      default: null,
    },

    issue_date: {
      type: Date,
      default: Date.now,
    },

    valid_until: {
      type: Date,
      default: null,
    },

    verification_token: {
      type: String,
      required: true,
      unique: true,
    },

    ref_notesheet_id: {
      type: String, // In case this was generated referencing an approved notesheet
      default: null,
      trim: true,
    },

    supporting_documents: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

// Search optimization index
nocSchema.index({ recipient_id: 1, noc_number: 1 });

const NOC = mongoose.model("NOC", nocSchema);
export default NOC;
