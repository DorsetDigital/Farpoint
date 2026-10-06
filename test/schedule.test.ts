import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_RETRY_SECONDS,
  nextCheckTime,
  nextScheduledTime,
} from "../src/schedule";

describe("nextScheduledTime", () => {
  it("keeps a stable seconds offset inside the interval", () => {
    const now = Date.UTC(2026, 9, 1, 12, 1, 10);
    const next = nextScheduledTime(300, 22, now);

    expect(new Date(next).toISOString()).toBe("2026-10-01T12:05:22.000Z");
  });

  it("moves to the next interval when the offset has already passed", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextScheduledTime(300, 22, now);

    expect(new Date(next).toISOString()).toBe("2026-10-01T12:10:22.000Z");
  });
});

describe("nextCheckTime", () => {
  it("retries quickly while a failure is awaiting confirmation", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextCheckTime(300, 22, "UP", false, 1, 2, 0, 2, now);

    expect(next).toBe(now + CONFIRMATION_RETRY_SECONDS * 1000);
  });

  it("returns to the normal schedule once failure is confirmed", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextCheckTime(300, 22, "UP", false, 2, 2, 0, 2, now);

    expect(new Date(next).toISOString()).toBe("2026-10-01T12:10:22.000Z");
  });

  it("retries quickly while a down monitor is awaiting recovery confirmation", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextCheckTime(300, 22, "DOWN", true, 0, 2, 1, 2, now);

    expect(next).toBe(now + CONFIRMATION_RETRY_SECONDS * 1000);
  });

  it("returns to the normal schedule once recovery is confirmed", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextCheckTime(300, 22, "DOWN", true, 0, 2, 2, 2, now);

    expect(new Date(next).toISOString()).toBe("2026-10-01T12:10:22.000Z");
  });

  it("uses the normal schedule for healthy checks when not recovering", () => {
    const now = Date.UTC(2026, 9, 1, 12, 5, 41);
    const next = nextCheckTime(300, 22, "UP", true, 0, 2, 1, 2, now);

    expect(new Date(next).toISOString()).toBe("2026-10-01T12:10:22.000Z");
  });
});
