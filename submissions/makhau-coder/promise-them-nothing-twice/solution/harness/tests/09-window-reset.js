/**
 * Test 9: Window reset
 *
 * Fills the window to capacity, waits 61 seconds for the window to clear,
 * then sends another full burst to verify all pass.
 */

const { makeRequest, sendBurst, sleep, report } = require("./helpers");

async function main() {
  console.log("Test 9: Window reset (wait 61s, new burst passes)");
  console.log("=================================================");
  console.log("⏳ Waiting 61 seconds for window to clear...");

  const customerId = "test-reset-" + Date.now();

  // Fill the window (Starter tier = 60 RPM)
  const firstBatch = await sendBurst(customerId, 60);
  const firstAllowed = firstBatch.filter(r => r.statusCode === 200).length;

  // Verify it's full
  const overflowRes = await makeRequest("GET", "/api/v1/resource", { "X-Customer-Id": customerId });
  const isFullNow = overflowRes.statusCode === 429;

  // Wait for window to expire
  console.log("Window full. Waiting 61 seconds for it to expire...");
  await sleep(61000);

  // Send another full burst — should all pass
  const secondBatch = await sendBurst(customerId, 60);
  const secondAllowed = secondBatch.filter(r => r.statusCode === 200).length;

  const passed = firstAllowed === 60 && isFullNow && secondAllowed === 60;
  report("Window reset", passed,
    passed ? "Window successfully reset after 60s." : "Window failed to reset properly."
  );
  
  if (!passed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
