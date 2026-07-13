/**
 * WRO 2026 RoboMission Junior 練習記録用GAS
 * このコードを指定のApps Scriptプロジェクトへ貼り付け、ウェブアプリとしてデプロイします。
 */
const SPREADSHEET_ID = "1uwp_LefMKwa6xwp4j7pS7OkW7aw04QUXb9r7WB5eBUc";
const SHEET_NAME = "練習記録";

function doGet() {
  return json_({ ok: true, message: "RoboMission Junior score endpoint is ready." });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse(event.postData.contents);
    const sheet = getSheet_();
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
      JSON.stringify(data.details || {})
    ]);
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  const headers = [[
    "記録日時", "チーム名", "ラウンド", "競技時間（秒）", "訪問者", "赤い塔",
    "黄色い塔", "遺物", "汚れ", "ボーナス", "合計", "未判定数", "採点詳細JSON"
  ]];
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  sheet.setFrozenRows(1);
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
