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
  deleteSchool,
} from "../controllers/school.controller.js";
import {
  createDepartment,
  getAllDepartments,
  deleteDepartment,
} from "../controllers/department.controller.js";
// createnote controller
import {
  createNotesheet,
  getEligibleRoles,
  forwardChainOnly,
} from "../controllers/createNote.controller.js";
// Role Controllers
import {
  createRole,
  getAllRoles,
  assignPowerToRole,
  assignDeptToRole,
  updateDeptOfRole,
  deleteRole, 
} from "../controllers/role.controller.js";
// Power Controllers
import {
  createPower,
  getAllPowers,
  updatePowerOfFaculty,
  deletePower,
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
  getRecentNotesheets,
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
  approveNotesheetDirect,
  approveNotesheetChain,
  rejectNotesheet,
  sendQuery,
  replyQuery,
  getReceivedNotesheets,
  getQueriesByNoteId,
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
router.delete("/school/:id", deleteSchool);

// ---------------- DEPARTMENT ----------------
router.post("/department", authenticate, isAdmin, createDepartment);
router.get("/department", authenticate, getAllDepartments);
router.delete("/department/:id", deleteDepartment);

// ---------------- POWER ----------------
router.post("/power", authenticate, isAdmin, createPower);
router.get("/power", authenticate, getAllPowers);
router.delete("/power/:id", deletePower);

// ---------------- ROLE ----------------
router.post("/role", authenticate, isAdmin, createRole);
router.get("/role", authenticate, getAllRoles);
router.get("/roles/eligible", authenticate, getEligibleRoles);
router.delete("/role/:id", deleteRole);

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
// static routes
router.get("/notesheets/recent", authenticate, getRecentNotesheets);
router.get("/notesheets/received", authenticate, getReceivedNotesheets);
router.get("/notesheets/employee", authenticate, getNotesheetsForEmployee);
// nested routes
router.get("/notesheets/:noteId/approval-flow", authenticate, getApprovalFlow);
// dynamic routes last
router.get("/notesheets/:noteId", authenticate, getNotesheetById);

// ---------------- NOTESHEET ACTIONS ----------------
// approve direct
router.put("/notesheets/:noteId/approve-Direct", authenticate, approveNotesheetDirect);
// approve chain
router.put(
  "/notesheets/:noteId/approve-chain",
  authenticate,
  approveNotesheetChain
);
// forward chain only
router.put("/notesheets/forward", authenticate, forwardChainOnly);
// reject
router.put("/notesheets/:noteId/reject", authenticate, rejectNotesheet);
// send query
router.put("/notesheets/:noteId/query", authenticate, sendQuery);
// reply query
router.put("/notesheets/:noteId/reply-query", authenticate, replyQuery);
// get queries by noteId
router.get("/notesheets/:noteId/queries", authenticate, getQueriesByNoteId);

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