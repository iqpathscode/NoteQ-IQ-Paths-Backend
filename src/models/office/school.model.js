import mongoose from 'mongoose';

const schoolSchema = new mongoose.Schema({
  school_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  school_name: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

const School = mongoose.model('School', schoolSchema);

export default School;