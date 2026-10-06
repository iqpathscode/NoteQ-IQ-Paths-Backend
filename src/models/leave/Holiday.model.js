import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    holiday_id: {
      type: Number,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    holiday_date: {
      type: Date,
      required: true,
      index: true,
    },
    from_date: {
      type: Date,
      index: true,
    },
    to_date: {
      type: Date,
      index: true,
    },
    no_of_days: {
      type: Number,
      default: 1,
    },
    type: {
      type: String,
      enum: ["PUBLIC", "OPTIONAL", "COMPANY"],
      required: true,
    },
    academic_year: {
      type: String,
      required: true,
      default: () => {
        const d = new Date();
        const y = d.getFullYear();
        return `${y}-${y + 1}`;
      },
    },
    school_id: {
      type: Number,
      required: true,
      default: 0, // 0 = all schools
    },
    dept_id: {
      type: Number,
      default: 0, // 0 = all departments
    },
    created_by_emp_id: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

holidaySchema.index({ holiday_date: 1, school_id: 1 });
holidaySchema.index({ from_date: 1, to_date: 1, school_id: 1 });
holidaySchema.index({ academic_year: 1 });

const Holiday = mongoose.model("Holiday", holidaySchema);
export default Holiday;
