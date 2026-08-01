import { describe, expect, it } from "vitest";
import { isValidAccountId } from "./accountKey";

describe("account id validation", () => {
  it("accepts junior legacy, shared, and admin account ids without forcing uppercase", () => {
    ["A", "B", "C", "a", "b", "c", "a0", "rmam", "ADMIN", "システム動作確認", "テスト"].forEach((value) => {
      expect(isValidAccountId(value), value).toBe(true);
    });
  });

  it("rejects empty, unsafe, or too long ids", () => {
    ["", "a b", "a/b", "a?b", "x".repeat(65)].forEach((value) => {
      expect(isValidAccountId(value), value).toBe(false);
    });
  });
});
