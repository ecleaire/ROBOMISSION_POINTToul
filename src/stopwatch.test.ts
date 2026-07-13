import { describe, expect, it } from "vitest";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";

describe("stopwatch", () => {
  it("formats minutes, seconds and hundredths", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(65_439)).toBe("01:05.43");
  });

  it("converts the finished stopwatch value to competition seconds", () => {
    expect(secondsFromStopwatch(125_678)).toBe(125.67);
  });
});
