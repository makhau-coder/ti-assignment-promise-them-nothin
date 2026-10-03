const fs = require('fs');

/**
 * Offline Audit Log Checker
 *
 * Reads JSON audit lines and asserts that NO 60-second window
 * ever admitted more requests than the effective limit for a customer.
 *
 * Usage: docker compose logs | grep '{"audit":true' | node harness/audit-checker.js
 */

const WINDOW_MICRO = 60 * 1000000;

function main() {
  const data = fs.readFileSync(0, 'utf-8'); // Read all from stdin
  const lines = data.split('\n');

  const history = {}; // customerId -> array of { timeMicro, limit }
  let totalAllowed = 0;
  let totalDenied = 0;
  let errors = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Sometimes docker compose logs have prefix like "solution-app-node-1-1  | {"audit":..."
    const jsonStart = line.indexOf('{"audit":');
    if (jsonStart === -1) continue;

    const jsonStr = line.substring(jsonStart);
    try {
      const entry = JSON.parse(jsonStr);
      
      if (entry.decision === 'deny') {
        totalDenied++;
        continue;
      }
      
      totalAllowed++;

      const cust = entry.customer;
      if (!history[cust]) {
        history[cust] = [];
      }
      
      history[cust].push({
        timeMicro: entry.redisTimeMicro,
        limit: entry.effectiveLimit
      });

    } catch (e) {
      console.error("Failed to parse line:", line);
    }
  }

  console.log(`Parsed ${totalAllowed} allowed and ${totalDenied} denied requests.`);

  // For each customer, sort their allowed requests by time and check windows
  for (const cust of Object.keys(history)) {
    const requests = history[cust];
    requests.sort((a, b) => a.timeMicro - b.timeMicro);

    let left = 0;
    for (let right = 0; right < requests.length; right++) {
      const rightReq = requests[right];
      
      // Advance left pointer to keep window within 60 seconds
      while (rightReq.timeMicro - requests[left].timeMicro > WINDOW_MICRO) {
        left++;
      }

      const windowSize = right - left + 1;
      
      // Check against the limit at the time of the right-most request
      if (windowSize > rightReq.limit) {
        errors++;
        console.error(`[VIOLATION] Customer ${cust} had ${windowSize} requests in 60s, but limit was ${rightReq.limit}. Timestamp: ${rightReq.timeMicro}`);
      }
    }
  }

  if (errors > 0) {
    console.error(`\nAudit check FAILED with ${errors} violations.`);
    process.exit(1);
  } else {
    console.log(`\nAudit check PASSED. No 60s window exceeded its limit.`);
    process.exit(0);
  }
}

main();
