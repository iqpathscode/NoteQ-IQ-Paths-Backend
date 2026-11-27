import mongoose from "mongoose";
import { dbName } from "../constants/constants.js";
import { env } from "./env.config.js";
const dbConnect = async () => {
  try {
    const mongoUrl = `${env.MONGO_URI}/${dbName}`;

    await mongoose.connect(mongoUrl, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 50,
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 60000,
    });

    console.log("Database connected successfully");
  } catch (error) {
    console.error("Failed to connect db :", error.message);
    process.exit(1); // app stop if DB fails
  }
};

export default dbConnect;
