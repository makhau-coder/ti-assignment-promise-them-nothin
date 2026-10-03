/**
 * Test 6: Test Endpoints Gated
 *
 * Proves: The /api/v1/test/* endpoints are blocked by default and return 404
 *         unless ENABLE_TEST_ENDPOINTS=true is explicitly set.
 */

const { exec } = require("child_process");
const { makeRequest, report, sleep } = require("./helpers");

async function main() {
  console.log("Test 6: Test Endpoints Gated");
  console.log("============================");
  console.log("Starting a temporary app node without ENABLE_TEST_ENDPOINTS...");

  // Start the server process locally without the env var
  const env = { ...process.env, PORT: "3005" };
  delete env.ENABLE_TEST_ENDPOINTS;

  const serverProcess = exec("node ../../solution/src/server.js", { env });

  try {
    // Wait for it to start
    await sleep(2000);

    // Make request to the temporary server
    const http = require("http");
    const options = {
      hostname: "localhost",
      port: 3005,
      path: "/api/v1/test/set-time",
      method: "POST"
    };

    const statusCode = await new Promise((resolve, reject) => {
      const req = http.request(options, res => resolve(res.statusCode));
      req.on("error", reject);
      req.end();
    });

    console.log(`  Response status: ${statusCode} (expected: 404)`);
    
    const passed = statusCode === 404;
    report("Test endpoints gated", passed,
      passed ? "Endpoint returned 404 as expected." : "Endpoint did NOT return 404!"
    );

  } finally {
    // Cleanup
    serverProcess.kill();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
