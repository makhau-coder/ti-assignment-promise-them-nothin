/**
 * Test 11: Rejected requests not counted
 *
 * Fills the limit, sends 100 extra requests (all 429).
 * Waits for the window to clear, then sends 60 — all should pass.
 */

const { sendBurst, sleep, report } = require("./helpers");

async function main() {
  console.log("Test 11: Rejected requests not counted");
  console.log("======================================");

  const customerId = "test-rejected-" + Date.now();

  // Fill the window (60 allowed)
  await sendBurst(customerId, 60);

  // Hammer with 100 more requests (all should be 429)
  const extraResponses = await sendBurst(customerId, 100);
  const extraRejected = extraResponses.filter(r => r.statusCode === 429).length;
  const allExtraRejected = extraRejected === 100;

  console.log(`  Extra rejected: ${extraRejected}/100`);

  // Wait for window to clear
  console.log("  ⏳ Waiting 61 seconds for window to clear...");
  await sleep(61000);

  // Send 60 new requests — should all pass if rejects weren't counted
  const newBatch = await sendBurst(customerId, 60);
  const newAllowed = newBatch.filter(r => r.statusCode === 200).length;

  console.log(`  After clear: ${newAllowed}/60 allowed`);

  const passed = allExtraRejected && newAllowed === 60;
  report("Rejected requests not counted", passed,
    passed ? "Rejections successfully ignored by log." : "Rejections were counted, extending lockout!"
  );

  if (!passed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
