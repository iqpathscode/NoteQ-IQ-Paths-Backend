import express from 'express';

// Admin Controller
import { createAdmin } from '../controllers/admin.controller.js';
// Auth Controllers
import { login, changePassword, createUserByAdmin } from '../controllers/login/auth.controller.js';
import { signup } from '../controllers/signup/auth.controller.js';
import { createSchool, getSchools } from '../controllers/school.controller.js';
import { createDepartment, getDepartments } from '../controllers/department.controller.js';
import { createPowerLevel, getRoles } from '../controllers/role.controller.js';
import { createPower, getPowers } from '../controllers/power.controller.js';
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

router.post('/signup', signup);
router.post('/login', login);
router.post('/school', createSchool);
router.get('/schools', getSchools);
router.post('/department', createDepartment);
router.get('/departments', getDepartments);
router.post('/power-level', createPowerLevel);
router.get('/roles', getRoles);
router.post('/power', createPower);
router.get('/powers', getPowers);
router.post('/notesheet', createNotesheet);
router.get('/employees', getEmployeesWithDetails);
router.get('/employee/:empId', getEmployeeDetailsById);
router.get('/employee/:empId/notesheets/summary', getEmployeeNotesheetSummary);
router.get('/notesheets', getNotesheetsForEmployee);
router.get('/notesheets/:noteId', getNotesheetById);

export default router;
