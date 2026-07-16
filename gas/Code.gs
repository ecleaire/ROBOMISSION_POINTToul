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
const ACCOUNT_NAME_PROPERTIES = Object.freeze({
  A: "ACCOUNT_NAME_A",
  B: "ACCOUNT_NAME_B",
  C: "ACCOUNT_NAME_C"
});
const DYNAMIC_ACCOUNTS_PROPERTY = "ACCOUNT_CONFIG_JSON";
const VIDEO_FOLDER_PROPERTY = "VIDEO_FOLDER_ID";
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const HYOGO_NEWS_FEED_URL = "https://wro-hyogo.jp/feed/";
const HYOGO_NEWS_CACHE_KEY = "hyogo-news-v1";
const HYOGO_NEWS_FALLBACK = Object.freeze([
  { source: "兵庫", title: "〖2026〗選手・コーチのみなさまへ", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E9%81%B8%E6%89%8B%E3%83%BB%E3%82%B3%E3%83%BC%E3%83%81%E3%81%AE%E3%81%BF%E3%81%AA%E3%81%95%E3%81%BE%E3%81%B8/", updatedAt: "2026.07.15" },
  { source: "兵庫", title: "〖2026〗大会当日の注意事項について", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E5%A4%A7%E4%BC%9A%E5%BD%93%E6%97%A5%E3%81%AE%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/", updatedAt: "2026.07.08" },
  { source: "兵庫", title: "〖2026〗ルール補足とローカルルールについて", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E3%83%AB%E3%83%BC%E3%83%AB%E8%A3%9C%E8%B6%B3%E3%81%A8%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%AB%E3%83%BC%E3%83%AB%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/", updatedAt: "2026.06.27" }
]);

function doGet() {
  return json_({ ok: true, message: "RoboMission Junior score endpoint is ready. Use POST for authenticated actions." });
}

function doPost(event) {
  try {
    const data = JSON.parse(event.postData.contents);
    if (data.action === "news") return json_({ ok: true, news: getHyogoNews_() });
    const key = normalizeKey_(data.apiKey);
    if (!key) throw new Error("APIキーが無効です。");
    if (data.action === "auth") return json_({ ok: true, account: key, accountName: accountName_(key) });
    if (data.action === "records") return json_({ ok: true, account: key, records: getRecordsForAccount_(key) });
    if (data.action === "freeMemos") return json_({ ok: true, account: key, memos: getFreeMemosForAccount_(key) });
    if (data.action === "video") return json_(getRecordVideo_(key, data));
    if (key === "ADMIN" && data.action === "accounts") {
      return json_({ ok: true, accounts: publicAccountList_() });
    }
    if (key === "ADMIN" && data.action === "saveAccount") {
      const accountLock = LockService.getScriptLock();
      accountLock.waitLock(10000);
      try {
        return json_({ ok: true, account: saveAccount_(data), accounts: publicAccountList_() });
      } finally {
        accountLock.releaseLock();
      }
    }
    const targetAccount = key === "ADMIN" ? String(data.account || "").toUpperCase() : key;
    if (!accountById_(targetAccount)) {
      throw new Error("対象アカウントが無効です。");
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (data.action === "saveFreeMemo") {
        const savedMemo = saveFreeMemo_(getMemoSheet_(targetAccount), data);
        return json_({ ok: true, memo: savedMemo });
      }
      if (data.action === "deleteFreeMemo") {
        deleteFreeMemo_(getMemoSheet_(targetAccount), data.memoId);
        return json_({ ok: true });
      }
      const sheet = getSheet_(targetAccount);
      ensureHeader_(sheet);
      if (data.action === "delete") {
        archiveRecord_(sheet, data.rowNumber, data.recordedAt);
        return json_({ ok: true });
      }
      if (data.action === "saveMemo") {
        updateRecordMemo_(sheet, data.rowNumber, data.recordedAt, data.notes, data.board);
        return json_({ ok: true });
      }
      if (data.action === "attachVideo") {
        return json_(attachVideoToRecord_(sheet, targetAccount, data));
      }
      const requestId = String(data.requestId || "").slice(0, 100);
      const cache = CacheService.getScriptCache();
      const requestCacheKey = requestId ? "score-" + targetAccount + "-" + requestId : "";
      const cachedResult = requestCacheKey ? cache.get(requestCacheKey) : "";
      if (cachedResult) {
        try { return json_(Object.assign({ ok: true, duplicate: true }, JSON.parse(cachedResult))); }
        catch (cacheError) { return json_({ ok: true, duplicate: true }); }
      }
      let videoFile = null;
      try {
        videoFile = data.video ? saveVideo_(targetAccount, data.video) : null;
        const recordedAt = new Date();
        const rowNumber = sheet.getLastRow() + 1;
        sheet.getRange(rowNumber, 1, 1, 15).setValues([
          scoreRowValues_(data, recordedAt, videoFile ? videoFile.getId() : "")
        ]);
        const savedRecord = { rowNumber: rowNumber, recordedAt: recordedAt.toISOString() };
        ensureDeleteControlForRow_(sheet, rowNumber);
        if (requestCacheKey) cache.put(requestCacheKey, JSON.stringify(savedRecord), 21600);
        return json_(Object.assign({ ok: true }, savedRecord));
      } catch (error) {
        if (videoFile) {
          try { videoFile.setTrashed(true); } catch (cleanupError) { /* 保存失敗時の後片付け */ }
        }
        throw error;
      }
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) });
  }
}

function scoreRowValues_(data, recordedAt, videoFileId) {
  return [
    recordedAt,
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
    "",
    videoFileId || "",
    safeBoard_(data.board)
  ];
}

function attachVideoToRecord_(sheet, targetAccount, data) {
  const rowNumber = Number(data.rowNumber);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error("動画を追加する記録が見つかりません。");
  }
  const row = sheet.getRange(rowNumber, 1, 1, 14);
  const values = row.getValues()[0];
  const currentDate = values[0] instanceof Date ? values[0] : new Date(values[0]);
  const requestedDate = new Date(data.recordedAt);
  if (!Number.isFinite(currentDate.getTime()) || !Number.isFinite(requestedDate.getTime()) || currentDate.getTime() !== requestedDate.getTime()) {
    throw new Error("記録の位置が変わりました。動画を追加できません。");
  }
  if (values[13]) return { ok: true, duplicate: true };
  let videoFile = null;
  try {
    videoFile = saveVideo_(targetAccount, data.video);
    sheet.getRange(rowNumber, 14).setValue(videoFile.getId());
    return { ok: true };
  } catch (error) {
    if (videoFile) {
      try { videoFile.setTrashed(true); } catch (cleanupError) { /* 保存失敗時の後片付け */ }
    }
    throw error;
  }
}

function getRecordsForAccount_(key) {
  if (key === "ADMIN") {
    const records = accountConfigs_().reduce(function(allRecords, account) {
      const accountSheet = getSheet_(account.id);
      ensureHeader_(accountSheet);
      return allRecords.concat(readRecords_(accountSheet, account.id, account.name));
    }, []);
    return records.sort(function(left, right) {
      return new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime();
    });
  }
  const sheet = getSheet_(key);
  ensureHeader_(sheet);
  return readRecords_(sheet, key, accountName_(key));
}

function getSheet_(key) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = ACCOUNT_SHEETS[key] || (accountById_(key) ? "練習記録_" + key.replace(/[^A-Z0-9_]/g, "") : "");
  if (!sheetName) throw new Error("対象シートが設定されていません。");
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function getMemoSheet_(key) {
  const account = accountById_(key);
  if (!account) throw new Error("対象アカウントが無効です。");
  const sheetName = "メモ_" + key.replace(/[^A-Z0-9_]/g, "");
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  ensureMemoHeader_(sheet);
  return sheet;
}

function ensureMemoHeader_(sheet) {
  const headers = [["メモID", "作成日時", "更新日時", "内容", "削除", "コート書き込み"]];
  if (sheet.getMaxColumns() < 6) sheet.insertColumnAfter(sheet.getMaxColumns());
  const current = sheet.getLastRow() ? sheet.getRange(1, 1, 1, 6).getValues()[0] : [];
  if (headers[0].some(function(value, index) { return current[index] !== value; })) {
    sheet.getRange(1, 1, 1, 6).setValues(headers).setFontWeight("bold").setBackground("#d9eaf7");
  }
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
}

function getFreeMemosForAccount_(key) {
  if (key === "ADMIN") {
    return accountConfigs_().reduce(function(allMemos, account) {
      return allMemos.concat(readFreeMemos_(getMemoSheet_(account.id), account.id, account.name));
    }, []).sort(function(left, right) {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }
  return readFreeMemos_(getMemoSheet_(key), key, accountName_(key));
}

function readFreeMemos_(sheet, account, accountName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 6).getValues().map(function(row) {
    return {
      account: account,
      accountName: accountName,
      memoId: String(row[0] || ""),
      createdAt: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ""),
      updatedAt: row[2] instanceof Date ? row[2].toISOString() : String(row[2] || ""),
      content: String(row[3] || ""),
      deleted: row[4] === true,
      board: safeBoard_(row[5])
    };
  }).filter(function(memo) { return memo.memoId && (memo.content || memo.board) && !memo.deleted; }).reverse();
}

function saveFreeMemo_(sheet, data) {
  const content = safe_(String(data.content || "").trim().slice(0, 1000));
  const board = safeBoard_(data.board);
  if (!content && !board) throw new Error("メモの内容またはコート書き込みを入力してください。");
  const memoId = String(data.memoId || "").trim();
  const now = new Date();
  if (!memoId) {
    const createdId = Utilities.getUuid();
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([[createdId, now, now, content, false, board]]);
    return { memoId: createdId, createdAt: now.toISOString(), updatedAt: now.toISOString(), content: content, board: board };
  }
  const rowNumber = findFreeMemoRow_(sheet, memoId);
  sheet.getRange(rowNumber, 3, 1, 2).setValues([[now, content]]);
  sheet.getRange(rowNumber, 6).setValue(board);
  return { memoId: memoId, updatedAt: now.toISOString(), content: content, board: board };
}

function getHyogoNews_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(HYOGO_NEWS_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  try {
    const response = UrlFetchApp.fetch(HYOGO_NEWS_FEED_URL, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { "User-Agent": "RoboMission Assist news reader" }
    });
    if (response.getResponseCode() !== 200) throw new Error("feed unavailable");
    const news = parseHyogoNewsFeed_(response.getContentText()).slice(0, 3);
    if (!news.length) throw new Error("feed parse failed");
    cache.put(HYOGO_NEWS_CACHE_KEY, JSON.stringify(news), 1800);
    return news;
  } catch (error) {
    return HYOGO_NEWS_FALLBACK.slice();
  }
}

function parseHyogoNewsFeed_(xml) {
  return String(xml || "").match(/<item>[\s\S]*?<\/item>/gi)?.map(function(item) {
    const title = feedValue_(item, "title");
    const link = feedValue_(item, "link");
    const publishedAt = feedValue_(item, "pubDate");
    const date = new Date(publishedAt);
    return {
      source: "兵庫",
      title: title,
      url: /^https:\/\/wro-hyogo\.jp\//i.test(link) ? link : "https://wro-hyogo.jp/",
      updatedAt: Number.isFinite(date.getTime()) ? Utilities.formatDate(date, "Asia/Tokyo", "yyyy.MM.dd") : ""
    };
  }).filter(function(item) { return item.title && item.updatedAt; }) || [];
}

function feedValue_(item, tagName) {
  const match = String(item).match(new RegExp("<" + tagName + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tagName + ">", "i"));
  if (!match) return "";
  return decodeXmlText_(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]+>/g, "").trim());
}

function decodeXmlText_(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'");
}

function deleteFreeMemo_(sheet, memoId) {
  const rowNumber = findFreeMemoRow_(sheet, String(memoId || "").trim());
  sheet.getRange(rowNumber, 5).setValue(true);
}

function findFreeMemoRow_(sheet, memoId) {
  if (!memoId || sheet.getLastRow() < 2) throw new Error("メモが見つかりません。");
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0] || "") === memoId) return index + 2;
  }
  throw new Error("メモが見つかりません。");
}

function ensureHeader_(sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "sheet-ready-v3-" + sheet.getSheetId();
  if (cache.get(cacheKey)) return;
  const headers = [[
    "記録日時", "競技時間（秒）", "訪問者", "赤い塔", "黄色い塔", "遺物",
    "汚れ", "ボーナス", "合計", "未判定数", "メモ", "削除", "削除日時", "動画ID（非公開）", "コート書き込み"
  ]];
  const lastRow = sheet.getLastRow();
  if (lastRow > 0 && sheet.getLastColumn() >= 14) {
    const currentHeaders = sheet.getRange(1, 1, 1, 14).getValues()[0];
    if (currentHeaders[1] === "チーム名" || currentHeaders[12] === "採点詳細JSON") {
      const oldRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 14).getValues() : [];
      const migratedRows = oldRows.map(function(row) {
        return [row[0], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[13], "", "", "", ""];
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
  cache.put(cacheKey, "1", 21600);
}

function readRecords_(sheet, account, accountName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  return rows.map(function(row, index) {
    return {
      account: account,
      accountName: accountName,
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
      notes: String(row[10] || ""),
      hasVideo: Boolean(row[13]),
      board: safeBoard_(row[14])
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
  const row = sheet.getRange(rowNumber, 1, 1, 15);
  const values = row.getValues()[0];
  const currentDate = values[0] instanceof Date ? values[0] : new Date(values[0]);
  const requestedDate = new Date(recordedAt);
  if (!Number.isFinite(currentDate.getTime()) || !Number.isFinite(requestedDate.getTime()) || currentDate.getTime() !== requestedDate.getTime()) {
    throw new Error("記録の位置が変わりました。記録を更新してから、もう一度削除してください。");
  }
  if (values[11] === true || String(values[11] || "") === "削除済み") return;
  sheet.getRange(rowNumber, 12, 1, 2).setValues([[true, new Date()]]);
}

function updateRecordMemo_(sheet, rowNumberValue, recordedAt, notes, board) {
  const rowNumber = Number(rowNumberValue);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error("メモを保存する記録が見つかりません。");
  }
  const currentValue = sheet.getRange(rowNumber, 1).getValue();
  const currentDate = currentValue instanceof Date ? currentValue : new Date(currentValue);
  const requestedDate = new Date(recordedAt);
  if (!Number.isFinite(currentDate.getTime()) || !Number.isFinite(requestedDate.getTime()) || currentDate.getTime() !== requestedDate.getTime()) {
    throw new Error("記録の位置が変わりました。一覧を更新してから、もう一度保存してください。");
  }
  sheet.getRange(rowNumber, 11).setValue(safe_(String(notes || "").slice(0, 500)));
  sheet.getRange(rowNumber, 15).setValue(safeBoard_(board));
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
      .setRanges([sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 15)])
      .build());
    sheet.setConditionalFormatRules(rules);
  }
}

function ensureDeleteControlForRow_(sheet, rowNumber) {
  const cell = sheet.getRange(rowNumber, 12);
  if (!cell.getDataValidation()) {
    cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

function canAccessVideo_(key, targetAccount) {
  return key === "ADMIN" || key === targetAccount;
}

function getRecordVideo_(key, data) {
  const targetAccount = key === "ADMIN" ? String(data.account || "").toUpperCase() : key;
  if (!accountById_(targetAccount) || !canAccessVideo_(key, targetAccount)) {
    throw new Error("この動画を表示する権限がありません。");
  }
  const sheet = getSheet_(targetAccount);
  ensureHeader_(sheet);
  const rowNumber = Number(data.rowNumber);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error("動画の記録が見つかりません。");
  }
  const values = sheet.getRange(rowNumber, 1, 1, 14).getValues()[0];
  const currentDate = values[0] instanceof Date ? values[0] : new Date(values[0]);
  const requestedDate = new Date(data.recordedAt);
  if (!Number.isFinite(currentDate.getTime()) || !Number.isFinite(requestedDate.getTime()) || currentDate.getTime() !== requestedDate.getTime()) {
    throw new Error("記録の位置が変わりました。記録を更新してから、もう一度お試しください。");
  }
  if (values[11] === true || String(values[11] || "") === "削除済み") {
    throw new Error("削除済みの記録です。");
  }
  const fileId = String(values[13] || "");
  if (!fileId) throw new Error("この記録には動画がありません。");
  const file = DriveApp.getFileById(fileId);
  if (file.getSize() > MAX_VIDEO_BYTES) throw new Error("動画の容量が大きすぎます。");
  const blob = file.getBlob();
  return {
    ok: true,
    video: {
      name: file.getName(),
      type: file.getMimeType() || "video/mp4",
      size: file.getSize(),
      base64: Utilities.base64Encode(blob.getBytes())
    }
  };
}

function saveVideo_(account, video) {
  const type = String(video && video.type || "").toLowerCase();
  const declaredSize = Number(video && video.size);
  const encoded = String(video && video.base64 || "");
  if (type.indexOf("video/") !== 0) throw new Error("動画ファイルを選択してください。");
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_VIDEO_BYTES) {
    throw new Error("動画は25MB以下にしてください。");
  }
  if (!encoded || encoded.length > Math.ceil(MAX_VIDEO_BYTES * 4 / 3) + 8) {
    throw new Error("動画データが無効です。");
  }
  const bytes = Utilities.base64Decode(encoded);
  if (!bytes.length || bytes.length !== declaredSize || bytes.length > MAX_VIDEO_BYTES) {
    throw new Error("動画データの容量を確認できませんでした。");
  }
  const originalName = String(video.name || "video").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(-80) || "video";
  const fileName = account + "_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + "_" + originalName;
  const file = videoFolder_().createFile(Utilities.newBlob(bytes, type, fileName));
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  return file;
}

function videoFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = String(properties.getProperty(VIDEO_FOLDER_PROPERTY) || "");
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (error) { /* フォルダ再作成 */ }
  }
  const folder = DriveApp.createFolder("RoboMission_Assist_Private_Videos");
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  properties.setProperty(VIDEO_FOLDER_PROPERTY, folder.getId());
  return folder;
}

function accountConfigs_() {
  const properties = PropertiesService.getScriptProperties();
  const legacy = Object.keys(API_KEY_PROPERTIES).map(function(id) {
    return {
      id: id,
      name: String(properties.getProperty(ACCOUNT_NAME_PROPERTIES[id]) || "アカウント " + id).slice(0, 50),
      apiKey: String(properties.getProperty(API_KEY_PROPERTIES[id]) || "").trim(),
      legacy: true
    };
  }).filter(function(account) { return Boolean(account.apiKey); });
  let dynamic = [];
  try {
    const parsed = JSON.parse(properties.getProperty(DYNAMIC_ACCOUNTS_PROPERTY) || "[]");
    if (Array.isArray(parsed)) dynamic = parsed;
  } catch (_error) {
    dynamic = [];
  }
  const usedIds = {};
  return legacy.concat(dynamic.map(function(account) {
    return {
      id: String(account && account.id || "").toUpperCase(),
      name: String(account && account.name || "").trim().slice(0, 50),
      apiKey: String(account && account.apiKey || "").trim(),
      legacy: false
    };
  })).filter(function(account) {
    if (!/^[A-Z0-9_]{1,32}$/.test(account.id) || !account.name || !account.apiKey || usedIds[account.id]) return false;
    usedIds[account.id] = true;
    return true;
  });
}

function accountById_(id) {
  const accountId = String(id || "").toUpperCase();
  return accountConfigs_().filter(function(account) { return account.id === accountId; })[0] || null;
}

function accountName_(id) {
  if (id === "ADMIN") return "管理者";
  const account = accountById_(id);
  return account ? account.name : "";
}

function publicAccountList_() {
  return accountConfigs_().map(function(account) {
    return { id: account.id, name: account.name, legacy: account.legacy, hasApiKey: Boolean(account.apiKey) };
  });
}

function saveAccount_(data) {
  const name = String(data.name || "").trim().slice(0, 50);
  const newApiKey = String(data.newApiKey || "").trim();
  if (!name) throw new Error("チーム名を入力してください。");
  const properties = PropertiesService.getScriptProperties();
  let requestedId = String(data.accountId || "").toUpperCase();
  const existing = requestedId ? accountById_(requestedId) : null;
  if (requestedId && !existing) throw new Error("更新するアカウントが見つかりません。");
  if (newApiKey) {
    const normalizedNewApiKey = newApiKey.toLocaleLowerCase();
    const duplicate = accountConfigs_().some(function(account) {
      return account.id !== requestedId && account.apiKey.toLocaleLowerCase() === normalizedNewApiKey;
    });
    if (duplicate || normalizeKey_(newApiKey) === "ADMIN") throw new Error("このAPIキーは既に使用されています。");
  }
  if (existing && existing.legacy) {
    properties.setProperty(ACCOUNT_NAME_PROPERTIES[existing.id], name);
    if (newApiKey) properties.setProperty(API_KEY_PROPERTIES[existing.id], newApiKey);
    return { id: existing.id, name: name, legacy: true, hasApiKey: true };
  }
  let dynamic = accountConfigs_().filter(function(account) { return !account.legacy; });
  if (existing) {
    dynamic = dynamic.map(function(account) {
      return account.id === existing.id
        ? { id: account.id, name: name, apiKey: newApiKey || account.apiKey }
        : { id: account.id, name: account.name, apiKey: account.apiKey };
    });
  } else {
    if (!newApiKey) throw new Error("新しいアカウントのAPIキーを入力してください。");
    const id = "ACC_" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
    dynamic.push({ id: id, name: name, apiKey: newApiKey });
    requestedId = id;
  }
  properties.setProperty(DYNAMIC_ACCOUNTS_PROPERTY, JSON.stringify(dynamic));
  const savedId = existing ? existing.id : requestedId;
  return { id: savedId, name: name, legacy: false, hasApiKey: true };
}

function normalizeKey_(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey) return "";
  const normalizedApiKey = apiKey.toLocaleLowerCase();
  const properties = PropertiesService.getScriptProperties();
  const accounts = accountConfigs_();
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    if (account.apiKey && normalizedApiKey === account.apiKey.toLocaleLowerCase()) return account.id;
  }
  const allProperties = properties.getProperties();
  const masterPropertyNames = Object.keys(allProperties).filter(function(name) {
    return name.indexOf("MASTER_PASS") === 0;
  });
  for (let index = 0; index < masterPropertyNames.length; index += 1) {
    const configuredPassword = String(allProperties[masterPropertyNames[index]] || "");
    if (configuredPassword && normalizedApiKey === configuredPassword.toLocaleLowerCase()) return "ADMIN";
  }
  return "";
}

function safe_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function safeBoard_(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (text.length > 45000) throw new Error("コート書き込みのデータが大きすぎます。書き込みを減らしてください。");
  let board;
  try { board = JSON.parse(text); } catch (error) { return ""; }
  if (!board || board.version !== 1 || !Array.isArray(board.elements) || board.elements.length > 120) return "";
  return JSON.stringify(board);
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
