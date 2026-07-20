import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";
import path from "path";
import { env } from "../config/env.config.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key:    env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = path.extname(file.originalname).replace(".", ""); // "pdf"
    return {
      folder: "notesheets",
      resource_type: "auto",
      //  original naam se public_id set karo (spaces → underscores)
      public_id: `${Date.now()}-${file.originalname.replace(/\s+/g, "_").replace(/\.[^/.]+$/, "")}`,
      format: ext,
    };
  },
});

export const upload = multer({ storage });