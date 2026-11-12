import { describe, expect, it } from "vitest";
import { hasScoreActivity } from "./scoreActivity";

describe("score activity detection", () => {
  it("treats an untouched score sheet as empty", () => {
    expect(hasScoreActivity({ scores: [0, 0], timeSeconds: null, text: "" })).toBe(false);
  });

  it("detects scores, time, notes, and extra attachments", () => {
    expect(hasScoreActivity({ scores: [0, 5], timeSeconds: null, text: "" })).toBe(true);
    expect(hasScoreActivity({ scores: [0, 0], timeSeconds: 0, text: "" })).toBe(true);
    expect(hasScoreActivity({ scores: [0, 0], timeSeconds: null, text: " メモ " })).toBe(true);
    expect(hasScoreActivity({ scores: [0, 0], timeSeconds: null, text: "", hasExtra: true })).toBe(true);
  });
});
