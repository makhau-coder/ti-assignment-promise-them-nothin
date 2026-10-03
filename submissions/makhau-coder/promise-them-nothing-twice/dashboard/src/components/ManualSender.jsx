import { useState } from "react";
import { sendBurst } from "../api";

/**
 * Manual Request Sender
 *
 * Pick a customer, set how many requests to send,
 * and see the results with a breakdown chart.
 */

const PRESET_CUSTOMERS = [
  { id: "northwind", label: "Northwind (Enterprise, 300 RPM)", rpm: 300 },
  { id: "acme-corp", label: "Acme Corp (Growth, 300 RPM)", rpm: 300 },
  { id: "small-biz", label: "Small Biz (Starter, 60 RPM)", rpm: 60 }
];

export default function ManualSender() {
  const [customerId, setCustomerId] = useState("small-biz");
  const [customCustomerId, setCustomCustomerId] = useState("");
  const [requestCount, setRequestCount] = useState(75);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [history, setHistory] = useState([]);

  async function handleSend() {
    const actualId = customerId === "custom" ? customCustomerId : customerId;
    if (!actualId) return;

    setIsRunning(true);
    setResults(null);

    const startTime = Date.now();
    const responses = await sendBurst(actualId, requestCount);
    const elapsed = Date.now() - startTime;

    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const rejected = responses.filter((r) => r.statusCode === 429).length;
    const errors = responses.filter((r) => r.statusCode !== 200 && r.statusCode !== 429).length;

    // Get node distribution
    const nodeDistribution = {};
    responses.forEach((r) => {
      if (r.body && r.body.data && r.body.data.nodeId) {
        const nodeId = r.body.data.nodeId;
        nodeDistribution[nodeId] = (nodeDistribution[nodeId] || 0) + 1;
      }
    });

    // Get rate limit info from last successful response
    const lastOk = responses.find((r) => r.statusCode === 200);
    const rateLimit = lastOk ? lastOk.headers["x-ratelimit-limit"] : "?";
    const source = lastOk ? lastOk.headers["x-ratelimit-source"] : "?";

    const result = {
      customerId: actualId,
      totalSent: requestCount,
      allowed,
      rejected,
      errors,
      elapsed,
      rateLimit,
      source,
      nodeDistribution,
      timestamp: new Date().toISOString()
    };

    setResults(result);
    setHistory((prev) => [result, ...prev].slice(0, 10));
    setIsRunning(false);
  }

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Manual Request Sender</h2>
          <p className="card-subtitle">Send a burst of requests and see the results</p>
        </div>
      </div>

      <div className="form-row-3">
        <div className="form-group">
          <label className="form-label">Customer</label>
          <select
            className="form-select"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            {PRESET_CUSTOMERS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
            <option value="custom">Custom ID...</option>
          </select>
        </div>

        {customerId === "custom" && (
          <div className="form-group">
            <label className="form-label">Custom ID</label>
            <input
              className="form-input"
              type="text"
              placeholder="my-customer-id"
              value={customCustomerId}
              onChange={(e) => setCustomCustomerId(e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Number of Requests</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="5000"
            value={requestCount}
            onChange={(e) => setRequestCount(parseInt(e.target.value) || 1)}
          />
        </div>

        <div className="form-group" style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={isRunning}
            style={{ width: "100%" }}
          >
            {isRunning ? (
              <>
                <span className="spinner"></span>
                Sending {requestCount} requests...
              </>
            ) : (
              `Send ${requestCount} Requests`
            )}
          </button>
        </div>
      </div>

      {results && (
        <div style={{ marginTop: "var(--space-xl)" }}>
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-value blue">{results.totalSent}</div>
              <div className="stat-label">Total Sent</div>
            </div>
            <div className="stat-card">
              <div className="stat-value green">{results.allowed}</div>
              <div className="stat-label">Allowed (200)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value red">{results.rejected}</div>
              <div className="stat-label">Rejected (429)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value yellow">{results.elapsed}ms</div>
              <div className="stat-label">Duration</div>
            </div>
          </div>

          {/* Visual bar showing allowed vs rejected ratio */}
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
              Request Distribution
            </div>
            <div style={{
              display: "flex",
              height: "32px",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              border: "1px solid var(--border-color)"
            }}>
              {results.allowed > 0 && (
                <div style={{
                  width: `${(results.allowed / results.totalSent) * 100}%`,
                  background: "var(--accent-green)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "white",
                  transition: "width 0.5s ease"
                }}>
                  {results.allowed} OK
                </div>
              )}
              {results.rejected > 0 && (
                <div style={{
                  width: `${(results.rejected / results.totalSent) * 100}%`,
                  background: "var(--accent-red)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "white",
                  transition: "width 0.5s ease"
                }}>
                  {results.rejected} Rejected
                </div>
              )}
            </div>
          </div>

          {/* Node distribution */}
          {Object.keys(results.nodeDistribution).length > 0 && (
            <div style={{ marginBottom: "var(--space-lg)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                Node Distribution (Round-Robin)
              </div>
              <div style={{ display: "flex", gap: "var(--space-md)" }}>
                {Object.entries(results.nodeDistribution).map(([node, count]) => (
                  <div key={node} className="stat-card" style={{ flex: 1, padding: "var(--space-sm) var(--space-md)" }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.2rem", fontWeight: 600, color: "var(--accent-blue)" }}>
                      {count}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                      {node}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Rate Limit: {results.rateLimit} RPM | Source: {results.source}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div style={{ marginTop: "var(--space-xl)" }}>
          <h3 className="card-title" style={{ fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
            Recent Runs
          </h3>
          <table className="results-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Sent</th>
                <th>Allowed</th>
                <th>Rejected</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{h.customerId}</td>
                  <td>{h.totalSent}</td>
                  <td style={{ color: "var(--accent-green)" }}>{h.allowed}</td>
                  <td style={{ color: "var(--accent-red)" }}>{h.rejected}</td>
                  <td>{h.elapsed}ms</td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
