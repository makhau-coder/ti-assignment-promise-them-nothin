import { useState } from "react";
import { sendBurst, checkHealth, getAudit, setSimulatedTime, resetSimulatedTime, stopRedis, startRedis } from "../api";

/**
 * Harness Tests Panel
 *
 * Runs all 10 harness test scenarios with live status updates.
 * Each test shows PASS/FAIL/RUNNING status in a table.
 */

const TEST_DEFINITIONS = [
  {
    id: 1,
    name: "Basic enforcement (60 RPM, send 75)",
    description: "Sends 75 requests for a 60 RPM customer. Expects 60 allowed, 15 rejected."
  },
  {
    id: 2,
    name: "Multi-customer isolation",
    description: "Two customers on same tier. Flooding one should not affect the other."
  },
  {
    id: 3,
    name: "Northwind batch window (1300 RPM)",
    description: "Simulates 02:30 UTC. Northwind should get 1300 RPM override."
  },
  {
    id: 4,
    name: "Distributed correctness (3 nodes)",
    description: "Total allowed across all nodes should equal RPM, not RPM × 3."
  },
  {
    id: 5,
    name: "Boundary precision (RPM then RPM+1)",
    description: "Exactly 60 requests pass, then request #61 gets rejected."
  },
  {
    id: 6,
    name: "Retry-After header validation",
    description: "Verify 429 response includes correct Retry-After and rate limit headers."
  },
  {
    id: 7,
    name: "Northwind batch window end (1300→300)",
    description: "RPM drops from 1300 to 300 when batch window ends at 04:00 UTC."
  },
  {
    id: 8,
    name: "Redis source verification",
    description: "X-RateLimit-Source header should say 'redis' when Redis is connected."
  },
  {
    id: 9,
    name: "Redis kill & recovery",
    description: "Stops Redis mid-traffic, verifies fallback (no hangs), restarts and confirms reconnection. Opt-in."
  }
];

export default function HarnessTests() {
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState(null);
  const [logs, setLogs] = useState([]);
  const [redisKillEnabled, setRedisKillEnabled] = useState(false);

  function addLog(message, type = "info") {
    setLogs((prev) => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
  }

  function updateResult(id, status, detail) {
    setResults((prev) => {
      const existing = prev.find((r) => r.id === id);
      if (existing) {
        return prev.map((r) => (r.id === id ? { ...r, status, detail } : r));
      }
      return [...prev, { id, status, detail }];
    });
  }

  async function runAllTests() {
    setIsRunning(true);
    setResults([]);
    setLogs([]);

    // Initialize all tests as pending
    TEST_DEFINITIONS.forEach((t) => {
      updateResult(t.id, "pending", "Waiting...");
    });

    try {
      // Check health first
      addLog("Checking service health...");
      const health = await checkHealth();
      if (health.statusCode !== 200) {
        addLog("Service is not healthy! Aborting.", "error");
        setIsRunning(false);
        return;
      }
      addLog(`Service healthy — ${health.body.nodeId}, Redis: ${health.body.redis}`, "success");

      // Reset any simulated time
      await resetSimulatedTime();

      // Test 1: Basic enforcement
      await runTest1();
      // Test 2: Customer isolation
      await runTest2();
      // Test 3: Northwind batch window
      await runTest3();
      // Test 4: Distributed correctness
      await runTest4();
      // Test 5: Boundary precision
      await runTest5();
      // Test 6: Retry-After
      await runTest6();
      // Test 7: Batch window end
      await runTest7();
      // Test 8: Redis source
      await runTest8();

      // Test 9: Redis kill & recovery (opt-in)
      if (redisKillEnabled) {
        await runTest9();
      } else {
        addLog("Skipping test 9 (Redis kill & recovery) — enable checkbox to run.", "warn");
      }

      addLog("All tests complete!", "success");
    } catch (err) {
      addLog(`Harness error: ${err.message}`, "error");
    }

    setIsRunning(false);
    setCurrentTest(null);
  }

  async function runTest1() {
    setCurrentTest(1);
    updateResult(1, "running", "Sending 75 requests...");
    addLog("Test 1: Sending 75 requests for small-biz (60 RPM)...");

    const customerId = "harness-test1-" + Date.now();
    // We need to use a customer with 60 RPM — unknown customers default to 60 RPM
    const responses = await sendBurst(customerId, 75);
    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const rejected = responses.filter((r) => r.statusCode === 429).length;

    const passed = allowed === 60 && rejected === 15;
    const detail = `Allowed: ${allowed}/60, Rejected: ${rejected}/15`;
    updateResult(1, passed ? "pass" : "fail", detail);
    addLog(`Test 1: ${detail}`, passed ? "success" : "error");
  }

  async function runTest2() {
    setCurrentTest(2);
    updateResult(2, "running", "Flooding customer A...");
    addLog("Test 2: Multi-customer isolation...");

    const idA = "harness-iso-a-" + Date.now();
    const idB = "harness-iso-b-" + Date.now();

    // Flood customer A with 80 requests (60 RPM limit for unknown customers)
    const responsesA = await sendBurst(idA, 80);
    const allowedA = responsesA.filter((r) => r.statusCode === 200).length;

    // Customer B sends 10 — should all pass
    const responsesB = await sendBurst(idB, 10);
    const allowedB = responsesB.filter((r) => r.statusCode === 200).length;

    const passed = allowedA === 60 && allowedB === 10;
    const detail = `A: ${allowedA}/60 allowed | B: ${allowedB}/10 allowed`;
    updateResult(2, passed ? "pass" : "fail", detail);
    addLog(`Test 2: ${detail}`, passed ? "success" : "error");
  }

  async function runTest3() {
    setCurrentTest(3);
    updateResult(3, "running", "Setting simulated time to 02:30 UTC...");
    addLog("Test 3: Setting time to 02:30 UTC for Northwind batch window...");

    await setSimulatedTime("2026-03-15T02:30:00Z");
    // Small delay for time to propagate
    await new Promise((r) => setTimeout(r, 500));

    // Check audit to verify override
    const audit = await getAudit("northwind");
    const effectiveRpm = audit.body.currentEffective.rpm;

    if (effectiveRpm !== 1300) {
      updateResult(3, "fail", `Override not active! RPM=${effectiveRpm}`);
      addLog(`Test 3: Override not active! RPM=${effectiveRpm}`, "error");
      await resetSimulatedTime();
      return;
    }

    addLog("Test 3: Override active (1300 RPM). Sending 1350 requests...");
    const responses = await sendBurst("northwind", 1350);
    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const rejected = responses.filter((r) => r.statusCode === 429).length;

    const passed = allowed === 1300 && rejected === 50;
    const detail = `RPM=1300 | Allowed: ${allowed}/1300, Rejected: ${rejected}/50`;
    updateResult(3, passed ? "pass" : "fail", detail);
    addLog(`Test 3: ${detail}`, passed ? "success" : "error");

    await resetSimulatedTime();
  }

  async function runTest4() {
    setCurrentTest(4);
    updateResult(4, "running", "Sending 90 requests across 3 nodes...");
    addLog("Test 4: Distributed correctness — 90 requests, expect 60 allowed...");

    const customerId = "harness-dist-" + Date.now();
    const responses = await sendBurst(customerId, 90);
    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const rejected = responses.filter((r) => r.statusCode === 429).length;

    const passed = allowed === 60 && rejected === 30;
    const detail = `Allowed: ${allowed}/60 (not ${60 * 3}), Rejected: ${rejected}/30`;
    updateResult(4, passed ? "pass" : "fail", detail);
    addLog(`Test 4: ${detail}`, passed ? "success" : "error");
  }

  async function runTest5() {
    setCurrentTest(5);
    updateResult(5, "running", "Sending exactly 60, then 1 more...");
    addLog("Test 5: Boundary precision...");

    const customerId = "harness-bound-" + Date.now();
    const firstBatch = await sendBurst(customerId, 60);
    const firstAllowed = firstBatch.filter((r) => r.statusCode === 200).length;

    const extra = await sendBurst(customerId, 1);
    const extraRejected = extra[0].statusCode === 429;

    const passed = firstAllowed === 60 && extraRejected;
    const detail = `First 60: ${firstAllowed}/60 | Extra: ${extra[0].statusCode} (expect 429)`;
    updateResult(5, passed ? "pass" : "fail", detail);
    addLog(`Test 5: ${detail}`, passed ? "success" : "error");
  }

  async function runTest6() {
    setCurrentTest(6);
    updateResult(6, "running", "Checking Retry-After header...");
    addLog("Test 6: Retry-After header validation...");

    const customerId = "harness-retry-" + Date.now();
    await sendBurst(customerId, 60);

    const rejected = await sendBurst(customerId, 1);
    const res = rejected[0];

    const retryAfter = res.headers["retry-after"];
    const limit = res.headers["x-ratelimit-limit"];
    const remaining = res.headers["x-ratelimit-remaining"];
    const hasHeaders = retryAfter && limit && remaining === "0";

    const passed = res.statusCode === 429 && hasHeaders;
    const detail = `Status: ${res.statusCode} | Retry-After: ${retryAfter}s | Remaining: ${remaining}`;
    updateResult(6, passed ? "pass" : "fail", detail);
    addLog(`Test 6: ${detail}`, passed ? "success" : "error");
  }

  async function runTest7() {
    setCurrentTest(7);
    updateResult(7, "running", "Testing batch window transition...");
    addLog("Test 7: Northwind batch window end...");

    await setSimulatedTime("2026-03-15T03:59:00Z");
    await new Promise((r) => setTimeout(r, 500));

    const auditBefore = await getAudit("northwind");
    const rpmBefore = auditBefore.body.currentEffective.rpm;

    await setSimulatedTime("2026-03-15T04:01:00Z");
    await new Promise((r) => setTimeout(r, 500));

    const auditAfter = await getAudit("northwind");
    const rpmAfter = auditAfter.body.currentEffective.rpm;

    const passed = rpmBefore === 1300 && rpmAfter === 300;
    const detail = `Before: ${rpmBefore} RPM → After: ${rpmAfter} RPM`;
    updateResult(7, passed ? "pass" : "fail", detail);
    addLog(`Test 7: ${detail}`, passed ? "success" : "error");

    await resetSimulatedTime();
  }

  async function runTest8() {
    setCurrentTest(8);
    updateResult(8, "running", "Checking X-RateLimit-Source header...");
    addLog("Test 8: Redis source verification...");

    const customerId = "harness-source-" + Date.now();
    const responses = await sendBurst(customerId, 1);
    const source = responses[0].headers["x-ratelimit-source"];

    const passed = source === "redis";
    const detail = `X-RateLimit-Source: ${source}`;
    updateResult(8, passed ? "pass" : "fail", detail);
    addLog(`Test 8: ${detail}`, passed ? "success" : "error");
  }

  async function runTest9() {
    setCurrentTest(9);
    updateResult(9, "running", "Pre-check: verifying source=redis...");
    addLog("Test 9: Redis kill & recovery — starting...");

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      // Step 1: Pre-check source=redis
      const preId = "harness-redis-kill-" + Date.now();
      const preRes = await sendBurst(preId, 1);
      const preSrc = preRes[0].headers["x-ratelimit-source"];

      if (preSrc !== "redis") {
        updateResult(9, "fail", `Pre-check failed: source=${preSrc}`);
        addLog(`Test 9: Pre-check failed — source=${preSrc}`, "error");
        return;
      }
      addLog("Test 9: Pre-check passed (source=redis)", "success");

      // Step 2: Stop Redis
      updateResult(9, "running", "Stopping Redis...");
      addLog("Test 9: Stopping Redis via docker compose...");
      const stopRes = await stopRedis();
      if (!stopRes.ok) {
        updateResult(9, "fail", `Failed to stop Redis: ${stopRes.error}`);
        addLog(`Test 9: Failed to stop Redis: ${stopRes.error}`, "error");
        return;
      }
      addLog("Test 9: Redis stopped", "success");

      // Give nodes time to detect disconnect
      await sleep(2000);

      // Step 3: Send traffic while Redis is down
      updateResult(9, "running", "Sending requests with Redis down...");
      addLog("Test 9: Sending 20 requests with Redis down...");
      const fallbackId = "harness-fallback-" + Date.now();
      let allGotResponse = true;
      let anyHung = false;
      let fallbackSource = null;

      for (let i = 0; i < 20; i++) {
        const start = Date.now();
        try {
          const res = await sendBurst(fallbackId, 1);
          const elapsed = Date.now() - start;
          if (elapsed > 5000) anyHung = true;
          if (res[0].headers["x-ratelimit-source"]) {
            fallbackSource = res[0].headers["x-ratelimit-source"];
          }
          if (res[0].statusCode !== 200 && res[0].statusCode !== 429) {
            allGotResponse = false;
          }
        } catch {
          allGotResponse = false;
        }
      }

      const fallbackOk = allGotResponse && !anyHung;
      addLog(
        `Test 9: Fallback check — responded=${allGotResponse}, noHangs=${!anyHung}, source=${fallbackSource}`,
        fallbackOk ? "success" : "error"
      );

      // Step 4: Restart Redis
      updateResult(9, "running", "Restarting Redis...");
      addLog("Test 9: Starting Redis via docker compose...");
      const startRes = await startRedis();
      if (!startRes.ok) {
        updateResult(9, "fail", `Failed to start Redis: ${startRes.error}`);
        addLog(`Test 9: Failed to start Redis: ${startRes.error}`, "error");
        return;
      }
      addLog("Test 9: Redis started", "success");

      // Step 5: Wait for reconnection (up to 15 seconds)
      updateResult(9, "running", "Waiting for nodes to reconnect...");
      addLog("Test 9: Waiting for nodes to reconnect to Redis...");
      let reconnected = false;
      const reconnectId = "harness-reconnect-" + Date.now();

      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(1000);
        try {
          const res = await sendBurst(reconnectId, 1);
          if (res[0].headers["x-ratelimit-source"] === "redis") {
            reconnected = true;
            break;
          }
        } catch {
          // Redis might still be booting
        }
      }

      const passed = fallbackOk && reconnected;
      const detail = `Fallback: OK=${fallbackOk} (source=${fallbackSource}) | No hangs: ${!anyHung} | Reconnected: ${reconnected}`;
      updateResult(9, passed ? "pass" : "fail", detail);
      addLog(`Test 9: ${detail}`, passed ? "success" : "error");
    } catch (err) {
      // Always try to restart Redis even on error
      try { await startRedis(); } catch {}
      updateResult(9, "fail", `Error: ${err.message}`);
      addLog(`Test 9: Error: ${err.message}`, "error");
    }
  }

  const passedCount = results.filter((r) => r.status === "pass").length;
  const failedCount = results.filter((r) => r.status === "fail").length;
  const totalDone = passedCount + failedCount;

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Harness Tests</h2>
          <p className="card-subtitle">Run automated tests against the rate limiter</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={runAllTests}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner"></span>
              Running...
            </>
          ) : (
            "▶ Run All Tests"
          )}
        </button>
      </div>

      {/* Opt-in toggle for Redis kill test */}
      <label style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        marginBottom: "var(--space-lg)",
        fontSize: "0.85rem",
        color: "var(--text-secondary)",
        cursor: "pointer"
      }}>
        <input
          type="checkbox"
          checked={redisKillEnabled}
          onChange={(e) => setRedisKillEnabled(e.target.checked)}
          disabled={isRunning}
          style={{ accentColor: "var(--accent-red)" }}
        />
        🔴 Include Redis kill &amp; recovery test (stops/starts Redis via Docker)
      </label>

      {results.length > 0 && (
        <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card">
            <div className="stat-value blue">{totalDone}/{TEST_DEFINITIONS.length}</div>
            <div className="stat-label">Completed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value green">{passedCount}</div>
            <div className="stat-label">Passed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value red">{failedCount}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
      )}

      <table className="results-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Test</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {TEST_DEFINITIONS.map((test) => {
            const result = results.find((r) => r.id === test.id);
            return (
              <tr key={test.id}>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)" }}>
                  {test.id}
                </td>
                <td>
                  <div>{test.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                    {test.description}
                  </div>
                </td>
                <td>
                  {result ? (
                    <span className={`status-badge ${result.status}`}>
                      {result.status === "running" && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }}></span>}
                      {result.status}
                    </span>
                  ) : (
                    <span className="status-badge pending">pending</span>
                  )}
                </td>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  {result ? result.detail : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {logs.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <h3 className="card-title" style={{ marginBottom: "var(--space-md)", fontSize: "0.9rem" }}>
            Execution Log
          </h3>
          <div className="log-area">
            {logs.map((log, i) => (
              <div key={i} className={`log-line ${log.type}`}>
                <span style={{ color: "var(--text-muted)" }}>[{log.time}]</span> {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
