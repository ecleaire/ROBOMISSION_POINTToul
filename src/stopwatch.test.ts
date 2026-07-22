import { describe, expect, it } from "vitest";
import { formatRecordingTime, formatStopwatch, secondsFromStopwatch } from "./stopwatch";

describe("stopwatch", () => {
  it("formats minutes, seconds and hundredths", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(65_439)).toBe("01:05.43");
  });

  it("converts the finished stopwatch value to competition seconds", () => {
    expect(secondsFromStopwatch(125_678)).toBe(125.67);
  });

  it("formats the independent camera recording time", () => {
    expect(formatRecordingTime(0)).toBe("00:00");
    expect(formatRecordingTime(125_999)).toBe("02:05");
  });
});
