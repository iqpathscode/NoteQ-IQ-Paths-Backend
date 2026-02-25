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

   forward_to_emp_id: {
     type: Number, 
     default: null 
    }, 
    
    forward_to_role_id: { 
      type: Number, 
      default: null 
    },

    attachment: {
      type: String,
      default: null
    },

    mode: {
      type: Number, // 0 = Direct, 1 = chain
      enum: [0, 1],
      default: 1
    },

    level: {
      type: Number,
      default: 0
    },

    created_by: { type: Number }, 
    updated_by: { type: Number }
  },
  {
    timestamps: true
  }
);

// Indexes for fast lookup 
notesheetSchema.index({ dept_id: 1, status: 1 }); notesheetSchema.index({ note_id: 1, level: 1 });

const Notesheet = mongoose.model('Notesheet', notesheetSchema);
export default Notesheet;
