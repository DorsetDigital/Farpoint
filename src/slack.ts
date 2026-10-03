import type { CheckResult, Env, MonitorRow, MonitorState } from "./types";

function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function notifyStateChange(
  env: Env,
  monitor: MonitorRow,
  previousState: MonitorState,
  nextState: MonitorState,
  result: CheckResult,
): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) {
    return;
  }

  const firstOnline = previousState === "UNKNOWN" && nextState === "UP";
  const emoji = firstOnline
    ? "👀"
    : nextState === "DOWN"
      ? "🔴"
      : nextState === "DEGRADED"
        ? "🟠"
        : "🟢";
  const title = firstOnline
    ? "Q-bot is watching"
    : nextState === "DOWN"
      ? "Website unavailable"
      : nextState === "DEGRADED"
        ? "Website performance degraded"
        : "Website recovered";

  const details: string[] = [
    "*URL:* " + escapeSlack(monitor.url),
    "*State:* " + previousState + " → " + nextState,
    "*Response time:* " + result.responseTimeMs + "ms",
  ];

  if (result.statusCode !== null) {
    details.push("*HTTP:* " + result.statusCode);
  }

  if (nextState === "DEGRADED") {
    details.push(
      "*Threshold:* " + monitor.degraded_threshold_ms + "ms",
    );
  }

  if (result.error) {
    details.push("*Reason:* " + escapeSlack(result.error));
  }

  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          emoji +
          " *" +
          title +
          " — " +
          escapeSlack(monitor.name) +
          "*\n" +
          details.join("\n"),
      },
    },
  ];

  if (env.CONTROL_PANEL_BASE_URL) {
    const base = env.CONTROL_PANEL_BASE_URL.replace(/\/$/, "");
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View monitoring" },
          url: base + "/monitoring/" + encodeURIComponent(monitor.id),
        },
      ],
    });
  }

  const response = await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: emoji + " " + title + " — " + monitor.name,
      blocks,
    }),
  });

  if (!response.ok) {
    throw new Error(
      "Slack webhook returned HTTP " + response.status,
    );
  }
}


export async function notifyMonitoringServiceState(
  env: Env,
  paused: boolean,
  total: number,
  succeeded: number,
  failed: number,
): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) {
    return;
  }

  const emoji = paused ? "⏸️" : "👀";
  const title = paused
    ? "Farpoint service has been paused"
    : "Farpoint service has resumed";
  const message = paused
    ? "Q is no longer watching!"
    : "Q is watching again!";

  const details = [
    "*Monitors:* " + succeeded + "/" + total,
  ];

  if (failed > 0) {
    details.push("*Failed:* " + failed);
  }

  const text =
    emoji + " *" + title + "*\n" +
    message + "\n" +
    details.join("\n");

  const response = await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: title + " — " + message,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      "Slack webhook returned HTTP " + response.status,
    );
  }
}
