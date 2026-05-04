import express from "express";

// Controllers
import { createAdmin } from "../controllers/admin.controller.js";

// Auth
import {
  login,
  changePassword,
  getMe,
  createUserByAdmin,
  logout,
  forgotPassword,
  resetPassword,
} from "../controllers/login/auth.controller.js";

import { signup, 
 } from "../controllers/signup/auth.controller.js";

// School & Department
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

// Notesheet Creation
import {
  createNotesheet,
  getEligibleRoles,
  forwardChainOnly,
} from "../controllers/createNote.controller.js";

// Roles
import {
  createRole,
  getAllRoles,
  assignPowerToRole,
  assignDeptToRole,
  updateDeptOfRole,
  deleteRole,
} from "../controllers/role.controller.js";

// Power
import {
  createPower,
  getAllPowers,
  updatePowerOfFaculty,
  deletePower,
} from "../controllers/power.controller.js";

// Employee
import {
  getEmployeeDetailsById,
  getEmployeeNotesheetSummary,
  getEmployeesWithDetails,
  switchEmployeeRole,
  transferRole,
  assignRoleToFaculty,
  updateRoleOfFaculty,
  getProfile,
  updateProfile,
} from "../controllers/employe.controller.js";

// Notesheet
import {
  getNotesheetById,
  getNotesheetsForEmployee,
  getAllNotesheets,
  getApprovalFlow,
  getRecentNotesheets,
  getAllNotesheetsByScope,
} from "../controllers/notesheet.controller.js";

// Actions
import {
  approveNotesheetDirect,
  approveNotesheetChain,
  rejectNotesheet,
  sendQuery,
  replyQuery,
  getReceivedNotesheets,
  getQueriesByNoteId,
  forwardNotesheetDirect,
  getProcessedNotesheets,
} from "../controllers/notesheetAction.controller.js";

// Upload
import { upload } from "../utility/cloudinary.js";
import { uploadAttachment } from "../controllers/upload.controller.js";

// Excel
import { bulkSignup } from "../controllers/execl.contorller.js";
import { uploadExcel } from "../utility/excel.js";

// Download
import {
  bulkDownload,
  downloadNotesheet,
} from "../controllers/downloadNotesheet.js";

// Notifications
import {
  createNotification,
  getNotifications,
  deleteNotification,
} from "../controllers/notification.controller.js";

// Middleware
import { authenticate, isAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();


// ======================== ADMIN ========================
router.post("/admin", createAdmin);


// ======================== AUTH ========================
router.post("/login", login);
router.post("/signup", signup);
router.get("/me", authenticate, getMe);
router.put("/change-password", authenticate, changePassword);
router.post("/admin/create-user", authenticate, isAdmin, createUserByAdmin);
router.post("/logout", authenticate, logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);



// ======================== UPLOAD ========================
router.post("/upload", upload.single("file"), uploadAttachment);


// ======================== SCHOOL ========================
router.post("/school", authenticate, isAdmin, createSchool);
router.get("/school", authenticate, getAllSchools);
router.delete("/school/:id", authenticate, isAdmin, deleteSchool);


// ======================== DEPARTMENT ========================
router.post("/department", authenticate, isAdmin, createDepartment);
router.get("/department", authenticate, getAllDepartments);
router.delete("/department/:id", authenticate, isAdmin, deleteDepartment);


// ======================== POWER ========================
router.post("/power", authenticate, isAdmin, createPower);
router.get("/power", authenticate, getAllPowers);
router.put("/power", authenticate, isAdmin, updatePowerOfFaculty);
router.delete("/power/:id", authenticate, isAdmin, deletePower);


// ======================== ROLE ========================
router.post("/role", authenticate, isAdmin, createRole);
router.get("/role", authenticate, getAllRoles);
router.get("/roles/eligible", authenticate, getEligibleRoles);
router.delete("/role/:id", authenticate, isAdmin, deleteRole);

// Role Assignments
router.post("/assign-power", authenticate, isAdmin, assignPowerToRole);
router.post("/assign-role", authenticate, isAdmin, assignRoleToFaculty);
router.post("/assign-dept-role", authenticate, isAdmin, assignDeptToRole);

// Role Updates
router.put("/update-role", authenticate, isAdmin, updateRoleOfFaculty);
router.put("/update-power", authenticate, isAdmin, updatePowerOfFaculty);
router.put("/update-dept-role", authenticate, isAdmin, updateDeptOfRole);
router.put("/role/switch-role", authenticate, switchEmployeeRole);
router.put("/transfer-role", authenticate, transferRole);
router.get("/profile", authenticate, getProfile);
router.put("/update-profile", authenticate, updateProfile);


// ======================== EMPLOYEES ========================
router.get("/employees", authenticate, getEmployeesWithDetails);
router.get("/employee/:empId", authenticate, getEmployeeDetailsById);
router.get(
  "/employee/:empId/notesheets/summary",
  authenticate,
  getEmployeeNotesheetSummary
);


// ======================== NOTESHEET ========================

// Create
router.post("/notesheet", authenticate, createNotesheet);

// LIST (clean grouping)
router.get("/notesheets", authenticate, getAllNotesheets);
router.get("/notesheets/recent", authenticate, getRecentNotesheets);
router.get("/notesheets/received", authenticate, getReceivedNotesheets);
router.get("/notesheets/employee", authenticate, getNotesheetsForEmployee);
router.get("/notesheets/scope", authenticate, getAllNotesheetsByScope);
router.get("/notesheets/processed", authenticate, getProcessedNotesheets);

// Nested
router.get(
  "/notesheets/:noteId/approval-flow",
  authenticate,
  getApprovalFlow
);

// IMPORTANT: KEEP THIS LAST
router.get("/notesheets/:noteId", authenticate, getNotesheetById);


// ======================== NOTESHEET ACTIONS ========================
router.put(
  "/notesheets/:noteId/approve-direct",
  authenticate,
  approveNotesheetDirect
);

router.put(
  "/notesheets/:noteId/approve-chain",
  authenticate,
  approveNotesheetChain
);

router.put(
  "/notesheets/:noteId/forward-direct",
  authenticate,
  forwardNotesheetDirect
);

router.put("/notesheets/forward", authenticate, forwardChainOnly);

router.put(
  "/notesheets/:noteId/reject",
  authenticate,
  rejectNotesheet
);

router.put(
  "/notesheets/:noteId/query",
  authenticate,
  sendQuery
);

router.put(
  "/notesheets/:noteId/reply-query",
  authenticate,
  replyQuery
);

router.get(
  "/notesheets/:noteId/queries",
  authenticate,
  getQueriesByNoteId
);


// ======================== DOWNLOAD ========================
router.get(
  "/notesheets/download/:id",
  authenticate,
  downloadNotesheet
);

router.post(
  "/notesheets/bulk-download",
  authenticate,
  bulkDownload
);


// ======================== NOTIFICATIONS ========================
router.post("/notifications", authenticate, createNotification);

router.get("/notifications", authenticate, getNotifications);

router.delete(
  "/notifications/:id",
  authenticate,
  deleteNotification
);


// ======================== EXCEL ========================
router.post(
  "/bulk-upload",
  uploadExcel.single("file"),
  bulkSignup
);


export default router;
