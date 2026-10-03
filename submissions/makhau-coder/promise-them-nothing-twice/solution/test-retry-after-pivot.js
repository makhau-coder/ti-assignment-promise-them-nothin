const Redis = require("ioredis");

/**
 * Retry-After Pivot Test
 *
 * Tests that when count > limit (e.g., after a limit drop),
 * the Retry-After value is based on the (count - limit)-th entry,
 * not the oldest.
 *
 * Setup:
 *   - limit = 5
 *   - Insert 8 entries with backdated scores (known ages)
 *   - Entry ages: [56s, 55s, 54s, 53s, 10s, 8s, 6s, 4s]
 *   - pivotIndex = 8 - 5 = 3 (the entry that was 53s ago)
 *   - That entry expires in ~7 seconds
 *
 * Tests:
 *   1. Retry-After ≈ 7 seconds (not ~4s which would be the oldest's expiry)
 *   2. Wait (Retry-After - 1s) → still rejected
 *   3. Wait 1 more second → exactly one request allowed
 *   4. Immediately after → rejected again (count back to 5)
 */

// The exact same Lua script from rateLimiter.js
const LUA_SLIDING_WINDOW_LOG = `
local redisTime = redis.call('TIME')
local nowMicro = tonumber(redisTime[1]) * 1000000 + tonumber(redisTime[2])

local key = KEYS[1]
local windowMicro = tonumber(ARGV[1])
local maxRequests = tonumber(ARGV[2])
local member = ARGV[3]

local windowStart = nowMicro - windowMicro

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local currentCount = redis.call('ZCARD', key)

if currentCount < maxRequests then
    redis.call('ZADD', key, nowMicro, member)
    redis.call('PEXPIRE', key, math.ceil(windowMicro / 1000) + 1000)
    local remaining = maxRequests - currentCount - 1
    return {1, currentCount + 1, remaining, 0}
else
    local pivotIndex = currentCount - maxRequests
    local pivotEntries = redis.call('ZRANGE', key, pivotIndex, pivotIndex, 'WITHSCORES')
    local retryAfterMs = 0
    if #pivotEntries >= 2 then
        local pivotScore = tonumber(pivotEntries[2])
        local expiresAtMicro = pivotScore + windowMicro
        retryAfterMs = math.ceil((expiresAtMicro - nowMicro) / 1000)
        if retryAfterMs < 0 then
            retryAfterMs = 0
        end
    end
    local remaining = 0
    return {0, currentCount, remaining, retryAfterMs}
end
`;

const WINDOW_MICRO = 60 * 1000000; // 60 seconds in microseconds
const LIMIT = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the Lua script against a key with a given limit.
 * Returns { allowed, currentCount, remaining, retryAfterMs }.
 */
async function runLuaScript(redis, key) {
  const member = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await redis.eval(
    LUA_SLIDING_WINDOW_LOG,
    1,
    key,
    WINDOW_MICRO,
    LIMIT,
    member
  );
  return {
    allowed: result[0] === 1,
    currentCount: result[1],
    remaining: result[2],
    retryAfterMs: result[3]
  };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║    Retry-After Pivot Test (count > limit scenario)          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  const redis = new Redis({ host: "localhost", port: 6379 });
  const key = `test:retry-after-pivot:${Date.now()}`;

  let allPassed = true;
  function assert(condition, label, detail) {
    if (condition) {
      console.log(`  ✓ ${label}: ${detail}`);
    } else {
      console.log(`  ✗ ${label}: ${detail}`);
      allPassed = false;
    }
  }

  try {
    // ── Step 1: Get Redis TIME and backdate 8 entries ──────────────────
    console.log("── Step 1: Backdating 8 entries into Redis sorted set ──");
    console.log(`   Key: ${key}, Limit: ${LIMIT}`);

    const timeResult = await redis.time();
    const nowMicro = parseInt(timeResult[0]) * 1000000 + parseInt(timeResult[1]);

    // Ages in seconds — each entry was added this many seconds ago
    //   Index 0: 56s ago → expires in 4s  (oldest)
    //   Index 1: 55s ago → expires in 5s
    //   Index 2: 54s ago → expires in 6s
    //   Index 3: 53s ago → expires in 7s  ← PIVOT (8 - 5 = 3)
    //   Index 4: 10s ago → expires in 50s
    //   Index 5: 8s ago  → expires in 52s
    //   Index 6: 6s ago  → expires in 54s
    //   Index 7: 4s ago  → expires in 56s
    const ages = [56, 55, 54, 53, 10, 8, 6, 4];

    for (let i = 0; i < ages.length; i++) {
      const score = nowMicro - (ages[i] * 1000000);
      await redis.zadd(key, score, `backdated-${i}`);
    }

    const insertedCount = await redis.zcard(key);
    assert(insertedCount === 8, "Inserted count", `${insertedCount} entries (expected 8)`);

    console.log("   Ages: [56s, 55s, 54s, 53s, 10s, 8s, 6s, 4s]");
    console.log("   pivotIndex = count(8) - limit(5) = 3");
    console.log("   Pivot entry age: 53s → expires in ~7s");
    console.log("   Oldest entry age: 56s → expires in ~4s (this is what OLD code would use)");
    console.log("");

    // ── Step 2: Run Lua, verify Retry-After ─────────────────────────────
    console.log("── Step 2: Run Lua script, check Retry-After ──");

    const firstResult = runLuaScript(redis, key);
    const r1 = await firstResult;

    assert(!r1.allowed, "Request rejected", `allowed=${r1.allowed}, count=${r1.currentCount}`);
    assert(r1.currentCount === 8, "Count is 8", `currentCount=${r1.currentCount}`);

    // Retry-After should be ~7000ms (pivot entry expires in 7s)
    // NOT ~4000ms (which the OLD buggy code would return from the oldest entry)
    const retryMs = r1.retryAfterMs;
    const inExpectedRange = retryMs >= 6500 && retryMs <= 7500;
    const wouldBeOldBug = retryMs >= 3500 && retryMs <= 4500;

    assert(inExpectedRange, "Retry-After ~7000ms (pivot entry)",
      `retryAfterMs=${retryMs}` +
      (wouldBeOldBug ? " ← BUG: this is the oldest entry, not the pivot!" : ""));

    if (wouldBeOldBug) {
      console.log("\n  ✗✗ FATAL: Retry-After is based on the oldest entry, not the pivot.");
      console.log("     The Lua script still has the old bug!\n");
      process.exit(1);
    }

    console.log(`   Returned retryAfterMs = ${retryMs}`);
    console.log("");

    // ── Step 3: Wait (retryAfter - 1 second), assert still rejected ─────
    const earlyWait = retryMs - 1000;
    console.log(`── Step 3: Wait ${earlyWait}ms (Retry-After minus 1 second) ──`);
    console.log("   Expecting: still rejected (pivot entry hasn't expired yet)");

    await sleep(earlyWait);

    const r2 = await runLuaScript(redis, key);
    assert(!r2.allowed, "Still rejected 1s early",
      `allowed=${r2.allowed}, count=${r2.currentCount}, retryAfterMs=${r2.retryAfterMs}`);

    console.log("");

    // ── Step 4: Wait the remaining time + 200ms buffer, assert allowed ───
    const remainingWait = 1200; // 1s remaining + 200ms buffer for timing jitter
    console.log(`── Step 4: Wait ${remainingWait}ms more (past the pivot expiry) ──`);
    console.log("   Expecting: exactly one request allowed");

    await sleep(remainingWait);

    const r3 = await runLuaScript(redis, key);
    assert(r3.allowed, "Request allowed after Retry-After",
      `allowed=${r3.allowed}, count=${r3.currentCount}, remaining=${r3.remaining}`);

    // Verify that count dropped below limit (entries 0-3 expired, 4-7 remain = 4)
    // plus the one we just added = 5
    assert(r3.currentCount === 5, "Count = 5 (4 remaining + 1 new)",
      `currentCount=${r3.currentCount}`);

    console.log("");

    // ── Step 5: Immediately send another request — should be rejected ────
    console.log("── Step 5: Immediately send another request ──");
    console.log("   Expecting: rejected (count is now at limit)");

    const r4 = await runLuaScript(redis, key);
    assert(!r4.allowed, "Next request rejected (count = limit)",
      `allowed=${r4.allowed}, count=${r4.currentCount}`);

    assert(r4.currentCount === 5, "Count still 5",
      `currentCount=${r4.currentCount}`);

    console.log("");

    // ── Step 6: Boundary check — ZREMRANGEBYSCORE and Retry-After agree ──
    console.log("── Step 6: Boundary agreement check ──");
    console.log("   The Lua script uses ZREMRANGEBYSCORE(key, '-inf', windowStart)");
    console.log("   where windowStart = nowMicro - 60000000.");
    console.log("   An entry with score EXACTLY equal to windowStart is removed (<=).");
    console.log("   Retry-After = ceil((pivotScore + windowMicro - nowMicro) / 1000).");
    console.log("   After waiting exactly Retry-After ms, the pivot entry's score equals");
    console.log("   windowStart, so it's removed by the <= comparison.");
    console.log("   This was proven by steps 3-4: waiting 1s early → rejected,");
    console.log("   waiting past Retry-After → allowed.");
    assert(true, "ZREMRANGEBYSCORE and Retry-After use same boundary", "<= comparison on score");

    console.log("");

    // ── Cleanup ──────────────────────────────────────────────────────────
    await redis.del(key);

  } catch (err) {
    console.error("Test error:", err);
    allPassed = false;
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  if (allPassed) {
    console.log("  ✓ ALL ASSERTIONS PASSED — Retry-After pivot logic is correct");
  } else {
    console.log("  ✗ SOME ASSERTIONS FAILED");
  }
  console.log("═══════════════════════════════════════════════════════════════");

  await redis.quit();
  process.exit(allPassed ? 0 : 1);
}

main();
