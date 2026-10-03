/**
 * Test 2: Per-Customer Isolation
 *
 * Proves: CTO requirement #2 — "Customer A's traffic spike must not
 *         consume Customer B's budget."
 *
 * Sends 350 requests for customer A (300 RPM Growth tier) to exhaust
 * their quota, then sends 10 requests for customer B (same tier).
 * All 10 of B's requests must get 200 — A's flood cannot affect B.
 *
 * How it would fail: If customers share a pool/key, B gets 429s.
 */

const { sendBurst, report } = require("./helpers");

async function main() {
  console.log("Test 2: Per-Customer Isolation");
  console.log("==============================");
  console.log("Flooding customer A (acme-corp, 300 RPM) with 350 requests...");

  const resultsA = await sendBurst("acme-corp", 350);
  const allowedA = resultsA.filter(r => r.statusCode === 200).length;
  const rejectedA = resultsA.filter(r => r.statusCode === 429).length;

  console.log(`  A: Allowed=${allowedA}, Rejected=${rejectedA}`);

  console.log("Now sending 10 requests for customer B (bluesky-inc, 300 RPM)...");
  const resultsB = await sendBurst("bluesky-inc", 10);
  const allowedB = resultsB.filter(r => r.statusCode === 200).length;

  console.log(`  B: Allowed=${allowedB} out of 10`);

  const passed = allowedA === 300 && rejectedA === 50 && allowedB === 10;
  report("Per-customer isolation", passed,
    passed ? "A exhausted at 300, B got all 10 through — isolated."
           : `A: ${allowedA}/${rejectedA}, B: ${allowedB}/10 — isolation may be broken.`
  );
}

main().catch(err => { console.error(err); process.exit(1); });
