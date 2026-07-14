import { describe, expect, it } from "vitest";
import { isComplete, makeInitialState, sanitizeScoreState, totalScore, unjudgedCount } from "./model";

describe("score calculation", () => {
  it("calculates the official maximum as 230", () => {
    const state = makeInitialState();
    state.visitors.fill(10);
    state.redTowers.fill(15);
    state.yellowTowers.fill(25);
    state.artifacts.forEach((item) => (item.score = 15));
    state.dirt.fill(2);
    state.bonus.fill(10);
    expect(totalScore(state)).toBe(230);
    expect(unjudgedCount(state)).toBe(0);
  });

  it("treats every unchecked condition as zero", () => {
    const state = makeInitialState();
    expect(totalScore(state)).toBe(0);
    expect(unjudgedCount(state)).toBe(0);
    expect(state.visitors).toEqual([0, 0, 0, 0]);
    expect(state.dirt).toEqual(Array(10).fill(0));
  });

  it("calculates a mixture of partial scores", () => {
    const state = makeInitialState();
    state.visitors = [10, 5, 0, 10];
    state.redTowers = [15, 10];
    state.yellowTowers = [25, 15];
    state.artifacts.forEach((item, index) => (item.score = [15, 5, 0, 15][index]));
    state.dirt = [2, 2, 0, 2, 0, 2, 2, 0, 2, 2];
    state.bonus = [10, 0, 10];
    expect(totalScore(state)).toBe(159);
  });

  it("requires a color only when an artifact has points", () => {
    const state = makeInitialState();
    expect(isComplete(state)).toBe(true);
    state.artifacts[0].score = 15;
    expect(isComplete(state)).toBe(false);
    state.artifacts[0].color = "blue";
    expect(isComplete(state)).toBe(true);
  });

  it("repairs corrupted local data without allowing an invalid score", () => {
    const state = sanitizeScoreState({
      timeSeconds: -20,
      notes: 123,
      visitors: [999, 10],
      redTowers: [15, "10"],
      yellowTowers: null,
      artifacts: [{ color: "purple", score: 99 }, { color: "blue", score: 15 }],
      dirt: [2, 4],
      bonus: [10, 20],
    });
    expect(state.timeSeconds).toBeNull();
    expect(state.visitors).toEqual([0, 10, 0, 0]);
    expect(state.redTowers).toEqual([15, 0]);
    expect(state.artifacts[0]).toEqual({ color: "unused", score: 0 });
    expect(state.artifacts[1]).toEqual({ color: "blue", score: 15 });
    expect(state.dirt).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(state.bonus).toEqual([10, 0, 0]);
    expect(totalScore(state)).toBeLessThanOrEqual(230);
  });
});

