/**
 * WRO 2026 RoboMission Junior 練習記録用GAS
 * このコードを指定のApps Scriptプロジェクトへ貼り付け、ウェブアプリとしてデプロイします。
 */
const SPREADSHEET_ID = "1uwp_LefMKwa6xwp4j7pS7OkW7aw04QUXb9r7WB5eBUc";
const ACCOUNT_SHEETS = Object.freeze({
  A: "練習記録_A",
  B: "練習記録_B",
  C: "練習記録_C"
});

function doGet(event) {
  const key = normalizeKey_(event && event.parameter && event.parameter.key);
  if (!key) {
    return json_({ ok: true, message: "RoboMission Junior score endpoint is ready." });
  }
  try {
    const sheet = getSheet_(key);
    ensureHeader_(sheet);
    return json_({ ok: true, account: key, records: readRecords_(sheet) });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse(event.postData.contents);
    const key = normalizeKey_(data.apiKey);
    if (!key) throw new Error("APIキーが無効です。");
    const sheet = getSheet_(key);
    ensureHeader_(sheet);
    sheet.appendRow([
      new Date(),
      safe_(data.teamName),
      safe_(data.round),
      numberOrBlank_(data.timeSeconds),
      number_(data.visitors),
      number_(data.redTowers),
      number_(data.yellowTowers),
      number_(data.artifacts),
      number_(data.dirt),
      number_(data.bonus),
      number_(data.total),
      number_(data.unjudged),
      JSON.stringify(data.details || {}),
      safe_(data.notes)
    ]);
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_(key) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = ACCOUNT_SHEETS[key];
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function ensureHeader_(sheet) {
  const headers = [[
    "記録日時", "チーム名", "ラウンド", "競技時間（秒）", "訪問者", "赤い塔",
    "黄色い塔", "遺物", "汚れ", "ボーナス", "合計", "未判定数", "採点詳細JSON", "メモ"
  ]];
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  sheet.setFrozenRows(1);
}

function readRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  return rows.reverse().slice(0, 100).map(function(row) {
    return {
      recordedAt: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ""),
      teamName: String(row[1] || ""),
      round: String(row[2] || ""),
      timeSeconds: row[3] === "" ? null : number_(row[3]),
      visitors: number_(row[4]),
      redTowers: number_(row[5]),
      yellowTowers: number_(row[6]),
      artifacts: number_(row[7]),
      dirt: number_(row[8]),
      bonus: number_(row[9]),
      total: number_(row[10]),
      unjudged: number_(row[11]),
      notes: String(row[13] || "")
    };
  });
}

function normalizeKey_(value) {
  const key = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ACCOUNT_SHEETS, key) ? key : "";
}

function safe_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function number_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrBlank_(value) {
  return value == null || value === "" ? "" : number_(value);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
