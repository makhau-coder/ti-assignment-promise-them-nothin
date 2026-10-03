const Redis = require("ioredis");

/**
 * Redis client setup for the rate limiter.
 *
 * Connects to Redis using environment variables.
 * Tracks connection status so the rate limiter can
 * fall back to in-memory counting if Redis is down.
 */

let redisClient = null;
let isRedisAvailable = false;

function createRedisClient() {
  const redisHost = process.env.REDIS_HOST || "localhost";
  const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);

  redisClient = new Redis({
    host: redisHost,
    port: redisPort,
    // Retry connecting every 2 seconds if disconnected
    retryStrategy(times) {
      const delay = Math.min(times * 500, 2000);
      return delay;
    },
    // Don't buffer commands when disconnected — fail fast
    enableOfflineQueue: false,
    // Connection timeout
    connectTimeout: 5000,
    // Per-command timeout to prevent hanging when Redis is unresponsive
    commandTimeout: process.env.REDIS_COMMAND_TIMEOUT_MS ? parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS, 10) : 500
  });

  redisClient.on("connect", () => {
    isRedisAvailable = true;
    console.log(`[Redis] Connected to ${redisHost}:${redisPort}`);
  });

  redisClient.on("ready", () => {
    isRedisAvailable = true;
    console.log("[Redis] Ready to accept commands");
  });

  redisClient.on("error", (err) => {
    isRedisAvailable = false;
    console.error("[Redis] Connection error:", err.message);
  });

  redisClient.on("close", () => {
    isRedisAvailable = false;
    console.log("[Redis] Connection closed");
  });

  return redisClient;
}

/**
 * Get the Redis client instance.
 * Creates one if it doesn't exist yet.
 */
function getRedisClient() {
  if (!redisClient) {
    createRedisClient();
  }
  return redisClient;
}

/**
 * Check if Redis is currently connected and available.
 */
function getRedisStatus() {
  return isRedisAvailable;
}

/**
 * Gracefully close the Redis connection.
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isRedisAvailable = false;
    console.log("[Redis] Disconnected gracefully");
  }
}

module.exports = {
  getRedisClient,
  getRedisStatus,
  closeRedis
};
