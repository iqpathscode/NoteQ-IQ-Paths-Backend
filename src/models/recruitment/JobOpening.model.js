import mongoose from "mongoose";

const jobOpeningSchema = new mongoose.Schema(
  {
    job_id: { type: Number, unique: true, index: true },
    advertisement_no: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    dept_id: { type: Number, required: true },
    dept_name: { type: String, required: true, trim: true },
    school_name: { type: String, default: "" },
    designation: { type: String, required: true, trim: true },
    employment_type: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT", "ADJUNCT", "VISITING"],
      default: "FULL_TIME",
    },
    vacancies_count: { type: Number, default: 1, min: 1 },
    roster_category: {
      type: String,
      enum: ["GENERAL", "OBC", "SC", "ST", "EWS", "PWD"],
      default: "GENERAL",
    },
    pay_scale: { type: String, default: "UGC 7th CPC Level 10" },
    min_qualification: { type: String, default: "Post Graduation / Ph.D." },
    min_experience_years: { type: Number, default: 0 },
    specialization_required: { type: String, default: "" },
    description: { type: String, default: "" },
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["DRAFT", "ACTIVE", "IN_SCRUTINY", "INTERVIEW", "COMPLETED", "CLOSED"],
      default: "ACTIVE",
    },
    notesheet_ref_id: { type: Number, default: null },
    created_by_admin: { type: String, default: "Admin" },
  },
  { timestamps: true }
);

// Auto-increment job_id hook
jobOpeningSchema.pre("validate", async function () {
  if (this.isNew && !this.job_id) {
    const lastDoc = await mongoose.model("JobOpening").findOne().sort({ job_id: -1 }).lean();
    this.job_id = lastDoc && lastDoc.job_id ? lastDoc.job_id + 1 : 101;
  }
});

const JobOpening = mongoose.model("JobOpening", jobOpeningSchema);
export default JobOpening;
