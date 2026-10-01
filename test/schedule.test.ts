import { describe, expect, it } from "vitest";
import { nextScheduledTime } from "../src/schedule";

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
