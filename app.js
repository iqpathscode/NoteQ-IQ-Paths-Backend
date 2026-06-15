// app.js
import express from "express";
import authRoutes from "./src/routes/auth.routes.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import uploadRoutes from "./src/routes/upload.routes.js";
import appConfigRoute from "./src/routes/appConfigRoute.js";
import { generalRateLimiter } from "./src/middlewares/rateLimiter.middleware.js";
import applicationRoutes from "./src/routes/application.routes.js";
import queryRoutes from "./src/routes/query.routes.js";

const app = express();

// middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://intellect-quest-paths-yc7m.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(generalRateLimiter);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // <-- important for reading cookies

// routes
app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/admin/app-config", appConfigRoute);
app.use("/api/applications", applicationRoutes);
app.use("/api/query", queryRoutes);

app.get("/test", (req, res) => {
  res.send("API working");
});

app.get("/", (req, res) => {
  res.send("NoteQ is here live !!");
});

export default app;
