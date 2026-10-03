/**
 * Test 14: Redis kill & recovery (opt-in)
 *
 * Simulates a Redis failure and recovery. Opt-in only.
 */

const { execSync } = require("child_process");
const path = require("path");
const { makeRequest, report, sleep } = require("./helpers");

const SOLUTION_DIR = path.join(__dirname, "..", "..");

async function main() {
  console.log("Test 14: Redis kill & recovery (fallback + reconnect)");
  console.log("=====================================================");

  if (process.env.REDIS_KILL !== "true") {
    console.log("⏭ Skipping (requires REDIS_KILL=true environment variable).");
    process.exit(0); // Exit successfully if skipped
  }

  try {
    // Step 1: Confirm source=redis
    const preRes = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": "test-kill-" + Date.now() });
    const preSrc = preRes.headers["x-ratelimit-source"];

    if (preSrc !== "redis") {
      throw new Error(`Pre-check failed: source=${preSrc}`);
    }
    console.log(`     ✓ Pre-check: source=${preSrc}`);

    // Step 2: Stop Redis
    console.log("     ⏳ Stopping Redis (docker compose stop redis)...");
    execSync("docker compose stop redis", { cwd: SOLUTION_DIR, stdio: "pipe" });
    console.log("     ✓ Redis stopped");

    await sleep(2000);

    // Step 3: Send traffic while Redis is down
    const fallbackId = "test-fallback-" + Date.now();
    let anyHung = false;
    let fallbackSource = null;
    let allGotResponse = true;

    console.log("     ⏳ Sending 20 requests with Redis down...");
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      try {
        const res = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": fallbackId });
        if (Date.now() - start > 5000) anyHung = true;
        if (res.headers["x-ratelimit-source"]) fallbackSource = res.headers["x-ratelimit-source"];
        if (res.statusCode !== 200 && res.statusCode !== 429) allGotResponse = false;
      } catch (err) {
        if (Date.now() - start > 5000) anyHung = true;
        allGotResponse = false;
      }
    }

    const fallbackOk = allGotResponse && !anyHung;
    console.log(`     ${fallbackOk ? "✓" : "✗"} Fallback: responded=${allGotResponse}, noHangs=${!anyHung}, source=${fallbackSource}`);

    // Step 4: Restart Redis
    console.log("     ⏳ Starting Redis (docker compose start redis)...");
    execSync("docker compose start redis", { cwd: SOLUTION_DIR, stdio: "pipe" });
    console.log("     ✓ Redis started");

    // Step 5: Wait for reconnect
    console.log("     ⏳ Waiting for nodes to reconnect to Redis...");
    let reconnected = false;
    const reconnectId = "test-reconnect-" + Date.now();
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep(1000);
      try {
        const res = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": reconnectId });
        if (res.headers["x-ratelimit-source"] === "redis") {
          reconnected = true;
          break;
        }
      } catch (_) {}
    }

    const passed = fallbackOk && reconnected;
    report("Redis kill & recovery", passed,
      passed ? "Fallback active and reconnected successfully." : "Failed to failover or reconnect."
    );

    if (!passed) process.exit(1);

  } catch (err) {
    try {
      execSync("docker compose start redis", { cwd: SOLUTION_DIR, stdio: "pipe" });
    } catch (_) {}
    console.error("Test failed: " + err.message);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
