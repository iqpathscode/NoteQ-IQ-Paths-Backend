import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Admin from "../models/user/admin.model.js";

const MONGO_URI = process.env.MONGO_URI;

const envPassword = process.env.SUPER_ADMIN_PASSWORD;

const SUPER_ADMIN = {
  admin_id: 1,
  admin_name: process.env.SUPER_ADMIN_NAME || "Super Admin",
  designation: "Master Super Admin",
  mobile_number: process.env.SUPER_ADMIN_MOBILE || "9999999999",
  email: (process.env.SUPER_ADMIN_EMAIL || "superadmin@noteq.local").toLowerCase(),
  password: envPassword || crypto.randomBytes(9).toString("base64url"),
  is_active: true,
  is_admin: true,
  is_super_admin: true,
};

const run = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set in .env");
    }

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    // Check if any admin exists with this email or admin_id
    const targetEmail = SUPER_ADMIN.email;
    let admin = await Admin.findOne({ email: targetEmail });

    if (admin) {
      admin.is_super_admin = true;
      admin.is_admin = true;
      admin.is_active = true;
      await admin.save();
      console.log(`✅ Existing admin (${admin.email}) upgraded to SUPER ADMIN successfully!`);
    } else {
      // Check if admin_id 1 exists with different email
      const existingId = await Admin.findOne({ admin_id: SUPER_ADMIN.admin_id });
      if (existingId) {
        // Just upgrade this existing primary admin
        existingId.is_super_admin = true;
        await existingId.save();
        console.log(`✅ Existing admin ID 1 (${existingId.email}) upgraded to SUPER ADMIN!`);
      } else {
        const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, 10);
        admin = await Admin.create({
          ...SUPER_ADMIN,
          password: hashedPassword,
        });
        console.log("✅ Super Admin created successfully:");
        console.log({
          admin_id: admin.admin_id,
          admin_name: admin.admin_name,
          email: admin.email,
          password: SUPER_ADMIN.password,
        });
      }
    }
  } catch (error) {
    console.error("Error seeding super admin:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
};

run();
