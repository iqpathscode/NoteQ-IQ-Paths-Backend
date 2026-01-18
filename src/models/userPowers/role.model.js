import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  role_id: {
    type: Number,
    required: true,
    unique: true,
    trim: true
  },
  role_name: {
    type: String,
    required: true,
    trim: true
  },
  power: {
    type: Number,
    required: true,
    default: 0
  },
  role_dep_id: {
    type : Number,
    // type: mongoose.Schema.Types.ObjectId,
    // ref: 'Department',
    required: true
  }
}, {
  timestamps: true
});

const Role = mongoose.model('Role', roleSchema);

export default Role;
