const { getRedisClient, getRedisStatus } = require("../lib/redis");
const { getEffectiveRpm } = require("../config/customers");

/**
 * Sliding Window Log Rate Limiter
 *
 * How it works:
 * - Each customer gets a Redis sorted set: "ratelimit:{customerId}"
 * - Each ALLOWED request adds an entry with score = timestamp in microseconds
 * - Members are unique strings (timestamp + random suffix) to avoid collisions
 * - On each request, we:
 *   1. Remove all entries older than 60 seconds (outside the window)
 *   2. Count remaining entries
 *   3. If count < RPM limit, add a new entry and ALLOW
 *   4. If count >= RPM limit, REJECT (do NOT add the entry)
 * - All of this happens in a single atomic Lua script
 * - We use Redis TIME for the clock (not the app server's clock)
 *   to avoid clock drift between nodes
 *
 * IMPORTANT: Rejected requests are NOT counted.
 * Northwind retries aggressively on 429 — counting rejections
 * would create a death spiral where retries eat the budget.
 *
 * Fallback (Redis unavailable):
 * - Each node enforces RPM / 3 using an in-memory sliding window
 * - With 3 nodes and round-robin LB, this approximates the global limit
 * - Errs on the side of over-rejecting (CTO's preference)
 */

// ============================================================
// Lua script for atomic sliding window log in Redis
// ============================================================
//
// KEYS[1] = sorted set key for this customer
// ARGV[1] = window size in microseconds (60 seconds = 60000000)
// ARGV[2] = max allowed requests (RPM limit)
// ARGV[3] = unique member string for this request
//
// Returns: [allowed (0 or 1), currentCount, remainingRequests, retryAfterMs]

const LUA_SLIDING_WINDOW_LOG = `
-- Get the current time from Redis server (not app server)
-- redis.call('TIME') returns {seconds, microseconds}
local redisTime = redis.call('TIME')
local nowMicro = tonumber(redisTime[1]) * 1000000 + tonumber(redisTime[2])

local key = KEYS[1]
local windowMicro = tonumber(ARGV[1])
local maxRequests = tonumber(ARGV[2])
local member = ARGV[3]

-- Calculate the start of the sliding window
local windowStart = nowMicro - windowMicro

-- Step 1: Remove all entries outside the window (older than 60s ago)
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

-- Step 2: Count how many requests are in the current window
local currentCount = redis.call('ZCARD', key)

-- Step 3: Decide — allow or reject
if currentCount < maxRequests then
    -- ALLOW: Add this request to the sorted set
    redis.call('ZADD', key, nowMicro, member)

    -- Set TTL on the key so it auto-cleans (window + small buffer)
    redis.call('PEXPIRE', key, math.ceil(windowMicro / 1000) + 1000)

    local remaining = maxRequests - currentCount - 1
    return {1, currentCount + 1, remaining, 0, nowMicro}
else
    -- REJECT: Do NOT add to the set (rejected requests are not counted)

    -- Calculate retry-after: time until enough entries expire so count < limit.
    --
    -- When currentCount == maxRequests, we need 1 entry to expire → look at index 0.
    -- When currentCount > maxRequests (e.g., after a limit drop from 1300 to 300,
    -- the sorted set may have 305 entries but the limit is 300), we need
    -- (currentCount - maxRequests + 1) entries to expire.
    -- The last entry that must expire is at index (currentCount - maxRequests).
    --
    -- Example: 305 entries, limit 300.
    --   pivotIndex = 305 - 300 = 5
    --   When entry at index 5 expires, entries 0-5 (6 entries) have aged out.
    --   Remaining = 305 - 6 = 299, which is < 300. One slot opens.
    local pivotIndex = currentCount - maxRequests
    local pivotEntries = redis.call('ZRANGE', key, pivotIndex, pivotIndex, 'WITHSCORES')
    local retryAfterMs = 0
    if #pivotEntries >= 2 then
        local pivotScore = tonumber(pivotEntries[2])
        -- This entry will expire at pivotScore + windowMicro
        local expiresAtMicro = pivotScore + windowMicro
        retryAfterMs = math.ceil((expiresAtMicro - nowMicro) / 1000)
        if retryAfterMs < 0 then
            retryAfterMs = 0
        end
    end

    local remaining = 0
    return {0, currentCount, remaining, retryAfterMs, nowMicro}
end
`;

// ============================================================
// In-memory fallback (used when Redis is unavailable)
// ============================================================

// Map of customerId -> array of timestamps (in milliseconds)
const inMemoryWindows = new Map();

// How many nodes we assume are running (for dividing the RPM)
const TOTAL_NODES = parseInt(process.env.TOTAL_NODES || "3", 10);

/**
 * In-memory sliding window log for a single node.
 * Enforces RPM / TOTAL_NODES to approximate the global limit.
 *
 * @param {string} customerId
 * @param {number} rpm - full RPM limit for the customer
 * @returns {{ allowed: boolean, currentCount: number, remaining: number, retryAfterMs: number }}
 */
function checkInMemoryLimit(customerId, rpm) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 60 seconds
  const windowStart = now - windowMs;

  // Per-node limit: divide by number of nodes
  const perNodeLimit = Math.floor(rpm / TOTAL_NODES);

  // Get or create the request log for this customer
  if (!inMemoryWindows.has(customerId)) {
    inMemoryWindows.set(customerId, []);
  }

  const requestLog = inMemoryWindows.get(customerId);

  // Remove entries outside the window
  while (requestLog.length > 0 && requestLog[0] <= windowStart) {
    requestLog.shift();
  }

  const currentCount = requestLog.length;

  if (currentCount < perNodeLimit) {
    // ALLOW — add timestamp
    requestLog.push(now);
    return {
      allowed: true,
      currentCount: currentCount + 1,
      remaining: perNodeLimit - currentCount - 1,
      retryAfterMs: 0
    };
  } else {
    // REJECT — do NOT add timestamp
    let retryAfterMs = 0;
    if (requestLog.length > 0) {
      // Time until the oldest entry exits the window
      retryAfterMs = Math.max(0, (requestLog[0] + windowMs) - now);
    }
    return {
      allowed: false,
      currentCount: currentCount,
      remaining: 0,
      retryAfterMs: Math.ceil(retryAfterMs)
    };
  }
}

// ============================================================
// Rate limiter middleware
// ============================================================

/**
 * Express middleware that enforces per-customer rate limits.
 *
 * Reads the customer ID from the X-Customer-Id header.
 * Looks up their effective RPM (including schedule overrides).
 * Uses Redis sliding window log if available, else in-memory fallback.
 *
 * Response headers on every request:
 *   X-RateLimit-Limit: the current RPM limit
 *   X-RateLimit-Remaining: requests left in this window
 *   X-RateLimit-Source: "redis" or "in-memory" (for debugging)
 *
 * On rejection (429):
 *   Retry-After: seconds until a slot opens up
 */
function rateLimiterMiddleware(req, res, next) {
  const customerId = req.headers["x-customer-id"];

  // No customer ID = reject immediately
  if (!customerId) {
    return res.status(400).json({
      error: "Missing X-Customer-Id header"
    });
  }

  // Get the effective RPM for this customer right now
  const { rpm, isOverride, reason } = getEffectiveRpm(customerId);

  // Check if Redis is available
  if (getRedisStatus()) {
    // ---- Redis path: distributed sliding window log ----
    checkRedisLimit(customerId, rpm)
      .then((result) => {
        setRateLimitHeaders(res, rpm, result.remaining, "redis");

        // Log audit line
        console.log(JSON.stringify({
          audit: true,
          customer: customerId,
          nodeId: process.env.NODE_ID || "node-unknown",
          decision: result.allowed ? "allow" : "deny",
          redisTimeMicro: result.redisTimeMicro,
          countAtDecision: result.currentCount,
          effectiveLimit: rpm,
          policyId: isOverride ? (reason || "override") : "base"
        }));

        if (result.allowed) {
          // Request is allowed — continue to the route handler
          next();
        } else {
          // Request is rejected — return 429
          const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
          res.set("Retry-After", String(Math.max(1, retryAfterSeconds)));
          res.status(429).json({
            error: "Too Many Requests",
            message: `Rate limit exceeded. Your limit is ${rpm} requests per minute.`,
            retryAfterMs: result.retryAfterMs
          });
        }
      })
      .catch((err) => {
        // Redis command failed — fall back to in-memory
        console.error("[RateLimiter] Redis error, falling back to in-memory:", err.message);
        handleInMemoryFallback(customerId, rpm, res, next);
      });
  } else {
    // ---- In-memory fallback path ----
    handleInMemoryFallback(customerId, rpm, res, next);
  }
}

/**
 * Check rate limit using Redis sliding window log.
 *
 * @param {string} customerId
 * @param {number} rpm
 * @returns {Promise<{ allowed: boolean, currentCount: number, remaining: number, retryAfterMs: number }>}
 */
async function checkRedisLimit(customerId, rpm) {
  const redis = getRedisClient();

  const key = `ratelimit:${customerId}`;
  const windowMicro = 60 * 1000000; // 60 seconds in microseconds

  // Create a unique member for this request
  // Using Redis TIME + random suffix to avoid collisions
  const uniqueMember = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  const result = await redis.eval(
    LUA_SLIDING_WINDOW_LOG,
    1,           // number of keys
    key,         // KEYS[1]
    windowMicro, // ARGV[1]
    rpm,         // ARGV[2]
    uniqueMember // ARGV[3]
  );

  // Lua returns an array: [allowed, currentCount, remaining, retryAfterMs, nowMicro]
  return {
    allowed: result[0] === 1,
    currentCount: result[1],
    remaining: result[2],
    retryAfterMs: result[3],
    redisTimeMicro: result[4]
  };
}

/**
 * Handle rate limiting using in-memory fallback.
 * Used when Redis is unavailable.
 */
function handleInMemoryFallback(customerId, rpm, res, next) {
  const result = checkInMemoryLimit(customerId, rpm);

  const perNodeLimit = Math.floor(rpm / TOTAL_NODES);
  setRateLimitHeaders(res, perNodeLimit, result.remaining, "in-memory");

  if (result.allowed) {
    next();
  } else {
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    res.set("Retry-After", String(Math.max(1, retryAfterSeconds)));
    res.status(429).json({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Per-node limit is ${perNodeLimit} requests per minute (Redis unavailable, degraded mode).`,
      retryAfterMs: result.retryAfterMs
    });
  }
}

/**
 * Set standard rate limit response headers.
 */
function setRateLimitHeaders(res, limit, remaining, source) {
  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.set("X-RateLimit-Source", source);
}

module.exports = { rateLimiterMiddleware };
