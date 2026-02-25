// app.js
import express from "express";
import authRoutes from './src/routes/auth.routes.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import uploadRoutes from "./src/routes/upload.routes.js";

const app = express();

// middleware
app.use(cors({
  origin: 'http://localhost:5173', // adjust to your frontend domain
  credentials: true                // allow cookies to be sent
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // <-- important for reading cookies

// routes
app.use('/api/auth', authRoutes);
app.use('/api', uploadRoutes);

app.get('/test', (req, res) => {
  res.send('API working');
});

app.get("/", (req, res) => {
  res.send("NoteQ is here live !!");
});

export default app;

