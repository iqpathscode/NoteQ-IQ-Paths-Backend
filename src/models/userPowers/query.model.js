import mongoose from "mongoose";

const querySchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, trim: true, lowercase: true },
    phone:   { type: String, trim: true, default: "" },
    message: { type: String, required: true, trim: true },
    status:  { type: String, enum: ["pending", "resolved"], default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Query", querySchema);
