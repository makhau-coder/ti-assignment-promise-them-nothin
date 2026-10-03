import { useState, useEffect } from "react";
import HarnessTests from "./components/HarnessTests";
import ManualSender from "./components/ManualSender";
import CustomerDashboard from "./components/CustomerDashboard";
import TimeSimulation from "./components/TimeSimulation";
import LiveChart from "./components/LiveChart";
import CustomLoadTest from "./components/CustomLoadTest";
import ConcurrencyCheck from "./components/ConcurrencyCheck";
import { checkHealth } from "./api";

/**
 * RelayAPI Rate Limiter Dashboard
 *
 * A React UI for testing and monitoring the rate limiter service.
 * 5 tabs: Harness Tests, Manual Sender, Customer Dashboard, Time Simulation, Live Chart
 */

const TABS = [
  { id: "harness", label: "🧪 Harness Tests" },
  { id: "loadtest", label: "🎯 Load Test" },
  { id: "concurrency", label: "⚡ Concurrency" },
  { id: "sender", label: "🚀 Manual Sender" },
  { id: "dashboard", label: "📊 Dashboard" },
  { id: "time", label: "⏱ Time Sim" },
  { id: "chart", label: "📈 Live Chart" }
];

function App() {
  const [activeTab, setActiveTab] = useState("harness");
  const [health, setHealth] = useState(null);

  useEffect(() => {
    // Check health on load and every 10 seconds
    async function fetchHealth() {
      try {
        const res = await checkHealth();
        setHealth(res.body);
      } catch (err) {
        setHealth({ status: "unreachable" });
      }
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = health && health.status === "ok";

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1>RelayAPI Rate Limiter</h1>
        <p>Distributed rate limiting dashboard & test harness</p>

        {health && (
          <div className={`health-badge ${isHealthy ? "healthy" : "unhealthy"}`}>
            <span className="health-dot"></span>
            {isHealthy ? (
              <>Service Online — {health.nodeId} — Redis: {health.redis}</>
            ) : (
              <>Service Unreachable</>
            )}
          </div>
        )}
      </header>

      {/* Tab navigation */}
      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="card">
        {activeTab === "harness" && <HarnessTests />}
        {activeTab === "loadtest" && <CustomLoadTest />}
        {activeTab === "concurrency" && <ConcurrencyCheck />}
        {activeTab === "sender" && <ManualSender />}
        {activeTab === "dashboard" && <CustomerDashboard />}
        {activeTab === "time" && <TimeSimulation />}
        {activeTab === "chart" && <LiveChart />}
      </div>
    </div>
  );
}

export default App;
