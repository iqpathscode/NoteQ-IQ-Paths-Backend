import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true }
);

const appConfigSchema = new mongoose.Schema(
  {
    key:        { type: String, required: true, unique: true },
    value:      { type: mongoose.Schema.Types.Mixed, default: {} },
    categories: { type: [categorySchema], default: [] },
  },
  { timestamps: true }
);

const AppConfig = mongoose.model("AppConfig", appConfigSchema);
export default AppConfig;
