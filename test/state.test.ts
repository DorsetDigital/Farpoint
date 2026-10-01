import { describe, expect, it } from "vitest";
import { transitionState } from "../src/state";
import type { CheckResult, MonitorRow } from "../src/types";

function monitor(overrides: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: "test",
    name: "Test",
    url: "https://example.com/",
    enabled: 1,
    interval_seconds: 300,
    offset_seconds: 22,
    timeout_ms: 15000,
    expected_status: 200,
    min_body_bytes: 256,
    must_contain: null,
    must_not_contain: null,
    degraded_enabled: 1,
    degraded_threshold_ms: 3000,
    degraded_confirmation_checks: 2,
    failure_confirmation_checks: 2,
    recovery_confirmation_checks: 2,
    current_state: "UP",
    consecutive_failures: 0,
    consecutive_slow: 0,
    consecutive_healthy: 0,
    consecutive_successes: 0,
    last_checked_at: null,
    last_response_time_ms: null,
    last_status_code: null,
    last_error: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function result(ok: boolean, responseTimeMs: number): CheckResult {
  return {
    ok,
    statusCode: ok ? 200 : 503,
    responseTimeMs,
    error: ok ? null : "HTTP 503",
  };
}

describe("transitionState", () => {
  it("requires confirmed failures before going down", () => {
    const first = transitionState(monitor(), result(false, 100));
    expect(first.state).toBe("UP");

    const second = transitionState(
      monitor({
        consecutive_failures: first.counters.consecutiveFailures,
      }),
      result(false, 100),
    );
    expect(second.state).toBe("DOWN");
  });

  it("requires confirmed slow checks before becoming degraded", () => {
    const first = transitionState(monitor(), result(true, 4000));
    expect(first.state).toBe("UP");

    const second = transitionState(
      monitor({
        consecutive_slow: first.counters.consecutiveSlow,
        consecutive_successes: first.counters.consecutiveSuccesses,
      }),
      result(true, 4200),
    );
    expect(second.state).toBe("DEGRADED");
  });

  it("requires confirmed healthy checks to recover from degraded", () => {
    const first = transitionState(
      monitor({ current_state: "DEGRADED" }),
      result(true, 500),
    );
    expect(first.state).toBe("DEGRADED");

    const second = transitionState(
      monitor({
        current_state: "DEGRADED",
        consecutive_healthy: first.counters.consecutiveHealthy,
        consecutive_successes: first.counters.consecutiveSuccesses,
      }),
      result(true, 450),
    );
    expect(second.state).toBe("UP");
  });
});
