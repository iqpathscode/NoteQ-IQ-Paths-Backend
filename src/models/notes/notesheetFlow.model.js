import mongoose from 'mongoose';

const notesheetFlowSchema = new mongoose.Schema(
  {
    note_id: {
      type: Number,
      required: true
    },

    from_emp_id: {
      type: Number,
      required: true
    },

    to_emp_id: {
      type: Number,
      default: null
    },

    action: {
      type: String,
      enum: ['CREATED', 'FORWARDED', 'APPROVED', 'REJECTED'],
      required: true
    },

    remark: {
      type: String,
      trim: true,
      default: null
    },

    level: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Fast history fetch
notesheetFlowSchema.index({ note_id: 1, createdAt: 1 });

const NotesheetFlow = mongoose.model(
  'NotesheetFlow',
  notesheetFlowSchema
);

export default NotesheetFlow;
