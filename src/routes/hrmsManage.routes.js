import express from "express";
import { authenticate, isAdmin, requireModule } from "../middlewares/auth.middleware.js";
import {
  getSystemRoles,
  toggleRoleLeavePermission,
  getLeaveWorkflows,
  createLeaveWorkflow,
  updateLeaveWorkflow,
  deleteLeaveWorkflow,
} from "../controllers/hrmsManage.controller.js";

const router = express.Router();
router.use(authenticate);
router.use(requireModule("leave"));

router.get("/roles", getSystemRoles);
router.put("/roles/:id", isAdmin, toggleRoleLeavePermission);
router.get("/workflows", getLeaveWorkflows);
router.post("/workflows", isAdmin, createLeaveWorkflow);
router.put("/workflows/:id", isAdmin, updateLeaveWorkflow);
router.delete("/workflows/:id", isAdmin, deleteLeaveWorkflow);

export default router;