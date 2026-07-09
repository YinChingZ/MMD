import { describe, expect, it } from "vitest";
import {
  dateGroupKey,
  formatCostUsd,
  formatDuration,
} from "../src/lib/format";

describe("dateGroupKey", () => {
  const now = new Date("2026-07-09T12:00:00");

  it("groups same-day as today", () => {
    expect(dateGroupKey("2026-07-09T01:00:00", now)).toBe("today");
  });

  it("groups previous day as yesterday", () => {
    expect(dateGroupKey("2026-07-08T23:59:00", now)).toBe("yesterday");
  });

  it("groups 2-6 days ago as week", () => {
    expect(dateGroupKey("2026-07-05T10:00:00", now)).toBe("week");
  });

  it("groups 7+ days ago as earlier", () => {
    expect(dateGroupKey("2026-07-01T10:00:00", now)).toBe("earlier");
  });
});

describe("formatCostUsd", () => {
  it("shows 3 decimals under $1", () => {
    expect(formatCostUsd(0.4321)).toBe("$0.432");
  });
  it("shows 2 decimals at $1+", () => {
    expect(formatCostUsd(2.5)).toBe("$2.50");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(42_000)).toBe("42 秒");
  });
  it("formats minutes with seconds", () => {
    expect(formatDuration(150_000)).toBe("2 分 30 秒");
  });
  it("formats whole minutes", () => {
    expect(formatDuration(120_000)).toBe("2 分钟");
  });
});
