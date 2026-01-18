import dotenv from "dotenv";
dotenv.config()

import express from "express";
import dbConnect from "./databaseConfig/database.config.js";
const app = express();

const port = process.env.PORT || 5000;

try {
    dbConnect()
    .then((res)=>{
        console.log("Database connected successfully");
    })
    .catch((err)=>{
        console.log("Failed to connect db : ", err);
    });

    app.listen(port , ()=>{
        console.log(`Server is running on port ${port}`);
    })
} catch (err) {
    console.log("Database call in index and get a error :",err)
    process.exit(1);
}


app.get('/',(req,res)=>{
    res.send("NoteQ is here live !!")
})


