import mongoose from "mongoose";
import { dbName } from "../constants/constants.js";
import { env } from "./env.config.js";
const dbConnect = async () => {
  try {
    const mongoUrl = `${env.MONGO_URI}/${dbName}`;

    await mongoose.connect(mongoUrl);

    console.log("Database connected successfully");
  } catch (error) {
    console.error("Failed to connect db :", error.message);
    process.exit(1); // app stop if DB fails
  }
};

export default dbConnect;
