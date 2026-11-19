import mongoose from "mongoose";
import { deleteCache } from "../../utility/cache.utils.js";

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
    key:            { type: String, required: true, unique: true },
    value:          { type: mongoose.Schema.Types.Mixed, default: {} },
    categories:     { type: [categorySchema], default: [] },
    app_categories: { type: [categorySchema], default: [] },
    modules: {
      notesheet:   { type: Boolean, default: true },
      application: { type: Boolean, default: true },
      leave:       { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

appConfigSchema.post(["save", "findOneAndUpdate", "updateOne", "updateMany"], async function () {
  await deleteCache("app_config:*");
});

const AppConfig = mongoose.model("AppConfig", appConfigSchema);
export default AppConfig;
