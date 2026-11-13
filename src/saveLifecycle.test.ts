import { describe, expect, it } from "vitest";
import { isCurrentSaveContext } from "./saveLifecycle";

describe("save lifecycle", () => {
  it.each([
    ["team-a", "key-a", "team-a", "key-a", true],
    ["team-a", "key-a", "team-b", "key-a", false],
    ["team-a", "key-a", "team-a", "key-b", false],
    ["team-a", "key-a", null, null, false],
    ["", "key-a", "", "key-a", false],
    ["team-a", "", "team-a", "", false],
  ])("detects whether an asynchronous save still owns the active account", (expectedAccount, expectedKey, currentAccount, currentKey, expected) => {
    expect(isCurrentSaveContext(expectedAccount, expectedKey, currentAccount, currentKey)).toBe(expected);
  });
});
