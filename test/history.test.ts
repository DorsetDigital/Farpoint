import { describe, expect, it } from "vitest";
import {
  bucketStart,
  DEFAULT_RETENTION_DAYS,
  retentionDays,
} from "../src/history";

describe("history helpers", () => {
  it("uses explicit positive retention values", () => {
    expect(retentionDays("90", 30)).toBe(90);
  });

  it("falls back for missing invalid or non-positive values", () => {
    expect(retentionDays(undefined, 30)).toBe(30);
    expect(retentionDays("nope", 30)).toBe(30);
    expect(retentionDays("0", 30)).toBe(30);
    expect(retentionDays("-10", 30)).toBe(30);
  });

  it("defaults long-lived data to five years", () => {
    expect(DEFAULT_RETENTION_DAYS.daily).toBe(1825);
    expect(DEFAULT_RETENTION_DAYS.incidents).toBe(1825);
  });

  it("aligns timestamps to bucket boundaries", () => {
    const timestamp = Date.UTC(2026, 9, 2, 10, 37, 12);

    expect(new Date(bucketStart(timestamp, 3_600_000)).toISOString())
      .toBe("2026-10-02T10:00:00.000Z");
  });
});
