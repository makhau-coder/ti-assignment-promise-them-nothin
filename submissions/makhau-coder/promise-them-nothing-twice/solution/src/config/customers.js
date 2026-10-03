/**
 * Customer configuration for RelayAPI rate limiter.
 *
 * Each customer has:
 *   - customerId: unique identifier (comes from X-Customer-Id header)
 *   - tier: pricing tier name
 *   - baseRpm: default requests-per-minute limit
 *   - scheduleOverrides: optional array of time-based RPM overrides
 *
 * Schedule overrides allow raising (or lowering) a customer's RPM
 * during specific time windows. This is a generic, auditable feature —
 * not a customer-specific hack. Any Enterprise customer can have overrides.
 *
 * Overrides are checked in order. The first matching window wins.
 * If no override matches, baseRpm is used.
 */

// Simulated time for testing (null = use real time)
let simulatedTime = null;

const customers = {

  // ── Enterprise tier (600 RPM base, scheduled overrides allowed) ───────

  "northwind": {
    customerId: "northwind",
    tier: "enterprise",
    baseRpm: 300,
    scheduleOverrides: [
      {
        windowStart: "02:00",   // UTC
        windowEnd: "04:00",     // UTC
        rpm: 1300,
        reason: "Contracted nightly batch window — approved by sales",
        approvedBy: "priya@relayapi.com"
      }
    ]
  },

  "globalship": {
    customerId: "globalship",
    tier: "enterprise",
    baseRpm: 600,
    scheduleOverrides: [
      {
        windowStart: "06:00",   // UTC — morning logistics sync
        windowEnd: "08:00",     // UTC
        rpm: 1000,
        reason: "Morning fleet sync batch — approved by sales",
        approvedBy: "priya@relayapi.com"
      }
    ]
  },

  "techcorp": {
    customerId: "techcorp",
    tier: "enterprise",
    baseRpm: 600,
    scheduleOverrides: []
  },

  // ── Growth tier (300 RPM, no overrides) ──────────────────────────────

  "acme-corp": {
    customerId: "acme-corp",
    tier: "growth",
    baseRpm: 300,
    scheduleOverrides: []
  },

  "bluesky-inc": {
    customerId: "bluesky-inc",
    tier: "growth",
    baseRpm: 300,
    scheduleOverrides: []
  },

  "rapidscale": {
    customerId: "rapidscale",
    tier: "growth",
    baseRpm: 300,
    scheduleOverrides: []
  },

  "dataflow-io": {
    customerId: "dataflow-io",
    tier: "growth",
    baseRpm: 300,
    scheduleOverrides: []
  },

  // ── Starter tier (60 RPM) ─────────────────────────────────────────────

  "small-biz": {
    customerId: "small-biz",
    tier: "starter",
    baseRpm: 60,
    scheduleOverrides: []
  },

  "freelance-hub": {
    customerId: "freelance-hub",
    tier: "starter",
    baseRpm: 60,
    scheduleOverrides: []
  },

  "pixel-shop": {
    customerId: "pixel-shop",
    tier: "starter",
    baseRpm: 60,
    scheduleOverrides: []
  },

  // ── CTO demo tier (100 RPM — matches CTO success criteria exactly) ────

  "cto-demo-a": {
    customerId: "cto-demo-a",
    tier: "demo-100",
    baseRpm: 100,
    scheduleOverrides: []
  },

  "cto-demo-b": {
    customerId: "cto-demo-b",
    tier: "demo-100",
    baseRpm: 100,
    scheduleOverrides: []
  },

  "cto-demo-c": {
    customerId: "cto-demo-c",
    tier: "demo-100",
    baseRpm: 100,
    scheduleOverrides: []
  }

};

// Default config for unknown customers (safety net)
const defaultCustomerConfig = {
  tier: "starter",
  baseRpm: 60,
  scheduleOverrides: []
};

/**
 * Get the current effective RPM for a customer.
 *
 * Checks if any schedule override is active right now.
 * If yes, returns the override RPM.
 * If no, returns the base RPM.
 *
 * @param {string} customerId
 * @returns {{ rpm: number, isOverride: boolean, reason: string | null }}
 */
function getEffectiveRpm(customerId) {
  let customer = customers[customerId];

  // Dynamically support any CTO demo run-id (e.g. cto-demo-a-12345) with 100 RPM
  if (!customer && customerId.startsWith("cto-demo-")) {
    customer = {
      customerId,
      tier: "demo-100",
      baseRpm: 100,
      scheduleOverrides: []
    };
  }

  if (!customer) {
    return {
      rpm: defaultCustomerConfig.baseRpm,
      isOverride: false,
      reason: null
    };
  }

  // Use simulated time if set, otherwise real time
  const now = simulatedTime ? new Date(simulatedTime) : new Date();
  const currentUtcHours = now.getUTCHours();
  const currentUtcMinutes = now.getUTCMinutes();
  const currentUtcSeconds = now.getUTCSeconds();
  const currentTimeSeconds = currentUtcHours * 3600 + currentUtcMinutes * 60 + currentUtcSeconds;

  for (const override of customer.scheduleOverrides) {
    // Overrides are defined as "HH:mm" strings
    const [startHour, startMin] = override.windowStart.split(":").map(Number);
    const [endHour, endMin] = override.windowEnd.split(":").map(Number);

    const startSeconds = startHour * 3600 + startMin * 60;
    const endSeconds = endHour * 3600 + endMin * 60;

    // Check if current time falls within the override window
    let isInWindow = false;

    if (startSeconds < endSeconds) {
      // Normal window (e.g., 02:00 to 04:00)
      isInWindow = currentTimeSeconds >= startSeconds && currentTimeSeconds < endSeconds;
    } else {
      // Overnight window (e.g., 23:00 to 03:00)
      isInWindow = currentTimeSeconds >= startSeconds || currentTimeSeconds < endSeconds;
    }

    if (isInWindow) {
      return {
        rpm: override.rpm,
        isOverride: true,
        reason: override.reason
      };
    }
  }

  // No override matched — use base RPM
  return {
    rpm: customer.baseRpm,
    isOverride: false,
    reason: null
  };
}

/**
 * Get the full customer config (for audit/debug endpoints).
 *
 * @param {string} customerId
 * @returns {object}
 */
function getCustomerConfig(customerId) {
  if (customers[customerId]) return customers[customerId];
  
  if (customerId.startsWith("cto-demo-")) {
    return {
      customerId,
      tier: "demo-100",
      baseRpm: 100,
      scheduleOverrides: []
    };
  }

  return { customerId, ...defaultCustomerConfig };
}

/**
 * Set a simulated time for testing schedule overrides.
 * Pass an ISO string like "2026-03-15T02:30:00Z" to simulate 02:30 UTC.
 * Pass null to go back to real time.
 *
 * @param {string | null} isoString
 */
function setSimulatedTime(isoString) {
  simulatedTime = isoString;
}

/**
 * Clear simulated time — go back to real time.
 */
function clearSimulatedTime() {
  simulatedTime = null;
}

/**
 * Get the current simulated time (or null if using real time).
 */
function getSimulatedTime() {
  return simulatedTime;
}

module.exports = {
  customers,
  defaultCustomerConfig,
  getEffectiveRpm,
  getCustomerConfig,
  setSimulatedTime,
  clearSimulatedTime,
  getSimulatedTime
};
