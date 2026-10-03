/**
 * Shared HTTP helper for all standalone harness tests.
 *
 * Provides makeRequest() and sendBurst() so each test file
 * stays small and focused on its scenario.
 */

const http = require("http");

const BASE_URL = process.env.HARNESS_URL || "http://localhost:8080";
const parsed = new URL(BASE_URL);

const customAgent = new http.Agent({ maxSockets: Infinity, keepAlive: true });

/**
 * Make a single HTTP request. Returns { statusCode, headers, body }.
 */
function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path,
      method,
      agent: customAgent,
      headers: { "Content-Type": "application/json", ...headers }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsedBody = null;
        try { parsedBody = JSON.parse(data); } catch (e) { parsedBody = { raw: data }; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Fire N requests in parallel for a given customer.
 * Returns array of { statusCode, headers, body }.
 */
function sendBurst(customerId, count, path = "/api/v1/resource") {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(makeRequest("GET", path, { "X-Customer-Id": customerId }));
  }
  return Promise.all(promises);
}

/**
 * Set simulated time on all nodes (send 6 times for round-robin coverage).
 */
async function setSimulatedTime(isoTime) {
  for (let i = 0; i < 6; i++) {
    await makeRequest("POST", "/api/v1/test/set-time", {}, { time: isoTime });
  }
}

/**
 * Reset simulated time on all nodes.
 */
async function resetSimulatedTime() {
  for (let i = 0; i < 6; i++) {
    await makeRequest("POST", "/api/v1/test/reset-time");
  }
}

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Print a test result line.
 */
function report(name, passed, details) {
  const icon = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`\n${icon}: ${name}`);
  if (details) console.log(`  ${details}`);
  if (!passed) process.exitCode = 1;
}

/**
 * Run the offline audit checker on the current docker logs.
 * Throws an error if the audit checker finds violations.
 */
function runAuditChecker() {
  const { execSync } = require("child_process");
  const path = require("path");
  const SOLUTION_DIR = path.join(__dirname, "..", "..");
  const CHECKER_PATH = path.join(__dirname, "..", "audit-checker.js");
  
  // Windows compatibility: use findstr instead of grep
  const cmd = `docker compose logs | findstr "audit" | node "${CHECKER_PATH}"`;
  
  try {
    execSync(cmd, { cwd: SOLUTION_DIR, stdio: 'pipe' });
    return true;
  } catch (err) {
    throw new Error("Audit checker failed: limits were breached!\n" + (err.stderr ? err.stderr.toString() : err.stdout ? err.stdout.toString() : err.message));
  }
}

module.exports = { makeRequest, sendBurst, setSimulatedTime, resetSimulatedTime, sleep, report, runAuditChecker };
