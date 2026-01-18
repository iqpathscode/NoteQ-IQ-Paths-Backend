import mongoose from 'mongoose';

const notesheetSchema = new mongoose.Schema({
  note_sr_no: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  note_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  emp_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  date_create: {
    type: Date,
    default: Date.now,
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  forward_to: {
    type: Number,
    default: null
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  attachment: {
    type: String,
    default: null
  },
  mode: {
    type: Number,
    enum: [0, 1],
    default: 0
  },
//   dept_id: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Department',
//     required: true
//   },
  level: {
    type: Number,
    required: true,
    default: 1
  }
}, {
  timestamps: true
});

const Notesheet = mongoose.model('Notesheet', notesheetSchema);

export default Notesheet;