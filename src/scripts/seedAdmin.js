import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import Admin from "../src/models/user/admin.model.js"; 
const MONGO_URI = process.env.MONGO_URI;

const DEFAULT_ADMIN = {
  admin_id: 1,
  admin_name: process.env.SEED_ADMIN_NAME || "Admin",
  designation: process.env.SEED_ADMIN_DESIGNATION || "Super Admin",
  mobile_number: process.env.SEED_ADMIN_MOBILE || "8756379365",
  email: process.env.SEED_ADMIN_EMAIL || "gawanderinki1016@gmail.com",
  // Plaintext password — sirf seed ke waqt use hota hai, DB me hamesha hashed hi jaayega
  password: process.env.SEED_ADMIN_PASSWORD || "Admin@123",
  is_active: true,
  is_admin: true,
};

const seedAdmin = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set in environment variables");
    }

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const existing = await Admin.findOne({
      $or: [{ admin_id: DEFAULT_ADMIN.admin_id }, { email: DEFAULT_ADMIN.email }],
    });

    if (existing) {
      console.log(
        `Admin already exists (admin_id: ${existing.admin_id}, email: ${existing.email}) — skipping seed.`
      );
      return;
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, 10);

    const admin = await Admin.create({
      ...DEFAULT_ADMIN,
      password: hashedPassword,
    });

    console.log("Admin seeded successfully:");
    console.log({
      admin_id: admin.admin_id,
      admin_name: admin.admin_name,
      email: admin.email,
      designation: admin.designation,
    });
    console.log(
      `Login password (plaintext, save this somewhere safe): ${DEFAULT_ADMIN.password}`
    );
  } catch (error) {
    console.error("Error seeding admin:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
};

seedAdmin();