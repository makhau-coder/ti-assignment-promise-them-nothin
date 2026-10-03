# RelayAPI Rate Limiter

A distributed, per-customer rate limiting service built with Node.js, Express, and Redis (Sliding Window Log).

## Setup & Run (≤ 15 mins)

**Prerequisites:** Docker and Docker Compose installed.

1. Clone or enter the `solution` directory.
2. Start the service (3 app nodes + Redis + Nginx load balancer):
   ```bash
   docker compose up --build -d
   ```
3. The load balancer will listen on `http://localhost:8080`.

## Testing with the Harness

The harness can be run in two ways: CLI or Web Dashboard.
### Option 1: CLI Harness

A standalone Node.js script that runs the test suite.

1. Ensure you are in the `solution` directory.
2. Run the test suite:
   ```bash
   npm test
   ```
3. The suite will run all 14 tests (taking ~3 minutes due to 60s waits). A detailed JSON report will be saved to `harness/harness-report.json`.
4. **Redis Kill Test (Opt-in):** By default, the destructive Redis stop/start test is skipped. To run the suite *with* the Redis kill & recovery test enabled, pass the `--redis-kill` flag:
   ```bash
   npm test -- --redis-kill
   ```

### Option 2: Web Dashboard

A premium React dashboard that provides a visual interface for the harness.

1. Navigate to the `dashboard` directory:
   ```bash
   cd ../dashboard
   npm install
   npm run dev
   ```
2. Open `http://localhost:5173` in your browser.
3. You can run all automated tests, simulate time, use the manual sender, and view live charts.

## Endpoints

- `GET /health`: LB health check
- `GET /api/v1/resource`: Mock rate-limited endpoint. Requires `X-Customer-Id` header.
- `GET /api/v1/audit/customer/:customerId`: Audit endpoint showing full config and current effective RPM.
- `POST /api/v1/test/set-time`: Fake the server time (for testing batch window overrides). Body: `{ "time": "2026-03-15T02:30:00Z" }`
- `POST /api/v1/test/reset-time`: Reset to real time.

## Architecture & Features

- **Algorithm:** Atomic Sliding Window Log via Redis Lua script.
- **Clock Drift:** Uses `Redis TIME` to avoid app node clock differences.
- **Aggressive Retries:** Rejected requests (429s) are *not* added to the log, preventing Northwind's retries from extending the lockout.
- **Fallback:** If Redis is down, nodes gracefully degrade to an in-memory sliding window enforcing `RPM / TOTAL_NODES`.
- **Time-based Overrides:** Handled via config, not hardcoded logic.
