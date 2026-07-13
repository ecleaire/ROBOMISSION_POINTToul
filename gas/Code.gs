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
      numberOrBlank_(data.timeSeconds),
      number_(data.visitors),
      number_(data.redTowers),
      number_(data.yellowTowers),
      number_(data.artifacts),
      number_(data.dirt),
      number_(data.bonus),
      number_(data.total),
      number_(data.unjudged),
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
    "記録日時", "競技時間（秒）", "訪問者", "赤い塔", "黄色い塔", "遺物",
    "汚れ", "ボーナス", "合計", "未判定数", "メモ"
  ]];
  const lastRow = sheet.getLastRow();
  if (lastRow > 0 && sheet.getLastColumn() >= 14) {
    const currentHeaders = sheet.getRange(1, 1, 1, 14).getValues()[0];
    if (currentHeaders[1] === "チーム名" || currentHeaders[12] === "採点詳細JSON") {
      const oldRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 14).getValues() : [];
      const migratedRows = oldRows.map(function(row) {
        return [row[0], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[13]];
      });
      sheet.clearContents();
      if (migratedRows.length) sheet.getRange(2, 1, migratedRows.length, headers[0].length).setValues(migratedRows);
    }
  }
  if (sheet.getMaxColumns() > headers[0].length) {
    sheet.deleteColumns(headers[0].length + 1, sheet.getMaxColumns() - headers[0].length);
  }
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  sheet.setFrozenRows(1);
}

function readRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  return rows.reverse().slice(0, 100).map(function(row) {
    return {
      recordedAt: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ""),
      timeSeconds: row[1] === "" ? null : number_(row[1]),
      visitors: number_(row[2]),
      redTowers: number_(row[3]),
      yellowTowers: number_(row[4]),
      artifacts: number_(row[5]),
      dirt: number_(row[6]),
      bonus: number_(row[7]),
      total: number_(row[8]),
      unjudged: number_(row[9]),
      notes: String(row[10] || "")
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
