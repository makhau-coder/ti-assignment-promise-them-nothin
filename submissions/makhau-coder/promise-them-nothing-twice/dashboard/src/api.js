/**
 * API helper for the dashboard.
 * All requests go through the Vite proxy to http://localhost:8080.
 */

const BASE = "";  // Vite proxy handles /api -> localhost:8080

/**
 * Make a request to the rate limiter service.
 */
export async function apiRequest(method, path, body = null, headers = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, options);

  const data = await response.json().catch(() => null);

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: data
  };
}

/**
 * Send a burst of N requests for a given customer.
 * Fires all requests in parallel and returns results.
 */
export async function sendBurst(customerId, count) {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(
      apiRequest("GET", "/api/v1/resource", null, { "X-Customer-Id": customerId })
    );
  }
  return Promise.all(promises);
}

/**
 * Check service health.
 */
export async function checkHealth() {
  return apiRequest("GET", "/health");
}

/**
 * Get audit info for a customer.
 */
export async function getAudit(customerId) {
  return apiRequest("GET", `/api/v1/audit/customer/${customerId}`);
}

/**
 * Set simulated time on all nodes (send 6 times for round-robin coverage).
 */
export async function setSimulatedTime(isoTime) {
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(apiRequest("POST", "/api/v1/test/set-time", { time: isoTime }));
  }
  return Promise.all(promises);
}

/**
 * Reset simulated time on all nodes.
 */
export async function resetSimulatedTime() {
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(apiRequest("POST", "/api/v1/test/reset-time"));
  }
  return Promise.all(promises);
}

/**
 * Stop Redis via docker compose (server-side Vite plugin).
 */
export async function stopRedis() {
  const res = await fetch("/harness/redis-stop", { method: "POST" });
  return res.json();
}

/**
 * Start Redis via docker compose (server-side Vite plugin).
 */
export async function startRedis() {
  const res = await fetch("/harness/redis-start", { method: "POST" });
  return res.json();
}
