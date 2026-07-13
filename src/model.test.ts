import { describe, expect, it } from "vitest";
import { makeInitialState, totalScore, unjudgedCount } from "./model";

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
});
