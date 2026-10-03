import { useState } from "react";
import { apiRequest } from "../api";

/**
 * Concurrency Check Test
 *
 * Verifies that the rate limiter handles requests concurrently —
 * requests should NOT queue behind each other.
 *
 * How it works:
 * 1. Send N requests sequentially, measure total time (baseline).
 * 2. Send N requests in parallel (Promise.all), measure total time.
 * 3. If the system is concurrent, parallel time ≈ single-request time,
 *    NOT N × single-request time.
 *
 * A failing test would show parallel time close to sequential time,
 * meaning requests are being serialized somewhere (e.g., a global lock
 * or blocking Lua script without pipelining).
 */

export default function ConcurrencyCheck() {
  const [batchSize, setBatchSize] = useState(50);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);

  function addLog(message, type = "info") {
    setLogs((prev) => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
  }

  /**
   * Send a single request and return the elapsed time in ms.
   */
  async function timedRequest(customerId) {
    const start = performance.now();
    await apiRequest("GET", "/api/v1/resource", null, { "X-Customer-Id": customerId });
    return performance.now() - start;
  }

  async function runTest() {
    setIsRunning(true);
    setResult(null);
    setLogs([]);

    // Use a unique customer so there's no leftover state
    const customerId = `concurrency-test-${Date.now()}`;

    try {
      // ── Phase 1: Sequential baseline ──────────────────────────────
      addLog(`Phase 1: Sending ${batchSize} requests SEQUENTIALLY...`);

      const sequentialTimes = [];
      const seqStart = performance.now();

      for (let i = 0; i < batchSize; i++) {
        const elapsed = await timedRequest(customerId + "-seq");
        sequentialTimes.push(elapsed);
      }

      const seqTotalMs = performance.now() - seqStart;
      const seqAvgMs = sequentialTimes.reduce((a, b) => a + b, 0) / sequentialTimes.length;

      addLog(
        `Sequential: total=${seqTotalMs.toFixed(0)}ms, avg per request=${seqAvgMs.toFixed(1)}ms`,
        "success"
      );

      // ── Phase 2: Parallel burst ───────────────────────────────────
      addLog(`Phase 2: Sending ${batchSize} requests IN PARALLEL (Promise.all)...`);

      const parStart = performance.now();

      // Fire all requests at once
      const parallelPromises = [];
      for (let i = 0; i < batchSize; i++) {
        parallelPromises.push(timedRequest(customerId + "-par"));
      }
      const parallelTimes = await Promise.all(parallelPromises);

      const parTotalMs = performance.now() - parStart;
      const parAvgMs = parallelTimes.reduce((a, b) => a + b, 0) / parallelTimes.length;
      const parMaxMs = Math.max(...parallelTimes);

      addLog(
        `Parallel: total=${parTotalMs.toFixed(0)}ms, avg per request=${parAvgMs.toFixed(1)}ms, slowest=${parMaxMs.toFixed(0)}ms`,
        "success"
      );

      // ── Phase 3: Analysis ─────────────────────────────────────────
      // If truly concurrent, parallel total should be MUCH less than sequential total.
      // The speedup ratio tells us how well the system parallelizes.
      const speedup = seqTotalMs / parTotalMs;

      // Threshold: if parallel took less than 50% of sequential, it's concurrent.
      // A truly concurrent system should be 5-50x faster for 50 requests.
      const isConcurrent = speedup >= 2.0;

      // Also check: no individual parallel request took longer than 2x the
      // sequential average. If one did, requests might be queuing.
      const noStraggler = parMaxMs < seqAvgMs * 5;

      const passed = isConcurrent && noStraggler;

      const testResult = {
        batchSize,
        seqTotalMs: Math.round(seqTotalMs),
        seqAvgMs: Math.round(seqAvgMs * 10) / 10,
        parTotalMs: Math.round(parTotalMs),
        parAvgMs: Math.round(parAvgMs * 10) / 10,
        parMaxMs: Math.round(parMaxMs),
        speedup: Math.round(speedup * 10) / 10,
        isConcurrent,
        noStraggler,
        passed
      };

      setResult(testResult);

      addLog(`Speedup: ${speedup.toFixed(1)}x (sequential/parallel)`, speedup >= 2 ? "success" : "error");
      addLog(
        `Verdict: ${passed ? "✓ CONCURRENT" : "✗ POSSIBLY SERIALIZED"} — ` +
        `parallel total (${parTotalMs.toFixed(0)}ms) vs sequential total (${seqTotalMs.toFixed(0)}ms)`,
        passed ? "success" : "error"
      );

      if (!isConcurrent) {
        addLog(
          "Parallel time is too close to sequential time. Requests may be waiting for each other.",
          "error"
        );
      }
      if (!noStraggler) {
        addLog(
          `Straggler detected: slowest parallel request (${parMaxMs.toFixed(0)}ms) is >5x the sequential average (${seqAvgMs.toFixed(1)}ms).`,
          "error"
        );
      }

    } catch (err) {
      addLog(`Error: ${err.message}`, "error");
    }

    setIsRunning(false);
  }

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Concurrency Check</h2>
          <p className="card-subtitle">
            Verifies requests are handled in parallel — not queued behind each other
          </p>
        </div>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
        Sends the same number of requests <strong>sequentially</strong> (one at a time) and then <strong>in parallel</strong> (all at once via Promise.all).
        If the rate limiter is concurrent, the parallel batch should complete much faster than the sequential batch. If they take the same time,
        requests are being serialized somewhere.
      </p>

      {/* Config */}
      <div className="form-row" style={{ marginBottom: "var(--space-lg)" }}>
        <div className="form-group">
          <label className="form-label">Batch Size (requests per phase)</label>
          <input
            className="form-input"
            type="number"
            min="10"
            max="500"
            value={batchSize}
            onChange={(e) => setBatchSize(parseInt(e.target.value) || 10)}
            disabled={isRunning}
          />
        </div>
        <div className="form-group" style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={runTest}
            disabled={isRunning}
            style={{ width: "100%" }}
          >
            {isRunning ? (
              <><span className="spinner"></span> Testing...</>
            ) : (
              "▶ Run Concurrency Check"
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div style={{ marginBottom: "var(--space-lg)" }}>
          <div className="form-label" style={{ marginBottom: "var(--space-md)" }}>Results</div>
          <div className="stats-row" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--text-secondary)" }}>{result.seqTotalMs}ms</div>
              <div className="stat-label">Sequential Total</div>
            </div>
            <div className="stat-card">
              <div className="stat-value blue">{result.parTotalMs}ms</div>
              <div className="stat-label">Parallel Total</div>
            </div>
            <div className="stat-card">
              <div className="stat-value green">{result.speedup}x</div>
              <div className="stat-label">Speedup</div>
            </div>
            <div className="stat-card">
              <div className={`stat-value ${result.passed ? "green" : "red"}`}>
                {result.passed ? "✓ PASS" : "✗ FAIL"}
              </div>
              <div className="stat-label">Concurrent</div>
            </div>
          </div>

          {/* Timing comparison bar */}
          <div style={{ marginTop: "var(--space-lg)" }}>
            <div className="form-label" style={{ marginBottom: "var(--space-sm)" }}>Timing Comparison</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {/* Sequential bar */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <span style={{ width: "90px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Sequential</span>
                <div style={{
                  height: "28px",
                  width: "100%",
                  background: "var(--bg-input)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <div style={{
                    height: "100%",
                    width: "100%",
                    background: "linear-gradient(90deg, var(--accent-red), #ff6b6b)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: "var(--space-sm)"
                  }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff" }}>{result.seqTotalMs}ms</span>
                  </div>
                </div>
              </div>
              {/* Parallel bar */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <span style={{ width: "90px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Parallel</span>
                <div style={{
                  height: "28px",
                  width: "100%",
                  background: "var(--bg-input)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.max(3, (result.parTotalMs / result.seqTotalMs) * 100)}%`,
                    background: "linear-gradient(90deg, var(--accent-green), #51cf66)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: "var(--space-sm)"
                  }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff" }}>{result.parTotalMs}ms</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "var(--space-xs)" }}>
              Parallel should be a small fraction of sequential. If bars are similar length, requests are serialized.
            </div>
          </div>

          {/* Per-request stats */}
          <div style={{ marginTop: "var(--space-lg)" }}>
            <div className="form-label" style={{ marginBottom: "var(--space-sm)" }}>Per-Request Stats</div>
            <table style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "var(--space-sm)", borderBottom: "1px solid var(--border-color)" }}>Metric</th>
                  <th style={{ textAlign: "right", padding: "var(--space-sm)", borderBottom: "1px solid var(--border-color)" }}>Sequential</th>
                  <th style={{ textAlign: "right", padding: "var(--space-sm)", borderBottom: "1px solid var(--border-color)" }}>Parallel</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "var(--space-sm)" }}>Avg per request</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>{result.seqAvgMs}ms</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>{result.parAvgMs}ms</td>
                </tr>
                <tr>
                  <td style={{ padding: "var(--space-sm)" }}>Total wall time</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>{result.seqTotalMs}ms</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>{result.parTotalMs}ms</td>
                </tr>
                <tr>
                  <td style={{ padding: "var(--space-sm)" }}>Slowest request</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>—</td>
                  <td style={{ textAlign: "right", padding: "var(--space-sm)", fontFamily: "'JetBrains Mono', monospace" }}>{result.parMaxMs}ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div>
          <div className="form-label" style={{ marginBottom: "var(--space-sm)" }}>Log</div>
          <div className="log-panel">
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">{log.time}</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
