import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../config/redis.config.js"; // existing redis client reuse
import { extractToken, verifyAuthToken } from "../utility/authToken.utils.js";

// Helper to create store with fallback to MemoryStore if Redis is offline
const getStore = (prefix) => {
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: async (...args) => {
      if (redis.status !== "ready") {
        throw new Error("Redis not ready");
      }
      return await redis.call(...args);
    },
    prefix,
  });
};

// ======================== LOGIN RATE LIMITER ========================
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // Don't block users if Redis fails

  // ✅ Redis store with memory fallback
  store: getStore("login_limit:"),

  // ✅ IP + Email combined — shared IP issue fix
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase().trim();
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() || // proxy ke peeche real IP
      req.socket?.remoteAddress ||
      "unknown-ip";

    // email nahi hai toh sirf IP pe limit
    return email ? `${ip}:${email}` : ip;
  },

  // ✅ Successful login count nahi hoga
  skipSuccessfulRequests: true,

  // ✅ Custom handler — remaining attempts bhi batao
  handler: (req, res, next, options) => {
    const email = req.body?.email || "this account";
    return res.status(429).json({
      success: false,
      message: `Too many login attempts for ${email}. Please try again after 15 minutes.`,
    });
  },
});

// ======================== FORGOT PASSWORD RATE LIMITER ========================
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,

  // ✅ Redis store with memory fallback
  store: getStore("forgot_limit:"),

  // ✅ Sirf email based — IP nahi
  // Kyunki forgot password mein IP sharing se koi issue nahi
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase().trim();
    return email ? `forgot:${email}` : `forgot:${req.socket?.remoteAddress || "unknown"}`;
  },

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many reset requests. Please try again after 1 hour.",
    });
  },
});

// ======================== GENERAL API RATE LIMITER ========================
const getClientIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
  req.ip ||
  req.socket?.remoteAddress ||
  "unknown-ip";

const resolveGeneralIdentity = (req) => {
  if (req._rateLimitIdentity) return req._rateLimitIdentity;
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = verifyAuthToken(token);
      if (decoded?.admin_id) {
        req._rateLimitIdentity = { key: `admin:${decoded.admin_id}`, isUser: true };
        return req._rateLimitIdentity;
      }
      if (decoded?.emp_id) {
        req._rateLimitIdentity = { key: `emp:${decoded.emp_id}`, isUser: true };
        return req._rateLimitIdentity;
      }
    } catch {
      // Invalid/expired token falls back to IP key
    }
  }
  req._rateLimitIdentity = { key: `ip:${getClientIp(req)}`, isUser: false };
  return req._rateLimitIdentity;
};

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // Per-user limit (240/min) prevents shared campus NAT IP from blocking 1000 concurrent users;
  // IP fallback allows high shared-IP burst (1500/min) for unauthenticated/public routes.
  max: (req) => (resolveGeneralIdentity(req).isUser ? 240 : 1500),
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: { keyGeneratorIpFallback: false },

  store: getStore("general_limit:"),

  keyGenerator: (req) => resolveGeneralIdentity(req).key,

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please slow down.",
    });
  },
});