import { describe, expect, it } from "vitest";
import { accountScopedStorageKey } from "./accountScopedStorage";

describe("account-scoped storage keys", () => {
  it("keeps guest data separate from account data", () => {
    expect(accountScopedStorageKey("score", null)).toBe("score-none");
    expect(accountScopedStorageKey("score", "team-a")).toBe("score-team-a");
  });

  it("treats account IDs case-insensitively", () => {
    expect(accountScopedStorageKey("score", " A0 ")).toBe(accountScopedStorageKey("score", "a0"));
    expect(accountScopedStorageKey("score", "RMAM")).toBe("score-rmam");
  });
});
