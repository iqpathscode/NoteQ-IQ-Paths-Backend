import express from "express";
import { raiseQuery } from "../controllers/query.controller.js";

const router = express.Router();

// POST /api/query/raise
router.post("/raise", raiseQuery);

export default router;
