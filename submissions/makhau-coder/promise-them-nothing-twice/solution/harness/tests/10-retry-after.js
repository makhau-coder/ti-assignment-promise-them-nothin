/**
 * Test 10: Retry-After header validation
 *
 * Hits the limit, reads Retry-After from the 429 response.
 * Asserts rejection at (Retry-After - 1) seconds.
 * Asserts success at (Retry-After) seconds.
 */

const { makeRequest, sendBurst, sleep, report } = require("./helpers");

async function main() {
  console.log("Test 10: Retry-After exact boundary validation");
  console.log("==============================================");

  const customerId = "test-retry-" + Date.now();

  // Fill the window (60 RPM)
  await sendBurst(customerId, 60);

  // Get a 429 response and check Retry-After
  const rejectedRes = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": customerId });
  const retryAfter = parseInt(rejectedRes.headers["retry-after"], 10);

  console.log(`  Received 429. Retry-After is ${retryAfter} seconds.`);

  if (isNaN(retryAfter) || retryAfter <= 1) {
    console.error("  Invalid or too small Retry-After header.");
    process.exit(1);
  }

  // Wait (retryAfter - 1) seconds
  console.log(`  ⏳ Waiting ${retryAfter - 1} seconds...`);
  await sleep((retryAfter - 1) * 1000);

  // Assert rejection at -1 second
  const earlyRes = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": customerId });
  console.log(`  Response at (Retry-After - 1)s: ${earlyRes.statusCode} (expected 429)`);
  const passedEarly = earlyRes.statusCode === 429;

  // Wait the remaining 1 second (plus small buffer for timing precision)
  console.log(`  ⏳ Waiting 1.5 seconds (to clear the full Retry-After)...`);
  await sleep(1500);

  // Assert success at full Retry-After
  const successRes = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": customerId });
  console.log(`  Response at full Retry-After: ${successRes.statusCode} (expected 200)`);
  const passedLate = successRes.statusCode === 200;

  const passed = passedEarly && passedLate;
  
  report("Retry-After exact boundary", passed,
    passed ? "Rejects at X-1s, allows at Xs." : "Boundary logic failed."
  );

  if (!passed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
