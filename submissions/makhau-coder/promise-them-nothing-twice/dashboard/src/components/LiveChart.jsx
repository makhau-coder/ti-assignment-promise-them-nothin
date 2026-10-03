import { useState, useRef, useEffect } from "react";
import { sendBurst } from "../api";

/**
 * Live Traffic Chart
 *
 * Continuously sends requests and charts allowed vs rejected over time.
 * Shows a live bar chart with configurable rate and customer.
 */

const MAX_BARS = 60;

export default function LiveChart() {
  const [isRunning, setIsRunning] = useState(false);
  const [customerId, setCustomerId] = useState("small-biz");
  const [rps, setRps] = useState(2); // requests per second
  const [bars, setBars] = useState([]);
  const [totals, setTotals] = useState({ allowed: 0, rejected: 0, total: 0 });
  const intervalRef = useRef(null);

  function start() {
    setIsRunning(true);
    setBars([]);
    setTotals({ allowed: 0, rejected: 0, total: 0 });

    intervalRef.current = setInterval(async () => {
      try {
        const responses = await sendBurst(customerId, rps);
        const allowed = responses.filter((r) => r.statusCode === 200).length;
        const rejected = responses.filter((r) => r.statusCode === 429).length;

        setBars((prev) => {
          const newBars = [...prev, { allowed, rejected, time: new Date().toLocaleTimeString() }];
          if (newBars.length > MAX_BARS) newBars.shift();
          return newBars;
        });

        setTotals((prev) => ({
          allowed: prev.allowed + allowed,
          rejected: prev.rejected + rejected,
          total: prev.total + allowed + rejected
        }));
      } catch (err) {
        console.error("Chart tick error:", err);
      }
    }, 1000);
  }

  function stop() {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const maxBarValue = Math.max(1, ...bars.map((b) => b.allowed + b.rejected));

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Live Traffic Chart</h2>
          <p className="card-subtitle">
            Continuous requests with real-time allowed vs rejected visualization
          </p>
        </div>
        {isRunning ? (
          <button className="btn btn-danger" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn btn-success" onClick={start}>
            ▶ Start Streaming
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="form-row-3" style={{ marginBottom: "var(--space-lg)" }}>
        <div className="form-group">
          <label className="form-label">Customer</label>
          <select
            className="form-select"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={isRunning}
          >
            <option value="northwind">Northwind (300 RPM)</option>
            <option value="acme-corp">Acme Corp (300 RPM)</option>
            <option value="small-biz">Small Biz (60 RPM)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Requests per Second</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="100"
            value={rps}
            onChange={(e) => setRps(parseInt(e.target.value) || 1)}
            disabled={isRunning}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Effective Rate</label>
          <div style={{
            padding: "var(--space-sm) var(--space-md)",
            background: "var(--bg-input)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-color)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.9rem",
            color: "var(--accent-blue)"
          }}>
            {rps * 60} RPM ({rps}/sec)
          </div>
        </div>
      </div>

      {/* Stats */}
      {bars.length > 0 && (
        <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="stat-card">
            <div className="stat-value green">{totals.allowed}</div>
            <div className="stat-label">Total Allowed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value red">{totals.rejected}</div>
            <div className="stat-label">Total Rejected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value blue">{totals.total}</div>
            <div className="stat-label">Total Sent</div>
          </div>
        </div>
      )}

      {/* Bar chart */}
      <div className="chart-container">
        <div className="bar-chart">
          {bars.length === 0 && (
            <div style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "0.85rem"
            }}>
              {isRunning ? "Waiting for first data..." : "Click 'Start Streaming' to begin"}
            </div>
          )}
          {bars.map((bar, i) => {
            const totalHeight = bar.allowed + bar.rejected;
            const heightPct = (totalHeight / maxBarValue) * 100;
            const allowedPct = totalHeight > 0 ? (bar.allowed / totalHeight) * 100 : 0;

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  minWidth: "4px",
                  maxWidth: "12px",
                  height: `${heightPct}%`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  borderRadius: "2px 2px 0 0",
                  overflow: "hidden"
                }}
                title={`${bar.time}: ${bar.allowed} allowed, ${bar.rejected} rejected`}
              >
                {bar.rejected > 0 && (
                  <div style={{
                    height: `${100 - allowedPct}%`,
                    background: "var(--accent-red)",
                    minHeight: bar.rejected > 0 ? "2px" : 0
                  }}></div>
                )}
                {bar.allowed > 0 && (
                  <div style={{
                    height: `${allowedPct}%`,
                    background: "var(--accent-green)",
                    minHeight: bar.allowed > 0 ? "2px" : 0
                  }}></div>
                )}
              </div>
            );
          })}
        </div>

        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-dot green"></div>
            Allowed (200)
          </div>
          <div className="legend-item">
            <div className="legend-dot red"></div>
            Rejected (429)
          </div>
        </div>
      </div>
    </div>
  );
}
