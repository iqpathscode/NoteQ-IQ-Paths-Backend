import mongoose from 'mongoose';

const notesheetFlowSchema = new mongoose.Schema(
  {
    note_id: {
      type:     String,
      required: true
    },

    // ================= FROM =================
    from_emp_id: {
      type:     Number,
      required: true
    },
    from_emp_name:  { type: String },
    from_role_id:   { type: Number },
    from_role_name: { type: String },

    // ================= TO =================
    to_emp_id:    { type: Number, default: null },
    to_emp_name:  { type: String },
    to_role_id:   { type: Number },
    to_role_name: { type: String },
    to_dept_id:   { type: Number },

    // ================= ACTION =================
    action: {
      type: String,
      enum: [
        'CREATED',
        'FORWARDED',
        'APPROVED',
        'REJECTED',
        'QUERY',
        'QUERY_REPLY',
        'EXECUTION_STARTED',
        'CLOSED'
      ],
      required: true
    },

   remark: {
      type:    [String],
      trim:    true,
      default: []
    },

    level: {
      type:     Number,
      required: true
    },

    final_status: {
      type: String,
      enum: [
        'PENDING',
        'QUERY_RAISED',
        'RESOLVED',
        'APPROVED',
        'REJECTED',
        'COMPLETED'
      ],
      default: 'PENDING'
    }
  },
  {
    timestamps: true
  }
);

// Performance Indexes for lookups, aggregations and history fetching
notesheetFlowSchema.index({ note_id: 1, createdAt: 1 });
notesheetFlowSchema.index({ from_role_id: 1, from_emp_id: 1, createdAt: 1 });
notesheetFlowSchema.index({ from_emp_id: 1, action: 1 });
notesheetFlowSchema.index({ note_id: 1, final_status: 1 });

const NotesheetFlow = mongoose.model('NotesheetFlow', notesheetFlowSchema);
export default NotesheetFlow;