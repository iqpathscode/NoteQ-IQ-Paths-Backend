import redis from "../config/redis.config.js";

// Bounded in-memory TTL fallback when Redis is unavailable or disabled
const MEMORY_CACHE_MAX_ENTRIES = 2000;
const memoryCache = new Map();
const inflightRequests = new Map();

const isRedisReady = () => Boolean(redis && redis.status === "ready");

const getMemoryCache = (key) => {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  // Refresh LRU position
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value;
};

const setMemoryCache = (key, value, ttlSeconds = 300) => {
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
  });
};

const deleteMemoryCache = (pattern) => {
  if (!pattern.includes("*")) {
    memoryCache.delete(pattern);
    return;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) memoryCache.delete(key);
  }
};

/**
 * Safe cache get (Redis with bounded in-memory fallback).
 * Returns null if key doesn't exist.
 */
export const getCache = async (key) => {
  try {
    if (isRedisReady()) {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    }
    return getMemoryCache(key);
  } catch (err) {
    console.warn(`[Cache] Failed to get key "${key}":`, err.message);
    return getMemoryCache(key);
  }
};

/**
 * Safe cache set (Redis with bounded in-memory fallback).
 */
export const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    setMemoryCache(key, value, ttlSeconds);
    if (!isRedisReady()) return true;
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
 * Non-blocking cache delete for single key or wildcard pattern.
 */
export const deleteCache = async (pattern) => {
  try {
    deleteMemoryCache(pattern);
    if (!isRedisReady()) return true;
    if (pattern.includes("*")) {
      const stream = redis.scanStream({ match: pattern, count: 100 });
      const batch = [];
      for await (const keys of stream) {
        if (keys.length) batch.push(...keys);
        if (batch.length >= 200) {
          await redis.del(...batch.splice(0, batch.length));
        }
      }
      if (batch.length > 0) {
        await redis.del(...batch);
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

/**
 * Read-through cache with single-flight coalescing to prevent cache stampedes
 * under high concurrent load.
 */
export const getOrSetCache = async (key, ttlSeconds, fetcher) => {
  const cached = await getCache(key);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  const promise = (async () => {
    try {
      const fresh = await fetcher();
      if (fresh !== undefined && fresh !== null) {
        await setCache(key, fresh, ttlSeconds);
      }
      return fresh;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
};
