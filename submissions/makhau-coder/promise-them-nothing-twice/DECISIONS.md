# Decisions — Promise Them Nothing Twice

## 1. Conflict Resolution

**Decision:** Config-driven scheduled quota overrides.
Northwind Logistics is granted a strict schedule override in the configuration, raising their limit to 1300 RPM from exactly 02:00 to 04:00 UTC. *(Note: The 1300 RPM ceiling is assumed to be a commercially approved limit).* 

- **Grace period:** None. The limit cuts over instantly at 04:00 UTC.
- **Auditable logs:** One JSON line per decision is emitted to `stdout` containing the customer, node ID, decision (allow/deny), Redis time, effective limit, count, and policy ID.
- **Missing/Unknown IDs:** Missing `X-Customer-Id` headers are rejected with a 400 Bad Request. Unknown customer IDs default to the 60 RPM Starter tier.

*(For detailed explanations of our test coverage and mutation runs, see `NOTES.md`).*

---

## 2. Algorithm and Distributed Coordination

**Decision:** Sliding Window Log via Redis Lua Script.

- **Atomicity:** The sliding window log pruning (`ZREMRANGEBYSCORE`), window counting (`ZCARD`), limit decision, and insertion (`ZADD`) happen inside a single atomic Lua script. 
- **Time/Clock:** The Lua script uses `redis.call('TIME')` internally. The sliding window boundary is evaluated strictly using this Redis timestamp, guaranteeing all nodes share the same clock. However, the *effective limit* (e.g. checking if it is currently 02:00 UTC for a schedule override) is resolved in Node.js using the application server clock.
- **Rejection Policy:** Rejected requests (429s) are explicitly *not* added to the sliding window log. This ensures retries do not extend the lockout.
- **Retry-After Precision:** `Retry-After` is dynamically computed inside the Lua script by finding the exact `(count - limit + 1)`-th oldest entry in the sorted set.

---

## 3. What the Harness Proves and Does Not Prove

**Proved by tests (Terminal scripts in `harness/tests/`):**
- **Boundary Precision:** Exactly RPM requests pass, RPM+1 are rejected. Waiting exactly `(Retry-After - 1)` seconds yields 429; waiting exactly `Retry-After` seconds yields 200.
- **Distributed Correctness:** Two 100-RPM customers get exactly 100 requests allowed across 3 nodes. A third gets cut off exactly at 100.
- **Concurrency:** Overlapping bursts of 200 requests (proven by tracking `maxInFlight` on the nodes) correctly admit exactly 100 requests.
- **Redis Hanging/Down Behavior:** 
  - A hanging Redis triggers `ioredis` `commandTimeout` (set to 500ms), falling back to in-memory mode without infinite hanging.
  - A dead Redis triggers the fallback in-memory sliding window, which enforces an `RPM / 3` limit per node.
- **Security:** The `POST /api/v1/test/*` simulation endpoints are gated and return 404 by default.
- **Mutation Resilience:** Removing atomicity, counting rejections, using fixed windows, or breaking `Retry-After` logic reliably turns the test suite red.

**Unverified claims / What it does NOT prove:**
- **Circuit Breaker:** There is no circuit breaker. While the 500ms `commandTimeout` prevents infinite hangs, every single request incurs this 500ms penalty until Redis recovers or is fully disconnected.
- **Nginx Fairness in Fallback:** The fallback assumes Nginx perfectly round-robins traffic (`RPM / 3`). If traffic is unevenly distributed, the limit will be overly restrictive.
- **UI Dashboard Integrity:** The interactive Vite React dashboard UI is not covered by automated tests.

---

## 4. What I'd Build Next (With 4 Hours)

With four more hours, I would first fix the slow Redis problem. Right now, if Redis gets slow, every request waits about 500ms before it switches to
the backup limiter. I would make the app stop calling Redis for a few seconds after it fails a few times in a row, and then try it again. Next, I
would make everything use one clock. At the moment the app picks the limit using the server's time, but it counts requests using Redis's time, so if
the two are a bit different, the wrong limit could apply for a few seconds around 02:00 and 04:00. After that, I would add a "watch only" mode that
just logs what the limiter would have blocked, so we can check it is correct before it touches Northwind's traffic, plus a switch to turn the
limiter off quickly if something goes wrong. I would also add a short grace period after 04:00, so if Northwind's batch finishes a little late, they
don't get blocked while the last minute of requests clears out. Finally, I would add more tests, including one with a deliberately wrong limiter (like
a fixed window) to show that my tests actually catch it.
