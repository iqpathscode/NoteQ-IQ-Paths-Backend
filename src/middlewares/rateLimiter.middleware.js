import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../config/redis.config.js"; // existing redis client reuse

// ======================== LOGIN RATE LIMITER ========================
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,

  // ✅ Redis store — server restart pe bhi persist rahega
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args), // ioredis ka .call()
    prefix: "login_limit:",
  }),

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

  // ✅ Redis store
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: "forgot_limit:",
  }),

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
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,

  // General ke liye Redis store zaroori nahi — IP based theek hai
  // Lekin consistency ke liye lagao
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: "general_limit:",
  }),

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please slow down.",
    });
  },
});