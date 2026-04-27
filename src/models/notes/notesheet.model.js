import mongoose from "mongoose";

const notesheetSchema = new mongoose.Schema(
  {
    note_id: {
      type: Number,
      required: true,
      unique: true,
    },

    emp_id: {
      type: Number,
      required: true,
    },

    dept_id: {
      type: Number,
      required: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

    forward_to_emp_id: { type: Number },
    forward_to_role_id: { type: Number },
    forward_to_dept_id: { type: Number },

    attachments: {
      type: [String],
      default: [],
    },

    mode: {
      type: Number,
      enum: [0, 1], // 0 = chain, 1 = direct
      default: 1,
    },

    level: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      required: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },

    // IMPORTANT FIX
    created_by_emp_id: { type: Number, required: true },
    created_by_role_id: { type: Number, required: false },

    updated_by: { type: Number },
  },
  {
    timestamps: true,
  },
);

// Indexes
notesheetSchema.index({ dept_id: 1, status: 1 });
notesheetSchema.index({ note_id: 1, level: 1 });

const Notesheet = mongoose.model("Notesheet", notesheetSchema);
export default Notesheet;