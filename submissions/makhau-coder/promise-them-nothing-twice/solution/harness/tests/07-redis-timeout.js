/**
 * Test 7: Redis Command Timeout (docker pause)
 *
 * Proves: If Redis is alive (TCP open) but unresponsive, the Node server
 *         does not hang indefinitely. It aborts the command via commandTimeout
 *         and falls back to in-memory mode, or returns an error.
 */

const { execSync } = require("child_process");
const { makeRequest, report } = require("./helpers");

async function main() {
  console.log("Test 7: Redis Command Timeout");
  console.log("=============================");
  
  try {
    console.log("Pausing Redis container to simulate a hang...");
    execSync("docker pause solution-redis-1");

    console.log("Sending a request... expecting a fast rejection or fallback, not a hang.");
    
    const start = Date.now();
    const res = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": "techcorp" });
    const duration = Date.now() - start;

    console.log(`  Request completed in ${duration}ms (status: ${res.statusCode})`);
    
    // Default commandTimeout is 500ms, plus some overhead. If it takes > 2000ms, it's hanging.
    const passed = duration < 2000;
    report("Redis Command Timeout", passed,
      passed ? `Server recovered in ${duration}ms.` : `Server hung for ${duration}ms!`
    );

  } finally {
    console.log("Unpausing Redis container...");
    execSync("docker unpause solution-redis-1");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
