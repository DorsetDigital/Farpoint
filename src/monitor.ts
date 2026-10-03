import { DurableObject } from "cloudflare:workers";
import { checkMonitor } from "./checker";
import {
  bucketStart,
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  HOUR_MS,
  pruneHistory,
  recordIncidentTransition,
  retentionDays,
  rollupCompletedDay,
  writeHourlyAggregate,
  type HourlyAggregate,
} from "./history";
import { nextCheckTime, nextScheduledTime } from "./schedule";
import { notifyStateChange } from "./slack";
import { transitionState } from "./state";
import type { Env, MonitorRow, MonitorState } from "./types";

const MONITOR_ID_KEY = "monitorId";
const RUNTIME_KEY = "runtime";
const D1_SNAPSHOT_INTERVAL_MS = 5 * 60_000;
const REPORTING_RETRY_INTERVAL_MS = 5 * 60_000;

interface PendingIncident {
  previousState: MonitorState;
  nextState: MonitorState;
  changedAt: number;
}

interface MonitorRuntime {
  monitor: MonitorRow;
  hourly: HourlyAggregate | null;
  pendingHourly: HourlyAggregate[];
  pendingIncidents: PendingIncident[];
  lastMaintenanceDay: number | null;
  lastD1SnapshotAt: number | null;
  nextReportingRetryAt: number | null;
  nextSnapshotRetryAt: number | null;
}

function emptyHourly(periodStart: number): HourlyAggregate {
  return {
    periodStart,
    checks: 0,
    upChecks: 0,
    degradedChecks: 0,
    downChecks: 0,
    responseTimeSumMs: 0,
    responseTimeMinMs: null,
    responseTimeMaxMs: null,
  };
}

function addHourlyResult(
  aggregate: HourlyAggregate,
  state: MonitorState,
  responseTimeMs: number,
): HourlyAggregate {
  return {
    ...aggregate,
    checks: aggregate.checks + 1,
    upChecks: aggregate.upChecks + (state === "UP" ? 1 : 0),
    degradedChecks:
      aggregate.degradedChecks + (state === "DEGRADED" ? 1 : 0),
    downChecks: aggregate.downChecks + (state === "DOWN" ? 1 : 0),
    responseTimeSumMs: aggregate.responseTimeSumMs + responseTimeMs,
    responseTimeMinMs:
      aggregate.responseTimeMinMs === null
        ? responseTimeMs
        : Math.min(aggregate.responseTimeMinMs, responseTimeMs),
    responseTimeMaxMs:
      aggregate.responseTimeMaxMs === null
        ? responseTimeMs
        : Math.max(aggregate.responseTimeMaxMs, responseTimeMs),
  };
}

function isCodeUpdateReset(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Durable Object reset because its code was updated")
  );
}

export class Monitor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS recent_results (
        checked_at INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER NOT NULL,
        error TEXT
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/configure") {
      const body = (await request.json()) as { monitorId?: string };

      if (!body.monitorId) {
        return new Response("monitorId is required", { status: 400 });
      }

      await this.ctx.storage.put(MONITOR_ID_KEY, body.monitorId);

      const runtime = await this.refreshRuntimeFromD1(body.monitorId);

      if (!runtime || runtime.monitor.enabled !== 1) {
        await this.ctx.storage.deleteAlarm();
        return Response.json({ scheduled: false });
      }

      await this.scheduleNext(runtime.monitor);
      return Response.json({ scheduled: true });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      await this.runCheck();
      return Response.json({ checked: true });
    }

    if (request.method === "DELETE" && url.pathname === "/schedule") {
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204 });
    }

    if (request.method === "DELETE" && url.pathname === "/purge") {
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && url.pathname === "/results") {
      const limit = Math.min(
        Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
        500,
      );

      const results = this.ctx.storage.sql
        .exec(
          `SELECT checked_at, state, ok, status_code, response_time_ms, error
           FROM recent_results
           ORDER BY checked_at DESC
           LIMIT ?`,
          limit,
        )
        .toArray();

      return Response.json({ results });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const runtime = await this.ctx.storage.get<MonitorRuntime>(RUNTIME_KEY);

      return Response.json({
        monitorId: await this.ctx.storage.get<string>(MONITOR_ID_KEY),
        alarm: await this.ctx.storage.getAlarm(),
        lastMaintenanceDay: runtime?.lastMaintenanceDay ?? null,
        lastD1SnapshotAt: runtime?.lastD1SnapshotAt ?? null,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    if (this.env.MONITORING_PAUSED === "true") {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.runCheck();
  }

  private async runCheck(): Promise<void> {
    const monitorId = await this.ctx.storage.get<string>(MONITOR_ID_KEY);

    if (!monitorId) {
      return;
    }

    try {
      const runtime = await this.loadRuntime(monitorId);

      if (!runtime || runtime.monitor.enabled !== 1) {
        await this.ctx.storage.deleteAlarm();
        return;
      }

      const monitor = runtime.monitor;
      const previousState = monitor.current_state;
      const result = await checkMonitor(monitor);
      const transition = transitionState(monitor, result);
      const checkedAt = Date.now();
      const currentHour = bucketStart(checkedAt, HOUR_MS);

      if (runtime.hourly && runtime.hourly.periodStart !== currentHour) {
        runtime.pendingHourly.push(runtime.hourly);
        runtime.hourly = null;
      }

      runtime.hourly = addHourlyResult(
        runtime.hourly ?? emptyHourly(currentHour),
        transition.state,
        result.responseTimeMs,
      );

      this.ctx.storage.sql.exec(
        `INSERT INTO recent_results
          (checked_at, state, ok, status_code, response_time_ms, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        checkedAt,
        transition.state,
        result.ok ? 1 : 0,
        result.statusCode,
        result.responseTimeMs,
        result.error,
      );

      monitor.current_state = transition.state;
      monitor.consecutive_failures = transition.counters.consecutiveFailures;
      monitor.consecutive_slow = transition.counters.consecutiveSlow;
      monitor.consecutive_healthy = transition.counters.consecutiveHealthy;
      monitor.consecutive_successes = transition.counters.consecutiveSuccesses;
      monitor.last_checked_at = checkedAt;
      monitor.last_response_time_ms = result.responseTimeMs;
      monitor.last_status_code = result.statusCode;
      monitor.last_error = result.error;

      const stateChanged = transition.state !== previousState;

      if (stateChanged) {
        runtime.pendingIncidents.push({
          previousState,
          nextState: transition.state,
          changedAt: checkedAt,
        });

        try {
          await notifyStateChange(
            this.env,
            monitor,
            previousState,
            transition.state,
            result,
          );
        } catch (error) {
          console.error("Slack notification failed", error);
        }
      }

      await this.flushStatusSnapshot(runtime, monitor, checkedAt, stateChanged);
      await this.flushReporting(runtime, monitor, checkedAt);
      runtime.monitor = monitor;
      await this.ctx.storage.put(RUNTIME_KEY, runtime);

      await this.ctx.storage.setAlarm(
        nextCheckTime(
          monitor.interval_seconds,
          monitor.offset_seconds,
          previousState,
          result.ok,
          transition.counters.consecutiveFailures,
          monitor.failure_confirmation_checks,
          transition.counters.consecutiveSuccesses,
          monitor.recovery_confirmation_checks,
          Date.now(),
        ),
      );
    } catch (error) {
      if (isCodeUpdateReset(error)) {
        throw error;
      }

      console.error("Monitor alarm failed", error);

      // Keep the monitor alive when D1 or another dependency has a transient issue.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private async loadRuntime(
    monitorId: string,
  ): Promise<MonitorRuntime | null> {
    const existing = await this.ctx.storage.get<MonitorRuntime>(RUNTIME_KEY);

    if (existing) {
      existing.pendingHourly ??= [];
      existing.pendingIncidents ??= [];
      existing.nextReportingRetryAt ??= null;
      existing.nextSnapshotRetryAt ??= null;
      return existing;
    }

    const monitor = await this.getMonitor(monitorId);

    if (!monitor) {
      return null;
    }

    const runtime: MonitorRuntime = {
      monitor,
      hourly: null,
      pendingHourly: [],
      pendingIncidents: [],
      lastMaintenanceDay: null,
      lastD1SnapshotAt: monitor.last_checked_at,
      nextReportingRetryAt: null,
      nextSnapshotRetryAt: null,
    };

    await this.ctx.storage.put(RUNTIME_KEY, runtime);
    return runtime;
  }

  private async refreshRuntimeFromD1(
    monitorId: string,
  ): Promise<MonitorRuntime | null> {
    const fresh = await this.getMonitor(monitorId);

    if (!fresh) {
      return null;
    }

    const existing = await this.ctx.storage.get<MonitorRuntime>(RUNTIME_KEY);

    if (existing) {
      existing.pendingHourly ??= [];
      existing.pendingIncidents ??= [];
      existing.nextReportingRetryAt ??= null;
      existing.nextSnapshotRetryAt ??= null;

      const live = existing.monitor;

      fresh.current_state = live.current_state;
      fresh.consecutive_failures = live.consecutive_failures;
      fresh.consecutive_slow = live.consecutive_slow;
      fresh.consecutive_healthy = live.consecutive_healthy;
      fresh.consecutive_successes = live.consecutive_successes;
      fresh.last_checked_at = live.last_checked_at;
      fresh.last_response_time_ms = live.last_response_time_ms;
      fresh.last_status_code = live.last_status_code;
      fresh.last_error = live.last_error;

      existing.monitor = fresh;
      await this.ctx.storage.put(RUNTIME_KEY, existing);
      return existing;
    }

    const runtime: MonitorRuntime = {
      monitor: fresh,
      hourly: null,
      pendingHourly: [],
      pendingIncidents: [],
      lastMaintenanceDay: null,
      lastD1SnapshotAt: fresh.last_checked_at,
      nextReportingRetryAt: null,
      nextSnapshotRetryAt: null,
    };

    await this.ctx.storage.put(RUNTIME_KEY, runtime);
    return runtime;
  }

  private async flushStatusSnapshot(
    runtime: MonitorRuntime,
    monitor: MonitorRow,
    now: number,
    stateChanged: boolean,
  ): Promise<void> {
    const snapshotDue =
      stateChanged ||
      runtime.lastD1SnapshotAt === null ||
      now - runtime.lastD1SnapshotAt >= D1_SNAPSHOT_INTERVAL_MS;

    if (!snapshotDue) {
      return;
    }

    if (
      !stateChanged &&
      runtime.nextSnapshotRetryAt !== null &&
      now < runtime.nextSnapshotRetryAt
    ) {
      return;
    }

    try {
      await this.writeD1Snapshot(monitor, now);
      runtime.lastD1SnapshotAt = now;
      runtime.nextSnapshotRetryAt = null;
    } catch (error) {
      if (isCodeUpdateReset(error)) {
        throw error;
      }

      console.error("Monitor status snapshot failed", error);
      runtime.nextSnapshotRetryAt = now + REPORTING_RETRY_INTERVAL_MS;
    }
  }

  private async flushReporting(
    runtime: MonitorRuntime,
    monitor: MonitorRow,
    now: number,
  ): Promise<void> {
    if (
      runtime.nextReportingRetryAt !== null &&
      now < runtime.nextReportingRetryAt
    ) {
      return;
    }

    try {
      while (runtime.pendingHourly.length) {
        await writeHourlyAggregate(
          this.env,
          monitor.id,
          runtime.pendingHourly[0],
        );
        runtime.pendingHourly.shift();
      }

      while (runtime.pendingIncidents.length) {
        const incident = runtime.pendingIncidents[0];

        await recordIncidentTransition(
          this.env,
          {
            id: monitor.id,
            current_state: incident.previousState,
          },
          incident.nextState,
          incident.changedAt,
        );

        runtime.pendingIncidents.shift();
      }

      await this.runDailyMaintenance(runtime, monitor.id, now);
      runtime.nextReportingRetryAt = null;
    } catch (error) {
      if (isCodeUpdateReset(error)) {
        throw error;
      }

      console.error("Monitor reporting sync failed", error);
      runtime.nextReportingRetryAt = now + REPORTING_RETRY_INTERVAL_MS;
    }
  }

  private async writeD1Snapshot(
    monitor: MonitorRow,
    checkedAt: number,
  ): Promise<void> {
    await this.env.DB.prepare(
      "UPDATE monitors SET " +
        "current_state = ?, consecutive_failures = ?, consecutive_slow = ?, " +
        "consecutive_healthy = ?, consecutive_successes = ?, last_checked_at = ?, " +
        "last_response_time_ms = ?, last_status_code = ?, last_error = ?, updated_at = ? " +
        "WHERE id = ?",
    ).bind(
      monitor.current_state,
      monitor.consecutive_failures,
      monitor.consecutive_slow,
      monitor.consecutive_healthy,
      monitor.consecutive_successes,
      monitor.last_checked_at,
      monitor.last_response_time_ms,
      monitor.last_status_code,
      monitor.last_error,
      checkedAt,
      monitor.id,
    ).run();
  }

  private async runDailyMaintenance(
    runtime: MonitorRuntime,
    monitorId: string,
    now: number,
  ): Promise<void> {
    const todayStart = bucketStart(now, DAY_MS);

    if (runtime.lastMaintenanceDay === todayStart) {
      return;
    }

    const yesterdayStart = todayStart - DAY_MS;
    await rollupCompletedDay(this.env, monitorId, yesterdayStart);
    await pruneHistory(this.env, monitorId, now);

    const rawDays = retentionDays(
      this.env.RAW_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS.raw,
    );

    this.ctx.storage.sql.exec(
      "DELETE FROM recent_results WHERE checked_at < ?",
      now - rawDays * DAY_MS,
    );

    runtime.lastMaintenanceDay = todayStart;
  }

  private async scheduleNext(monitor: MonitorRow): Promise<void> {
    await this.ctx.storage.setAlarm(
      nextScheduledTime(
        monitor.interval_seconds,
        monitor.offset_seconds,
        Date.now(),
      ),
    );
  }

  private async getMonitor(monitorId: string): Promise<MonitorRow | null> {
    return this.env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
      .bind(monitorId)
      .first<MonitorRow>();
  }
}
