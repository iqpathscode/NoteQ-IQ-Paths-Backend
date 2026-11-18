import express from "express";
import {
  createPurchaseOrder,
  getAllPurchaseOrders,
  getPurchaseOrderById,
  updatePurchaseOrderStatus,
  verifyPOPublic,
  getApprovedNotesheetsHelper,
  sendPoEmail,
} from "../controllers/purchaseOrder.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { isRegistrar } from "../middlewares/registrarAuth.middleware.js";

const router = express.Router();

// ================= PUBLIC VERIFICATION ROUTE =================
// Anyone scanning the QR code or accessing verification URL
router.get("/verify/:token", verifyPOPublic);

// ================= PROTECTED REGISTRAR ROUTES =================
// Strictly Registrar-only operations
router.post("/create", authenticate, isRegistrar, createPurchaseOrder);
router.get("/all", authenticate, isRegistrar, getAllPurchaseOrders);
router.get("/approved-notesheets", authenticate, isRegistrar, getApprovedNotesheetsHelper);
router.get("/:id", authenticate, getPurchaseOrderById);
router.put("/:id/status", authenticate, isRegistrar, updatePurchaseOrderStatus);
router.post("/:id/send-email", authenticate, isRegistrar, sendPoEmail);

export default router;
