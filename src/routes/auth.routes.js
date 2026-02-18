import express from 'express';
import { login } from '../controllers/login/auth.controller.js';
import { signup } from '../controllers/signup/auth.controller.js';
import { createSchool } from '../controllers/school.controller.js';
import { createDepartment } from '../controllers/department.controller.js';
import { createPowerLevel } from '../controllers/role.controller.js';
import { createPower } from '../controllers/power.controller.js';
import { createNotesheet } from '../controllers/createNote.controller.js';
import { getEmployeeDetailsById, getEmployeeNotesheetSummary, getEmployeesWithDetails } from '../controllers/employe.controller.js';
import { getNotesheetById, getNotesheetsForEmployee } from '../controllers/notesheet.controller.js';
const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/school', createSchool);
router.post('/department', createDepartment);
router.post('/power-level', createPowerLevel);
router.post('/power', createPower);
router.post('/notesheet', createNotesheet);
router.get('/employees', getEmployeesWithDetails);
router.get('/employee/:empId', getEmployeeDetailsById);
router.get('/employee/:empId/notesheets/summary', getEmployeeNotesheetSummary);
router.get('/notesheets', getNotesheetsForEmployee);
router.get('/notesheets/:noteId', getNotesheetById);

export default router;
