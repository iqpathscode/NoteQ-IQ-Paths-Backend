import express from 'express';

// Admin Controller
import { createAdmin } from '../controllers/admin.controller.js';
// Auth Controllers
import { login, changePassword, getMe, createUserByAdmin } from '../controllers/login/auth.controller.js';
import { signup } from '../controllers/signup/auth.controller.js';
// School & Department Controllers
import { createSchool, getAllSchools } from '../controllers/school.controller.js';
import { createDepartment, getAllDepartments } from '../controllers/department.controller.js';
// createnote controller
import { createNotesheet } from '../controllers/createNote.controller.js';
// Role Controllers
import { createPowerLevel, getAllPowerLevels, assignPowerToRole, assignDeptToRole, updateDeptOfRole } from '../controllers/role.controller.js';
// Power Controllers
import { createPower, getAllPowers, updatePowerOfFaculty } from '../controllers/power.controller.js';
// Employee Controllers
import { getEmployeeDetailsById, getEmployeeNotesheetSummary, getEmployeesWithDetails, assignRoleToFaculty, updateRoleOfFaculty } from '../controllers/employe.controller.js';
// Notesheet Controllers
import { getNotesheetById, getNotesheetsForEmployee, getAllNotesheets, getRecentApprovalFlow } from '../controllers/notesheet.controller.js';
// Middleware
import { authenticate, isAdmin, authorizeRoles } from '../middlewares/auth.middleware.js';
// upload
import { upload } from '../utility/cloudinary.js';
import { uploadAttachment } from '../controllers/upload.controller.js';

// Notification
import { createNotification, getNotifications, deleteNotification } from '../controllers/notification.controller.js'

const router = express.Router();

// Admin
router.post("/admin", createAdmin);
// Auth & User Management
router.post("/admin/create-user", authenticate, isAdmin, createUserByAdmin);
router.post("/login", login);
router.post("/signup", signup);
router.put("/change-password", authenticate, changePassword);
router.get("/me", authenticate, getMe);

// upload
router.post("/upload", upload.single("file"), uploadAttachment);

// School & Department
router.post("/school", authenticate, isAdmin, createSchool);
router.get("/school", authenticate, getAllSchools);
router.post("/department", authenticate, isAdmin, createDepartment);
router.get("/department", authenticate, getAllDepartments);

// Role & Power
router.post("/power-level", authenticate, isAdmin, createPowerLevel);
router.get("/power-level", authenticate, getAllPowerLevels);
router.post("/power", authenticate, isAdmin, createPower);
router.get("/power", authenticate, getAllPowers);

// Assign & Update APIs (for AssignManage.jsx)
router.post("/assign-power", authenticate, isAdmin, assignPowerToRole);
router.post("/assign-role", authenticate, isAdmin, assignRoleToFaculty);
router.post("/assign-dept-role", authenticate, isAdmin, assignDeptToRole);

router.put("/update-role", authenticate, isAdmin, updateRoleOfFaculty);
router.put("/update-power", authenticate, isAdmin, updatePowerOfFaculty);
router.put("/update-dept-role", authenticate, isAdmin, updateDeptOfRole);

// Employees
// router.get("/employees", authenticate, authorizeRoles(2, 3), getEmployeesWithDetails); 
// router.get("/employee/:empId", authenticate, authorizeRoles(1, 2, 3), getEmployeeDetailsById);
// router.get("/employee/:empId/notesheets/summary", authenticate, authorizeRoles(1), getEmployeeNotesheetSummary);
router.get("/employees", authenticate, getEmployeesWithDetails); 
router.get("/employee/:empId", authenticate, getEmployeeDetailsById);
router.get("/employee/:empId/notesheets/summary", authenticate, getEmployeeNotesheetSummary);


// Notesheets
// router.post("/notesheet", authenticate, authorizeRoles(1), createNotesheet);
// router.get("/notesheets/all", authenticate, isAdmin, getAllNotesheets);
// router.get("/notesheets", authenticate, authorizeRoles(1, 2), getNotesheetsForEmployee);
// router.get("/notesheets/:noteId", authenticate, authorizeRoles(1, 2), getNotesheetById);
// router.get("/employee/:empId/notesheets/recent/approval-flow", authenticate, authorizeRoles(1), getRecentApprovalFlow);
router.post("/notesheet", authenticate, createNotesheet);
router.get("/notesheets/all", authenticate, isAdmin, getAllNotesheets);
router.get("/notesheets", authenticate, getNotesheetsForEmployee);
router.get("/notesheets/:noteId", authenticate, getNotesheetById);
router.get("/employee/:empId/notesheets/recent/approval-flow", authenticate, getRecentApprovalFlow);

// Notification
router.post("/notifications", authenticate, authorizeRoles(1, 2), createNotification); 
router.get("/notifications", authenticate, authorizeRoles(1, 2), getNotifications); 
router.delete("/notifications/:id", authenticate, authorizeRoles(2), deleteNotification);

export default router;
