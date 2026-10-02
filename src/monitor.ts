import { DurableObject } from "cloudflare:workers";
import { checkMonitor } from "./checker";
import {
  bucketStart,
  DAY_MS,
  pruneHistory,
  recordHourlyAggregate,
  recordIncidentTransition,
  rollupCompletedDay,
} from "./history";
import { nextCheckTime, nextScheduledTime } from "./schedule";
import { notifyStateChange } from "./slack";
import { transitionState } from "./state";
import type { Env, MonitorRow } from "./types";

const MONITOR_ID_KEY = "monitorId";
const LAST_MAINTENANCE_DAY_KEY = "lastMaintenanceDay";

export class Monitor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/configure") {
      const body = (await request.json()) as { monitorId?: string };

      if (!body.monitorId) {
        return new Response("monitorId is required", { status: 400 });
      }

      await this.ctx.storage.put(MONITOR_ID_KEY, body.monitorId);
      await this.scheduleNext(body.monitorId);
      return Response.json({ scheduled: true });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      await this.runCheck();
      return Response.json({ checked: true });
    }

    if (request.method === "DELETE" && url.pathname === "/schedule") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete(MONITOR_ID_KEY);
      await this.ctx.storage.delete(LAST_MAINTENANCE_DAY_KEY);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({
        monitorId: await this.ctx.storage.get<string>(MONITOR_ID_KEY),
        alarm: await this.ctx.storage.getAlarm(),
        lastMaintenanceDay:
          await this.ctx.storage.get<number>(LAST_MAINTENANCE_DAY_KEY),
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.runCheck();
  }

  private async runCheck(): Promise<void> {
    const monitorId = await this.ctx.storage.get<string>(MONITOR_ID_KEY);

    if (!monitorId) {
      return;
    }

    try {
      const monitor = await this.getMonitor(monitorId);

      if (!monitor || monitor.enabled !== 1) {
        await this.ctx.storage.deleteAlarm();
        return;
      }

      const result = await checkMonitor(monitor);
      const transition = transitionState(monitor, result);
      const checkedAt = Date.now();

      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO monitor_results " +
            "(monitor_id, checked_at, state, ok, status_code, response_time_ms, error) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          monitor.id,
          checkedAt,
          transition.state,
          result.ok ? 1 : 0,
          result.statusCode,
          result.responseTimeMs,
          result.error,
        ),
        this.env.DB.prepare(
          "UPDATE monitors SET " +
            "current_state = ?, consecutive_failures = ?, consecutive_slow = ?, " +
            "consecutive_healthy = ?, consecutive_successes = ?, last_checked_at = ?, " +
            "last_response_time_ms = ?, last_status_code = ?, last_error = ?, updated_at = ? " +
            "WHERE id = ?",
        ).bind(
          transition.state,
          transition.counters.consecutiveFailures,
          transition.counters.consecutiveSlow,
          transition.counters.consecutiveHealthy,
          transition.counters.consecutiveSuccesses,
          checkedAt,
          result.responseTimeMs,
          result.statusCode,
          result.error,
          checkedAt,
          monitor.id,
        ),
      ]);

      await recordHourlyAggregate(
        this.env,
        monitor.id,
        checkedAt,
        transition.state,
        result.responseTimeMs,
      );

      const stateChanged = transition.state !== monitor.current_state;

      if (stateChanged) {
        await recordIncidentTransition(
          this.env,
          monitor,
          transition.state,
          checkedAt,
        );

        const refreshed = {
          ...monitor,
          current_state: transition.state,
        } as MonitorRow;

        try {
          await notifyStateChange(
            this.env,
            refreshed,
            monitor.current_state,
            transition.state,
            result,
          );
        } catch (error) {
          console.error("Slack notification failed", error);
        }
      }

      await this.runDailyMaintenance(monitor.id, checkedAt);

      await this.ctx.storage.setAlarm(
        nextCheckTime(
          monitor.interval_seconds,
          monitor.offset_seconds,
          result.ok,
          transition.counters.consecutiveFailures,
          monitor.failure_confirmation_checks,
          Date.now(),
        ),
      );
    } catch (error) {
      console.error("Monitor alarm failed", error);

      // Keep the monitor alive even when D1 or another dependency has a transient issue.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private async runDailyMaintenance(
    monitorId: string,
    now: number,
  ): Promise<void> {
    const todayStart = bucketStart(now, DAY_MS);
    const lastMaintenanceDay =
      await this.ctx.storage.get<number>(LAST_MAINTENANCE_DAY_KEY);

    if (lastMaintenanceDay === todayStart) {
      return;
    }

    const yesterdayStart = todayStart - DAY_MS;
    await rollupCompletedDay(this.env, monitorId, yesterdayStart);
    await pruneHistory(this.env, monitorId, now);
    await this.ctx.storage.put(LAST_MAINTENANCE_DAY_KEY, todayStart);
  }

  private async scheduleNext(monitorId: string): Promise<void> {
    const monitor = await this.getMonitor(monitorId);

    if (!monitor || monitor.enabled !== 1) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

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
