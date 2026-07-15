import { describe, expect, it } from "vitest";
import { isAppleTouchDevice } from "./device";

describe("isAppleTouchDevice", () => {
  it("detects an iPad user agent", () => {
    expect(isAppleTouchDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5)).toBe(true);
  });

  it("detects iPadOS when it requests the desktop site", () => {
    expect(isAppleTouchDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
  });

  it("does not treat a Mac without touch input as an iPad", () => {
    expect(isAppleTouchDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
  });

  it("does not treat Android as an Apple touch device", () => {
    expect(isAppleTouchDevice("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5)).toBe(false);
  });
});
