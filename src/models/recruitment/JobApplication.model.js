import mongoose from "mongoose";

const jobApplicationSchema = new mongoose.Schema(
  {
    application_no: { type: String, unique: true, index: true },
    job_id: { type: Number, required: true, index: true },
    full_name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    gender: { type: String, enum: ["MALE", "FEMALE", "OTHER"], default: "MALE" },
    dob: { type: Date, required: true },
    category: {
      type: String,
      enum: ["GENERAL", "OBC", "SC", "ST", "EWS", "PWD"],
      default: "GENERAL",
    },
    category_certificate_url: { type: String, default: "" },
    address: {
      line1: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },
    academics: [
      {
        level: {
          type: String,
          enum: ["10TH", "12TH", "BACHELORS", "MASTERS", "MPHIL", "PHD"],
        },
        degree: { type: String, default: "" },
        board_or_university: { type: String, default: "" },
        passing_year: { type: Number },
        percentage_or_cgpa: { type: Number },
        specialization: { type: String, default: "" },
        marksheet_url: { type: String, default: "" },
      },
    ],
    national_eligibility: {
      net_qualified: { type: Boolean, default: false },
      net_jrf: { type: Boolean, default: false },
      gate_qualified: { type: Boolean, default: false },
      slet_qualified: { type: Boolean, default: false },
      roll_number: { type: String, default: "" },
      year: { type: Number },
      certificate_url: { type: String, default: "" },
    },
    experience: [
      {
        org_name: { type: String, default: "" },
        designation: { type: String, default: "" },
        exp_type: {
          type: String,
          enum: ["TEACHING", "RESEARCH", "INDUSTRY"],
          default: "TEACHING",
        },
        start_date: { type: Date },
        end_date: { type: Date },
        months: { type: Number, default: 0 },
        certificate_url: { type: String, default: "" },
      },
    ],
    publications: [
      {
        title: { type: String, default: "" },
        journal_name: { type: String, default: "" },
        issn: { type: String, default: "" },
        doi: { type: String, default: "" },
        is_scopus: { type: Boolean, default: false },
        is_ugc_care: { type: Boolean, default: false },
        publication_year: { type: Number },
        paper_url: { type: String, default: "" },
      },
    ],
    api_score_breakdown: {
      graduation_score: { type: Number, default: 0 },
      post_graduation_score: { type: Number, default: 0 },
      mphil_score: { type: Number, default: 0 },
      phd_score: { type: Number, default: 0 },
      net_score: { type: Number, default: 0 },
      publications_score: { type: Number, default: 0 },
      experience_score: { type: Number, default: 0 },
      awards_score: { type: Number, default: 0 },
      total_score: { type: Number, default: 0 },
      ai_calculated: { type: Boolean, default: false },
    },
    resume_url: { type: String, default: "" },
    photo_url: { type: String, default: "" },
    signature_url: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "SUBMITTED",
        "IN_SCRUTINY",
        "ELIGIBLE",
        "INELIGIBLE",
        "SHORTLISTED",
        "INTERVIEW_SCHEDULED",
        "SELECTED",
        "REJECTED",
        "ONBOARDED",
      ],
      default: "SUBMITTED",
    },
    scrutiny_remarks: { type: String, default: "" },
    ineligible_reason: { type: String, default: "" },
    interview_details: {
      date: { type: Date },
      time: { type: String, default: "" },
      venue: { type: String, default: "" },
      meeting_link: { type: String, default: "" },
      call_letter_sent: { type: Boolean, default: false },
    },
    onboarded_emp_id: { type: Number, default: null },
    onboarded_at: { type: Date, default: null },
  },
  { timestamps: true }
);

// Auto-generate application_no hook
jobApplicationSchema.pre("validate", async function () {
  if (this.isNew && !this.application_no) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("JobApplication").countDocuments({ job_id: this.job_id });
    const seq = String(count + 1).padStart(4, "0");
    this.application_no = `APP-${year}-${this.job_id}-${seq}`;
  }
});

const JobApplication = mongoose.model("JobApplication", jobApplicationSchema);
export default JobApplication;
