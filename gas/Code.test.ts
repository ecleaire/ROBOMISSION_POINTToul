import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type GasContext = {
  normalizeKey_: (value: string) => string;
  publicAccountList_: () => Array<{ id: string; name: string; legacy: boolean; hasApiKey: boolean }>;
  saveAccount_: (data: { accountId?: string; name: string; newApiKey?: string }) => { id: string; name: string };
  canAccessVideo_: (key: string, targetAccount: string) => boolean;
  updateRecordMemo_: (sheet: unknown, rowNumber: number, recordedAt: string, notes: string, board?: string, photos?: unknown[], account?: string) => void;
  safeBoard_: (value: string) => string;
  scoreRowValues_: (data: Record<string, unknown>, recordedAt: Date, videoFileId: string) => unknown[];
  readMemoPhotos_: (value: string) => Array<{ id: string; board: string }>;
  saveMemoPhotos_: (account: string, requested: unknown[], existing: string) => Array<{ id: string; board: string }>;
  findFreeMemoRow_: (sheet: unknown, memoId: string) => number;
  parseHyogoNewsFeed_: (xml: string) => Array<{ source: string; title: string; url: string; updatedAt: string }>;
};

function loadGas() {
  const trashedFiles: string[] = [];
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
    Utilities: {
      getUuid: () => "12345678-1234-1234-1234-123456789abc",
      formatDate: (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "."),
    },
    DriveApp: {
      getFileById: (id: string) => ({ setTrashed: () => { trashedFiles.push(id); } }),
    },
  });
  vm.runInContext(readFileSync(new URL("./Code.gs", import.meta.url), "utf8"), context);
  return { gas: context as unknown as GasContext, values, trashedFiles };
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
    const saved: Record<number, string> = {};
    const recordedAt = "2026-07-15T01:02:03.000Z";
    const sheet = {
      getLastRow: () => 5,
      getRange: (_row: number, column: number) => column === 1
        ? { getValue: () => recordedAt }
        : column === 16
          ? { getValue: () => "[]", setValue: (value: string) => { saved[column] = value; } }
          : { setValue: (value: string) => { saved[column] = value; } },
    };
    const board = JSON.stringify({ version: 1, elements: [{ type: "circle" }] });
    gas.updateRecordMemo_(sheet, 3, recordedAt, "次はゆっくり走る", board, [], "A");
    expect(saved[11]).toBe("次はゆっくり走る");
    expect(saved[15]).toBe(board);
    expect(() => gas.updateRecordMemo_(sheet, 3, "2026-07-15T01:02:04.000Z", "誤った行", board, [], "A"))
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

  it("accepts compact court board JSON and rejects invalid data", () => {
    const { gas } = loadGas();
    const board = JSON.stringify({ version: 1, elements: [{ type: "triangle", color: "#ff0000", x: .1, y: .2 }] });
    expect(gas.safeBoard_(board)).toBe(board);
    expect(gas.safeBoard_("not-json")).toBe("");
  });

  it("keeps at most five private memo photo references", () => {
    const { gas } = loadGas();
    const photos = Array.from({ length: 7 }, (_, index) => ({ id: `photo-${index}`, board: "" }));
    expect(gas.readMemoPhotos_(JSON.stringify(photos))).toHaveLength(5);
  });

  it("does not delete existing photos when annotation metadata is too large", () => {
    const { gas, trashedFiles } = loadGas();
    const existing = JSON.stringify([{ id: "keep-photo", board: "" }, { id: "old-photo", board: "" }]);
    const oversizedBoard = JSON.stringify({ version: 1, elements: [{ type: "text", text: "x".repeat(44920) }] });
    expect(() => gas.saveMemoPhotos_("A", [{ id: "keep-photo", board: oversizedBoard }], existing))
      .toThrow("写真への書き込みが多すぎます");
    expect(trashedFiles).toEqual([]);
  });

  it("stores a scoring-screen court board in the record board column", () => {
    const { gas } = loadGas();
    const board = JSON.stringify({ version: 1, elements: [{ type: "circle", color: "#ff0000", x: .1, y: .2, x2: .3, y2: .4 }] });
    const values = gas.scoreRowValues_({
      timeSeconds: 120,
      visitors: 40,
      redTowers: 30,
      yellowTowers: 50,
      artifacts: 60,
      dirt: 20,
      bonus: 30,
      total: 230,
      unjudged: 0,
      notes: "採点メモ",
      board,
    }, new Date("2026-07-17T00:00:00Z"), "");
    expect(values).toHaveLength(16);
    expect(values[10]).toBe("採点メモ");
    expect(values[14]).toBe(board);
  });

  it("recalculates and bounds saved scores on the server", () => {
    const { gas } = loadGas();
    const values = gas.scoreRowValues_({
      visitors: 999,
      redTowers: -10,
      yellowTowers: 50,
      artifacts: 60,
      dirt: 20,
      bonus: 30,
      total: 999,
    }, new Date("2026-07-17T00:00:00Z"), "");
    expect(values.slice(2, 9)).toEqual([40, 0, 50, 60, 20, 30, 200]);
  });

  it("parses the latest Hyogo qualifier news from RSS", () => {
    const { gas } = loadGas();
    const items = gas.parseHyogoNewsFeed_(`
      <rss><channel><item><title><![CDATA[〖2026〗選手・コーチのみなさまへ]]></title>
      <link>https://wro-hyogo.jp/news-one/</link><pubDate>Wed, 15 Jul 2026 01:00:00 +0000</pubDate></item></channel></rss>
    `);
    expect(items).toEqual([{ source: "兵庫", title: "〖2026〗選手・コーチのみなさまへ", url: "https://wro-hyogo.jp/news-one/", updatedAt: "2026.07.15" }]);
  });
});
