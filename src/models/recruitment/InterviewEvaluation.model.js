import mongoose from "mongoose";

const interviewEvaluationSchema = new mongoose.Schema(
  {
    application_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobApplication",
      required: true,
      index: true,
    },
    application_no: { type: String, required: true },
    job_id: { type: Number, required: true, index: true },
    candidate_name: { type: String, required: true },
    panelist_name: { type: String, required: true },
    panelist_role: {
      type: String,
      enum: ["HOD", "DEAN", "EXTERNAL_EXPERT", "PRINCIPAL", "VICE_CHANCELLOR", "MEMBER"],
      default: "MEMBER",
    },
    scores: {
      domain_knowledge: { type: Number, default: 0, min: 0, max: 25 },
      research_aptitude: { type: Number, default: 0, min: 0, max: 25 },
      teaching_demo: { type: Number, default: 0, min: 0, max: 25 },
      personality_comm: { type: Number, default: 0, min: 0, max: 25 },
      total: { type: Number, default: 0, min: 0, max: 100 },
    },
    remarks: { type: String, default: "" },
    recommendation: {
      type: String,
      enum: ["HIGHLY_RECOMMENDED", "RECOMMENDED", "WAITLISTED", "NOT_RECOMMENDED"],
      default: "RECOMMENDED",
    },
  },
  { timestamps: true }
);

interviewEvaluationSchema.pre("save", function () {
  if (this.scores) {
    this.scores.total =
      (this.scores.domain_knowledge || 0) +
      (this.scores.research_aptitude || 0) +
      (this.scores.teaching_demo || 0) +
      (this.scores.personality_comm || 0);
  }
});

const InterviewEvaluation = mongoose.model("InterviewEvaluation", interviewEvaluationSchema);
export default InterviewEvaluation;
