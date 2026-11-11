import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import redis from "../config/redis.config.js";

const INVALID_TOKEN_VALUES = new Set(["", "null", "undefined"]);

const sanitizeToken = (raw) => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return INVALID_TOKEN_VALUES.has(trimmed) ? null : trimmed;
};

export const parseBearerToken = (authHeader) => {
  if (typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? sanitizeToken(match[1]) : null;
};

export const extractToken = (req) => {
  const cookieToken = sanitizeToken(req?.cookies?.token);
  const bearerToken = parseBearerToken(req?.headers?.authorization);
  return cookieToken || bearerToken;
};

export const extractAllTokens = (req) => {
  const tokens = [
    sanitizeToken(req?.cookies?.token),
    parseBearerToken(req?.headers?.authorization),
  ].filter(Boolean);
  return Array.from(new Set(tokens));
};

export const getAuthCookieOptions = (req, maxAge) => {
  const isSecureContext =
    process.env.NODE_ENV === "production" ||
    Boolean(req?.secure) ||
    req?.headers?.["x-forwarded-proto"] === "https";

  const options = {
    httpOnly: true,
    secure: isSecureContext,
    sameSite: isSecureContext ? "none" : "lax",
    path: "/",
  };

  if (typeof maxAge === "number") {
    options.maxAge = maxAge;
  }

  return options;
};

export const setAuthCookie = (res, req, token, maxAge) => {
  res.cookie("token", token, getAuthCookieOptions(req, maxAge));
};

export const clearAuthCookie = (res, req) => {
  res.clearCookie("token", getAuthCookieOptions(req));
};

export const signAuthToken = (payload, expiresIn = env.JWT_EXPIRES_IN) => {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
};

export const verifyAuthToken = (token) => {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.verify(token, env.JWT_SECRET);
};

export const isTokenBlacklisted = async (token) => {
  const result = await redis.get(`blacklist:${token}`);
  return Boolean(result);
};

export const blacklistToken = async (token) => {
  const cleanToken = sanitizeToken(token);
  if (!cleanToken) return false;

  let decoded;
  try {
    decoded = verifyAuthToken(cleanToken);
  } catch {
    // Only blacklist genuine, non-expired tokens issued by this server
    return false;
  }

  const expirySeconds = decoded?.exp
    ? decoded.exp - Math.floor(Date.now() / 1000)
    : 0;

  if (expirySeconds <= 0) return false;

  try {
    await redis.setex(`blacklist:${cleanToken}`, expirySeconds, "true");
    return true;
  } catch (err) {
    console.error("[Auth] Failed to blacklist token in Redis:", err.message);
    return false;
  }
};
