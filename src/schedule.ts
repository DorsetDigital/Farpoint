export const FAILURE_RETRY_SECONDS = 10;

export function nextScheduledTime(
  intervalSeconds: number,
  offsetSeconds: number,
  nowMs = Date.now(),
): number {
  const intervalMs = intervalSeconds * 1000;
  const base = Math.floor(nowMs / intervalMs) * intervalMs;
  let candidate = base + offsetSeconds * 1000;

  if (candidate <= nowMs) {
    candidate += intervalMs;
  }

  return candidate;
}

export function nextCheckTime(
  intervalSeconds: number,
  offsetSeconds: number,
  checkOk: boolean,
  consecutiveFailures: number,
  failureConfirmationChecks: number,
  nowMs = Date.now(),
): number {
  if (
    !checkOk &&
    consecutiveFailures > 0 &&
    consecutiveFailures < failureConfirmationChecks
  ) {
    return nowMs + FAILURE_RETRY_SECONDS * 1000;
  }

  return nextScheduledTime(intervalSeconds, offsetSeconds, nowMs);
}

export function randomOffsetSeconds(): number {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return value % 60;
}
