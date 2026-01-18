import mongoose from "mongoose";
import { dbName } from "../constants/constants.js";

const dbConnect = async ()=>{
    try {
        await mongoose.connect(process.env.MONGODB_URL/dbName)
        .then((res)=>{
            console.log("Database connected successfully");
        })
        .catch((err)=>{
            console.log("Failed to connect db : ", err);
        });
    } catch (error) {
        console.log("Database connection error : ", error);
    }
    

}


export default dbConnect;