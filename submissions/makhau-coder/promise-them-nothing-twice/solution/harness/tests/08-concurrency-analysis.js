/**
 * Test 8: Concurrency Analysis
 *
 * Proves: The backend handles concurrent requests efficiently and correctly.
 * 
 * Part 1: 50 simultaneous requests against a slow (100ms) endpoint.
 *         Measures total time and max in-flight per node.
 * Part 2: 200 concurrent requests against a 100 RPM limit.
 *         Asserts exactly 100 admitted, 100 rejected.
 */

const { sendBurst, report, runAuditChecker } = require("./helpers");
const { execSync } = require("child_process");

async function main() {
  console.log("Test 8: Concurrency Analysis");
  console.log("============================");

  // Part 1: 50 simultaneous against /api/v1/test/slow
  console.log("Part 1: 50 simultaneous requests against slow endpoint...");
  
  const start = Date.now();
  const resultsSlow = await sendBurst("techcorp", 50, "/api/v1/test/slow");
  const duration = Date.now() - start;

  const successful = resultsSlow.filter(r => r.statusCode === 200);
  
  let maxInFlightGlobal = 0;
  for (const res of successful) {
    if (res.body.maxInFlight > maxInFlightGlobal) {
      maxInFlightGlobal = res.body.maxInFlight;
    }
  }

  console.log(`  Total time: ${duration}ms`);
  console.log(`  Max in-flight observed by a node: ${maxInFlightGlobal}`);
  
  // With 3 nodes and 50 requests taking 100ms each, Nginx distributes them.
  // We expect high concurrency and a time much less than sequential (50 * 100 = 5000ms).
  const passedSlow = duration < 500 && maxInFlightGlobal > 5;
  report("Slow endpoint concurrency", passedSlow,
    passedSlow ? "Concurrent processing confirmed." : "Too slow or not concurrent enough."
  );

  // Part 2: 200 concurrent against 100 RPM limit
  const customerId = "cto-demo-run-" + Date.now();
  console.log(`\nPart 2: 200 concurrent requests against 100 RPM limit (${customerId})...`);
  
  const results200 = await sendBurst(customerId, 200, "/api/v1/test/slow");
  const allowed = results200.filter(r => r.statusCode === 200).length;
  const rejected = results200.filter(r => r.statusCode === 429).length;

  let maxInFlight200 = 0;
  for (const res of results200.filter(r => r.statusCode === 200)) {
    if (res.body.maxInFlight > maxInFlight200) maxInFlight200 = res.body.maxInFlight;
  }

  console.log(`  Allowed: ${allowed}  (expected: 100)`);
  console.log(`  Rejected: ${rejected}  (expected: 100)`);
  console.log(`  Max in-flight during block: ${maxInFlight200}`);

  const passed200 = allowed === 100 && rejected === 100 && maxInFlight200 > 1;
  
  let passed = passedSlow && passed200;
  
  if (passed) {
    try {
      console.log("  Verifying via offline audit checker...");
      runAuditChecker();
    } catch (err) {
      passed = false;
      console.error("  " + err.message);
    }
  }

  report("200 concurrent enforcement", passed,
    passed ? "Exactly 100 admitted despite massive concurrency. Strictly verified by audit logs." : "Limit breached under concurrency! Or audit failed."
  );

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
