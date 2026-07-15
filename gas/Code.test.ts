import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type GasContext = {
  normalizeKey_: (value: string) => string;
  publicAccountList_: () => Array<{ id: string; name: string; legacy: boolean; hasApiKey: boolean }>;
  saveAccount_: (data: { accountId?: string; name: string; newApiKey?: string }) => { id: string; name: string };
  canAccessVideo_: (key: string, targetAccount: string) => boolean;
  updateRecordMemo_: (sheet: unknown, rowNumber: number, recordedAt: string, notes: string) => void;
  findFreeMemoRow_: (sheet: unknown, memoId: string) => number;
};

function loadGas() {
  const values: Record<string, string> = {
    API_KEY_A: "alpha-key",
    API_KEY_B: "bravo-key",
    API_KEY_C: "charlie-key",
    ACCOUNT_NAME_A: "Team Alpha",
    MASTER_PASS_MAIN: "SecretAdmin",
  };
  const propertyStore = {
    getProperty: (name: string) => values[name] ?? null,
    setProperty: (name: string, value: string) => { values[name] = value; },
    getProperties: () => ({ ...values }),
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => propertyStore },
    Utilities: { getUuid: () => "12345678-1234-1234-1234-123456789abc" },
  });
  vm.runInContext(readFileSync(new URL("./Code.gs", import.meta.url), "utf8"), context);
  return { gas: context as unknown as GasContext, values };
}

describe("GAS account management", () => {
  it("treats account API keys and administrator passwords as case-insensitive", () => {
    const { gas } = loadGas();
    expect(gas.normalizeKey_("alpha-key")).toBe("A");
    expect(gas.normalizeKey_("ALPHA-KEY")).toBe("A");
    expect(gas.normalizeKey_("secretadmin")).toBe("ADMIN");
    expect(gas.normalizeKey_("SECRETADMIN")).toBe("ADMIN");
  });

  it("changes a legacy team name without exposing its API key", () => {
    const { gas, values } = loadGas();
    gas.saveAccount_({ accountId: "A", name: "Renamed Team" });
    expect(values.ACCOUNT_NAME_A).toBe("Renamed Team");
    expect(gas.publicAccountList_()).toContainEqual({ id: "A", name: "Renamed Team", legacy: true, hasApiKey: true });
    expect(JSON.stringify(gas.publicAccountList_())).not.toContain("alpha-key");
  });

  it("adds a dynamic account with an opaque id", () => {
    const { gas, values } = loadGas();
    const created = gas.saveAccount_({ name: "Private Team", newApiKey: "private-key" });
    expect(created.id).toBe("ACC_1234567812");
    expect(values.ACCOUNT_CONFIG_JSON).toContain("Private Team");
    expect(gas.normalizeKey_("private-key")).toBe(created.id);
    expect(gas.normalizeKey_("PRIVATE-KEY")).toBe(created.id);
  });

  it("rejects API keys that only differ by letter case", () => {
    const { gas } = loadGas();
    expect(() => gas.saveAccount_({ name: "Duplicate Team", newApiKey: "ALPHA-KEY" })).toThrow("このAPIキーは既に使用されています。");
  });

  it("allows a one-character API key", () => {
    const { gas } = loadGas();
    const created = gas.saveAccount_({ name: "Short Key Team", newApiKey: "x" });
    expect(gas.normalizeKey_("X")).toBe(created.id);
  });

  it("allows videos only for their account and administrators", () => {
    const { gas } = loadGas();
    expect(gas.canAccessVideo_("A", "A")).toBe(true);
    expect(gas.canAccessVideo_("A", "B")).toBe(false);
    expect(gas.canAccessVideo_("ADMIN", "A")).toBe(true);
  });

  it("updates the memo only when the saved row still matches the record date", () => {
    const { gas } = loadGas();
    let saved = "";
    const recordedAt = "2026-07-15T01:02:03.000Z";
    const sheet = {
      getLastRow: () => 5,
      getRange: (_row: number, column: number) => column === 1
        ? { getValue: () => recordedAt }
        : { setValue: (value: string) => { saved = value; } },
    };
    gas.updateRecordMemo_(sheet, 3, recordedAt, "次はゆっくり走る");
    expect(saved).toBe("次はゆっくり走る");
    expect(() => gas.updateRecordMemo_(sheet, 3, "2026-07-15T01:02:04.000Z", "誤った行"))
      .toThrow("記録の位置が変わりました");
  });

  it("finds an account-scoped free memo by its opaque id", () => {
    const { gas } = loadGas();
    const sheet = {
      getLastRow: () => 4,
      getRange: () => ({ getValues: () => [["memo-a"], ["memo-b"], ["memo-c"]] }),
    };
    expect(gas.findFreeMemoRow_(sheet, "memo-b")).toBe(3);
    expect(() => gas.findFreeMemoRow_(sheet, "missing")).toThrow("メモが見つかりません");
  });
});
