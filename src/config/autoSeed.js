import bcrypt from "bcryptjs";
import crypto from "crypto";
import Admin from "../models/user/admin.model.js";
import AppConfig from "../models/counter/AppConfig.js";

const CONFIG_KEY = "app_config";

const DEFAULT_LOGIN_CONFIG = {
  university_name: "Medicaps University",
  university_subtitle: "Indore, Madhya Pradesh",
  tagline: "Streamline your academic workflow with our professional notesheet management system",
  campus_image_url: "",
  portal_title: "NoteSheet Portal",
  portal_subtitle: "Manage your academic notesheets efficiently with our streamlined digital workflow system.",
};

const DEFAULT_CATEGORIES = [
  { name: "Leave Request", isActive: true, sortOrder: 1 },
  { name: "Budget Approval", isActive: true, sortOrder: 2 },
  { name: "Equipment Purchase", isActive: true, sortOrder: 3 },
  { name: "Event Permission", isActive: true, sortOrder: 4 },
  { name: "Research Grant", isActive: true, sortOrder: 5 },
  { name: "Infrastructure", isActive: true, sortOrder: 6 },
  { name: "Other", isActive: true, sortOrder: 99 },
];

/**
 * Parses INITIAL_MODULES string from .env
 * e.g., "notesheet,application" -> { notesheet: true, application: true, leave: false }
 * e.g., "leave" -> { notesheet: false, application: false, leave: true }
 * e.g., "all" or undefined -> { notesheet: true, application: true, leave: true }
 */
const parseModulesFromEnv = (rawString) => {
  if (!rawString || rawString.trim().toLowerCase() === "all") {
    return { notesheet: true, application: true, leave: true };
  }
  const parts = rawString.toLowerCase().split(",").map((s) => s.trim());
  return {
    notesheet: parts.includes("notesheet"),
    application: parts.includes("application"),
    leave: parts.includes("leave"),
  };
};

/**
 * Automatically seeds or verifies Super Admin & initial modules on server startup
 */
export const autoSeedOnStartup = async () => {
  try {
    // ── 1. Ensure Super Admin Account ───────────────────────────────────────────
    const superAdminEmail = (
      process.env.SUPER_ADMIN_EMAIL ||
      process.env.SEED_ADMIN_EMAIL ||
      "superadmin@noteq.local"
    ).toLowerCase().trim();

    const envPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
    // No env password set → generate a random one instead of a guessable hardcoded default.
    const superAdminPassword = envPassword || crypto.randomBytes(9).toString("base64url");

    const superAdminName =
      process.env.SUPER_ADMIN_NAME ||
      process.env.SEED_ADMIN_NAME ||
      "Super Admin";

    const superAdminMobile =
      process.env.SUPER_ADMIN_MOBILE ||
      process.env.SEED_ADMIN_MOBILE ||
      "9999999999";

    const superAdminDesignation =
      process.env.SUPER_ADMIN_DESIGNATION ||
      process.env.SEED_ADMIN_DESIGNATION ||
      "Master Super Admin";

    let admin = await Admin.findOne({ email: superAdminEmail });

    if (admin) {
      if (!admin.is_super_admin) {
        admin.is_super_admin = true;
        admin.is_admin = true;
        admin.is_active = true;
        await admin.save();
        console.log(`[AutoSeed] 🛡️ Existing admin (${admin.email}) upgraded to Super Admin.`);
      }
    } else {
      // Check if another super admin already exists
      const existingSuperAdmin = await Admin.findOne({ is_super_admin: true });
      if (!existingSuperAdmin) {
        // Check if admin_id: 1 exists
        const adminWithIdOne = await Admin.findOne({ admin_id: 1 });
        if (adminWithIdOne) {
          adminWithIdOne.is_super_admin = true;
          await adminWithIdOne.save();
          console.log(`[AutoSeed] 🛡️ Admin ID 1 (${adminWithIdOne.email}) designated as Super Admin.`);
        } else {
          const hashedPassword = await bcrypt.hash(superAdminPassword, 10);
          await Admin.create({
            admin_id: 1,
            admin_name: superAdminName,
            designation: superAdminDesignation,
            mobile_number: superAdminMobile,
            email: superAdminEmail,
            password: hashedPassword,
            is_active: true,
            is_admin: true,
            is_super_admin: true,
          });
          console.log(`[AutoSeed] 🛡️ Super Admin auto-created: ${superAdminEmail}`);
          if (!envPassword) {
            console.log(
              `[AutoSeed] ⚠️ SUPER_ADMIN_PASSWORD not set — generated a one-time random password (shown once, save it now): ${superAdminPassword}`
            );
            console.log(
              "[AutoSeed] ⚠️ Set SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in your .env to control this account explicitly."
            );
          }
        }
      }
    }

    // ── 2. Ensure AppConfig & Module Licensing ──────────────────────────────────
    let configDoc = await AppConfig.findOne({ key: CONFIG_KEY });
    const initialModulesFromEnv = parseModulesFromEnv(process.env.INITIAL_MODULES);

    if (!configDoc) {
      // First boot on fresh database
      configDoc = await AppConfig.create({
        key: CONFIG_KEY,
        value: DEFAULT_LOGIN_CONFIG,
        categories: DEFAULT_CATEGORIES,
        app_categories: [],
        modules: initialModulesFromEnv,
      });
      console.log("[AutoSeed] ⚙️ AppConfig initialized for fresh database with modules:", configDoc.modules);
    } else {
      // If FORCE_MODULES_SYNC is set in .env, override DB modules
      if (process.env.FORCE_MODULES_SYNC === "true" && process.env.INITIAL_MODULES) {
        configDoc.modules = initialModulesFromEnv;
        await configDoc.save();
        console.log("[AutoSeed] ⚙️ Modules synced from .env (FORCE_MODULES_SYNC=true):", configDoc.modules);
      }
    }
  } catch (error) {
    console.error("[AutoSeed] ⚠️ Auto-seed encountered an issue (non-blocking):", error.message);
  }
};
