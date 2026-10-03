import { useState, useEffect } from "react";
import { getAudit, checkHealth } from "../api";

/**
 * Customer Dashboard
 *
 * Shows real-time rate limit status for each customer.
 * Auto-refreshes every 5 seconds.
 */

const CUSTOMERS = ["northwind", "acme-corp", "small-biz"];

export default function CustomerDashboard() {
  const [customerData, setCustomerData] = useState({});
  const [healthData, setHealthData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  async function fetchData() {
    try {
      // Fetch health
      const health = await checkHealth();
      setHealthData(health.body);

      // Fetch audit for each customer
      const data = {};
      for (const id of CUSTOMERS) {
        const audit = await getAudit(id);
        data[id] = audit.body;
      }
      setCustomerData(data);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
        <div className="spinner" style={{ width: 32, height: 32, margin: "0 auto", borderWidth: 3 }}></div>
        <p style={{ marginTop: "var(--space-md)", color: "var(--text-muted)" }}>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Customer Status Dashboard</h2>
          <p className="card-subtitle">Real-time rate limit status per customer (auto-refreshes every 5s)</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchData}>
          ↻ Refresh
        </button>
      </div>

      {/* Service info */}
      {healthData && (
        <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "var(--space-xl)" }}>
          <div className="stat-card">
            <div className="stat-value blue" style={{ fontSize: "1.2rem" }}>{healthData.nodeId}</div>
            <div className="stat-label">Last Responding Node</div>
          </div>
          <div className="stat-card">
            <div className="stat-value green" style={{ fontSize: "1.2rem" }}>{healthData.redis}</div>
            <div className="stat-label">Redis Status</div>
          </div>
          <div className="stat-card">
            <div className="stat-value yellow" style={{ fontSize: "1rem" }}>
              {new Date(healthData.timestamp).toLocaleTimeString()}
            </div>
            <div className="stat-label">Last Check</div>
          </div>
        </div>
      )}

      {/* Customer cards */}
      <div style={{ display: "grid", gap: "var(--space-md)" }}>
        {CUSTOMERS.map((id) => {
          const data = customerData[id];
          if (!data) return null;

          const isOverride = data.currentEffective?.isScheduleOverride;
          const effectiveRpm = data.currentEffective?.rpm;
          const baseRpm = data.customer?.baseRpm;
          const tier = data.customer?.tier;
          const overrides = data.customer?.scheduleOverrides || [];

          return (
            <div key={id} className="card" style={{ padding: "var(--space-md) var(--space-lg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>{id}</h3>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "8px",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      background: tier === "enterprise" ? "rgba(168, 85, 247, 0.15)" : tier === "growth" ? "rgba(99, 102, 241, 0.15)" : "rgba(100, 116, 139, 0.15)",
                      color: tier === "enterprise" ? "var(--accent-purple)" : tier === "growth" ? "var(--accent-blue)" : "var(--text-muted)"
                    }}>
                      {tier}
                    </span>
                    {isOverride && (
                      <span className="status-badge" style={{
                        background: "var(--accent-yellow-glow)",
                        color: "var(--accent-yellow)",
                        fontSize: "0.7rem"
                      }}>
                        ⚡ Schedule Override Active
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "var(--space-xs)" }}>
                    Base: {baseRpm} RPM
                    {overrides.length > 0 && ` | ${overrides.length} schedule override(s)`}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: isOverride ? "var(--accent-yellow)" : "var(--accent-green)"
                  }}>
                    {effectiveRpm}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                    Effective RPM
                  </div>
                </div>
              </div>

              {/* Schedule overrides detail */}
              {overrides.length > 0 && (
                <div style={{
                  marginTop: "var(--space-md)",
                  padding: "var(--space-sm) var(--space-md)",
                  background: "var(--bg-input)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem"
                }}>
                  {overrides.map((ov, i) => (
                    <div key={i} style={{ color: "var(--text-secondary)" }}>
                      📅 {ov.windowStart}–{ov.windowEnd} UTC → {ov.rpm} RPM
                      <span style={{ color: "var(--text-muted)", marginLeft: "var(--space-md)" }}>
                        ({ov.reason})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Counting method */}
      {customerData["northwind"] && (
        <div style={{
          marginTop: "var(--space-xl)",
          padding: "var(--space-md)",
          background: "var(--bg-secondary)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-color)",
          fontSize: "0.8rem",
          color: "var(--text-secondary)"
        }}>
          <strong style={{ color: "var(--text-primary)" }}>Counting Method:</strong>{" "}
          {customerData["northwind"].countingMethod}
        </div>
      )}
    </div>
  );
}
