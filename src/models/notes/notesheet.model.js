import mongoose from 'mongoose';

const notesheetSchema = new mongoose.Schema(
  {
    note_id: {
      type: Number,
      required: true,
      unique: true
    },

    emp_id: {
      type: Number,
      required: true
    },

    dept_id: {
      type: Number,
      required: true
    },

    subject: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      required: true,
      trim: true
    },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    },

    forward_to: {
      type: Number, // next emp_id / role_id
      default: null
    },

    attachment: {
      type: String,
      default: null
    },

    mode: {
      type: Number, // 0 = offline, 1 = online
      enum: [0, 1],
      default: 0
    },

    level: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true
  }
);

const Notesheet = mongoose.model('Notesheet', notesheetSchema);
export default Notesheet;
