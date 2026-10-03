/**
 * Test 3: Northwind Batch Window
 *
 * Proves: During the 02:00-04:00 UTC window, Northwind gets 1300 RPM
 *         instead of their base 300 RPM. Outside the window, they get 300.
 *
 * Uses time simulation (sets clock to 02:30 UTC).
 *
 * How it would fail: If the override config is wrong or the time
 *                    simulation doesn't propagate, only 300 get through.
 */

const { sendBurst, setSimulatedTime, resetSimulatedTime, report, runAuditChecker } = require("./helpers");

async function main() {
  console.log("Test 3: Northwind Batch Window (02:30 UTC simulation)");
  console.log("=====================================================\n");

  try {
    // Set simulated time to 02:30 UTC (inside the batch window)
    console.log("Setting simulated time to 02:30 UTC...");
    await setSimulatedTime("2026-03-15T02:30:00Z");

    console.log("Sending 1350 requests for 'northwind'...");
    const results = await sendBurst("northwind", 1350);

    const allowed = results.filter(r => r.statusCode === 200).length;
    const rejected = results.filter(r => r.statusCode === 429).length;

    console.log(`  Allowed (200):  ${allowed}  (expected: 1300)`);
    console.log(`  Rejected (429): ${rejected}  (expected: 50)`);

    let passed = allowed === 1300 && rejected === 50;

    if (passed) {
      try {
        console.log("  Verifying via offline audit checker...");
        runAuditChecker();
      } catch (err) {
        passed = false;
        console.error("  " + err.message);
      }
    }

    report("Northwind batch window", passed,
      passed ? "1300 RPM override active and strictly verified by audit logs."
             : `Expected 1300 allowed / 50 rejected, got ${allowed} / ${rejected}. Or audit failed.`
    );
  } finally {
    await resetSimulatedTime();
    console.log("\nSimulated time reset.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
