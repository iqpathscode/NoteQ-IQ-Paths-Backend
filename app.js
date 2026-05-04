// app.js
import express from "express";
import authRoutes from './src/routes/auth.routes.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import uploadRoutes from "./src/routes/upload.routes.js";

const app = express();

// middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://intellect-quest-paths-yc7m.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
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

