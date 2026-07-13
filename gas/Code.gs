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
    if (data.action === "delete") {
      archiveRecord_(sheet, data.rowNumber, data.recordedAt);
      return json_({ ok: true });
    }
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
      safe_(data.notes),
      "",
      ""
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
    "汚れ", "ボーナス", "合計", "未判定数", "メモ", "削除", "削除日時"
  ]];
  const lastRow = sheet.getLastRow();
  if (lastRow > 0 && sheet.getLastColumn() >= 14) {
    const currentHeaders = sheet.getRange(1, 1, 1, 14).getValues()[0];
    if (currentHeaders[1] === "チーム名" || currentHeaders[12] === "採点詳細JSON") {
      const oldRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 14).getValues() : [];
      const migratedRows = oldRows.map(function(row) {
        return [row[0], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[13], "", ""];
      });
      sheet.clearContents();
      if (migratedRows.length) sheet.getRange(2, 1, migratedRows.length, headers[0].length).setValues(migratedRows);
    }
  }
  if (sheet.getMaxColumns() < headers[0].length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers[0].length - sheet.getMaxColumns());
  } else if (sheet.getMaxColumns() > headers[0].length) {
    sheet.deleteColumns(headers[0].length + 1, sheet.getMaxColumns() - headers[0].length);
  }
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  sheet.setFrozenRows(1);
  ensureDeleteControls_(sheet);
}

function readRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  return rows.map(function(row, index) {
    return {
      rowNumber: index + 2,
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
  }).filter(function(record, index) {
    return rows[index][11] !== true && String(rows[index][11] || "") !== "削除済み";
  }).reverse().slice(0, 100);
}

function archiveRecord_(sheet, rowNumberValue, recordedAt) {
  const rowNumber = Number(rowNumberValue);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error("削除する記録が見つかりません。");
  }
  const row = sheet.getRange(rowNumber, 1, 1, 13);
  const values = row.getValues()[0];
  const currentDate = values[0] instanceof Date ? values[0] : new Date(values[0]);
  const requestedDate = new Date(recordedAt);
  if (!Number.isFinite(currentDate.getTime()) || !Number.isFinite(requestedDate.getTime()) || currentDate.getTime() !== requestedDate.getTime()) {
    throw new Error("記録の位置が変わりました。記録を更新してから、もう一度削除してください。");
  }
  if (values[11] === true || String(values[11] || "") === "削除済み") return;
  sheet.getRange(rowNumber, 12, 1, 2).setValues([[true, new Date()]]);
}

function ensureDeleteControls_(sheet) {
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(2, 12, rowCount, 1).setDataValidation(checkboxRule);
  const formula = "=$L2=TRUE";
  const rules = sheet.getConditionalFormatRules().filter(function(rule) {
    const condition = rule.getBooleanCondition();
    return !condition || String(condition.getCriteriaValues()[0] || "") !== formula;
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground("#f4cccc")
    .setFontColor("#990000")
    .setRanges([sheet.getRange(2, 1, rowCount, 13)])
    .build());
  sheet.setConditionalFormatRules(rules);
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
