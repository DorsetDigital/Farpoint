import type { MonitorState } from "./types";

export const DASHBOARD_WINDOWS = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
} as const;

export type DashboardWindow = keyof typeof DASHBOARD_WINDOWS;

export interface DashboardIncident {
  monitor_id: string;
  state: "DEGRADED" | "DOWN";
  started_at: number;
  ended_at: number | null;
}

export interface AvailabilityWindow {
  uptime_percent: number | null;
  degraded_percent: number | null;
  down_ms: number;
  degraded_ms: number;
  observed_ms: number;
}

export function clampInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}

export function dashboardState(value: string | null): MonitorState | null {
  if (!value) {
    return null;
  }

  const state = value.toUpperCase();
  return state === "UNKNOWN" ||
    state === "UP" ||
    state === "DEGRADED" ||
    state === "DOWN"
    ? state
    : null;
}

export function overlapMs(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

export function calculateAvailability(
  monitorCreatedAt: number,
  incidents: DashboardIncident[],
  days: number,
  now = Date.now(),
): AvailabilityWindow {
  const requestedStart = now - days * 86_400_000;
  const observedStart = Math.max(requestedStart, monitorCreatedAt);
  const observedMs = Math.max(0, now - observedStart);

  if (observedMs === 0) {
    return {
      uptime_percent: null,
      degraded_percent: null,
      down_ms: 0,
      degraded_ms: 0,
      observed_ms: 0,
    };
  }

  let downMs = 0;
  let degradedMs = 0;

  for (const incident of incidents) {
    const duration = overlapMs(
      incident.started_at,
      incident.ended_at ?? now,
      observedStart,
      now,
    );

    if (incident.state === "DOWN") {
      downMs += duration;
    } else {
      degradedMs += duration;
    }
  }

  const uptimePercent = ((observedMs - downMs) / observedMs) * 100;
  const degradedPercent = (degradedMs / observedMs) * 100;

  return {
    uptime_percent: Number(Math.max(0, uptimePercent).toFixed(4)),
    degraded_percent: Number(Math.max(0, degradedPercent).toFixed(4)),
    down_ms: downMs,
    degraded_ms: degradedMs,
    observed_ms: observedMs,
  };
}
