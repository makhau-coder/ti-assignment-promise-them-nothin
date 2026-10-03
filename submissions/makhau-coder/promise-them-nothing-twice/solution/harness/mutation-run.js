/**
 * Mutation Run script
 *
 * Breaks the limiter in 5 different ways, runs the harness to confirm tests go red,
 * restores the code, and prints a table of mutation vs tests that caught it.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RATE_LIMITER_PATH = path.join(__dirname, '..', 'src', 'middleware', 'rateLimiter.js');
const ORIGINAL_CONTENT = fs.readFileSync(RATE_LIMITER_PATH, 'utf8');
const SOLUTION_DIR = path.join(__dirname, '..');

const mutations = [
  {
    name: "Non-atomic check (simulate race condition in JS)",
    // A true non-atomic check requires rewriting the middleware to not use Lua.
    // Instead of completely rewriting, we can simulate non-atomic behavior by always allowing if 
    // we bypass the ZCARD check, but a simpler way is to just artificially sleep in a JS version.
    // Given complexity, we'll just break atomicity in Lua by returning random success on high concurrency?
    // Actually, let's break it by just checking ZCARD, but not adding the item right away (which we can't do easily in JS).
    // Let's replace the Lua call with a broken JS implementation.
    apply: (code) => code.replace(
      /const result = await redis\.eval\(/g,
      `// Break atomicity: check then wait then add
  const count = await redis.zcard(key);
  if (count < rpm) {
    await new Promise(r => setTimeout(r, 10)); // simulate race
    await redis.zadd(key, Date.now() * 1000, uniqueMember);
    return { allowed: true, currentCount: count + 1, remaining: rpm - count - 1, retryAfterMs: 0, redisTimeMicro: Date.now() * 1000 };
  } else {
    return { allowed: false, currentCount: count, remaining: 0, retryAfterMs: 1000, redisTimeMicro: Date.now() * 1000 };
  }
  const result = await redis.eval(`
    )
  },
  {
    name: "Counting rejections (death spiral)",
    apply: (code) => code.replace(
      /-- REJECT: Do NOT add to the set \(rejected requests are not counted\)/g,
      `-- REJECT but STILL COUNT IT
    redis.call('ZADD', key, nowMicro, member)`
    )
  },
  {
    name: "Fixed window (instead of sliding)",
    apply: (code) => code.replace(
      /local windowStart = nowMicro - windowMicro/g,
      `local windowStart = nowMicro - (nowMicro % windowMicro)`
    )
  },
  {
    name: "Oldest-entry Retry-After (buggy pivot)",
    apply: (code) => code.replace(
      /local pivotIndex = currentCount - maxRequests/g,
      `local pivotIndex = 0 -- Bug: always look at oldest entry`
    )
  },
  {
    name: "Global lock (no customer isolation)",
    apply: (code) => code.replace(
      /local key = KEYS\[1\]/g,
      `local key = "global_rate_limit" -- Bug: shared limit for everyone`
    )
  }
];

function runHarness() {
  try {
    const out = execSync("node harness.js", { cwd: __dirname, encoding: "utf8", stdio: 'pipe' });
    return out;
  } catch (err) {
    return err.stdout + "\n" + err.stderr;
  }
}

async function main() {
  console.log("Mutation Run: Proving the test suite catches broken logic");
  console.log("=========================================================\n");

  const results = [];

  for (const mutation of mutations) {
    console.log(`Applying mutation: ${mutation.name}...`);
    
    const mutatedCode = mutation.apply(ORIGINAL_CONTENT);
    fs.writeFileSync(RATE_LIMITER_PATH, mutatedCode);

    // Restart the node apps to pick up the change
    console.log(`  Restarting app nodes...`);
    execSync("docker compose up --build -d --no-deps app-node-1 app-node-2 app-node-3", { cwd: SOLUTION_DIR, stdio: 'pipe' });
    
    // Also flush Redis so previous state doesn't interfere
    execSync("docker exec solution-redis-1 redis-cli flushall", { cwd: SOLUTION_DIR, stdio: 'pipe' });

    console.log(`  Running harness...`);
    const output = runHarness();

    // Find all failed tests
    const failures = [];
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes("❌ ") && line.includes(".js failed!")) {
        failures.push(line.replace("❌ ", "").replace(" failed!", "").trim());
      }
    }

    if (failures.length === 0) {
      console.log(`  WARNING: No tests caught this mutation!`);
    } else {
      console.log(`  Caught by: ${failures.join(", ")}`);
    }

    results.push({
      mutation: mutation.name,
      caughtBy: failures.join(", ") || "NONE"
    });
  }

  // Restore
  console.log("\nRestoring original code...");
  fs.writeFileSync(RATE_LIMITER_PATH, ORIGINAL_CONTENT);
  execSync("docker compose up --build -d --no-deps app-node-1 app-node-2 app-node-3", { cwd: SOLUTION_DIR, stdio: 'pipe' });
  execSync("docker exec solution-redis-1 redis-cli flushall", { cwd: SOLUTION_DIR, stdio: 'pipe' });

  // Print Table
  console.log("\nMutation Run Results");
  console.log("-----------------------------------------------------------------------------------------");
  console.log("Mutation                                            | Caught By");
  console.log("-----------------------------------------------------------------------------------------");
  for (const r of results) {
    console.log(`${r.mutation.padEnd(51)} | ${r.caughtBy}`);
  }
  console.log("-----------------------------------------------------------------------------------------");
}

main().catch(err => {
  fs.writeFileSync(RATE_LIMITER_PATH, ORIGINAL_CONTENT);
  console.error("Mutation script crashed, code restored.", err);
  process.exit(1);
});
