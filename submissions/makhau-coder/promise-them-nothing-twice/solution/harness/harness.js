/**
 * RelayAPI Rate Limiter — Master Load Harness
 *
 * Runs the individual standalone tests located in the `tests/` directory.
 * Generates harness-report.json with results.
 *
 * Usage:
 *   node harness.js [--redis-kill]
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function main() {
  const args = process.argv.slice(2);
  const REDIS_KILL = args.includes("--redis-kill");

  const testsDir = path.join(__dirname, "tests");
  const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith(".js") && f !== "helpers.js")
    .sort();

  const report = {
    target: process.env.BASE_URL || "http://localhost:8080",
    runAt: new Date().toISOString(),
    totalTests: files.length,
    passed: 0,
    failed: 0,
    redisKillEnabled: REDIS_KILL,
    results: []
  };

  console.log("=============================================");
  console.log("   RelayAPI Rate Limiter Test Harness");
  console.log("=============================================");

  const env = { ...process.env };
  if (REDIS_KILL) {
    env.REDIS_KILL = "true";
  }

  for (const file of files) {
    console.log(`\n▶ Running ${file}...`);
    
    // Test 14 handles its own skip if REDIS_KILL isn't set, but we can also just let it run
    const result = spawnSync("node", [path.join(testsDir, file)], {
      stdio: "pipe",
      env,
      encoding: "utf8"
    });

    const output = result.stdout || "";
    const errOutput = result.stderr || "";
    const passed = result.status === 0;

    // Print output to console
    if (output) console.log(output.trim());
    if (errOutput) console.error(errOutput.trim());

    if (passed) {
      console.log(`✅ ${file} completed successfully.`);
      report.passed++;
    } else {
      console.error(`❌ ${file} failed!`);
      report.failed++;
    }

    // Try to extract a detail string if there's a PASS/FAIL line
    let detail = "Completed.";
    const match = output.match(/(?:✓ PASS:|✗ FAIL:).*\n(.*)/);
    if (match && match[1]) {
      detail = match[1].trim();
    } else if (errOutput) {
      detail = errOutput.trim().split("\n")[0];
    }

    report.results.push({
      test: file,
      passed,
      details: detail,
      timestamp: new Date().toISOString()
    });
  }

  console.log("\n=============================================");
  if (report.failed === 0) {
    console.log(`✅ ALL ${report.passed} TESTS PASSED`);
  } else {
    console.log(`❌ ${report.failed} TESTS FAILED`);
  }

  const reportPath = path.join(__dirname, "harness-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 JSON report saved to: ${reportPath}\n`);

  process.exit(report.failed === 0 ? 0 : 1);
}

main();
