import Redis from "ioredis";
import { env } from "./env.config.js";

let redis = null;

if (env.REDIS_URL && process.env.ENABLE_REDIS !== "false") {
  try {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 4000,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times >= 2) {
          console.warn("⚠️ [Redis] Connection failed (port 6379 may be blocked by host). Disabling Redis retries.");
          return null; // Stop retrying permanently so server doesn't hang
        }
        return 1000;
      },
    });

    redis.connect().catch((err) => {
      console.warn("⚠️ [Redis] Running in fallback mode without Redis:", err.message);
    });

    redis.on("connect", () => console.log("✅ Redis connected"));
    redis.on("error", (err) => {
      console.warn("⚠️ [Redis] Warning:", err.message);
    });
  } catch (err) {
    console.warn("⚠️ [Redis] Initialization failed:", err.message);
    redis = null;
  }
} else {
  console.log("ℹ️ [Redis] Running without Redis (in-memory mode)");
}

export default redis;