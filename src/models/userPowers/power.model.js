import mongoose from 'mongoose';

const powerSchema = new mongoose.Schema(
  {
    power_id: { type: Number, required: true, unique: true },
    power_name: { type: String, required: true, trim: true },
    power_level: { type: Number, required: true },
    power_type: { type: String, required: true, trim: true },
     scope: {
    type: String,
    enum: ["DEPARTMENT", "SCHOOL", "GLOBAL"],
    required: true,
  },
  },
  
  { timestamps: true }
);

// Fast lookup for chain progression 
powerSchema.index({ power_level: 1 });

const Power = mongoose.model('Power', powerSchema);
export default Power;