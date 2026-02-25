import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    admin_id: {
      type: Number,
      required: true,
      unique: true
    },
    admin_name: {
      type: String,
      required: true,
      trim: true
    },
    designation: {
      type: String,
      required: true,
      trim: true
    },
    mobile_number: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true
    },
    password:{
      type: String,
      required:true
    },
    is_active: { type: Boolean, default: true }, last_login: { type: Date, default: null },
    is_admin: { type: Boolean, default: false }

  },
  {
    timestamps: true
  }
);

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;
