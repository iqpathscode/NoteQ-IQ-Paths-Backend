import mongoose from 'mongoose';

const notesheetFlowSchema = new mongoose.Schema(
  {
    note_id: {
      type: Number,
      required: true
    },

    // ================= FROM =================
    from_emp_id: {
      type: Number,
      required: true
    },

    from_emp_name: {   
      type: String
    },

    from_role_id: {
      type: Number
    },

    from_role_name: {  
      type: String
    },

    // ================= TO =================
    to_emp_id: { type: Number, default: null },

    to_emp_name: {     
      type: String
    },

    to_role_id: { type: Number },

    to_role_name: {    
      type: String
    },

    to_dept_id: { type: Number },

    // ================= ACTION =================
    action: {
      type: String,
      enum: ['CREATED', 'FORWARDED', 'APPROVED', 'REJECTED', 'QUERY', 'QUERY_REPLY'],
      required: true
    },

    remark: {
      type: [String],
      trim: true,
      default: []
    },

    level: {
      type: Number,
      required: true
    },

    final_status: {
      type: String,
      enum: ['PENDING', 'REPLIED', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    }
  },
  {
    timestamps: true
  }
);

const NotesheetFlow = mongoose.model('NotesheetFlow', notesheetFlowSchema);

export default NotesheetFlow;