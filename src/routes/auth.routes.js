import express from "express";

// Controllers
import { createAdmin } from "../controllers/admin.controller.js";

// Auth
import {
  login,
  changePassword,
  getMe,
  // createUserByAdmin,
  logout,
  forgotPassword,
  resetPassword,
} from "../controllers/login/auth.controller.js";

import {
  createUserByAdmin
} from "../controllers/userController.js"
// import { signup, 
//  } from "../controllers/signup/auth.controller.js";

// School & Department
import {
  createSchool,
  getSchools,
  deleteSchool,
} from "../controllers/school.controller.js";

import {
  createDepartment,
  getDepartments,
  deleteDepartment,
} from "../controllers/department.controller.js";

// Notesheet Creation
import {
  createNotesheet,
  getEligibleRoles,
  forwardChainOnly,
  getExecutionNotesheets,
  forwardExecutionNotesheet,
  completeExecutionNotesheet,
  getNotesheetForRef,
  deleteNotesheet,
  editNotesheet,
} from "../controllers/createNote.controller.js";

// Roles
import {
  createRole,
  getAllRoles,
  // assignPowerToRole,
  // assignDeptToRole,
  updateDeptOfRole,
  deleteRole,
  getRoleAssignedEmployee
} from "../controllers/role.controller.js";

// Power
import {
  createPower,
  getAllPowers,
  // updatePowerOfFaculty,
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
  // updateRoleOfFaculty,
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
  getDepartmentsByRole,
} from "../controllers/notesheet.controller.js";

import { getCombinedDashboardData } from "../controllers/dashboard.controller.js";

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
  getApprovedNotesheetsByRole,
} from "../controllers/notesheetAction.controller.js";

// Upload
import { upload } from "../utility/cloudinary.js";
import { uploadAttachment } from "../controllers/upload.controller.js";

// Excel
import { bulkSignup } from "../controllers/execl.contorller.js";
import { uploadExcel } from "../utility/excel.js";


// Middleware
import { authenticate, isAdmin, verifyAdminSecret  } from "../middlewares/auth.middleware.js";
import { loginRateLimiter, forgotPasswordRateLimiter } from "../middlewares/rateLimiter.middleware.js"

import {
  createNotesheetHeader,
  getActiveNotesheetHeader,
  getAllNotesheetHeaders,
  updateNotesheetHeader,
  deleteNotesheetHeader,
} from "../controllers/notesheetHeader.controller.js";

const router = express.Router();

router.post("/admin", verifyAdminSecret, createAdmin); 


// ======================== AUTH ========================
router.post("/login", loginRateLimiter, login);
router.get("/me", authenticate, getMe);
router.put("/change-password", authenticate, changePassword);
router.post("/admin/create-user", authenticate, isAdmin, createUserByAdmin);
router.post("/logout", authenticate, logout);
router.post("/forgot-password", forgotPasswordRateLimiter, forgotPassword);
router.post("/reset-password/:token", resetPassword);


// ======================== UPLOAD ========================
router.post("/upload", authenticate, upload.single("file"), uploadAttachment); 


// ======================== SCHOOL ========================
router.post("/school", authenticate, isAdmin, createSchool);
router.get("/school", authenticate, getSchools);
router.delete("/school/:id", authenticate, isAdmin, deleteSchool);


// ======================== DEPARTMENT ========================
router.post("/department", authenticate, isAdmin, createDepartment);
router.get("/department", authenticate, getDepartments);
router.delete("/department/:id", authenticate, isAdmin, deleteDepartment);


// ======================== POWER ========================
router.post("/power", authenticate, isAdmin, createPower);
router.get("/power", authenticate, getAllPowers);
router.delete("/power/:id", authenticate, isAdmin, deletePower);


// ======================== ROLE ========================
router.post("/role", authenticate, isAdmin, createRole);
router.get("/role", authenticate, getAllRoles);
router.get("/roles/eligible", authenticate, getEligibleRoles);
router.delete("/role/:id", authenticate, isAdmin, deleteRole);
router.get("/role/:role_id/assigned-employee", authenticate, getRoleAssignedEmployee);
router.post("/assign-role", authenticate, isAdmin, assignRoleToFaculty);



router.put("/update-dept-role", authenticate, isAdmin, updateDeptOfRole);
router.put("/role/switch-role", authenticate, switchEmployeeRole);
router.put("/transfer-role", authenticate, transferRole);
router.get("/profile", authenticate, getProfile);
router.put("/update-profile", authenticate, upload.single("signature"), updateProfile);


// ======================== EMPLOYEES ========================
router.get("/employees", authenticate, getEmployeesWithDetails);
router.get("/employee/:empId", authenticate, getEmployeeDetailsById);
router.get("/employee/:empId/notesheets/summary", authenticate, getEmployeeNotesheetSummary);
router.get("/notesheets/approved", authenticate, getApprovedNotesheetsByRole);


// ======================== NOTESHEET ========================
router.post("/notesheet", authenticate, createNotesheet);
router.get("/notesheets/execution", authenticate, getExecutionNotesheets);
router.get("/notesheet/for-ref", authenticate, getNotesheetForRef);

router.get("/notesheets", authenticate, getAllNotesheets);
router.get("/notesheets/recent", authenticate, getRecentNotesheets);
router.get("/notesheets/received", authenticate, getReceivedNotesheets);
router.get("/notesheets/employee", authenticate, getNotesheetsForEmployee);
router.get("/notesheets/scope", authenticate, getAllNotesheetsByScope);
router.get("/notesheets/processed", authenticate, getProcessedNotesheets);
router.get("/departments/by-role", authenticate, getDepartmentsByRole);
router.get("/dashboard/combined", authenticate, getCombinedDashboardData);

router.get("/notesheets/:noteId/approval-flow", authenticate, getApprovalFlow);
router.get("/notesheets/:noteId", authenticate, getNotesheetById); 
router.delete("/notesheet/:note_id", authenticate, deleteNotesheet);
router.put("/notesheet/:note_id/edit", authenticate, editNotesheet);


// ======================== NOTESHEET ACTIONS ========================
router.put("/notesheets/:noteId/approve-direct", authenticate, approveNotesheetDirect);
router.put("/notesheets/:noteId/approve-chain", authenticate, approveNotesheetChain);
router.put("/notesheets/:noteId/forward-direct", authenticate, forwardNotesheetDirect);
router.put("/notesheets/forward", authenticate, forwardChainOnly);
router.put("/notesheets/:noteId/reject", authenticate, rejectNotesheet);
router.put("/notesheets/:noteId/query", authenticate, sendQuery);
router.put("/notesheets/:noteId/reply-query", authenticate, replyQuery);
router.get("/notesheets/:noteId/queries", authenticate, getQueriesByNoteId);
router.put("/notesheets/:noteId/forward-execution", authenticate, forwardExecutionNotesheet);
router.put("/notesheets/:noteId/complete-execution", authenticate, completeExecutionNotesheet);


// ======================== NOTESHEET HEADERS ========================
router.post(
  "/notesheet/headers",
  authenticate, isAdmin,         
  upload.fields([{ name: "left_logo", maxCount: 1 }, { name: "right_logo", maxCount: 1 }]),
  createNotesheetHeader
);
router.put(
  "/notesheet/headers/:id",
  authenticate, isAdmin,        
  upload.fields([{ name: "left_logo", maxCount: 1 }, { name: "right_logo", maxCount: 1 }]),
  updateNotesheetHeader
);
router.get("/notesheet/headers/active", getActiveNotesheetHeader); 
router.get("/notesheet/headers", authenticate, getAllNotesheetHeaders);   
router.delete("/notesheet/headers/:id", authenticate, isAdmin, deleteNotesheetHeader);

// ======================== EXCEL ========================
router.post(
  "/bulk-upload",
  authenticate, isAdmin,          
  uploadExcel.single("file"),
  bulkSignup
);


export default router;