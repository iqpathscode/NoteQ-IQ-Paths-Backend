import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";
import { env } from "../config/env.config.js";

cloudinary.config({
  cloud_name:env.CLOUDINARY_CLOUD_NAME,
  api_key:env.CLOUDINARY_API_KEY,
  api_secret:env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "notesheets",
    resource_type: "auto",
  },
});

export const upload = multer({ storage });
