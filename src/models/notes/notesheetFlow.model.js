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

    from_role_id: { 
      type: Number
     },
to_emp_id: { type: Number, default: null }, 
to_role_id: { type: Number  }, 
to_dept_id: { type: Number }, 


    action: {
  type: String,
  enum: ['CREATED', 'FORWARDED', 'APPROVED', 'REJECTED', 'QUERY', 'QUERY_REPLY'],
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
    },

    final_status: { 
      type: String, enum: ['PENDING', 'REPLIED', 'APPROVED', 'REJECTED'], 
      default: 'PENDING' }
  },
  {
    timestamps: true
  }
);

// Fast history + current approver fetch 
notesheetFlowSchema.index({ note_id: 1, createdAt: 1 }); 
notesheetFlowSchema.index({ note_id: 1, level: 1 });
notesheetFlowSchema.index({ note_id: 1, final_status: 1 });

const NotesheetFlow = mongoose.model(
  'NotesheetFlow',
  notesheetFlowSchema
);

export default NotesheetFlow;