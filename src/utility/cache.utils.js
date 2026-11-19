import redis from "../config/redis.config.js";

/**
 * Safe Redis get with JSON parsing.
 * Returns null if key doesn't exist or if Redis is unreachable.
 */
export const getCache = async (key) => {
  try {
    if (!redis || (redis.status !== "ready" && redis.status !== "connecting")) return null;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn(`[Cache] Failed to get key "${key}":`, err.message);
    return null;
  }
};

/**
 * Safe Redis set with JSON stringifying and optional TTL in seconds.
 */
export const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    if (!redis || (redis.status !== "ready" && redis.status !== "connecting")) return false;
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
    return true;
  } catch (err) {
    console.warn(`[Cache] Failed to set key "${key}":`, err.message);
    return false;
  }
};

/**
 * Safe Redis delete for single key or wildcard pattern.
 */
export const deleteCache = async (pattern) => {
  try {
    if (!redis || (redis.status !== "ready" && redis.status !== "connecting")) return false;
    if (pattern.includes("*")) {
      const keys = await redis.keys(pattern);
      if (keys && keys.length > 0) {
        await redis.del(...keys);
      }
    } else {
      await redis.del(pattern);
    }
    return true;
  } catch (err) {
    console.warn(`[Cache] Failed to delete cache for "${pattern}":`, err.message);
    return false;
  }
};
