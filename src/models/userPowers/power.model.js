import mongoose from 'mongoose';

const powerSchema = new mongoose.Schema({
  power_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  power_name: {
    type: String,
    required: true,
    trim: true
  },
  power_rank: {
    type: Number,
    required: true,
    default: 0
  },
  power_type: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

const Power = mongoose.model('Power', powerSchema);

export default Power;