/**
 * Test 13: Redis source verification
 *
 * Verifies the X-RateLimit-Source header is "redis" when Redis is up.
 */

const { makeRequest, report } = require("./helpers");

async function main() {
  console.log("Test 13: Redis source verification (fallback exists)");
  console.log("====================================================");

  const customerId = "test-source-" + Date.now();
  const response = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": customerId });

  const source = response.headers["x-ratelimit-source"];

  console.log(`  X-RateLimit-Source: ${source}`);

  const passed = source === "redis";
  report("Redis source verification", passed,
    passed ? "Source is 'redis' as expected." : `Source was '${source}' instead of 'redis'.`
  );

  if (!passed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
