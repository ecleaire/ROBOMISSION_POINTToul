import { describe, expect, it } from "vitest";
import { createResilientStorage } from "./resilientStorage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("resilient storage", () => {
  it("uses normal browser storage when it is available", () => {
    const native = memoryStorage();
    const storage = createResilientStorage(() => native);
    storage.setItem("score", "42");
    expect(storage.getItem("score")).toBe("42");
    expect(storage.isPersistent()).toBe(true);
    storage.removeItem("score");
    expect(storage.getItem("score")).toBeNull();
  });

  it("keeps current-tab data when storage access is blocked", () => {
    const storage = createResilientStorage(() => { throw new DOMException("blocked", "SecurityError"); });
    storage.setItem("score", "55");
    expect(storage.getItem("score")).toBe("55");
    expect(storage.isPersistent()).toBe(false);
    storage.removeItem("score");
    expect(storage.getItem("score")).toBeNull();
  });

  it("falls back when a write exceeds the storage quota", () => {
    const native = memoryStorage();
    native.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    const storage = createResilientStorage(() => native);
    storage.setItem("draft", "preserved");
    expect(storage.getItem("draft")).toBe("preserved");
    expect(storage.isPersistent()).toBe(false);
  });
});
