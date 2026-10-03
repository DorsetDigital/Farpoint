import { describe, expect, it } from "vitest";
import {
  calculateAvailability,
  clampInt,
  dashboardState,
  overlapMs,
} from "../src/dashboard";

const DAY = 86_400_000;

describe("dashboard helpers", () => {
  it("clamps integer query values", () => {
    expect(clampInt("25", 20, 1, 100)).toBe(25);
    expect(clampInt("500", 20, 1, 100)).toBe(100);
    expect(clampInt("nope", 20, 1, 100)).toBe(20);
  });

  it("normalises valid states and rejects invalid states", () => {
    expect(dashboardState("down")).toBe("DOWN");
    expect(dashboardState("DEGRADED")).toBe("DEGRADED");
    expect(dashboardState("broken")).toBeNull();
  });

  it("calculates interval overlap", () => {
    expect(overlapMs(100, 200, 150, 250)).toBe(50);
    expect(overlapMs(100, 120, 150, 250)).toBe(0);
  });

  it("calculates uptime from downtime duration rather than check counts", () => {
    const now = 10 * DAY;
    const result = calculateAvailability(
      0,
      [
        {
          monitor_id: "one",
          state: "DOWN",
          started_at: now - 12 * 60 * 60 * 1000,
          ended_at: now - 6 * 60 * 60 * 1000,
        },
      ],
      1,
      now,
    );

    expect(result.observed_ms).toBe(DAY);
    expect(result.down_ms).toBe(6 * 60 * 60 * 1000);
    expect(result.uptime_percent).toBe(75);
  });

  it("limits the denominator to the monitor lifetime", () => {
    const now = 10 * DAY;
    const created = now - DAY;
    const result = calculateAvailability(created, [], 30, now);

    expect(result.observed_ms).toBe(DAY);
    expect(result.uptime_percent).toBe(100);
  });

  it("includes open incidents through the current time", () => {
    const now = 10 * DAY;
    const result = calculateAvailability(
      now - DAY,
      [
        {
          monitor_id: "one",
          state: "DOWN",
          started_at: now - 60 * 60 * 1000,
          ended_at: null,
        },
      ],
      1,
      now,
    );

    expect(result.down_ms).toBe(60 * 60 * 1000);
  });

  it("tracks degraded time separately without treating it as downtime", () => {
    const now = 10 * DAY;
    const result = calculateAvailability(
      now - DAY,
      [
        {
          monitor_id: "one",
          state: "DEGRADED",
          started_at: now - 6 * 60 * 60 * 1000,
          ended_at: now,
        },
      ],
      1,
      now,
    );

    expect(result.uptime_percent).toBe(100);
    expect(result.degraded_percent).toBe(25);
  });
});
