import dotenv  from "dotenv";
dotenv.config();

export const env = {
  PORT:process.env.PORT,
  MONGO_URI:process.env.MONGO_URI,
  JWT_SECRET:process.env.JWT_SECRET,
  JWT_EXPIRES_IN:process.env.JWT_EXPIRES_IN,
  CLOUDINARY_CLOUD_NAME:process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY:process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET:process.env.CLOUDINARY_API_SECRET,
  FRONTEND_URL:process.env.FRONTEND_URL,
  EMAIL_USER: process.env.EMAIL_USER,
  ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY,
  REDIS_URL: process.env.REDIS_URL,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
}
