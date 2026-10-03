# Notes — Promise Them Nothing Twice

This file contains extended explanations and details that do not fit into the primary DECISIONS.md summary.

## Test Suite Details

The `solution/harness/tests/` directory contains 14 terminal tests proving the rate limiter's behavior:

1. **`01-basic-enforcement.js`**: Proves hard 429 enforcement kicks in exactly when a limit is exceeded.
2. **`02-customer-isolation.js`**: Proves Customer A flooding the API and exhausting their budget has zero impact on Customer B's limit.
3. **`03-northwind-batch-window.js`**: Proves Northwind is successfully granted 1300 RPM during their simulated 02:00-04:00 UTC window, and limits are verified via offline audit checking.
4. **`04-cto-success-criteria.js`**: Proves two 100-RPM customers get exactly 100 requests allowed across all 3 nodes, and a third gets cut off exactly at 100.
5. **`05-prove-tests-fail.js`**: (Replaced by `mutation-run.js`).
6. **`06-test-endpoints-gated.js`**: Proves that the `POST /api/v1/test/*` endpoints (which manipulate the clock for simulations) are blocked by default and return 404 unless `ENABLE_TEST_ENDPOINTS=true` is set.
7. **`07-redis-timeout.js`**: Proves that a hanging Redis (`docker pause`) doesn't hang the Node server; `commandTimeout` aborts the request and falls back to in-memory mode.
8. **`08-concurrency-analysis.js`**: Proves that 50 simultaneous requests against a slow endpoint are highly concurrent (max in-flight per node > 15), and 200 concurrent requests against a 100 RPM limit result in exactly 100 allowed (verified by audit logs).
9. **`09-window-reset.js`**: Proves the sliding window successfully resets after 60 seconds of waiting.
10. **`10-retry-after.js`**: Proves boundary precision on `Retry-After`. Hitting the endpoint at exactly `(Retry-After - 1)` seconds yields a 429, but waiting exactly `Retry-After` seconds yields a 200.
11. **`11-rejected-not-counted.js`**: Proves rejected requests are not counted in the log (preventing lockout death spirals).
12. **`12-batch-window-end.js`**: Proves Northwind's batch window automatically drops limits from 1300 RPM to 300 RPM once 04:00 UTC hits.
13. **`13-redis-fallback.js`**: Verifies `X-RateLimit-Source` header fallback logic.
14. **`14-redis-kill-recovery.js`**: Opt-in test (`--redis-kill`) that stops Redis entirely via Docker, proves requests do not hang and fall back to in-memory mode, and verifies that the system gracefully recovers once Redis is restarted.

## Mutation Run Details

The `harness/mutation-run.js` script dynamically rips out safeguards from the application code, runs the test suite to prove the bugs are caught, and then restores the code.

| Mutation Applied | Consequence | Caught By |
|---|---|---|
| **Non-atomic check** (simulating race conditions in JS) | Concurrent requests exceed the granted limit due to read-modify-write races. | `08-concurrency-analysis.js` & `audit-checker.js` |
| **Counting rejections** (extending lockout) | Northwind's aggressive retries would extend their lockout window, creating a death spiral. | `11-rejected-not-counted.js` |
| **Fixed window** (instead of sliding log) | Allows 2x bursts at the window boundary (e.g. 00:59 and 01:01). | `audit-checker.js` |
| **Oldest-entry Retry-After** (buggy pivot index) | Calculating `Retry-After` from the oldest overall entry fails when the request count far exceeds the limit. It must be computed from the `(count - limit + 1)`-th oldest entry. | `10-retry-after.js` |
| **Global lock** (ignoring customer ID) | Customer traffic is pooled, breaking isolation and causing unrelated customers to share a single limit. | `02-customer-isolation.js` & `04-cto-success-criteria.js` |
