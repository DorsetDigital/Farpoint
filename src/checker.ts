import type { CheckResult, MonitorRow } from "./types";

function parseStringList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function checkMonitor(
  monitor: Pick<
    MonitorRow,
    | "url"
    | "timeout_ms"
    | "expected_status"
    | "min_body_bytes"
    | "must_contain"
    | "must_not_contain"
  >,
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeout_ms);
  const startedAt = Date.now();

  try {
    const response = await fetch(monitor.url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Farpoint/0.1 (+https://github.com/DorsetDigital/Farpoint)",
      },
    });

    const body = await response.text();
    const responseTimeMs = Date.now() - startedAt;
    const bodyBytes = new TextEncoder().encode(body).byteLength;

    if (response.status !== monitor.expected_status) {
      return {
        ok: false,
        statusCode: response.status,
        responseTimeMs,
        error:
          "Expected HTTP " +
          monitor.expected_status +
          " but received " +
          response.status,
      };
    }

    if (bodyBytes < monitor.min_body_bytes) {
      return {
        ok: false,
        statusCode: response.status,
        responseTimeMs,
        error:
          "Response body was only " +
          bodyBytes +
          " bytes; minimum is " +
          monitor.min_body_bytes,
      };
    }

    for (const needle of parseStringList(monitor.must_contain)) {
      if (!body.includes(needle)) {
        return {
          ok: false,
          statusCode: response.status,
          responseTimeMs,
          error: 'Response body did not contain required text: "' + needle + '"',
        };
      }
    }

    for (const needle of parseStringList(monitor.must_not_contain)) {
      if (body.includes(needle)) {
        return {
          ok: false,
          statusCode: response.status,
          responseTimeMs,
          error: 'Response body contained forbidden text: "' + needle + '"',
        };
      }
    }

    return {
      ok: true,
      statusCode: response.status,
      responseTimeMs,
      error: null,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const message =
      error instanceof Error ? error.message : "Unknown monitoring error";

    return {
      ok: false,
      statusCode: null,
      responseTimeMs,
      error:
        error instanceof DOMException && error.name === "AbortError"
          ? "Request timed out after " + monitor.timeout_ms + "ms"
          : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
