import { useState, useEffect } from "react";
import { setSimulatedTime, resetSimulatedTime, getAudit } from "../api";

/**
 * Time Simulation Controls
 *
 * Set/reset simulated time across all nodes to test
 * Northwind's batch window without waiting until 2 AM UTC.
 */

const QUICK_TIMES = [
  { label: "01:00 UTC (Before batch)", time: "2026-03-15T01:00:00Z", desc: "Normal hours — 300 RPM" },
  { label: "02:00 UTC (Batch start)", time: "2026-03-15T02:00:00Z", desc: "Batch window starts — 1300 RPM" },
  { label: "02:30 UTC (Mid-batch)", time: "2026-03-15T02:30:00Z", desc: "Peak batch traffic" },
  { label: "03:59 UTC (Batch ending)", time: "2026-03-15T03:59:00Z", desc: "Just before window closes" },
  { label: "04:00 UTC (Batch end)", time: "2026-03-15T04:00:00Z", desc: "Window closed — 300 RPM" },
  { label: "12:00 UTC (Midday)", time: "2026-03-15T12:00:00Z", desc: "Normal daytime hours" }
];

export default function TimeSimulation() {
  const [currentSimTime, setCurrentSimTime] = useState(null);
  const [customTime, setCustomTime] = useState("2026-03-15T02:30:00");
  const [isApplying, setIsApplying] = useState(false);
  const [northwindRpm, setNorthwindRpm] = useState(null);

  async function applyTime(isoTime) {
    setIsApplying(true);
    await setSimulatedTime(isoTime);
    setCurrentSimTime(isoTime);

    // Wait for propagation, then check Northwind's effective RPM
    await new Promise((r) => setTimeout(r, 500));
    const audit = await getAudit("northwind");
    setNorthwindRpm(audit.body.currentEffective);

    setIsApplying(false);
  }

  async function handleReset() {
    setIsApplying(true);
    await resetSimulatedTime();
    setCurrentSimTime(null);

    const audit = await getAudit("northwind");
    setNorthwindRpm(audit.body.currentEffective);

    setIsApplying(false);
  }

  // Fetch initial Northwind state
  useEffect(() => {
    getAudit("northwind").then((res) => {
      setNorthwindRpm(res.body.currentEffective);
    });
  }, []);

  return (
    <div>
      <div className="card-header">
        <div>
          <h2 className="card-title">Time Simulation Controls</h2>
          <p className="card-subtitle">
            Fake the server time to test Northwind's batch window (02:00–04:00 UTC)
          </p>
        </div>
      </div>

      {/* Current state */}
      <div className="time-panel">
        <div>
          <div className="time-label">Current Mode</div>
          <div className="current-time">
            {currentSimTime ? (
              <>⏱ Simulated: {new Date(currentSimTime).toUTCString()}</>
            ) : (
              <>🕐 Real Time: {new Date().toUTCString()}</>
            )}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {currentSimTime && (
            <button className="btn btn-danger btn-sm" onClick={handleReset} disabled={isApplying}>
              Reset to Real Time
            </button>
          )}
        </div>
      </div>

      {/* Northwind effect */}
      {northwindRpm && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-lg)",
          padding: "var(--space-md) var(--space-lg)",
          background: northwindRpm.isScheduleOverride ? "var(--accent-yellow-glow)" : "var(--bg-secondary)",
          borderRadius: "var(--radius-md)",
          border: `1px solid ${northwindRpm.isScheduleOverride ? "rgba(245, 158, 11, 0.3)" : "var(--border-color)"}`,
          marginBottom: "var(--space-lg)"
        }}>
          <div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Northwind Effective RPM</div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "2rem",
              fontWeight: 700,
              color: northwindRpm.isScheduleOverride ? "var(--accent-yellow)" : "var(--accent-green)"
            }}>
              {northwindRpm.rpm}
            </div>
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {northwindRpm.isScheduleOverride ? (
              <>
                ⚡ <strong>Override Active</strong> — Batch window RPM
                <br />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Reason: {northwindRpm.overrideReason}
                </span>
              </>
            ) : (
              <>✓ Normal hours — Base RPM applied</>
            )}
          </div>
        </div>
      )}

      {/* Quick time buttons */}
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <div className="form-label" style={{ marginBottom: "var(--space-md)" }}>Quick Select</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-sm)" }}>
          {QUICK_TIMES.map((qt) => {
            const isActive = currentSimTime === qt.time;
            return (
              <button
                key={qt.time}
                className={`btn ${isActive ? "btn-primary" : "btn-outline"} btn-sm`}
                onClick={() => applyTime(qt.time)}
                disabled={isApplying}
                style={{ flexDirection: "column", alignItems: "flex-start", padding: "var(--space-sm) var(--space-md)" }}
              >
                <div style={{ fontWeight: 600 }}>{qt.label}</div>
                <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>{qt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom time input */}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Custom Time (ISO 8601)</label>
          <input
            className="form-input"
            type="datetime-local"
            step="1"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            className="btn btn-success"
            onClick={() => {
              const suffix = customTime.length === 16 ? ":00Z" : "Z";
              applyTime(new Date(customTime + suffix).toISOString());
            }}
            disabled={isApplying}
            style={{ width: "100%" }}
          >
            {isApplying ? (
              <>
                <span className="spinner"></span>
                Applying...
              </>
            ) : (
              "Apply Custom Time"
            )}
          </button>
        </div>
      </div>

      {/* Timeline visualization */}
      <div style={{ marginTop: "var(--space-xl)" }}>
        <div className="form-label" style={{ marginBottom: "var(--space-md)" }}>
          Northwind's 24-Hour Timeline (UTC)
        </div>
        <div style={{
          position: "relative",
          height: "60px",
          background: "var(--bg-input)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-color)",
          overflow: "hidden"
        }}>
          {/* Batch window highlight */}
          <div style={{
            position: "absolute",
            left: `${(2 / 24) * 100}%`,
            width: `${(2 / 24) * 100}%`,
            height: "100%",
            background: "var(--accent-yellow-glow)",
            borderLeft: "2px solid var(--accent-yellow)",
            borderRight: "2px solid var(--accent-yellow)"
          }}>
            <div style={{
              position: "absolute",
              top: "4px",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.65rem",
              color: "var(--accent-yellow)",
              fontWeight: 600,
              whiteSpace: "nowrap"
            }}>
              Batch Window (1300 RPM)
            </div>
          </div>

          {/* Current time marker */}
          {currentSimTime && (() => {
            const d = new Date(currentSimTime);
            const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
            const pct = (hours / 24) * 100;
            return (
              <div style={{
                position: "absolute",
                left: `${pct}%`,
                top: 0,
                width: "2px",
                height: "100%",
                background: "var(--accent-blue)",
                zIndex: 2
              }}>
                <div style={{
                  position: "absolute",
                  bottom: "4px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: "0.6rem",
                  color: "var(--accent-blue)",
                  fontWeight: 600,
                  whiteSpace: "nowrap"
                }}>
                  ▲ Now
                </div>
              </div>
            );
          })()}

          {/* Hour labels */}
          <div style={{ position: "absolute", bottom: "4px", left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 4px" }}>
            {[0, 4, 8, 12, 16, 20, 24].map((h) => (
              <span key={h} style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
