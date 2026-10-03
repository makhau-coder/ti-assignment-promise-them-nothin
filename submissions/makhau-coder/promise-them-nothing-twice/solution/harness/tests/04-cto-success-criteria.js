/**
 * Test 4: CTO Success Criteria (Distributed Enforcement)
 *
 * Proves: CTO memo requirement — "Show me a demo where two customers on a 100 RPM
 *         tier each get exactly their budget, and a third customer who exceeds
 *         100 RPM gets cut off — even when I hammer the load balancer randomly
 *         across all three nodes."
 *
 * Uses: 3 custom 100-RPM customers (cto-demo-a, cto-demo-b, cto-demo-c).
 * Sends requests through the Nginx load balancer, which distributes them
 * across the 3 stateless app nodes.
 */

const { sendBurst, report, runAuditChecker } = require("./helpers");

async function main() {
  console.log("Test 4: CTO Success Criteria (100 RPM limit across 3 nodes)");
  console.log("=============================================================\n");

  console.log("Sending 100 requests for Customer A (cto-demo-a)...");
  const resultsA = await sendBurst("cto-demo-a", 100);
  const allowedA = resultsA.filter(r => r.statusCode === 200).length;
  console.log(`  Customer A: Allowed=${allowedA} / 100  (expected: 100)`);

  console.log("Sending 100 requests for Customer B (cto-demo-b)...");
  const resultsB = await sendBurst("cto-demo-b", 100);
  const allowedB = resultsB.filter(r => r.statusCode === 200).length;
  console.log(`  Customer B: Allowed=${allowedB} / 100  (expected: 100)`);

  console.log("Sending 150 requests for Customer C (cto-demo-c)...");
  const resultsC = await sendBurst("cto-demo-c", 150);
  const allowedC = resultsC.filter(r => r.statusCode === 200).length;
  const rejectedC = resultsC.filter(r => r.statusCode === 429).length;
  console.log(`  Customer C: Allowed=${allowedC}, Rejected=${rejectedC}  (expected: 100/50)`);

  // To verify they hit different nodes, collect the node IDs from the successful responses
  const nodesHit = new Set(resultsC.filter(r => r.statusCode === 200).map(r => r.body.data && r.body.data.nodeId));
  console.log(`\n  Nodes utilized by LB during Customer C burst: ${[...nodesHit].join(", ")}`);

  let passed = (allowedA === 100) && (allowedB === 100) && (allowedC === 100) && (rejectedC === 50) && (nodesHit.size === 3);
  
  if (passed) {
    try {
      console.log("  Verifying via offline audit checker...");
      runAuditChecker();
    } catch (err) {
      passed = false;
      console.error("  " + err.message);
    }
  }

  report("CTO Success Criteria", passed,
    passed ? "Customers A and B got exactly 100, C got cut off at 100. Strictly verified by audit logs."
           : "Criteria failed. Check counts or if Nginx is hitting all 3 nodes. Or audit failed."
  );
}

main().catch(err => { console.error(err); process.exit(1); });
