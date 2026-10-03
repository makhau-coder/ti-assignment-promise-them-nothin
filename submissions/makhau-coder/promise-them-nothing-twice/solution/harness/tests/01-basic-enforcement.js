/**
 * Test 1: Basic Rate Limit Enforcement
 *
 * Proves: When a customer sends more requests than their RPM limit,
 *         the excess requests get 429 status codes.
 *
 * Uses: Starter tier customer (60 RPM).
 *       Sends 75 requests — expects 60 allowed, 15 rejected.
 *
 * How it would fail: If the rate limiter is not running, all 75 get 200.
 *                    If counting is wrong, more or fewer than 60 get through.
 */

const { sendBurst, report } = require("./helpers");

async function main() {
  console.log("Test 1: Basic Rate Limit Enforcement");
  console.log("====================================");
  console.log("Sending 75 requests for 'small-biz' (Starter, 60 RPM)...\n");

  const results = await sendBurst("small-biz", 75);

  const allowed = results.filter(r => r.statusCode === 200).length;
  const rejected = results.filter(r => r.statusCode === 429).length;

  console.log(`  Allowed (200):  ${allowed}  (expected: 60)`);
  console.log(`  Rejected (429): ${rejected}  (expected: 15)`);

  const passed = allowed === 60 && rejected === 15;
  report("Basic enforcement", passed,
    passed ? "Exactly 60 allowed, 15 rejected — limit enforced correctly."
           : `Expected 60 allowed / 15 rejected, got ${allowed} / ${rejected}.`
  );
}

main().catch(err => { console.error(err); process.exit(1); });
