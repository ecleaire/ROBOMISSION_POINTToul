import { describe, expect, it } from "vitest";
import { analyzeRecords, trendPolyline, type AnalyticsRecord } from "./recordAnalytics";

const record = (date: string, total: number, visitors = 0): AnalyticsRecord => ({
  recordedAt: date, total, visitors, redTowers: 0, yellowTowers: 0, artifacts: 0, dirt: 0, bonus: 0,
});

describe("record analytics", () => {
  it("sorts records and calculates change and averages", () => {
    const result = analyzeRecords([record("2026-01-02", 120, 20), record("2026-01-01", 100, 10)]);
    expect(result.average).toBe(110);
    expect(result.best).toBe(120);
    expect(result.change).toBe(20);
    expect(result.missions[0].average).toBe(15);
    expect(result.missions[0].successRate).toBe(37.5);
    expect(result.missions[0].max).toBe(40);
  });

  it("calculates bounded mission success rates from average score", () => {
    const result = analyzeRecords([record("2026-01-01", 230, 50)]);
    expect(result.missions[0].successRate).toBe(100);
    expect(result.missions[1].successRate).toBe(0);
  });

  it("limits the trend to the latest twelve records", () => {
    const result = analyzeRecords(Array.from({ length: 20 }, (_, i) => record(`2026-01-${String(i + 1).padStart(2, "0")}`, i)));
    expect(result.trend).toHaveLength(12);
    expect(result.trend[0].total).toBe(8);
  });

  it("marks the first record as having no previous comparison", () => {
    const result = analyzeRecords([record("2026-01-01", 80, 10)]);
    expect(result.previous).toBeNull();
    expect(result.change).toBeNull();
    expect(result.missions[0].latest).toBe(10);
  });

  it("creates bounded chart points", () => {
    expect(trendPolyline([0, 230], 100, 100)).toBe("0.0,100.0 100.0,0.0");
  });
});
