import { useState } from "react";
import { sendBurst, getAudit, setSimulatedTime, resetSimulatedTime, apiRequest } from "../api";

/**
 * Custom Load Test
 *
 * Lets the user pick a customer, a simulated time (UTC), and a
 * request count, then fires that many requests and reports how
 * many were allowed vs rejected, the effective RPM, and whether
 * an override was active.
 */

const KNOWN_CUSTOMERS = [
  // Enterprise
  { id: "northwind",    label: "Northwind    — Enterprise  — 300 RPM (1300 RPM 02:00–04:00 UTC batch)" },
  { id: "globalship",  label: "GlobalShip   — Enterprise  — 600 RPM (1000 RPM 06:00–08:00 UTC batch)" },
  { id: "techcorp",    label: "TechCorp     — Enterprise  — 600 RPM" },
  // Growth
  { id: "acme-corp",   label: "Acme Corp    — Growth      — 300 RPM" },
  { id: "bluesky-inc", label: "BlueSky Inc  — Growth      — 300 RPM" },
  { id: "rapidscale",  label: "RapidScale   — Growth      — 300 RPM" },
  { id: "dataflow-io", label: "DataFlow.io  — Growth      — 300 RPM" },
  // Starter
  { id: "small-biz",   label: "Small Biz    — Starter     — 60 RPM" },
  { id: "freelance-hub", label: "FreelanceHub — Starter   — 60 RPM" },
  { id: "pixel-shop",  label: "PixelShop    — Starter     — 60 RPM" }
];

export default function CustomLoadTest() {
  const [customerId, setCustomerId] = useState("northwind");
  const [useCustomId, setUseCustomId] = useState(false);
  const [customIdInput, setCustomIdInput] = useState("");
  const [simulatedTimeStr, setSimulatedTimeStr] = useState("2026-03-15T02:30:00");
  const [useSimTime, setUseSimTime] = useState(false);
  const [requestCount, setRequestCount] = useState(100);

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);

  function addLog(message, type = "info") {
    setLogs((prev) => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
  }

  async function runTest() {
    setIsRunning(true);
    setResult(null);
    setLogs([]);

    const effectiveId = useCustomId && customIdInput.trim()
      ? customIdInput.trim()
      : customerId;

    try {
      // Step 1: Set simulated time if enabled
      if (useSimTime) {
        // datetime-local gives "2026-03-15T03:01:05" (or without seconds if step is not used).
        // Without "Z", new Date() treats it as LOCAL time, not UTC.
        // We append "Z" (and optionally ":00") to force UTC interpretation.
        const suffix = simulatedTimeStr.length === 16 ? ":00Z" : "Z";
        const isoTime = new Date(simulatedTimeStr + suffix).toISOString();
        addLog(`Setting simulated time to ${isoTime} (UTC)...`);
        await setSimulatedTime(isoTime);
        addLog("Simulated time set.", "success");
        // Let it propagate
        await new Promise((r) => setTimeout(r, 500));
      }

      // Step 2: Get the audit info (shows effective RPM)
      addLog(`Fetching audit for customer "${effectiveId}"...`);
      const auditRes = await getAudit(effectiveId);
      const effective = auditRes.body.currentEffective;
      addLog(
        `Effective RPM: ${effective.rpm} | Override: ${effective.isScheduleOverride} | Reason: ${effective.overrideReason || "none"}`,
        effective.isScheduleOverride ? "warn" : "success"
      );

      // Step 3: Send requests as the real customer ID.
      //
      // NOTE: The rate limiter counts all requests in the last 60 seconds.
      // If you ran this test recently, leftover entries in the sliding window
      // will reduce available slots. Wait ~60 seconds between runs for a clean result.
      addLog(`Sending ${requestCount} requests as "${effectiveId}"...`);
      addLog("Note: prior requests in this 60s window reduce available slots.", "warn");

      // Step 4: Fire the burst
      const startTime = Date.now();
      const responses = await sendBurst(effectiveId, requestCount);
      const elapsed = Date.now() - startTime;

      // Step 5: Count results
      const allowed = responses.filter((r) => r.statusCode === 200).length;
      const rejected = responses.filter((r) => r.statusCode === 429).length;
      const errors = responses.filter((r) => r.statusCode !== 200 && r.statusCode !== 429).length;

      const testResult = {
        customerId: effectiveId,
        effectiveRpm: effective.rpm,
        isOverride: effective.isScheduleOverride,
        overrideReason: effective.overrideReason,
        requestsSent: requestCount,
        allowed,
        rejected,
        errors,
        elapsedMs: elapsed
      };

      setResult(testResult);

      addLog(
        `Done in ${elapsed}ms — Allowed: ${allowed}, Rejected: ${rejected}${errors > 0 ? `, Errors: ${errors}` : ""}`,
        allowed <= effective.rpm ? "success" : "error"
      );

      // Check if allowed count matches expectation
      const expectedAllowed = Math.min(requestCount, effective.rpm);
      if (allowed === expectedAllowed) {
        addLog(`✓ Allowed count (${allowed}) matches expected (${expectedAllowed})`, "success");
      } else {
        addLog(`✗ Allowed count (${allowed}) differs from expected (${expectedAllowed})`, "error");
      }

    } catch (err) {
      addLog(`Error: ${err.message}`, "error");
    }

    // Always reset simulated time
    if (useSimTime) {
      await resetSimulatedTime();
      addLog("Simulated time reset to real time.");
    }

    setIsRunning(false);
  }

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Custom Load Test</h2>
          <p className="card-subtitle">
            Pick a customer, time window, and request count — fire and see what happens
          </p>
        </div>
      </div>

      {/* Customer selection */}
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <div className="form-label">Customer</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {KNOWN_CUSTOMERS.map((c) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", fontSize: "0.9rem" }}>
              <input
                type="radio"
                name="customer"
                checked={!useCustomId && customerId === c.id}
                onChange={() => { setCustomerId(c.id); setUseCustomId(false); }}
                disabled={isRunning}
              />
              {c.label}
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", fontSize: "0.9rem" }}>
            <input
              type="radio"
              name="customer"
              checked={useCustomId}
              onChange={() => setUseCustomId(true)}
              disabled={isRunning}
            />
            Custom ID:
            <input
              className="form-input"
              value={customIdInput}
              onChange={(e) => { setCustomIdInput(e.target.value); setUseCustomId(true); }}
              placeholder="my-customer-123"
              disabled={isRunning}
              style={{ width: "200px", marginLeft: "var(--space-xs)" }}
            />
          </label>
        </div>
      </div>

      {/* Time simulation toggle */}
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", marginBottom: "var(--space-sm)" }}>
          <input
            type="checkbox"
            checked={useSimTime}
            onChange={(e) => setUseSimTime(e.target.checked)}
            disabled={isRunning}
          />
          <span className="form-label" style={{ margin: 0 }}>Simulate a specific UTC time</span>
        </label>
        {useSimTime && (
          <input
            className="form-input"
            type="datetime-local"
            step="1"
            value={simulatedTimeStr}
            onChange={(e) => setSimulatedTimeStr(e.target.value)}
            disabled={isRunning}
            style={{ maxWidth: "300px" }}
          />
        )}
      </div>

      {/* Request count */}
      <div className="form-row" style={{ marginBottom: "var(--space-lg)" }}>
        <div className="form-group">
          <label className="form-label">Number of Requests</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="5000"
            value={requestCount}
            onChange={(e) => setRequestCount(parseInt(e.target.value) || 1)}
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
              <><span className="spinner"></span> Running...</>
            ) : (
              "▶ Fire Requests"
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
              <div className="stat-value blue">{result.effectiveRpm}</div>
              <div className="stat-label">Effective RPM {result.isOverride ? "(Override)" : ""}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value green">{result.allowed}</div>
              <div className="stat-label">Allowed (200)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value red">{result.rejected}</div>
              <div className="stat-label">Rejected (429)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "var(--text-secondary)" }}>{result.elapsedMs}ms</div>
              <div className="stat-label">Total Time</div>
            </div>
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
