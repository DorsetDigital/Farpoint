export type MonitorState = "UNKNOWN" | "UP" | "DEGRADED" | "DOWN";

export interface Env {
  DB: D1Database;
  MONITORS: DurableObjectNamespace;
  API_KEY: string;
  SLACK_WEBHOOK_URL?: string;
  CONTROL_PANEL_BASE_URL?: string;
  RAW_RETENTION_DAYS?: string;
  HOURLY_RETENTION_DAYS?: string;
  DAILY_RETENTION_DAYS?: string;
  INCIDENT_RETENTION_DAYS?: string;
  MONITORING_PAUSED?: string;
}

export interface MonitorRow {
  id: string;
  name: string;
  url: string;
  enabled: number;
  interval_seconds: number;
  offset_seconds: number;
  timeout_ms: number;
  expected_status: number;
  min_body_bytes: number;
  must_contain: string | null;
  must_not_contain: string | null;
  degraded_enabled: number;
  degraded_threshold_ms: number;
  degraded_confirmation_checks: number;
  failure_confirmation_checks: number;
  recovery_confirmation_checks: number;
  current_state: MonitorState;
  consecutive_failures: number;
  consecutive_slow: number;
  consecutive_healthy: number;
  consecutive_successes: number;
  last_checked_at: number | null;
  last_response_time_ms: number | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CheckResult {
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
}

export interface StateCounters {
  consecutiveFailures: number;
  consecutiveSlow: number;
  consecutiveHealthy: number;
  consecutiveSuccesses: number;
}

export interface StateTransition {
  state: MonitorState;
  counters: StateCounters;
}

export interface MonitorInput {
  name: string;
  url: string;
  enabled?: boolean;
  interval_seconds?: number;
  timeout_ms?: number;
  expected_status?: number;
  min_body_bytes?: number;
  must_contain?: string[];
  must_not_contain?: string[];
  degraded?: {
    enabled?: boolean;
    threshold_ms?: number;
    confirmation_checks?: number;
  };
  failure_confirmation_checks?: number;
  recovery_confirmation_checks?: number;
}
