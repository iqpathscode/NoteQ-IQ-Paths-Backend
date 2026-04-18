import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    role_id: {
      type: Number,
      required: true,
      unique: true,
    },

    role_name: {
      type: String,
      required: true,
      trim: true,
    },

    dept_ids: {
      type: [Number], // multi department support
      default: [],
    },

    power_id: {
      type: Number, // reference to Power
      required: true,
    },

    canReceiveNotesheet: {
      type: Boolean,
      default: false,
    },

    view_scope: {
  type: String,
  enum: ["OWN", "DEPARTMENT", "ALL"],
  default: "OWN",
},
view_dept_ids: {
  type: [Number],
  default: [],  
  },
},
  { timestamps: true }
);

// Indexes
roleSchema.index({ role_name: 1 });
roleSchema.index({ power_id: 1 });
roleSchema.index({ dept_ids: 1 });

const Role = mongoose.model("Role", roleSchema);
export default Role;