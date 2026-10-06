// app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./src/routes/auth.routes.js";
import uploadRoutes from "./src/routes/upload.routes.js";
import appConfigRoute from "./src/routes/appConfigRoute.js";
import applicationRoutes from "./src/routes/application.routes.js";
import queryRoutes from "./src/routes/query.routes.js";
import notificationRoutes from "./src/routes/notificationRoute.js";
import { authenticate, requireModule } from "./src/middlewares/auth.middleware.js";
import announcementRoutes from "./src/routes/announcementRoutes.js";
import attachmentRoutes from "./src/routes/attachmentRoutes.js";
import reportRoutes from "./src/routes/report.routes.js";
import downloadRoutes from "./src/routes/download.routes.js";
import leaveRoutes from "./src/routes/leave.routes.js";
import holidayRoutes from "./src/routes/holiday.routes.js";
import hrmsManageRoutes from "./src/routes/hrmsManage.routes.js";
import recruitmentRoutes from "./src/routes/recruitment.routes.js";
import { errorHandler } from "./src/middlewares/errorHandler.js";

const app = express();

// middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://intellect-quest-paths-yc7m.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
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

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// routes
app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/admin/app-config", appConfigRoute);
app.use("/api/applications", requireModule("application"), applicationRoutes);
app.use("/api/query", queryRoutes);
app.use("/api/notifications", authenticate, notificationRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/auth/notesheets", requireModule("notesheet"), attachmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/leave", requireModule("leave"), leaveRoutes);
app.use("/api/holidays", requireModule("leave"), holidayRoutes);
app.use("/api/hrms", requireModule("leave"), hrmsManageRoutes);
app.use("/api/recruitment", requireModule("recruitment"), recruitmentRoutes);
app.set("trust proxy", 1);

app.get("/test", (req, res) => {
  res.send("API working");
});

app.get("/", (req, res) => {
  res.send("NoteQ is here live !!");
});

app.use(errorHandler);

export default app;
