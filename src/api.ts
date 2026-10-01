import { randomOffsetSeconds } from "./schedule";
import type { Env, MonitorInput, MonitorRow } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

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
  const isResults = parts[4] === "results";

  if (request.method === "GET" && parts.length === 3) {
    const result = await env.DB.prepare(
      "SELECT * FROM monitors ORDER BY name ASC",
    ).all<MonitorRow>();

    return json({ monitors: result.results });
  }

  if (request.method === "POST" && parts.length === 3) {
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

  if (request.method === "GET" && isResults) {
    const limit = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
      500,
    );

    const result = await env.DB.prepare(
      "SELECT * FROM monitor_results WHERE monitor_id = ? " +
        "ORDER BY checked_at DESC LIMIT ?",
    ).bind(id, limit).all();

    return json({ results: result.results });
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

    await stopMonitor(env, id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM monitor_results WHERE monitor_id = ?").bind(id),
      env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id),
    ]);

    return new Response(null, { status: 204 });
  }

  return json({ error: "Not found" }, 404);
}
