import express from "express";
import { authenticate, requireModule } from "../middlewares/auth.middleware.js";
import {
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from "../controllers/holiday.controller.js";

const router = express.Router();
router.use(requireModule("leave"));

router.get("/", authenticate, getHolidays);
router.post("/", authenticate, createHoliday);
router.patch("/:id", authenticate, updateHoliday);
router.delete("/:id", authenticate, deleteHoliday);

export default router;
