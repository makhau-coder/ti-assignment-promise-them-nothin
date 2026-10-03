const express = require("express");
const { rateLimiterMiddleware } = require("./middleware/rateLimiter");
const { getRedisClient, getRedisStatus, closeRedis } = require("./lib/redis");
const { getEffectiveRpm, getCustomerConfig, setSimulatedTime, clearSimulatedTime, getSimulatedTime } = require("./config/customers");

/**
 * RelayAPI Rate Limiter Service
 *
 * A stateless Express app that enforces per-customer rate limits
 * using a distributed sliding window log in Redis.
 *
 * Each instance is meant to run behind a load balancer.
 * Multiple instances share state via Redis.
 */

// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
const app = express();

// Port and node ID from environment (each Docker container gets its own)
const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ID = process.env.NODE_ID || "node-1";

// ============================================================
// Middleware
// ============================================================

// Parse JSON bodies (for any POST endpoints if needed)
app.use(express.json());

// Log every incoming request with the node ID
app.use((req, res, next) => {
  console.log(`[${NODE_ID}] ${req.method} ${req.path} | Customer: ${req.headers["x-customer-id"] || "none"}`);
  next();
});

// ============================================================
// Routes
// ============================================================

/**
 * Health check — does NOT go through rate limiter.
 * Used by load balancer to check if the node is alive.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    nodeId: NODE_ID,
    redis: getRedisStatus() ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/v1/resource
 *
 * A mock API endpoint that goes through the rate limiter.
 * This simulates any real API endpoint that Northwind or
 * other customers would call.
 */
app.get("/api/v1/resource", rateLimiterMiddleware, (req, res) => {
  const customerId = req.headers["x-customer-id"];
  const { rpm, isOverride, reason } = getEffectiveRpm(customerId);

  res.json({
    message: "Request successful",
    data: {
      nodeId: NODE_ID,
      customerId: customerId,
      effectiveRpm: rpm,
      isScheduleOverride: isOverride,
      timestamp: new Date().toISOString()
    }
  });
});

/**
 * GET /api/v1/audit/customer/:customerId
 *
 * Audit endpoint — shows the full config and current effective
 * RPM for a customer. Does NOT go through rate limiter.
 *
 * This satisfies the CTO's auditability requirement:
 * enterprise prospects can see exactly how their limits work.
 */
app.get("/api/v1/audit/customer/:customerId", async (req, res) => {
  const customerId = req.params.customerId;
  const config = getCustomerConfig(customerId);
  const effective = getEffectiveRpm(customerId);

  // Fetch live request count from Redis if available
  let liveCount = null;
  if (getRedisStatus()) {
    try {
      const redis = getRedisClient();
      const key = `ratelimit:${customerId}`;
      // Clean expired entries first, then count
      const now = await redis.time();
      const nowMicro = parseInt(now[0]) * 1000000 + parseInt(now[1]);
      const windowStart = nowMicro - 60 * 1000000;
      await redis.zremrangebyscore(key, "-inf", windowStart);
      liveCount = await redis.zcard(key);
    } catch (err) {
      liveCount = "unavailable (Redis error)";
    }
  }

  res.json({
    nodeId: NODE_ID,
    customer: config,
    currentEffective: {
      rpm: effective.rpm,
      isScheduleOverride: effective.isOverride,
      overrideReason: effective.reason,
      checkedAt: new Date().toISOString()
    },
    liveRequestCount: liveCount,
    countingMethod: {
      algorithm: "Sliding Window Log",
      window: "60 seconds",
      storage: "Redis sorted set per customer (key: ratelimit:{customerId})",
      clock: "Redis TIME (not app server clock) — all nodes share the same time source",
      atomicity: "Single Lua script executes ZREMRANGEBYSCORE + ZCARD + conditional ZADD atomically",
      rejectionPolicy: "Rejected requests are NOT recorded in the set — retries do not consume quota",
      explanation: "Each allowed request is recorded with a microsecond-precision timestamp as its score in a Redis sorted set. "
        + "On every incoming request, entries older than 60 seconds are pruned, the remaining count is compared to the customer's RPM limit, "
        + "and the request is allowed (recorded) or rejected (not recorded). "
        + "Because all three application nodes execute the same atomic Lua script against a single Redis instance, "
        + "the count is globally consistent regardless of which node handles each request."
    }
  });
});

// ============================================================
// Test endpoints (for harness time simulation)
// ============================================================

// Gate all test endpoints behind an environment variable
app.use("/api/v1/test", (req, res, next) => {
  if (process.env.ENABLE_TEST_ENDPOINTS !== "true") {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

let inFlight = 0;
let maxInFlight = 0;

/**
 * GET /api/v1/test/slow
 *
 * A slow endpoint (100ms) behind the rate limiter to test concurrency.
 * Tracks max in-flight requests.
 */
app.get("/api/v1/test/slow", rateLimiterMiddleware, (req, res) => {
  inFlight++;
  if (inFlight > maxInFlight) maxInFlight = inFlight;
  
  setTimeout(() => {
    const currentMax = maxInFlight;
    inFlight--;
    res.json({ message: "Slow response", maxInFlight: currentMax, nodeId: NODE_ID });
  }, 100);
});

/**
 * POST /api/v1/test/set-time
 *
 * Sets a simulated time for schedule override checks.
 * Body: { "time": "2026-03-15T02:30:00Z" }
 *
 * This lets the harness test Northwind's batch window
 * without waiting until 2 AM UTC.
 */
app.post("/api/v1/test/set-time", (req, res) => {
  const { time } = req.body;

  if (!time) {
    return res.status(400).json({ error: "Missing 'time' in request body" });
  }

  // Validate the time string
  const parsed = new Date(time);
  if (isNaN(parsed.getTime())) {
    return res.status(400).json({ error: "Invalid time format. Use ISO 8601 (e.g., 2026-03-15T02:30:00Z)" });
  }

  setSimulatedTime(time);
  console.log(`[${NODE_ID}] Simulated time set to: ${time}`);

  res.json({
    message: "Simulated time set",
    simulatedTime: time,
    nodeId: NODE_ID
  });
});

/**
 * POST /api/v1/test/reset-time
 *
 * Clears the simulated time — goes back to real time.
 */
app.post("/api/v1/test/reset-time", (req, res) => {
  clearSimulatedTime();
  console.log(`[${NODE_ID}] Simulated time cleared — using real time`);

  res.json({
    message: "Simulated time cleared — using real time",
    nodeId: NODE_ID
  });
});

/**
 * GET /api/v1/test/current-time
 *
 * Returns the current effective time (simulated or real).
 */
app.get("/api/v1/test/current-time", (req, res) => {
  const simulated = getSimulatedTime();
  res.json({
    simulatedTime: simulated,
    realTime: new Date().toISOString(),
    usingSimulated: simulated !== null,
    nodeId: NODE_ID
  });
});

// ============================================================
// Server startup
// ============================================================

// Initialize Redis connection on startup
getRedisClient();

const server = app.listen(PORT, () => {
  console.log(`[${NODE_ID}] RelayAPI rate limiter running on port ${PORT}`);
  console.log(`[${NODE_ID}] Redis status: ${getRedisStatus() ? "connected" : "connecting..."}`);
});

// ============================================================
// Graceful shutdown
// ============================================================

async function shutdown(signal) {
  console.log(`[${NODE_ID}] Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    await closeRedis();
    console.log(`[${NODE_ID}] Shutdown complete`);
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error(`[${NODE_ID}] Forced shutdown after timeout`);
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
