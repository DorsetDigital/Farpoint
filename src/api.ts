import {
  calculateAvailability,
  clampInt,
  dashboardState,
  DASHBOARD_WINDOWS,
  type DashboardIncident,
} from "./dashboard";
import { randomOffsetSeconds } from "./schedule";
import { notifyMonitoringServiceState } from "./slack";
import type { Env, MonitorInput, MonitorRow } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const DAY_MS = 86_400_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function isAuthorised(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization");
  return Boolean(env.API_KEY && header === "Bearer " + env.API_KEY);
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function intInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function queryDays(url: URL, fallback = 365): number {
  const value = Number.parseInt(url.searchParams.get("days") ?? "", 10);
  return Number.isInteger(value) && value > 0
    ? Math.min(value, 3650)
    : fallback;
}

async function configureMonitor(env: Env, monitorId: string): Promise<void> {
  const id = env.MONITORS.idFromName(monitorId);
  const stub = env.MONITORS.get(id);

  const response = await stub.fetch("https://farpoint.internal/configure", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ monitorId }),
  });

  if (!response.ok) {
    throw new Error("Unable to configure monitor scheduler");
  }
}

async function stopMonitor(env: Env, monitorId: string): Promise<void> {
  const id = env.MONITORS.idFromName(monitorId);
  const stub = env.MONITORS.get(id);
  await stub.fetch("https://farpoint.internal/schedule", { method: "DELETE" });
}

async function purgeMonitor(env: Env, monitorId: string): Promise<void> {
  const id = env.MONITORS.idFromName(monitorId);
  const stub = env.MONITORS.get(id);
  await stub.fetch("https://farpoint.internal/purge", { method: "DELETE" });
}

async function setMonitoringPaused(
  env: Env,
  paused: boolean,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const result = await env.DB.prepare(
    "SELECT id FROM monitors WHERE enabled = 1 ORDER BY id",
  ).all<{ id: string }>();

  let succeeded = 0;
  let failed = 0;
  const batchSize = 20;

  for (let index = 0; index < result.results.length; index += batchSize) {
    const batch = result.results.slice(index, index + batchSize);

    const outcomes = await Promise.allSettled(
      batch.map(async ({ id }) => {
        if (paused) {
          await stopMonitor(env, id);
        } else {
          await configureMonitor(env, id);
        }
      }),
    );

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    total: result.results.length,
    succeeded,
    failed,
  };
}

async function getMonitorResults(
  env: Env,
  monitorId: string,
  limit: number,
): Promise<unknown> {
  const id = env.MONITORS.idFromName(monitorId);
  const stub = env.MONITORS.get(id);
  const response = await stub.fetch(
    "https://farpoint.internal/results?limit=" + limit,
  );

  if (!response.ok) {
    throw new Error("Unable to read monitor results");
  }

  return response.json();
}

function normaliseInput(
  input: MonitorInput,
  existing?: MonitorRow,
): Omit<MonitorRow, "created_at" | "updated_at"> {
  const url = parseUrl(input.url ?? existing?.url);

  if (!url) {
    throw new Error("A valid http(s) url is required");
  }

  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : existing?.name;

  if (!name) {
    throw new Error("name is required");
  }

  const mustContain = input.must_contain ?? (
    existing?.must_contain ? JSON.parse(existing.must_contain) : []
  );
  const mustNotContain = input.must_not_contain ?? (
    existing?.must_not_contain ? JSON.parse(existing.must_not_contain) : []
  );

  if (
    !Array.isArray(mustContain) ||
    !mustContain.every((item) => typeof item === "string") ||
    !Array.isArray(mustNotContain) ||
    !mustNotContain.every((item) => typeof item === "string")
  ) {
    throw new Error("must_contain and must_not_contain must be string arrays");
  }

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    url,
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled ? 1 : 0
        : existing?.enabled ?? 1,
    interval_seconds: intInRange(
      input.interval_seconds,
      existing?.interval_seconds ?? 300,
      60,
      86_400,
    ),
    offset_seconds: existing?.offset_seconds ?? randomOffsetSeconds(),
    timeout_ms: intInRange(
      input.timeout_ms,
      existing?.timeout_ms ?? 15_000,
      1_000,
      60_000,
    ),
    expected_status: intInRange(
      input.expected_status,
      existing?.expected_status ?? 200,
      100,
      599,
    ),
    min_body_bytes: intInRange(
      input.min_body_bytes,
      existing?.min_body_bytes ?? 256,
      0,
      10_000_000,
    ),
    must_contain: mustContain.length ? JSON.stringify(mustContain) : null,
    must_not_contain: mustNotContain.length ? JSON.stringify(mustNotContain) : null,
    degraded_enabled:
      typeof input.degraded?.enabled === "boolean"
        ? input.degraded.enabled ? 1 : 0
        : existing?.degraded_enabled ?? 0,
    degraded_threshold_ms: intInRange(
      input.degraded?.threshold_ms,
      existing?.degraded_threshold_ms ?? 3000,
      100,
      60_000,
    ),
    degraded_confirmation_checks: intInRange(
      input.degraded?.confirmation_checks,
      existing?.degraded_confirmation_checks ?? 2,
      1,
      10,
    ),
    failure_confirmation_checks: intInRange(
      input.failure_confirmation_checks,
      existing?.failure_confirmation_checks ?? 2,
      1,
      10,
    ),
    recovery_confirmation_checks: intInRange(
      input.recovery_confirmation_checks,
      existing?.recovery_confirmation_checks ?? 2,
      1,
      10,
    ),
    current_state: existing?.current_state ?? "UNKNOWN",
    consecutive_failures: existing?.consecutive_failures ?? 0,
    consecutive_slow: existing?.consecutive_slow ?? 0,
    consecutive_healthy: existing?.consecutive_healthy ?? 0,
    consecutive_successes: existing?.consecutive_successes ?? 0,
    last_checked_at: existing?.last_checked_at ?? null,
    last_response_time_ms: existing?.last_response_time_ms ?? null,
    last_status_code: existing?.last_status_code ?? null,
    last_error: existing?.last_error ?? null,
  };
}

async function getMonitor(env: Env, id: string): Promise<MonitorRow | null> {
  return env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
    .bind(id)
    .first<MonitorRow>();
}

async function getDashboard(env: Env, url: URL): Promise<Response> {
  const page = clampInt(url.searchParams.get("page"), 1, 1, 1_000_000);
  const perPage = clampInt(url.searchParams.get("per_page"), 25, 1, 100);
  const offset = (page - 1) * perPage;
  const search = (url.searchParams.get("search") ?? "").trim();
  const requestedState = url.searchParams.get("state");
  const state = dashboardState(requestedState);
  const enabled = url.searchParams.get("enabled") ?? "true";
  const direction =
    (url.searchParams.get("direction") ?? "asc").toLowerCase() === "desc"
      ? "DESC"
      : "ASC";

  if (requestedState && !state) {
    return json(
      { error: "state must be UNKNOWN, UP, DEGRADED or DOWN" },
      400,
    );
  }

  if (!["true", "false", "all"].includes(enabled)) {
    return json({ error: "enabled must be true, false or all" }, 400);
  }

  const sortColumns: Record<string, string> = {
    name: "name COLLATE NOCASE",
    state:
      "CASE current_state " +
      "WHEN 'DOWN' THEN 0 WHEN 'DEGRADED' THEN 1 " +
      "WHEN 'UNKNOWN' THEN 2 ELSE 3 END",
    response_time: "COALESCE(last_response_time_ms, -1)",
    last_checked: "COALESCE(last_checked_at, 0)",
  };
  const sort =
    sortColumns[url.searchParams.get("sort") ?? "name"] ?? sortColumns.name;

  const where: string[] = [];
  const bindings: unknown[] = [];

  if (enabled !== "all") {
    where.push("enabled = ?");
    bindings.push(enabled === "true" ? 1 : 0);
  }

  if (state) {
    where.push("current_state = ?");
    bindings.push(state);
  }

  if (search) {
    where.push("(name LIKE ? OR url LIKE ?)");
    const term = "%" + search + "%";
    bindings.push(term, term);
  }

  const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

  const summaryWhere =
    enabled === "all" ? "" : " WHERE enabled = ?";
  const summaryBindings =
    enabled === "all" ? [] : [enabled === "true" ? 1 : 0];

  const [pageResult, countResult, summaryResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
        id, name, url, enabled, current_state, interval_seconds,
        degraded_enabled, degraded_threshold_ms,
        last_checked_at, last_response_time_ms, last_status_code, last_error,
        created_at
      FROM monitors
      ${whereSql}
      ORDER BY ${sort} ${direction}, name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`,
    ).bind(...bindings, perPage, offset).all<MonitorRow>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM monitors" + whereSql,
    ).bind(...bindings).first<{ total: number }>(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN current_state = 'UP' THEN 1 ELSE 0 END) AS up,
        SUM(CASE WHEN current_state = 'DEGRADED' THEN 1 ELSE 0 END) AS degraded,
        SUM(CASE WHEN current_state = 'DOWN' THEN 1 ELSE 0 END) AS down,
        SUM(CASE WHEN current_state = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown
      FROM monitors` + summaryWhere,
    ).bind(...summaryBindings).first<{
      total: number;
      up: number | null;
      degraded: number | null;
      down: number | null;
      unknown: number | null;
    }>(),
  ]);

  const monitors = pageResult.results;
  const now = Date.now();
  const maxWindowDays = Math.max(...Object.values(DASHBOARD_WINDOWS));
  const cutoff = now - maxWindowDays * DAY_MS;
  const incidents: DashboardIncident[] = [];
  const incidentBatchSize = 50;

  for (let index = 0; index < monitors.length; index += incidentBatchSize) {
    const batch = monitors.slice(index, index + incidentBatchSize);
    const placeholders = batch.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT monitor_id, state, started_at, ended_at
      FROM monitor_incidents
      WHERE monitor_id IN (${placeholders})
        AND started_at <= ?
        AND (ended_at IS NULL OR ended_at >= ?)
      ORDER BY started_at ASC`,
    ).bind(...batch.map((monitor) => monitor.id), now, cutoff)
      .all<DashboardIncident>();

    incidents.push(...result.results);
  }

  const incidentsByMonitor = new Map<string, DashboardIncident[]>();

  for (const incident of incidents) {
    const monitorIncidents = incidentsByMonitor.get(incident.monitor_id) ?? [];
    monitorIncidents.push(incident);
    incidentsByMonitor.set(incident.monitor_id, monitorIncidents);
  }

  const dashboardMonitors = monitors.map((monitor) => {
    const monitorIncidents = incidentsByMonitor.get(monitor.id) ?? [];
    const availability = Object.fromEntries(
      Object.entries(DASHBOARD_WINDOWS).map(([label, days]) => [
        label,
        calculateAvailability(monitor.created_at, monitorIncidents, days, now),
      ]),
    );

    return {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      enabled: monitor.enabled === 1,
      state: monitor.current_state,
      interval_seconds: monitor.interval_seconds,
      degraded_enabled: monitor.degraded_enabled === 1,
      degraded_threshold_ms: monitor.degraded_threshold_ms,
      last_checked_at: monitor.last_checked_at,
      response_time_ms: monitor.last_response_time_ms,
      status_code: monitor.last_status_code,
      error: monitor.last_error,
      availability,
    };
  });

  const total = countResult?.total ?? 0;

  return json({
    monitors: dashboardMonitors,
    pagination: {
      page,
      per_page: perPage,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / perPage),
    },
    summary: {
      total: summaryResult?.total ?? 0,
      up: summaryResult?.up ?? 0,
      degraded: summaryResult?.degraded ?? 0,
      down: summaryResult?.down ?? 0,
      unknown: summaryResult?.unknown ?? 0,
    },
    generated_at: now,
  });
}

export async function handleApi(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isAuthorised(request, env)) {
    return json({ error: "Unauthorised" }, 401);
  }

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[3];
  const resource = parts[4];

  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[2] === "dashboard"
  ) {
    return getDashboard(env, url);
  }

  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[2] === "monitoring" &&
    parts[3] === "pause"
  ) {
    const result = await setMonitoringPaused(env, true);

    try {
      await notifyMonitoringServiceState(
        env,
        true,
        result.total,
        result.succeeded,
        result.failed,
      );
    } catch (error) {
      console.error("Slack service-state notification failed", error);
    }

    return json({
      monitoring: "paused",
      ...result,
    }, result.failed === 0 ? 200 : 207);
  }

  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[2] === "monitoring" &&
    parts[3] === "resume"
  ) {
    if (env.MONITORING_PAUSED === "true") {
      return json({
        error:
          "Monitoring is paused by MONITORING_PAUSED configuration and cannot be resumed through the API",
      }, 409);
    }

    const result = await setMonitoringPaused(env, false);

    try {
      await notifyMonitoringServiceState(
        env,
        false,
        result.total,
        result.succeeded,
        result.failed,
      );
    } catch (error) {
      console.error("Slack service-state notification failed", error);
    }

    return json({
      monitoring: "running",
      ...result,
    }, result.failed === 0 ? 200 : 207);
  }

  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[2] === "monitors"
  ) {
    const result = await env.DB.prepare(
      "SELECT * FROM monitors ORDER BY name ASC",
    ).all<MonitorRow>();

    return json({ monitors: result.results });
  }

  if (
    request.method === "POST" &&
    parts.length === 3 &&
    parts[2] === "monitors"
  ) {
    try {
      const input = (await request.json()) as MonitorInput;
      const monitor = normaliseInput(input);
      const now = Date.now();

      await env.DB.prepare(
        "INSERT INTO monitors (" +
          "id, name, url, enabled, interval_seconds, offset_seconds, timeout_ms, " +
          "expected_status, min_body_bytes, must_contain, must_not_contain, " +
          "degraded_enabled, degraded_threshold_ms, degraded_confirmation_checks, " +
          "failure_confirmation_checks, recovery_confirmation_checks, current_state, " +
          "consecutive_failures, consecutive_slow, consecutive_healthy, consecutive_successes, " +
          "created_at, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        monitor.id,
        monitor.name,
        monitor.url,
        monitor.enabled,
        monitor.interval_seconds,
        monitor.offset_seconds,
        monitor.timeout_ms,
        monitor.expected_status,
        monitor.min_body_bytes,
        monitor.must_contain,
        monitor.must_not_contain,
        monitor.degraded_enabled,
        monitor.degraded_threshold_ms,
        monitor.degraded_confirmation_checks,
        monitor.failure_confirmation_checks,
        monitor.recovery_confirmation_checks,
        monitor.current_state,
        monitor.consecutive_failures,
        monitor.consecutive_slow,
        monitor.consecutive_healthy,
        monitor.consecutive_successes,
        now,
        now,
      ).run();

      await configureMonitor(env, monitor.id);
      return json(await getMonitor(env, monitor.id), 201);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  }

  if (!id) {
    return json({ error: "Not found" }, 404);
  }

  if (request.method === "GET" && resource === "results") {
    const limit = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
      500,
    );

    try {
      return json(await getMonitorResults(env, id, limit));
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to read monitor results",
        },
        502,
      );
    }
  }

  if (request.method === "GET" && resource === "stats") {
    const resolution = url.searchParams.get("resolution") ?? "daily";

    if (resolution !== "hourly" && resolution !== "daily") {
      return json({ error: "resolution must be hourly or daily" }, 400);
    }

    const days = queryDays(url);
    const cutoff = Date.now() - days * DAY_MS;
    const table =
      resolution === "hourly"
        ? "monitor_hourly_stats"
        : "monitor_daily_stats";

    const result = await env.DB.prepare(
      `SELECT
        period_start,
        checks,
        up_checks,
        degraded_checks,
        down_checks,
        CASE
          WHEN checks > 0 THEN response_time_sum_ms * 1.0 / checks
          ELSE NULL
        END AS response_time_avg_ms,
        response_time_min_ms,
        response_time_max_ms
      FROM ${table}
      WHERE monitor_id = ? AND period_start >= ?
      ORDER BY period_start ASC`,
    ).bind(id, cutoff).all();

    return json({ resolution, days, stats: result.results });
  }

  if (request.method === "GET" && resource === "incidents") {
    const days = queryDays(url);
    const cutoff = Date.now() - days * DAY_MS;

    const result = await env.DB.prepare(
      "SELECT * FROM monitor_incidents " +
        "WHERE monitor_id = ? AND (ended_at IS NULL OR ended_at >= ?) " +
        "ORDER BY started_at DESC",
    ).bind(id, cutoff).all();

    return json({ days, incidents: result.results });
  }

  if (request.method === "GET" && parts.length === 4) {
    const monitor = await getMonitor(env, id);
    return monitor ? json(monitor) : json({ error: "Not found" }, 404);
  }

  if (request.method === "PATCH" && parts.length === 4) {
    const existing = await getMonitor(env, id);

    if (!existing) {
      return json({ error: "Not found" }, 404);
    }

    try {
      const input = (await request.json()) as MonitorInput;
      const monitor = normaliseInput(input, existing);
      const now = Date.now();

      await env.DB.prepare(
        "UPDATE monitors SET " +
          "name = ?, url = ?, enabled = ?, interval_seconds = ?, timeout_ms = ?, " +
          "expected_status = ?, min_body_bytes = ?, must_contain = ?, must_not_contain = ?, " +
          "degraded_enabled = ?, degraded_threshold_ms = ?, degraded_confirmation_checks = ?, " +
          "failure_confirmation_checks = ?, recovery_confirmation_checks = ?, updated_at = ? " +
          "WHERE id = ?",
      ).bind(
        monitor.name,
        monitor.url,
        monitor.enabled,
        monitor.interval_seconds,
        monitor.timeout_ms,
        monitor.expected_status,
        monitor.min_body_bytes,
        monitor.must_contain,
        monitor.must_not_contain,
        monitor.degraded_enabled,
        monitor.degraded_threshold_ms,
        monitor.degraded_confirmation_checks,
        monitor.failure_confirmation_checks,
        monitor.recovery_confirmation_checks,
        now,
        id,
      ).run();

      if (monitor.enabled === 1) {
        await configureMonitor(env, id);
      } else {
        await stopMonitor(env, id);
      }

      return json(await getMonitor(env, id));
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  }

  if (request.method === "DELETE" && parts.length === 4) {
    const existing = await getMonitor(env, id);

    if (!existing) {
      return new Response(null, { status: 204 });
    }

    await purgeMonitor(env, id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM monitor_results WHERE monitor_id = ?").bind(id),
      env.DB.prepare("DELETE FROM monitor_hourly_stats WHERE monitor_id = ?").bind(id),
      env.DB.prepare("DELETE FROM monitor_daily_stats WHERE monitor_id = ?").bind(id),
      env.DB.prepare("DELETE FROM monitor_incidents WHERE monitor_id = ?").bind(id),
      env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id),
    ]);

    return new Response(null, { status: 204 });
  }

  return json({ error: "Not found" }, 404);
}
