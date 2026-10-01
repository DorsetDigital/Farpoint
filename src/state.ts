import type {
  CheckResult,
  MonitorRow,
  MonitorState,
  StateCounters,
  StateTransition,
} from "./types";

export function transitionState(
  monitor: Pick<
    MonitorRow,
    | "current_state"
    | "degraded_enabled"
    | "degraded_threshold_ms"
    | "degraded_confirmation_checks"
    | "failure_confirmation_checks"
    | "recovery_confirmation_checks"
    | "consecutive_failures"
    | "consecutive_slow"
    | "consecutive_healthy"
    | "consecutive_successes"
  >,
  result: CheckResult,
): StateTransition {
  let state: MonitorState = monitor.current_state;
  const counters: StateCounters = {
    consecutiveFailures: monitor.consecutive_failures,
    consecutiveSlow: monitor.consecutive_slow,
    consecutiveHealthy: monitor.consecutive_healthy,
    consecutiveSuccesses: monitor.consecutive_successes,
  };

  if (!result.ok) {
    counters.consecutiveFailures += 1;
    counters.consecutiveSlow = 0;
    counters.consecutiveHealthy = 0;
    counters.consecutiveSuccesses = 0;

    if (counters.consecutiveFailures >= monitor.failure_confirmation_checks) {
      state = "DOWN";
    }

    return { state, counters };
  }

  counters.consecutiveFailures = 0;
  counters.consecutiveSuccesses += 1;

  const isSlow =
    monitor.degraded_enabled === 1 &&
    result.responseTimeMs > monitor.degraded_threshold_ms;

  if (isSlow) {
    counters.consecutiveSlow += 1;
    counters.consecutiveHealthy = 0;

    if (
      state === "DOWN" &&
      counters.consecutiveSuccesses < monitor.recovery_confirmation_checks
    ) {
      return { state, counters };
    }

    if (counters.consecutiveSlow >= monitor.degraded_confirmation_checks) {
      state = "DEGRADED";
    } else if (state === "UNKNOWN" || state === "DOWN") {
      state = "UP";
    }

    return { state, counters };
  }

  counters.consecutiveSlow = 0;
  counters.consecutiveHealthy += 1;

  if (
    state === "DOWN" &&
    counters.consecutiveSuccesses < monitor.recovery_confirmation_checks
  ) {
    return { state, counters };
  }

  if (
    state === "DEGRADED" &&
    counters.consecutiveHealthy < monitor.recovery_confirmation_checks
  ) {
    return { state, counters };
  }

  state = "UP";
  return { state, counters };
}
