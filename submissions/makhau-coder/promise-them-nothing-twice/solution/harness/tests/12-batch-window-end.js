/**
 * Test 12: Northwind batch window end
 *
 * Simulates time at 03:59 UTC (batch window active, 1300 RPM).
 * Then changes time to 04:01 UTC (window over, 300 RPM).
 * Verifies the limit drops back to 300 via the audit endpoint.
 */

const { makeRequest, report, sleep } = require("./helpers");

async function setSimulatedTimeOnAllNodes(isoTime) {
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(makeRequest("POST", "/api/v1/test/set-time", {}, { time: isoTime }));
  }
  await Promise.all(promises);
}

async function resetSimulatedTimeOnAllNodes() {
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(makeRequest("POST", "/api/v1/test/reset-time", {}));
  }
  await Promise.all(promises);
}

async function main() {
  console.log("Test 12: Northwind batch window end (1300 → 300 RPM)");
  console.log("====================================================");

  try {
    // Set time to 03:59 UTC (inside batch window)
    await setSimulatedTimeOnAllNodes("2026-03-15T03:59:00Z");
    await sleep(500);

    // Verify override is active
    const auditBefore = await makeRequest("GET", "/api/v1/audit/customer/northwind");
    const rpmBefore = auditBefore.body.effectiveLimit || auditBefore.body.currentEffective?.rpm;

    // Now switch to 04:01 UTC (outside batch window)
    await setSimulatedTimeOnAllNodes("2026-03-15T04:01:00Z");
    await sleep(500);

    // Verify override is now inactive
    const auditAfter = await makeRequest("GET", "/api/v1/audit/customer/northwind");
    const rpmAfter = auditAfter.body.effectiveLimit || auditAfter.body.currentEffective?.rpm;

    console.log(`  Before (03:59 UTC): ${rpmBefore} RPM`);
    console.log(`  After (04:01 UTC): ${rpmAfter} RPM`);

    const passed = rpmBefore === 1300 && rpmAfter === 300;
    report("Northwind batch window end", passed,
      passed ? "Limit correctly dropped to 300 RPM." : "Limit failed to drop!"
    );

    if (!passed) process.exitCode = 1;

  } finally {
    await resetSimulatedTimeOnAllNodes();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
