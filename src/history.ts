import type { Env, MonitorRow, MonitorState } from "./types";

export const DEFAULT_RETENTION_DAYS = {
  raw: 30,
  hourly: 365,
  daily: 1825,
  incidents: 1825,
} as const;

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export function bucketStart(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

export function retentionDays(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function recordHourlyAggregate(
  env: Env,
  monitorId: string,
  checkedAt: number,
  state: MonitorState,
  responseTimeMs: number,
): Promise<void> {
  const periodStart = bucketStart(checkedAt, HOUR_MS);

  await env.DB.prepare(
    `INSERT INTO monitor_hourly_stats (
      monitor_id, period_start, checks, up_checks, degraded_checks, down_checks,
      response_time_sum_ms, response_time_min_ms, response_time_max_ms
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (monitor_id, period_start) DO UPDATE SET
      checks = checks + 1,
      up_checks = up_checks + excluded.up_checks,
      degraded_checks = degraded_checks + excluded.degraded_checks,
      down_checks = down_checks + excluded.down_checks,
      response_time_sum_ms = response_time_sum_ms + excluded.response_time_sum_ms,
      response_time_min_ms = MIN(response_time_min_ms, excluded.response_time_min_ms),
      response_time_max_ms = MAX(response_time_max_ms, excluded.response_time_max_ms)`,
  ).bind(
    monitorId,
    periodStart,
    state === "UP" ? 1 : 0,
    state === "DEGRADED" ? 1 : 0,
    state === "DOWN" ? 1 : 0,
    responseTimeMs,
    responseTimeMs,
    responseTimeMs,
  ).run();
}

export async function rollupCompletedDay(
  env: Env,
  monitorId: string,
  dayStart: number,
): Promise<void> {
  const dayEnd = dayStart + DAY_MS;

  await env.DB.prepare(
    `INSERT INTO monitor_daily_stats (
      monitor_id, period_start, checks, up_checks, degraded_checks, down_checks,
      response_time_sum_ms, response_time_min_ms, response_time_max_ms
    )
    SELECT
      monitor_id,
      ?,
      SUM(checks),
      SUM(up_checks),
      SUM(degraded_checks),
      SUM(down_checks),
      SUM(response_time_sum_ms),
      MIN(response_time_min_ms),
      MAX(response_time_max_ms)
    FROM monitor_hourly_stats
    WHERE monitor_id = ? AND period_start >= ? AND period_start < ?
    GROUP BY monitor_id
    ON CONFLICT (monitor_id, period_start) DO UPDATE SET
      checks = excluded.checks,
      up_checks = excluded.up_checks,
      degraded_checks = excluded.degraded_checks,
      down_checks = excluded.down_checks,
      response_time_sum_ms = excluded.response_time_sum_ms,
      response_time_min_ms = excluded.response_time_min_ms,
      response_time_max_ms = excluded.response_time_max_ms`,
  ).bind(dayStart, monitorId, dayStart, dayEnd).run();
}

export async function recordIncidentTransition(
  env: Env,
  monitor: Pick<MonitorRow, "id" | "current_state">,
  nextState: MonitorState,
  changedAt: number,
): Promise<void> {
  if (nextState === monitor.current_state) {
    return;
  }

  const statements: D1PreparedStatement[] = [];

  if (
    monitor.current_state === "DEGRADED" ||
    monitor.current_state === "DOWN"
  ) {
    statements.push(
      env.DB.prepare(
        "UPDATE monitor_incidents " +
          "SET ended_at = ?, duration_ms = ? - started_at " +
          "WHERE monitor_id = ? AND ended_at IS NULL",
      ).bind(changedAt, changedAt, monitor.id),
    );
  }

  if (nextState === "DEGRADED" || nextState === "DOWN") {
    statements.push(
      env.DB.prepare(
        "INSERT INTO monitor_incidents " +
          "(monitor_id, state, started_at) VALUES (?, ?, ?)",
      ).bind(monitor.id, nextState, changedAt),
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }
}

export async function pruneHistory(
  env: Env,
  monitorId: string,
  now = Date.now(),
): Promise<void> {
  const rawDays = retentionDays(
    env.RAW_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS.raw,
  );
  const hourlyDays = retentionDays(
    env.HOURLY_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS.hourly,
  );
  const dailyDays = retentionDays(
    env.DAILY_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS.daily,
  );
  const incidentDays = retentionDays(
    env.INCIDENT_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS.incidents,
  );

  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM monitor_results WHERE monitor_id = ? AND checked_at < ?",
    ).bind(monitorId, now - rawDays * DAY_MS),
    env.DB.prepare(
      "DELETE FROM monitor_hourly_stats WHERE monitor_id = ? AND period_start < ?",
    ).bind(monitorId, now - hourlyDays * DAY_MS),
    env.DB.prepare(
      "DELETE FROM monitor_daily_stats WHERE monitor_id = ? AND period_start < ?",
    ).bind(monitorId, now - dailyDays * DAY_MS),
    env.DB.prepare(
      "DELETE FROM monitor_incidents " +
        "WHERE monitor_id = ? AND ended_at IS NOT NULL AND ended_at < ?",
    ).bind(monitorId, now - incidentDays * DAY_MS),
  ]);
}
