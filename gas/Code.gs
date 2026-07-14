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
const API_KEY_PROPERTIES = Object.freeze({
  A: "API_KEY_A",
  B: "API_KEY_B",
  C: "API_KEY_C"
});

function doGet(event) {
  const suppliedKey = event && event.parameter && event.parameter.key;
  if (!suppliedKey) {
    return json_({ ok: true, message: "RoboMission Junior score endpoint is ready." });
  }
  const key = normalizeKey_(suppliedKey);
  if (!key) return json_({ ok: false, message: "APIキーが無効です。" });
  try {
    return json_({ ok: true, account: key, records: getRecordsForAccount_(key) });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  }
}

function doPost(event) {
  try {
    const data = JSON.parse(event.postData.contents);
    const key = normalizeKey_(data.apiKey);
    if (!key) throw new Error("APIキーが無効です。");
    if (data.action === "auth") return json_({ ok: true, account: key });
    if (data.action === "records") return json_({ ok: true, account: key, records: getRecordsForAccount_(key) });
    if (key === "ADMIN" && data.action !== "delete") {
      throw new Error("管理アカウントから採点結果は保存できません。");
    }
    const targetAccount = key === "ADMIN" ? String(data.account || "").toUpperCase() : key;
    if (!Object.prototype.hasOwnProperty.call(ACCOUNT_SHEETS, targetAccount)) {
      throw new Error("対象アカウントが無効です。");
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet_(targetAccount);
      ensureHeader_(sheet);
      if (data.action === "delete") {
        archiveRecord_(sheet, data.rowNumber, data.recordedAt);
        return json_({ ok: true });
      }
      const requestId = String(data.requestId || "").slice(0, 100);
      const cache = CacheService.getScriptCache();
      const requestCacheKey = requestId ? "score-" + targetAccount + "-" + requestId : "";
      if (requestCacheKey && cache.get(requestCacheKey)) return json_({ ok: true, duplicate: true });
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
      ensureDeleteControls_(sheet);
      if (requestCacheKey) cache.put(requestCacheKey, "1", 21600);
      return json_({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  }
}

function getRecordsForAccount_(key) {
  if (key === "ADMIN") {
    const records = Object.keys(ACCOUNT_SHEETS).reduce(function(allRecords, account) {
      const accountSheet = getSheet_(account);
      ensureHeader_(accountSheet);
      return allRecords.concat(readRecords_(accountSheet, account));
    }, []);
    return records.sort(function(left, right) {
      return new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime();
    });
  }
  const sheet = getSheet_(key);
  ensureHeader_(sheet);
  return readRecords_(sheet, key);
}

function getSheet_(key) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = ACCOUNT_SHEETS[key];
  if (!sheetName) throw new Error("対象シートが設定されていません。");
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
  }
  const headerRange = sheet.getRange(1, 1, 1, headers[0].length);
  const currentHeader = sheet.getLastRow() ? headerRange.getValues()[0] : [];
  if (headers[0].some(function(value, index) { return currentHeader[index] !== value; })) {
    headerRange.setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  }
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  ensureDeleteControls_(sheet);
}

function readRecords_(sheet, account) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  return rows.map(function(row, index) {
    return {
      account: account,
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
    return rows[index][0] !== "" && rows[index][0] != null &&
      rows[index][11] !== true && String(rows[index][11] || "") !== "削除済み";
  }).reverse();
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
  const rowCount = Math.max(sheet.getLastRow() - 1, 1);
  const validationRange = sheet.getRange(2, 12, rowCount, 1);
  if (!sheet.getRange(Math.max(sheet.getLastRow(), 2), 12).getDataValidation()) {
    const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    validationRange.setDataValidation(checkboxRule);
  }
  const formula = "=$L2=TRUE";
  const rules = sheet.getConditionalFormatRules();
  const hasDeleteRule = rules.some(function(rule) {
    const condition = rule.getBooleanCondition();
    return condition && String(condition.getCriteriaValues()[0] || "") === formula;
  });
  if (!hasDeleteRule) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground("#f4cccc")
      .setFontColor("#990000")
      .setRanges([sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 13)])
      .build());
    sheet.setConditionalFormatRules(rules);
  }
}

function normalizeKey_(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey) return "";
  const properties = PropertiesService.getScriptProperties();
  const accounts = Object.keys(API_KEY_PROPERTIES);
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const configuredKey = String(properties.getProperty(API_KEY_PROPERTIES[account]) || "").trim();
    if (configuredKey && apiKey === configuredKey) return account;
  }
  const allProperties = properties.getProperties();
  const masterPropertyNames = Object.keys(allProperties).filter(function(name) {
    return name.indexOf("MASTER_PASS") === 0;
  });
  for (let index = 0; index < masterPropertyNames.length; index += 1) {
    const configuredPassword = String(allProperties[masterPropertyNames[index]] || "");
    if (configuredPassword && apiKey === configuredPassword) return "ADMIN";
  }
  return "";
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

