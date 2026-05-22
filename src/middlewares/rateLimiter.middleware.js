import rateLimit from "express-rate-limit";

// ======================== LOGIN RATE LIMITER ========================
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 15 min mein sirf 5 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
  skipSuccessfulRequests: true, // Successful login count nahi hoga
});

// ======================== FORGOT PASSWORD RATE LIMITER ========================
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,                    // 1 hour mein sirf 3 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again after 1 hour.",
  },
});

// ======================== GENERAL API RATE LIMITER ========================
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,            // 1 min mein 100 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
});