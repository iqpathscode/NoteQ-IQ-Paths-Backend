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

    power_level: {
      type: Number,
      required: true,
      default: 0,
    },
dept_ids: {
  type: [Number],   
  required: true,   // must have at least one dept
  default: [],
},

    power_id: {
      type: Number,
      required: true,
    },

    canReceiveNotesheet: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Prevent duplicate role names in same department
roleSchema.index({ role_name: 1 });

// Fast lookup for approvers
roleSchema.index({ power_id: 1 });

const Role = mongoose.model("Role", roleSchema);

export default Role;