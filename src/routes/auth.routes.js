import express from "express";

// Admin Controller
import { createAdmin } from "../controllers/admin.controller.js";
// Auth Controllers
import {
  login,
  changePassword,
  getMe,
  createUserByAdmin,
} from "../controllers/login/auth.controller.js";
import { signup } from "../controllers/signup/auth.controller.js";
// School & Department Controllers
import {
  createSchool,
  getAllSchools,
} from "../controllers/school.controller.js";
import {
  createDepartment,
  getAllDepartments,
} from "../controllers/department.controller.js";
// createnote controller
import {
  createNotesheet,
  getEligibleRoles,
} from "../controllers/createNote.controller.js";
// Role Controllers
import {
  createPowerLevel,
  getAllPowerLevels,
  assignPowerToRole,
  assignDeptToRole,
  updateDeptOfRole,
} from "../controllers/role.controller.js";
// Power Controllers
import {
  createPower,
  getAllPowers,
  updatePowerOfFaculty,
} from "../controllers/power.controller.js";
// Employee Controllers
import {
  getEmployeeDetailsById,
  getEmployeeNotesheetSummary,
  getEmployeesWithDetails,
  assignRoleToFaculty,
  updateRoleOfFaculty,
  switchEmployeeRole,
} from "../controllers/employe.controller.js";
// Notesheet Controllers
import {
  getNotesheetById,
  getNotesheetsForEmployee,
  getAllNotesheets,
  getApprovalFlow,
} from "../controllers/notesheet.controller.js";
// Middleware
import {
  authenticate,
  isAdmin,
} from "../middlewares/auth.middleware.js";
// upload
import { upload } from "../utility/cloudinary.js";
import { uploadAttachment } from "../controllers/upload.controller.js";

// Notification
import {
  createNotification,
  getNotifications,
  deleteNotification,
} from "../controllers/notification.controller.js";

import {
  approveNotesheet,
  rejectNotesheet,
  sendQuery,
  replyQuery,
  getReceivedNotesheets,
} from "../controllers/notesheetAction.controller.js";

const router = express.Router();

// ---------------- ADMIN ----------------
router.post("/admin", createAdmin);

// ---------------- AUTH ----------------
router.post("/login", login);
router.post("/signup", signup);
router.get("/me", authenticate, getMe);
router.put("/change-password", authenticate, changePassword);

router.post("/admin/create-user", authenticate, isAdmin, createUserByAdmin);

// ---------------- FILE UPLOAD ----------------
router.post("/upload", upload.single("file"), uploadAttachment);

// ---------------- SCHOOL ----------------
router.post("/school", authenticate, isAdmin, createSchool);
router.get("/school", authenticate, getAllSchools);

// ---------------- DEPARTMENT ----------------
router.post("/department", authenticate, isAdmin, createDepartment);
router.get("/department", authenticate, getAllDepartments);

// ---------------- POWER ----------------
router.post("/power", authenticate, isAdmin, createPower);
router.get("/power", authenticate, getAllPowers);

// ---------------- ROLE ----------------
router.post("/power-level", authenticate, isAdmin, createPowerLevel);
router.get("/power-level", authenticate, getAllPowerLevels);
router.get("/roles/eligible", authenticate, getEligibleRoles);

// Assignments
router.post("/assign-power", authenticate, isAdmin, assignPowerToRole);
router.post("/assign-role", authenticate, isAdmin, assignRoleToFaculty);
router.post("/assign-dept-role", authenticate, isAdmin, assignDeptToRole);

// Updates
router.put("/update-role", authenticate, isAdmin, updateRoleOfFaculty);
router.put("/switch-role", authenticate, switchEmployeeRole);
router.put("/update-power", authenticate, isAdmin, updatePowerOfFaculty);
router.put("/update-dept-role", authenticate, isAdmin, updateDeptOfRole);

// ---------------- EMPLOYEES ----------------
router.get("/employees", authenticate, getEmployeesWithDetails);
router.get("/employee/:empId", authenticate, getEmployeeDetailsById);
router.get(
  "/employee/:empId/notesheets/summary",
  authenticate,
  getEmployeeNotesheetSummary,
);

// ---------------- NOTESHEET ----------------
router.post("/notesheet", authenticate, createNotesheet);
router.get("/notesheets/all", authenticate, isAdmin, getAllNotesheets);
// employee notesheets
router.get("/notesheets/employee", authenticate, getNotesheetsForEmployee);
// received notesheets (important: before :noteId)
router.get("/notesheets/received", authenticate, getReceivedNotesheets);
// notesheet details
router.get("/notesheets/:noteId", authenticate, getNotesheetById);

// ---------------- NOTESHEET ACTIONS ----------------
// approve
router.put("/notesheets/:noteId/approve", authenticate, approveNotesheet);
// reject
router.put("/notesheets/:noteId/reject", authenticate, rejectNotesheet);
// send query
router.put("/notesheets/:noteId/query", authenticate, sendQuery);
// reply query
router.put("/notesheets/:noteId/reply-query", authenticate, replyQuery);
// approval flow
router.get(
  "/notesheets/:noteId/approval-flow",
  authenticate,
  getApprovalFlow,
);

// Approval Flow
router.get(
  "/notesheets/:noteId/approval-flow",
  authenticate,
  getApprovalFlow,
);

// ---------------- NOTIFICATIONS ----------------
router.post(
  "/notifications",
  authenticate,
  createNotification,
);

router.get(
  "/notifications",
  authenticate,
  getNotifications,
);

router.delete(
  "/notifications/:id",
  authenticate,
  deleteNotification,
);

export default router;