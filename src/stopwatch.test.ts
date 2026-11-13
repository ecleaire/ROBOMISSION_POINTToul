import { describe, expect, it } from "vitest";
import { formatRecordingTime, formatStopwatch, millisecondsFromCompetitionSeconds, recordingProgressPercent, recordingRemainingMs, secondsFromStopwatch } from "./stopwatch";

describe("stopwatch", () => {
  it("formats minutes, seconds and hundredths", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(65_439)).toBe("01:05.43");
  });

  it("converts the finished stopwatch value to competition seconds", () => {
    expect(secondsFromStopwatch(125_678)).toBe(125.67);
    expect(millisecondsFromCompetitionSeconds(125.67)).toBe(125_670);
    expect(millisecondsFromCompetitionSeconds(null)).toBe(0);
  });

  it("formats the independent camera recording time", () => {
    expect(formatRecordingTime(0)).toBe("00:00");
    expect(formatRecordingTime(125_999)).toBe("02:05");
  });

  it("bounds camera remaining time and recording progress", () => {
    expect(recordingRemainingMs(30_000, 180_000)).toBe(150_000);
    expect(recordingRemainingMs(190_000, 180_000)).toBe(0);
    expect(recordingProgressPercent(90_000, 180_000)).toBe(50);
    expect(recordingProgressPercent(190_000, 180_000)).toBe(100);
  });
});
