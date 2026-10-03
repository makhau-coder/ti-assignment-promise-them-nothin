const Redis = require("ioredis");

/**
 * Retry-After Pivot Test — OLD (BUGGY) Lua script
 *
 * Identical setup to test-retry-after-pivot.js, but uses the OLD
 * Lua logic that always looks at index 0 (the oldest entry).
 *
 * Expected result: the test FAILS because:
 *   - Retry-After is ~4000ms (oldest entry) instead of ~7000ms (pivot)
 *   - After waiting Retry-After, count is still 7 (>= limit 5)
 *   - The "allowed after Retry-After" assertion fails
 */

// OLD BUGGY Lua — always looks at index 0
const LUA_SLIDING_WINDOW_LOG_OLD = `
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
    -- BUG: always looks at index 0 (the oldest), not the pivot
    local oldestEntries = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = 0
    if #oldestEntries >= 2 then
        local oldestScore = tonumber(oldestEntries[2])
        local expiresAtMicro = oldestScore + windowMicro
        retryAfterMs = math.ceil((expiresAtMicro - nowMicro) / 1000)
        if retryAfterMs < 0 then
            retryAfterMs = 0
        end
    end
    local remaining = 0
    return {0, currentCount, remaining, retryAfterMs}
end
`;

const WINDOW_MICRO = 60 * 1000000;
const LIMIT = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOldLuaScript(redis, key) {
  const member = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await redis.eval(
    LUA_SLIDING_WINDOW_LOG_OLD,
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
  console.log("║  Retry-After Pivot Test — OLD (BUGGY) LOGIC                 ║");
  console.log("║  This test is EXPECTED TO FAIL.                             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  const redis = new Redis({ host: "localhost", port: 6379 });
  const key = `test:retry-after-old:${Date.now()}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, label, detail) {
    if (condition) {
      console.log(`  ✓ PASS  ${label}: ${detail}`);
      passed++;
    } else {
      console.log(`  ✗ FAIL  ${label}: ${detail}`);
      failed++;
    }
  }

  try {
    // ── Step 1: Backdate 8 entries ─────────────────────────────────────
    console.log("── Step 1: Backdating 8 entries (same setup as passing test) ──");

    const timeResult = await redis.time();
    const nowMicro = parseInt(timeResult[0]) * 1000000 + parseInt(timeResult[1]);

    // Index:  0     1     2     3     4    5    6   7
    // Ages:  56s   55s   54s   53s   10s  8s   6s  4s
    //
    // pivotIndex (correct) = 8 - 5 = 3  → expires in ~7s
    // index 0    (buggy)   = 0          → expires in ~4s
    const ages = [56, 55, 54, 53, 10, 8, 6, 4];

    for (let i = 0; i < ages.length; i++) {
      const score = nowMicro - (ages[i] * 1000000);
      await redis.zadd(key, score, `backdated-${i}`);
    }

    const insertedCount = await redis.zcard(key);
    assert(insertedCount === 8, "Inserted count", `${insertedCount} entries (expected 8)`);

    console.log("   Ages: [56s, 55s, 54s, 53s, 10s, 8s, 6s, 4s]");
    console.log("   Correct pivot index = 3 → expires in ~7s");
    console.log("   Old buggy index     = 0 → expires in ~4s");
    console.log("");

    // ── Step 2: Run OLD Lua, check Retry-After ────────────────────────
    console.log("── Step 2: Run OLD Lua script, check Retry-After ──");

    const r1 = await runOldLuaScript(redis, key);

    assert(!r1.allowed, "Request rejected", `allowed=${r1.allowed}`);

    // OLD code returns ~4000ms (oldest entry), not ~7000ms (pivot)
    // We assert it is NOT in the correct range [6500ms, 7500ms]
    const retryMs = r1.retryAfterMs;
    const isCorrectPivot = retryMs >= 6500 && retryMs <= 7500;
    const isOldBugValue  = retryMs >= 3500 && retryMs <= 4500;

    assert(isOldBugValue, "Retry-After is ~4000ms (oldest, NOT pivot)",
      `retryAfterMs=${retryMs} — old code uses index 0`);

    assert(!isCorrectPivot, "Retry-After is NOT the correct pivot value",
      `${retryMs}ms is outside the correct range [6500ms, 7500ms]`);

    console.log(`   Old code returned retryAfterMs = ${retryMs} (based on oldest entry)`);
    console.log(`   Correct value would be ~7000ms (based on pivot index 3)`);
    console.log("");

    // ── Step 3: Wait exactly Retry-After (old code's ~4000ms) ─────────
    console.log(`── Step 3: Wait exactly Retry-After (${retryMs}ms) as old code says ──`);
    console.log("   Expecting: STILL REJECTED — old code lied about the wait time");

    await sleep(retryMs + 200); // small buffer

    const r2 = await runOldLuaScript(redis, key);

    // After 4s, only entries 0 (56s) and 1 (55s ago originally) expired.
    // The set started with 8; ~2 entries aged out → count ≈ 6.
    // 6 >= 5 (limit), so still rejected.
    assert(!r2.allowed, "STILL REJECTED after old Retry-After expired",
      `allowed=${r2.allowed}, count=${r2.currentCount} — expected rejection (count >= ${LIMIT})`);

    if (!r2.allowed) {
      console.log("");
      console.log("  ╔══════════════════════════════════════════════════════════╗");
      console.log("  ║ BUG CONFIRMED: The client waited the full Retry-After    ║");
      console.log(`  ║ (${retryMs}ms) but got ANOTHER 429. It must wait again.   ║`);
      console.log("  ║ The old code pointing at index 0 is wrong when count     ║");
      console.log("  ║ exceeds the limit.                                       ║");
      console.log("  ╚══════════════════════════════════════════════════════════╝");
    }

    console.log("");

    // ── Cleanup ───────────────────────────────────────────────────────
    await redis.del(key);

  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Assertions run: ${passed + failed}`);

  // All assertions in this test are designed to CONFIRM the bug.
  // "passed" = the bug showed up as expected.
  // "failed" = something unexpected happened (setup issue or bug not present).
  const bugConfirmed = failed === 0;
  if (bugConfirmed) {
    console.log("  ✗ BUG CONFIRMED — old index-0 logic is provably wrong:");
    console.log("    • Retry-After was ~4000ms (oldest entry, index 0)");
    console.log("    • After waiting 4000ms the client got ANOTHER 429 (count=7, limit=5)");
    console.log("    • The pivot fix (index = count - limit) is necessary.");
  } else {
    console.log("  ? Unexpected: some bug assertions did not hold — check test setup.");
  }
  console.log("═══════════════════════════════════════════════════════════════");

  await redis.quit();
  process.exit(bugConfirmed ? 0 : 1);
}

main();
