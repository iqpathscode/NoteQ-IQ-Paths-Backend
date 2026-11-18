import express from "express";
import {
  createNOC,
  getAllNOCs,
  getNOCById,
  revokeNOC,
  verifyNOCPublic,
  searchRecipientHelper,
  sendNocEmail,
} from "../controllers/noc.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { isRegistrar } from "../middlewares/registrarAuth.middleware.js";

const router = express.Router();

// ================= PUBLIC VERIFICATION ROUTE =================
// Anyone scanning the QR code or visiting the verification link can verify
router.get("/verify/:token", verifyNOCPublic);

// ================= PROTECTED REGISTRAR ROUTES =================
// Only authenticated Registrar has access to create, list, and revoke NOCs
router.post("/create", authenticate, isRegistrar, createNOC);
router.get("/all", authenticate, isRegistrar, getAllNOCs);
router.get("/search-recipients", authenticate, isRegistrar, searchRecipientHelper);
router.get("/:id", authenticate, getNOCById);
router.put("/:id/revoke", authenticate, isRegistrar, revokeNOC);
router.post("/:id/send-email", authenticate, isRegistrar, sendNocEmail);

export default router;
