import Admin from "../models/user/admin.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const createAdmin = async (req, res) => {
  try {
    const { admin_id, admin_name, designation, mobile_number, email, password } = req.body;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await Admin.create({
      admin_id,
      admin_name,
      designation,
      mobile_number,
      email,
      password: hashedPassword,
      is_admin: true
    });

    return res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: admin
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};