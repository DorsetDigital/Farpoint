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

  const emoji =
    nextState === "DOWN" ? "🔴" : nextState === "DEGRADED" ? "🟠" : "🟢";
  const title =
    nextState === "DOWN"
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
