import "./style.css";
import { DEFAULT_GAS_WEB_APP_URL } from "./config";
import { isAppleTouchDevice } from "./device";
import { judgingGroups } from "./judging";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";
import { APP_VERSION } from "./version";
import {
  MAX_SCORE,
  duplicateArtifactColors,
  isComplete,
  makeInitialState,
  sanitizeScoreState,
  sectionScores,
  totalScore,
  unjudgedCount,
  type ArtifactColor,
  type Score,
  type ScoreState,
} from "./model";

type AccountKey = string;

interface PracticeRecord {
  account: string;
  accountName: string;
  rowNumber: number;
  recordedAt: string;
  timeSeconds: number | null;
  notes: string;
  visitors: number;
  redTowers: number;
  yellowTowers: number;
  artifacts: number;
  dirt: number;
  bonus: number;
  total: number;
  unjudged: number;
  hasVideo: boolean;
}

interface StoredVideo {
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface RecordFilters {
  query: string;
  dateFrom: string;
  dateTo: string;
  minScore: string;
  maxScore: string;
  account: string;
  sort: "newest" | "oldest" | "score-desc" | "score-asc";
}

interface ManagedAccount {
  id: string;
  name: string;
  legacy: boolean;
  hasApiKey: boolean;
}

const RULES_PDF_URL = `${import.meta.env.BASE_URL}assets/rules/WRO-2026-Junior-Google-Translate-JA.pdf`;
const RULES_DRIVE_PREVIEW_URL = "https://drive.google.com/file/d/1pDAgqy-Of24bbA4MeKslJ9SWUc-vH1zU/preview";
const PUBLIC_APP_URL = "https://ecleaire.github.io/ROBOMISSION_POINTToul/";
const GOOGLE_TRANSLATED_RULES_URL = "https://drive.google.com/file/d/1pDAgqy-Of24bbA4MeKslJ9SWUc-vH1zU/view?usp=sharing";
const WORLD_RULES_URL = "https://drive.google.com/file/d/1OVybBEc3_l8hV7nrjWLtlJUsXoLXGws0/view?usp=sharing";

const STORAGE_KEY = "robomission-junior-score-v2";
const ACCOUNT_KEY = "robomission-junior-account";
const API_KEY_KEY = "robomission-junior-api-key";
const ACCOUNT_STORAGE_MIGRATION_KEY = "robomission-account-storage-version";
const ACCOUNT_STORAGE_VERSION = "2026-07-15-optional-save-v1";
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_RECORDING_MS = 3 * 60 * 1000;
const VIDEO_RECORDING_BITRATE = 1_000_000;

if (localStorage.getItem(ACCOUNT_STORAGE_MIGRATION_KEY) !== ACCOUNT_STORAGE_VERSION) {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(API_KEY_KEY);
  localStorage.setItem(ACCOUNT_STORAGE_MIGRATION_KEY, ACCOUNT_STORAGE_VERSION);
}

const app = document.querySelector<HTMLDivElement>("#app")!;
let activeAccount = loadAccount();
let activeApiKey = loadApiKey();
let activeAccountName = "";
let state = loadState();
let modal: { group: string } | null = null;
let accountSwitchOpen = false;
let sheetStatus = "";
let accountError = "";
let recordsStatus = "";
let practiceRecords: PracticeRecord[] = [];
const RECORD_PAGE_SIZE = 50;
let recordVisibleCount = RECORD_PAGE_SIZE;
let recordsAbortController: AbortController | null = null;
let sheetSending = false;
let pendingRequestId = createRequestId();
let recordFilters: RecordFilters = {
  query: "",
  dateFrom: "",
  dateTo: "",
  minScore: "",
  maxScore: "",
  account: "ALL",
  sort: "newest",
};
const adminRevealPressCounts = { rules: 0, links: 0 };
let adminModeUnlocked = activeAccount === "ADMIN";
let adminError = "";
let managedAccounts: ManagedAccount[] = [];
let accountManagementStatus = "";
let selectedVideo: File | null = null;
let videoSelectionError = "";
let recordVideoModal: { url: string; name: string } | null = null;
let cameraStream: MediaStream | null = null;
let videoRecorder: MediaRecorder | null = null;
let videoChunks: Blob[] = [];
let videoRecordingBytes = 0;
let videoRecordingStartedAt = 0;
let videoRecordingStatus: "idle" | "starting" | "recording" | "processing" = "idle";
let videoRecordingTimer: number | null = null;
let videoRecordingLimitTimer: number | null = null;
let discardRecordedVideo = false;
type StopwatchStatus = "idle" | "running" | "paused";
let stopwatchStatus: StopwatchStatus = "idle";
let stopwatchElapsedMs = 0;
let stopwatchStartedAt = 0;
let stopwatchTimer: number | null = null;
let stopwatchLaps: number[] = [];

const visitorNames = ["緑の訪問者", "赤の訪問者", "青の訪問者", "黒の訪問者"];
const artifactColors: { value: ArtifactColor; label: string }[] = [
  { value: "unused", label: "未選択" },
  { value: "blue", label: "青" },
  { value: "red", label: "赤" },
  { value: "green", label: "緑" },
  { value: "black", label: "黒" },
  { value: "yellow", label: "黄" },
];

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  render();
  if (location.hash === "#/records" && activeAccount) void loadRecords();
  if (location.hash === "#/admin" && activeAccount === "ADMIN") { void loadRecords(); void loadManagedAccounts(); }
});
window.addEventListener("keydown", (event) => {
  if (!modal && !accountSwitchOpen) return;
  if (event.key === "Escape") { modal = null; accountSwitchOpen = false; }
  render();
});
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) return;
  if (document.body.classList.contains("pdf-mode")) {
    document.body.classList.remove("pdf-mode");
    document.querySelector<HTMLElement>(".pdf-viewer")?.classList.remove("pdf-viewer-expanded");
  }
  if (document.body.classList.contains("stopwatch-mode")) {
    document.body.classList.remove("stopwatch-mode");
    document.querySelector<HTMLElement>(".stopwatch")?.classList.remove("stopwatch-expanded");
    refreshStopwatch();
  }
  if (document.body.classList.contains("camera-mode")) {
    document.body.classList.remove("camera-mode");
    document.querySelector<HTMLElement>(".camera-preview-wrap")?.classList.remove("camera-preview-expanded");
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined),
  );
}

if (activeAccount === "ADMIN") location.hash = "#/admin";
else if (!location.hash) location.hash = "#/score";
render();
if (location.hash === "#/records" && activeAccount) void loadRecords();
if (location.hash === "#/admin" && activeAccount === "ADMIN") { void loadRecords(); void loadManagedAccounts(); }
if (activeAccount && activeAccount !== "ADMIN" && activeApiKey) void refreshAccountIdentity();

function render() {
  const route = location.hash.replace(/^#\/?/, "") || "score";
  const content =
    route === "admin" && adminModeUnlocked
      ? adminView()
    : !activeAccount || route === "account"
      ? accountView()
      : route === "score"
      ? scoringView()
      : route === "result"
        ? resultView()
        : route === "records"
          ? recordsView()
        : route === "photos"
          ? photoGalleryView()
          : route === "rules"
            ? rulesView()
            : route === "links"
              ? linksView()
            : scoringView();

  app.innerHTML = `${content}${modal ? modalView() : ""}${accountSwitchOpen ? accountSwitchModal() : ""}${recordVideoModal ? recordVideoModalView() : ""}`;
  bindEvents();
}

function shell(content: string, options: { back?: string; title?: string } = {}) {
  const route = location.hash.replace(/^#\/?/, "") || "score";
  const activeRoute = route === "result" ? "score" : route;
  const modes: string[][] = [
    ["score", "採点"],
    ["photos", "判定写真"],
    ["records", "練習記録"],
    ["rules", "ルール"],
    ["links", "リンク"],
  ];
  if (adminModeUnlocked || activeAccount === "ADMIN") modes.push(["admin", "管理"]);
  return `
    <header class="app-header">
      <div class="app-brand">
        <div><p>WRO 2026 / ROBOMISSION</p><strong>RoboMission Assist <small class="version-badge">v${APP_VERSION}</small></strong></div>
        <span class="current-mode">${options.title ?? "RoboMission Junior"}</span>
        ${activeAccount && activeAccount !== "ADMIN" ? `<div class="account-switch"><span>${escapeHtml(activeAccountName || "アカウント")}</span><button data-action="open-account-switch">切替</button></div>` : activeAccount === "ADMIN" ? `<span class="admin-badge">管理モード</span>` : ""}
      </div>
      <nav class="mode-nav" aria-label="機能メニュー">
        ${modes.map(([target, label]) => `<button data-nav="${target}" class="${activeRoute === target ? "active" : ""}">${label}</button>`).join("")}
      </nav>
    </header>
    <main>${content}</main>`;
}

function accountView() {
  return shell(`
    <section class="account-login card">
      <div class="account-icon">鍵</div>
      <p class="eyebrow">アカウントを選択</p>
      <h1>APIキーを入力</h1>
      <p>通常アカウントのAPIキー、または管理者パスワードを入力してください。管理者の場合は管理画面を開きます。</p>
      <label>APIキー<input id="account-key-input" type="password" maxlength="64" autocomplete="off" autocapitalize="characters" placeholder="APIキー" /></label>
      <label class="remember-account"><input id="remember-account-input" type="checkbox" /><span>この端末にアカウント情報を保存する</span></label>
      ${accountError ? `<p class="warning" role="alert">${escapeHtml(accountError)}</p>` : ""}
      <button class="primary" data-action="login-account">このキーで始める</button>
    </section>
  `, { title: "アカウント" });
}

function accountSwitchModal() {
  return `<div class="modal-backdrop" data-action="close-account-switch">
    <section class="account-switch-modal card" role="dialog" aria-modal="true" aria-label="アカウントを切り替える">
      <header><div><strong>アカウントを切り替える</strong><small>チーム名はAPIキー確認後に表示されます</small></div><button class="icon-button" data-action="close-account-switch" aria-label="閉じる">×</button></header>
      <label>APIキー<input id="switch-account-key-input" type="password" maxlength="128" autocomplete="off" placeholder="切り替えるアカウントのAPIキー" /></label>
      <label class="remember-account"><input id="remember-switch-account-input" type="checkbox" /><span>この端末にアカウント情報を保存する</span></label>
      ${accountError ? `<p class="warning" role="alert">${escapeHtml(accountError)}</p>` : ""}
      <button class="primary" data-action="switch-account">このアカウントへ切り替える</button>
    </section>
  </div>`;
}

function adminView() {
  if (activeAccount === "ADMIN") return recordsView();
  return shell(`
    <section class="account-login admin-login card">
      <div class="account-icon">管理</div>
      <p class="eyebrow">ADMINISTRATION</p>
      <h1>管理者パスワード</h1>
      <p>管理者用パスワードを入力してください。大文字・小文字は区別しません。</p>
      <label>パスワード<input id="admin-password-input" type="password" maxlength="128" autocomplete="current-password" placeholder="管理者パスワード" /></label>
      ${adminError ? `<p class="warning" role="alert">${escapeHtml(adminError)}</p>` : ""}
      <button class="primary" data-action="login-admin">管理画面を開く</button>
    </section>
  `, { title: "管理ログイン" });
}

function accountManagementView() {
  return `<section class="account-management card" aria-label="アカウント管理">
    <div class="account-management-header"><div><p class="eyebrow">PRIVATE ACCOUNT MANAGEMENT</p><h2>アカウント管理</h2></div><div class="account-management-actions"><button class="secondary" data-action="load-accounts">↻ 更新</button><button class="admin-exit" data-action="logout-admin">管理を終了</button></div></div>
    <p>チーム名とAPIキーはGASのスクリプトプロパティにだけ保存され、公開リポジトリ・URL・シート名には含めません。既存APIキーは画面へ表示しません。</p>
    ${accountManagementStatus ? `<p class="sheet-status" role="status">${escapeHtml(accountManagementStatus)}</p>` : ""}
    <div class="managed-account-list">
      ${managedAccounts.map((account) => `<article class="managed-account" data-managed-account="${account.id}">
        <div><strong>${escapeHtml(account.name)}</strong><small>ID: ${escapeHtml(account.id)}${account.legacy ? "・既存アカウント" : ""}</small></div>
        <label>チーム名<input data-managed-name="${account.id}" maxlength="50" value="${escapeHtml(account.name)}" /></label>
        <label>新しいAPIキー<input data-managed-key="${account.id}" type="password" minlength="4" maxlength="128" autocomplete="new-password" placeholder="変更しない場合は空欄" /></label>
        <button class="primary" data-action="update-account" data-account-id="${account.id}">変更を保存</button>
      </article>`).join("") || `<p class="empty-account-list">アカウント情報を読み込んでいます…</p>`}
    </div>
    <div class="new-managed-account">
      <h3>新しいアカウントを追加</h3>
      <label>チーム名<input id="new-account-name" maxlength="50" placeholder="チーム名" /></label>
      <label>APIキー<input id="new-account-key" type="password" minlength="4" maxlength="128" autocomplete="new-password" placeholder="4文字以上のAPIキー" /></label>
      <button class="primary" data-action="create-account">アカウントを追加</button>
    </div>
  </section>`;
}

function scoringView() {
  const total = totalScore(state);
  const duplicates = duplicateArtifactColors(state);
  const scores = sectionScores(state);
  return shell(`
    ${duplicates.length ? `<p class="warning sheet-warning">同じ色が重複しています：${duplicates.map(colorLabel).join("、")}</p>` : ""}
    <section class="score-sheet" aria-label="得点チェック表">
      <div class="score-sheet-title">WRO 2026 RoboMission Junior　得点チェック</div>
      ${stopwatchView()}
      ${cameraRecorderView()}
      <div class="score-sheet-guide">① ロボットの結果を見る　② 当てはまる□にチェック　③ 合計点を確認　<span>チェックなしは0点・同じ□をもう一度押すと解除</span></div>
      <div class="sheet-row sheet-columns">
        <strong>ミッション／対象</strong><strong>高得点</strong><strong>部分点</strong><strong>得点</strong><strong>最大得点</strong>
      </div>
      ${sheetSection("visitors", "1. 訪問者を案内する")}
      ${visitorNames.map((name, index) => sheetScoreRow("visitors", index, name, state.visitors[index], [[10, "対応色エリア内・直立"], [5, "一部だけ、または倒れている"], [0, "エリア外・違う色"]], 10)).join("")}
      ${sheetSubtotal(scores.visitors, 40)}
      ${sheetSection("redTowers", "2. 塔を再建する（赤い塔）")}
      ${state.redTowers.map((score, index) => sheetScoreRow("redTowers", index, `赤い塔 ${["コース上", "コース下"][index]}`, score, [[15, "完全に入り、直立"], [10, "一部だけ入り、直立"], [0, "エリア外・倒れている"]], 15)).join("")}
      ${sheetSubtotal(scores.redTowers, 30)}
      ${sheetSection("yellowTowers", "2. 塔を再建する（黄色い塔）")}
      ${state.yellowTowers.map((score, index) => sheetScoreRow("yellowTowers", index, `黄色い塔 ${["コース上", "コース下"][index]}`, score, [[25, "上部が正しく、土台が完全に入る"], [15, "上部が正しく、土台が一部入る"], [0, "上部が不正・直立していない"]], 25)).join("")}
      ${sheetSubtotal(scores.yellowTowers, 50)}
      ${sheetSection("artifacts", "3. 遺物を博物館に運ぶ")}
      ${state.artifacts.map((artifact, index) => sheetScoreRow("artifacts", index, `遺物 ${index + 1}`, artifact.score, [[15, "対応色に完全に入り、直立"], [5, "一部だけ、または倒れている"], [0, "エリア外・違う色"]], 15, artifactColorSelect(index, artifact.color))).join("")}
      ${sheetSubtotal(scores.artifacts, 60)}
      ${sheetSection("dirt", "4. 石畳の汚れを落とす")}
      ${dirtCountRow()}
      ${sheetSubtotal(scores.dirt, 20)}
      ${sheetSection("bonus", "5. ボーナスポイント")}
      ${["赤いバリア", "白いバリア", "オウム"].map((name, index) => sheetScoreRow("bonus", index, name, state.bonus[index], [[10, "移動・損傷していない"], [0, "移動または損傷している"]], 10)).join("")}
      ${sheetSubtotal(scores.bonus, 30)}
      <div class="sheet-row sheet-total"><strong>合計得点</strong><span></span><span></span><strong>${total}</strong><strong>${MAX_SCORE}</strong></div>
      <div class="sheet-row sheet-maximum"><strong>満点</strong><span></span><span></span><strong>${MAX_SCORE}</strong><strong>${MAX_SCORE}</strong></div>
      <div class="sheet-footer-tools">
        ${timePicker(state.timeSeconds)}
        <label class="notes-card">メモ<textarea data-notes rows="2" maxlength="500" placeholder="ミスした部分や次回の注意点">${escapeHtml(state.notes)}</textarea></label>
        ${videoPickerView()}
      </div>
    </section>
    <div class="bottom-space"></div>
    <nav class="bottom-bar">
      <button class="reset-button" data-action="reset">採点をリセット</button>
      <button class="primary" data-nav="result"><span>結果を見る</span><strong>合計得点 ${total} / ${MAX_SCORE}点</strong></button>
    </nav>
  `, { back: "score", title: "採点" });
}

function stopwatchView() {
  return `<section class="stopwatch" aria-label="ストップウォッチ">${stopwatchContents()}</section>`;
}

function cameraRecorderView() {
  const isRecording = videoRecordingStatus === "recording";
  const isBusy = videoRecordingStatus === "starting" || videoRecordingStatus === "processing";
  return `<section class="camera-recorder ${cameraStream ? "camera-active" : ""} ${isRecording ? "recording" : ""}" aria-label="動画録画">
    <div class="camera-preview-wrap">
      <video data-camera-preview muted playsinline></video>
      <span class="camera-placeholder">背面カメラ</span>
      ${isRecording ? `<strong class="recording-indicator">● 録画中 <span data-video-recording-time>00:00</span></strong>` : ""}
      ${cameraStream ? `<button class="camera-expand" data-action="camera-expand" aria-label="カメラ映像を全画面表示">⛶ 全画面</button>
        <button class="camera-collapse" data-action="camera-collapse" aria-label="カメラ映像の全画面表示を解除">× 全画面解除</button>
        ${isRecording ? `<button class="camera-overlay-stop" data-action="camera-stop">■ 録画停止</button>` : ""}` : ""}
    </div>
    <div class="camera-recorder-info"><strong>動画録画</strong><small>音声なし・最長3分。録画中もストップウォッチを操作できます。</small></div>
    ${isRecording
      ? `<button class="camera-stop" data-action="camera-stop">■ 録画停止</button>`
      : `<button class="camera-start" data-action="camera-start" ${isBusy ? "disabled" : ""}>${videoRecordingStatus === "starting" ? "カメラ準備中…" : videoRecordingStatus === "processing" ? "動画処理中…" : "● 録画開始"}</button>`}
  </section>`;
}

function stopwatchContents() {
  const timerControls = stopwatchStatus === "idle"
    ? `<button class="timer-lap" type="button" disabled>⚑ <span>ラップ</span></button><button class="timer-start" data-action="timer-start">◀ <span>スタート</span></button>`
    : stopwatchStatus === "running"
      ? `<button class="timer-lap" data-action="timer-lap">⚑ <span>ラップ</span></button><button class="timer-pause" data-action="timer-pause">Ⅱ <span>停止</span></button>`
      : `<button class="timer-finish" data-action="timer-finish">■ <span>タイマー終了</span></button><button class="timer-resume" data-action="timer-resume">◀ <span>再開</span></button>`;
  const fullscreenControl = document.body.classList.contains("stopwatch-mode")
    ? `<button class="timer-collapse" data-action="timer-collapse" aria-label="ストップウォッチの全画面表示を解除">× <span>全画面解除</span></button>`
    : `<button class="timer-expand" data-action="timer-expand" aria-label="ストップウォッチを全画面表示">⛶ <span>全画面</span></button>`;
  return `<div class="stopwatch-time"><span>STOPWATCH</span><strong data-stopwatch-display>${formatStopwatch(currentStopwatchElapsed())}</strong></div>
    <div class="stopwatch-controls">${timerControls}${fullscreenControl}</div>
    ${stopwatchLaps.length ? `<ol class="stopwatch-laps" aria-label="ラップ記録">${stopwatchLaps.map((lap, index) => `<li><span>ラップ ${index + 1}</span><strong>${formatStopwatch(lap)}</strong></li>`).join("")}</ol>` : ""}`;
}

function sheetSection(id: string, title: string, action = "") {
  return `<div class="sheet-section"><strong>${title}</strong><span>${action}<button data-photos="${id}" aria-label="${title}の判定写真を見る">▧ 写真</button></span></div>`;
}

function timePicker(value: number | null) {
  const centiseconds = value === null ? null : Math.max(0, Math.round(value * 100));
  const minutes = centiseconds === null ? "" : String(Math.min(2, Math.max(0, Math.floor(centiseconds / 6000))));
  const seconds = centiseconds === null ? 0 : Math.floor((centiseconds % 6000) / 100);
  const hundredths = centiseconds === null ? 0 : centiseconds % 100;
  const numberOptions = (length: number, selected: number) => Array.from({ length }, (_, number) =>
    `<option value="${number}" ${number === selected ? "selected" : ""}>${String(number).padStart(2, "0")}</option>`,
  ).join("");
  return `<section class="time-card">
    <div><strong>競技時間</strong><small>タイマー終了時に自動反映・手動修正できます</small></div>
    <div class="time-selects">
      <label><select data-time-part="minutes" aria-label="競技時間の分"><option value="" ${minutes === "" ? "selected" : ""}>--</option><option value="0" ${minutes === "0" ? "selected" : ""}>0</option><option value="1" ${minutes === "1" ? "selected" : ""}>1</option><option value="2" ${minutes === "2" ? "selected" : ""}>2</option></select><span>分</span></label>
      <label><select data-time-part="seconds" aria-label="競技時間の秒">${numberOptions(60, seconds)}</select><span>秒</span></label>
      <label><select data-time-part="hundredths" aria-label="競技時間の100分の1秒">${numberOptions(100, hundredths)}</select><span>1/100秒</span></label>
    </div>
  </section>`;
}

function videoPickerView() {
  return `<section class="video-card">
    <div><strong>動画</strong><small>任意・25MB以下／本人と管理者だけが閲覧できます</small></div>
    <label class="video-select">動画を選択<input data-video-input type="file" accept="video/*" /></label>
    ${selectedVideo ? `<div class="selected-video"><span>${escapeHtml(selectedVideo.name)}（${formatFileSize(selectedVideo.size)}）</span><button type="button" data-action="remove-video">取り消す</button></div>` : ""}
    ${videoSelectionError ? `<p class="video-error" role="alert">${escapeHtml(videoSelectionError)}</p>` : ""}
  </section>`;
}

function supportedRecordingMimeType() {
  if (!("MediaRecorder" in window)) return "";
  return [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function startCameraRecording() {
  if (videoRecordingStatus !== "idle") return;
  if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
    videoSelectionError = "このブラウザはアプリ内録画に対応していません。下の「動画を選択」を使用してください。";
    render();
    return;
  }
  if (selectedVideo && !confirm("選択済みの動画を新しい録画へ置き換えますか？")) return;
  selectedVideo = null;
  videoSelectionError = "";
  videoRecordingStatus = "starting";
  render();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    const mimeType = supportedRecordingMimeType();
    const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_RECORDING_BITRATE };
    if (mimeType) options.mimeType = mimeType;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(cameraStream, options);
    } catch {
      recorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : undefined);
    }
    videoRecorder = recorder;
    videoChunks = [];
    videoRecordingBytes = 0;
    discardRecordedVideo = false;
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      videoChunks.push(event.data);
      videoRecordingBytes += event.data.size;
      if (videoRecordingBytes >= MAX_VIDEO_BYTES * 0.96 && recorder.state === "recording") stopCameraRecording();
    });
    recorder.addEventListener("error", () => {
      videoSelectionError = "録画中にエラーが発生しました。";
      if (recorder.state !== "inactive") recorder.stop();
    });
    recorder.addEventListener("stop", () => finalizeCameraRecording(recorder.mimeType));
    recorder.start(1000);
    videoRecordingStartedAt = Date.now();
    videoRecordingStatus = "recording";
    videoRecordingTimer = window.setInterval(updateVideoRecordingTime, 250);
    videoRecordingLimitTimer = window.setTimeout(stopCameraRecording, MAX_RECORDING_MS);
    render();
  } catch (error) {
    stopCameraStream();
    videoRecordingStatus = "idle";
    videoSelectionError = error instanceof DOMException && error.name === "NotAllowedError"
      ? "カメラの使用が許可されませんでした。ブラウザのカメラ権限を確認してください。"
      : "カメラを開始できませんでした。";
    render();
  }
}

function stopCameraRecording() {
  if (!videoRecorder || videoRecorder.state === "inactive") return;
  exitCameraFullscreen();
  videoRecordingStatus = "processing";
  clearVideoRecordingTimers();
  videoRecorder.stop();
  render();
}

function finalizeCameraRecording(mimeType: string) {
  const chunks = videoChunks;
  videoChunks = [];
  const shouldDiscard = discardRecordedVideo;
  discardRecordedVideo = false;
  videoRecorder = null;
  clearVideoRecordingTimers();
  stopCameraStream();
  videoRecordingStatus = "idle";
  if (!shouldDiscard) {
    const type = mimeType || chunks[0]?.type || "video/webm";
    const blob = new Blob(chunks, { type });
    if (!blob.size) {
      videoSelectionError = "録画した動画を作成できませんでした。";
    } else if (blob.size > MAX_VIDEO_BYTES) {
      videoSelectionError = "録画した動画が25MBを超えました。画質設定または録画時間を短くしてください。";
    } else {
      const extension = type.includes("mp4") ? "mp4" : "webm";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      selectedVideo = new File([blob], `robomission_${stamp}.${extension}`, { type });
      videoSelectionError = "";
    }
  }
  render();
}

function discardVideoRecordingNow() {
  discardRecordedVideo = true;
  clearVideoRecordingTimers();
  if (videoRecorder && videoRecorder.state !== "inactive") {
    videoRecorder.stop();
  } else {
    videoRecorder = null;
    stopCameraStream();
    videoRecordingStatus = "idle";
  }
}

function stopCameraStream() {
  collapseCameraFullscreen();
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

function enterCameraFullscreen() {
  const preview = document.querySelector<HTMLElement>(".camera-preview-wrap");
  if (!preview || !cameraStream) return;
  preview.classList.add("camera-preview-expanded");
  document.body.classList.add("camera-mode");
  if (!document.fullscreenElement && preview.requestFullscreen) {
    void preview.requestFullscreen().catch(() => undefined);
  }
}

function collapseCameraFullscreen() {
  document.body.classList.remove("camera-mode");
  document.querySelector<HTMLElement>(".camera-preview-wrap")?.classList.remove("camera-preview-expanded");
}

function exitCameraFullscreen() {
  if (document.fullscreenElement && document.body.classList.contains("camera-mode")) {
    void document.exitFullscreen().catch(() => undefined).finally(collapseCameraFullscreen);
  } else {
    collapseCameraFullscreen();
  }
}

function clearVideoRecordingTimers() {
  if (videoRecordingTimer !== null) window.clearInterval(videoRecordingTimer);
  if (videoRecordingLimitTimer !== null) window.clearTimeout(videoRecordingLimitTimer);
  videoRecordingTimer = null;
  videoRecordingLimitTimer = null;
}

function attachCameraPreview() {
  const preview = document.querySelector<HTMLVideoElement>("[data-camera-preview]");
  if (!preview || !cameraStream) return;
  preview.srcObject = cameraStream;
  void preview.play().catch(() => undefined);
}

function updateVideoRecordingTime() {
  const display = document.querySelector<HTMLElement>("[data-video-recording-time]");
  if (!display || videoRecordingStatus !== "recording") return;
  const seconds = Math.max(0, Math.floor((Date.now() - videoRecordingStartedAt) / 1000));
  display.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function artifactColorSelect(index: number, color: ArtifactColor) {
  return `<select data-artifact-color="${index}" aria-label="遺物${index + 1}の色">${artifactColors.map((item) => `<option value="${item.value}" ${item.value === color ? "selected" : ""}>${item.label}</option>`).join("")}</select>`;
}

function sheetScoreRow(section: string, index: number, title: string, score: Score, options: [number, string][], max: number, targetExtra = "") {
  const high = options[0];
  const partial = options.length === 3 ? options[1] : null;
  const zero = options[options.length - 1];
  return `<div class="sheet-row score-sheet-row">
    <div class="sheet-target"><strong>${title}</strong>${targetExtra}</div>
    ${sheetCheck(section, index, score, high)}
    ${partial ? sheetCheck(section, index, score, partial) : `<span class="sheet-check-cell empty">—</span>`}
    <strong class="sheet-score-cell ${score === 0 ? "zero-score" : ""}" title="${escapeHtml(zero[1])}">${score}</strong>
    <strong class="sheet-max">${max}</strong>
  </div>`;
}

function sheetCheck(section: string, index: number, score: Score, option: [number, string]) {
  const [value, label] = option;
  return `<button type="button" class="sheet-check-cell ${score === value ? "selected" : ""}" title="${escapeHtml(label)}" data-score-section="${section}" data-score-index="${index}" data-score-value="${value}" aria-pressed="${score === value}">
    <span class="check-box" aria-hidden="true">✓</span><small>${value}点</small>
  </button>`;
}

function sheetSubtotal(score: number, max: number) {
  return `<div class="sheet-row sheet-subtotal"><strong>小計</strong><span></span><span></span><strong>${score}</strong><strong>${max}</strong></div>`;
}

function dirtCountRow() {
  const count = state.dirt.filter((score) => score === 2).length;
  return `<div class="sheet-row score-sheet-row dirt-count-row">
    <div class="sheet-target"><strong>石畳に触れていない汚れ</strong></div>
    <label class="dirt-count-cell"><select data-dirt-count aria-label="石畳に触れていない汚れの個数">
      ${Array.from({ length: 11 }, (_, value) => `<option value="${value}" ${value === count ? "selected" : ""}>${value}個</option>`).join("")}
    </select></label>
    <span class="sheet-check-cell empty">—</span>
    <strong class="sheet-score-cell ${count === 0 ? "zero-score" : ""}">${count * 2}</strong>
    <strong class="sheet-max">20</strong>
  </div>`;
}

function resultView() {
  const sections = sectionScores(state);
  const duplicates = duplicateArtifactColors(state);
  const resultIssues = [
    duplicates.length ? "遺物の色重複あり" : "",
    state.artifacts.some((item) => item.score > 0 && item.color === "unused") ? "得点を選んだ遺物の色未選択あり" : "",
  ].filter(Boolean);
  return shell(`
    <section class="result-card" id="result-card">
      <p class="eyebrow">スコア</p>
      <h1>採点結果</h1>
      <div class="result-meta"><span>競技時間 ${formatTime(state.timeSeconds)}</span></div>
      ${state.notes ? `<p class="result-notes"><strong>メモ</strong>${escapeHtml(state.notes)}</p>` : ""}
      ${selectedVideo ? `<p class="result-video"><strong>動画</strong>${escapeHtml(selectedVideo.name)}（${formatFileSize(selectedVideo.size)}）</p>` : ""}
      <div class="final-score"><span>合計得点</span><strong>${totalScore(state)} <small>/ ${MAX_SCORE} 点</small></strong></div>
      <dl class="score-breakdown">
        ${resultRow("訪問者を案内する", sections.visitors, 40)}
        ${resultRow("赤い塔を再建する", sections.redTowers, 30)}
        ${resultRow("黄色い塔を再建する", sections.yellowTowers, 50)}
        ${resultRow("遺物を博物館に運ぶ", sections.artifacts, 60)}
        ${resultRow("石畳の汚れを落とす", sections.dirt, 20)}
        ${resultRow("ボーナスポイント", sections.bonus, 30)}
      </dl>
      <div class="completion ${isComplete(state) ? "complete" : "incomplete"}">${isComplete(state) ? "✓ 採点内容を確認しました" : `! ${resultIssues.join("・")}`}</div>
    </section>
    <section class="result-actions">
      <button class="secondary" data-nav="score">採点へ戻る</button>
    </section>
    ${activeAccount === "ADMIN" ? `<section class="sheet-panel card"><h2>管理アカウント</h2><p>管理アカウントでは記録とアカウントを管理できます。採点結果の保存は通常アカウントへ切り替えてください。</p></section>` : `<section class="sheet-panel card">
      <h2>Googleスプレッドシートへ記録</h2>
      <p><strong>${escapeHtml(activeAccountName || "現在のアカウント")}</strong>のシートへ、この結果を1行追加します。</p>
      <button class="primary" data-action="send-sheet" ${sheetSending ? "disabled" : ""}>${sheetSending ? "保存中…" : "このチームの記録として保存"}</button>
      ${sheetStatus ? `<p class="sheet-status" role="status">${escapeHtml(sheetStatus)}</p>` : ""}
    </section>`}
    <button class="text-button new-score" data-action="new">＋ 新しい採点を始める</button>
  `, { back: "score", title: "採点結果" });
}

function recordsView() {
  const filteredRecords = filteredPracticeRecords();
  const visibleRecords = filteredRecords.slice(0, recordVisibleCount);
  const isAdmin = activeAccount === "ADMIN";
  return shell(`
    <section class="page-intro records-intro">
      <p class="eyebrow">${isAdmin ? "管理アカウント" : escapeHtml(activeAccountName || "現在のアカウント")}</p>
      <h1>記録</h1>
      <p>${isAdmin ? "登録されたすべての練習記録を表示しています。" : "現在のチームに対応する記録だけを表示しています。"} 削除した記録は、シートの「削除」チェックを外すと再表示されます。完全に消す場合はシートで行を削除してください。</p>
      <div class="records-intro-actions"><button class="secondary" data-action="load-records">↻ 記録を更新</button>${isAdmin ? `<button class="secondary admin-logout" data-action="logout-admin">管理を終了</button>` : ""}</div>
    </section>
    ${isAdmin ? accountManagementView() : ""}
    ${recordsStatus ? `<p class="sheet-status records-status" role="status">${escapeHtml(recordsStatus)}</p>` : ""}
    <section class="record-filters card" aria-label="記録の検索と並び替え">
      <label class="record-search">検索
        <input data-record-filter="query" type="search" value="${escapeHtml(recordFilters.query)}" placeholder="メモ・日付・点数を検索" />
      </label>
      <label>開始日<input data-record-filter="dateFrom" type="date" value="${recordFilters.dateFrom}" /></label>
      <label>終了日<input data-record-filter="dateTo" type="date" value="${recordFilters.dateTo}" /></label>
      <label>最低点<input data-record-filter="minScore" type="number" min="0" max="${MAX_SCORE}" inputmode="numeric" value="${recordFilters.minScore}" placeholder="0" /></label>
      <label>最高点<input data-record-filter="maxScore" type="number" min="0" max="${MAX_SCORE}" inputmode="numeric" value="${recordFilters.maxScore}" placeholder="${MAX_SCORE}" /></label>
      ${isAdmin ? `<label>アカウント<select data-record-filter="account">
        <option value="ALL" ${recordFilters.account === "ALL" ? "selected" : ""}>すべて</option>
        ${managedAccounts.map((account) => `<option value="${account.id}" ${recordFilters.account === account.id ? "selected" : ""}>${escapeHtml(account.name)}</option>`).join("")}
      </select></label>` : ""}
      <label>並び順<select data-record-filter="sort">
        <option value="newest" ${recordFilters.sort === "newest" ? "selected" : ""}>新しい順</option>
        <option value="oldest" ${recordFilters.sort === "oldest" ? "selected" : ""}>古い順</option>
        <option value="score-desc" ${recordFilters.sort === "score-desc" ? "selected" : ""}>得点が高い順</option>
        <option value="score-asc" ${recordFilters.sort === "score-asc" ? "selected" : ""}>得点が低い順</option>
      </select></label>
      <div class="record-filter-actions">
        <button class="primary" data-action="apply-record-filters">検索・絞り込み</button>
        <button class="secondary" data-action="reset-record-filters">条件をクリア</button>
      </div>
      <strong class="record-filter-count">${visibleRecords.length} / ${filteredRecords.length}件を表示（全${practiceRecords.length}件）</strong>
    </section>
    <section class="records-list">
      ${filteredRecords.length ? visibleRecords.map((record) => `
        <article class="record-card card">
          <div><p>${formatRecordDate(record.recordedAt)}${isAdmin ? `　<span class="record-account">${escapeHtml(record.accountName || record.account)}</span>` : ""}</p><h2>競技時間 ${formatTime(record.timeSeconds)}</h2><span>${record.notes ? escapeHtml(record.notes) : "ミッション別の採点記録"}</span></div>
          <strong>${record.total}<small> / ${MAX_SCORE}点</small></strong>
          ${record.unjudged ? `<em>未判定 ${record.unjudged}項目</em>` : `<em class="complete">判定済み</em>`}
          ${record.hasVideo ? `<button class="record-video" data-action="play-record-video" data-record-account="${record.account}" data-record-row="${record.rowNumber}" data-recorded-at="${escapeHtml(record.recordedAt)}">▶ 動画を見る</button>` : ""}
          <button class="record-delete" data-action="delete-record" data-record-account="${record.account}" data-record-row="${record.rowNumber}" data-recorded-at="${escapeHtml(record.recordedAt)}">この記録を削除</button>
        </article>`).join("") : `<div class="empty-state card"><strong>${practiceRecords.length ? "条件に一致する記録がありません" : "まだ記録がありません"}</strong><p>${practiceRecords.length ? "検索条件を変更してください。" : "採点結果から最初の記録を保存してください。"}</p></div>`}
      ${visibleRecords.length < filteredRecords.length ? `<button class="secondary records-more" data-action="show-more-records">さらに${Math.min(RECORD_PAGE_SIZE, filteredRecords.length - visibleRecords.length)}件表示</button>` : ""}
    </section>
  `, { back: "score", title: isAdmin ? "管理" : `${escapeHtml(activeAccountName || "チーム")}の記録` });
}

function filteredPracticeRecords() {
  const query = recordFilters.query.trim().toLowerCase();
  const dateFrom = recordFilters.dateFrom ? new Date(`${recordFilters.dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const dateTo = recordFilters.dateTo ? new Date(`${recordFilters.dateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  const minScore = recordFilters.minScore === "" ? 0 : Math.max(0, Number(recordFilters.minScore));
  const maxScore = recordFilters.maxScore === "" ? MAX_SCORE : Math.min(MAX_SCORE, Number(recordFilters.maxScore));
  return practiceRecords.filter((record) => {
    const recordedAt = new Date(record.recordedAt).getTime();
    const searchable = `${record.account} ${record.accountName} ${record.notes} ${formatRecordDate(record.recordedAt)} ${record.total}`.toLowerCase();
    const accountMatches = activeAccount !== "ADMIN" || recordFilters.account === "ALL" || record.account === recordFilters.account;
    return accountMatches && recordedAt >= dateFrom && recordedAt <= dateTo && record.total >= minScore && record.total <= maxScore && (!query || searchable.includes(query));
  }).sort((left, right) => {
    if (recordFilters.sort === "oldest") return new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime();
    if (recordFilters.sort === "score-desc") return right.total - left.total;
    if (recordFilters.sort === "score-asc") return left.total - right.total;
    return new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime();
  });
}

function updateRecordFiltersFromInputs() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-record-filter]").forEach((input) => {
    const key = input.dataset.recordFilter as keyof RecordFilters;
    if (key) (recordFilters[key] as string) = input.value;
  });
}

function resetRecordFilters() {
  recordFilters = { query: "", dateFrom: "", dateTo: "", minScore: "", maxScore: "", account: "ALL", sort: "newest" };
}

function resultRow(label: string, score: number, max: number) {
  return `<div><dt>${label}</dt><dd>${score} <small>/ ${max}</small></dd></div>`;
}

function photoGalleryView() {
  return shell(`
    <section class="page-intro"><p class="eyebrow">公式ルール掲載例</p><h1>判定写真</h1><p>見たいミッションを選んでください。写真は端末に保存され、オフラインでも確認できます。</p></section>
    <div class="gallery-grid">${Object.entries(judgingGroups).map(([key, group]) => `
      <button class="gallery-card" data-photos="${key}">
        <img src="${group.photos[0].src}" alt="" loading="lazy" decoding="async" /><span><strong>${group.title.replace("の判定写真", "")}</strong><small>${group.photos.length}枚の判定例</small></span>
      </button>`).join("")}</div>
  `, { back: "score", title: "判定写真" });
}

function rulesView() {
  const useDriveViewer = isAppleTouchDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const viewerUrl = useDriveViewer ? RULES_DRIVE_PREVIEW_URL : `${RULES_PDF_URL}#page=1&zoom=page-width`;
  return shell(`
    <section class="page-intro rules-intro">
      <div><p class="eyebrow">Google翻訳版</p><h1>ルールPDF</h1><p>${useDriveViewer ? "iPad向けの複数ページ対応ビューアで表示しています。上下にスクロールして全ページを確認できます。" : "PDF内の検索ボタン、またはキーボードの Ctrl + F（Macは ⌘ + F）で単語や文字を検索できます。"}</p></div>
      <div class="pdf-actions"><button class="primary pdf-open" data-action="pdf-expand">⛶ 全画面表示</button><a class="secondary pdf-open" href="${useDriveViewer ? GOOGLE_TRANSLATED_RULES_URL : RULES_PDF_URL}" target="_blank" rel="noopener">別画面で開く</a></div>
    </section>
    <section class="pdf-viewer card">
      <button class="pdf-collapse" data-action="pdf-collapse" aria-label="PDFの全画面表示を終了">× 全画面解除</button>
      <iframe src="${viewerUrl}" loading="lazy" allow="fullscreen" title="WRO 2026 RoboMission Junior Google翻訳版ルールPDF"></iframe>
      <p>${useDriveViewer ? `通信できない場合は、<a href="${RULES_PDF_URL}" target="_blank" rel="noopener">端末内PDFを開く</a>を押してください。` : `この端末でPDFが表示されない場合は、<a href="${RULES_PDF_URL}" target="_blank" rel="noopener">別画面で開く</a>を押してください。`}</p>
    </section>
  `, { back: "score", title: "ルール" });
}

function linksView() {
  return shell(`
    <section class="page-intro links-intro">
      <p class="eyebrow">RELATED LINKS</p>
      <h1>関連リンク</h1>
      <p>WROの公式情報、ルール、関連動画、このアプリの公開先をまとめています。</p>
    </section>
    <section class="link-groups">
      ${linkGroup("WRO ホームページ", [
        ["WRO Japan", "2026年シーズンの国内情報", "https://www.wroj.org/action/2026"],
        ["WRO 国際", "World Robot Olympiad公式サイト", "https://wro-association.org/"],
        ["WRO兵庫", "兵庫地区の大会・予選会情報", "https://wro-hyogo.jp/"],
      ])}
      ${linkGroup("ルール関連", [
        ["Google翻訳", "RoboMission JuniorルールのGoogle翻訳版", GOOGLE_TRANSLATED_RULES_URL],
        ["世界大会ルール", "RoboMission Juniorの世界大会ルール", WORLD_RULES_URL],
        ["Q&A", "WRO国際サイトの質問・回答", "https://wro-association.org/competition/questions-answers/"],
      ])}
      ${linkGroup("その他", [
        ["YouTube関連動画", "RoboMission関連動画の再生リスト", "https://youtube.com/playlist?list=PL5-Hc8xo0J3ns_WHhwGI-AxDOyEL9-l2O&si=YglnMNN6SpMbn9AN"],
        ["GitHubリポジトリ", "アプリのソースコード", "https://github.com/ecleaire/ROBOMISSION_POINTToul.git"],
      ])}
      <article class="link-section card qr-section">
        <h2>公開URL QRコード</h2>
        <a class="public-qr" href="${PUBLIC_APP_URL}" target="_blank" rel="noopener noreferrer">
          <img src="${import.meta.env.BASE_URL}assets/robomission-public-url-qr.png" alt="RoboMission Assist 公開URL QRコード" loading="lazy" decoding="async" />
          <span><strong>RoboMission Assist</strong><small>${PUBLIC_APP_URL}</small></span>
        </a>
      </article>
      <article class="link-section card credits-section">
        <h2>ライセンス / クレジット</h2>
        <p>採点条件・ルール・判定写真は、World Robot Olympiad Association Ltd.が公開するWRO 2026 RoboMission Juniorの資料を参照しています。ルール本文と画像の権利は各権利者に帰属します。</p>
        <p>WROおよびWROロゴはWorld Robot Olympiad Association Ltd.の商標です。正式な情報と判定はWRO公式サイトおよび各大会の案内を確認してください。</p>
        <p><strong>開発：</strong>ecleaire　<strong>開発支援：</strong>OpenAI ChatGPT / Codex</p>
      </article>
    </section>
  `, { back: "score", title: "リンク" });
}

function linkGroup(title: string, links: [string, string, string][]) {
  return `<article class="link-section card">
    <h2>${escapeHtml(title)}</h2>
    <div class="resource-links">${links.map(([label, description, href]) => `
      <a href="${href}" target="_blank" rel="noopener noreferrer">
        <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span><b aria-hidden="true">↗</b>
      </a>`).join("")}
    </div>
  </article>`;
}

function modalView() {
  if (!modal) return "";
  const group = judgingGroups[modal.group];
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="photo-modal" role="dialog" aria-modal="true" aria-label="${group.title}">
      <header><div><strong>${group.title}</strong><small>${group.photos.length}件の判定例を一覧表示</small></div><button class="icon-button" data-action="close-modal" aria-label="閉じる">×</button></header>
      <div class="photo-matrix">
        ${group.photos.map((photo) => `<article class="photo-example">
          <img src="${photo.src}" alt="${escapeHtml(photo.description)}" loading="lazy" decoding="async" />
          <div><span class="photo-label ${photo.label === "満点" ? "full" : photo.label === "部分点" ? "partial" : photo.score === "0点" ? "zero" : "info"}">${photo.score}</span><strong>${photo.label}</strong><p>${escapeHtml(photo.description)}</p></div>
        </article>`).join("")}
      </div>
    </section>
  </div>`;
}

function recordVideoModalView() {
  if (!recordVideoModal) return "";
  return `<div class="modal-backdrop" data-action="close-record-video">
    <section class="record-video-modal card" role="dialog" aria-modal="true" aria-label="記録動画">
      <header><div><strong>記録動画</strong><small>${escapeHtml(recordVideoModal.name)}</small></div><button class="icon-button" data-action="close-record-video" aria-label="閉じる">×</button></header>
      <video src="${recordVideoModal.url}" controls playsinline preload="metadata"></video>
    </section>
  </div>`;
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) =>
    element.addEventListener("click", () => {
      const target = element.dataset.nav!;
      if (target === "result" && videoRecordingStatus !== "idle") {
        videoSelectionError = "録画を停止して動画の処理が完了してから、結果を開いてください。";
        render();
        return;
      }
      if ((target === "rules" || target === "links") && !adminModeUnlocked) {
        adminRevealPressCounts[target] += 1;
        if (adminRevealPressCounts[target] >= 10) {
          adminModeUnlocked = true;
          render();
        }
      }
      location.hash = `#/${target}`;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-score-section]").forEach((button) =>
    button.addEventListener("click", () => toggleScore(button)),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-time-part]").forEach((select) =>
    select.addEventListener("change", updateTime),
  );
  document.querySelector<HTMLSelectElement>("[data-dirt-count]")?.addEventListener("change", (event) => {
    const count = Number((event.currentTarget as HTMLSelectElement).value);
    state.dirt = Array.from({ length: 10 }, (_, index) => index < count ? 2 : 0);
    saveState();
    render();
  });
  document.querySelector<HTMLTextAreaElement>("[data-notes]")?.addEventListener("input", (event) => {
    state.notes = (event.currentTarget as HTMLTextAreaElement).value;
    saveState();
  });
  document.querySelector<HTMLInputElement>("[data-video-input]")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    videoSelectionError = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      selectedVideo = null;
      videoSelectionError = "動画ファイルを選択してください。";
    } else if (file.size > MAX_VIDEO_BYTES) {
      selectedVideo = null;
      videoSelectionError = "動画は25MB以下にしてください。";
    } else {
      selectedVideo = file;
    }
    render();
  });
  document.querySelectorAll<HTMLSelectElement>("[data-artifact-color]").forEach((select) =>
    select.addEventListener("change", () => {
      state.artifacts[Number(select.dataset.artifactColor)].color = select.value as ArtifactColor;
      saveState(); render();
    }),
  );
  document.querySelectorAll<HTMLElement>("[data-photos]").forEach((button) =>
    button.addEventListener("click", () => { modal = { group: button.dataset.photos! }; render(); }),
  );
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) =>
    element.addEventListener("click", (event) => {
      if (element.classList.contains("modal-backdrop") && event.target !== element) return;
      handleAction(element.dataset.action!, element);
    }),
  );
  document.querySelector<HTMLInputElement>("#account-key-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loginAccount();
  });
  document.querySelector<HTMLInputElement>("#switch-account-key-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loginAccount(true);
  });
  document.querySelector<HTMLInputElement>("#admin-password-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loginAdmin();
  });
  attachCameraPreview();
}

function toggleScore(button: HTMLButtonElement) {
  const section = button.dataset.scoreSection!;
  const index = Number(button.dataset.scoreIndex);
  const selectedScore = Number(button.dataset.scoreValue);
  const currentScore = section === "artifacts"
    ? state.artifacts[index].score
    : (state[section as keyof Pick<ScoreState, "visitors" | "redTowers" | "yellowTowers" | "dirt" | "bonus">] as Score[])[index];
  updateScore(section, index, currentScore === selectedScore ? 0 : selectedScore as Score);
}

function updateScore(section: string, index: number, score: Score) {
  if (section === "artifacts") state.artifacts[index].score = score;
  else (state[section as keyof Pick<ScoreState, "visitors" | "redTowers" | "yellowTowers" | "dirt" | "bonus">] as Score[])[index] = score;
  saveState(); render();
}

function updateTime() {
  const minutes = document.querySelector<HTMLSelectElement>('[data-time-part="minutes"]')?.value ?? "";
  const seconds = Number(document.querySelector<HTMLSelectElement>('[data-time-part="seconds"]')?.value ?? 0);
  const hundredths = Number(document.querySelector<HTMLSelectElement>('[data-time-part="hundredths"]')?.value ?? 0);
  state.timeSeconds = minutes === "" ? null : Number(minutes) * 60 + seconds + hundredths / 100;
  saveState();
}

function handleAction(action: string, element: HTMLElement) {
  if (action === "login-account") void loginAccount();
  if (action === "switch-account") void loginAccount(true);
  if (action === "open-account-switch") { accountError = ""; accountSwitchOpen = true; render(); }
  if (action === "close-account-switch") { accountSwitchOpen = false; accountError = ""; render(); }
  if (action === "login-admin") void loginAdmin();
  if (action === "logout-admin") logoutAdmin();
  if (action === "load-accounts") void loadManagedAccounts();
  if (action === "create-account") void saveManagedAccount();
  if (action === "update-account") void saveManagedAccount(element.dataset.accountId);
  if (action === "load-records") void loadRecords();
  if (action === "apply-record-filters") { updateRecordFiltersFromInputs(); recordVisibleCount = RECORD_PAGE_SIZE; render(); }
  if (action === "reset-record-filters") { resetRecordFilters(); recordVisibleCount = RECORD_PAGE_SIZE; render(); }
  if (action === "show-more-records") { recordVisibleCount += RECORD_PAGE_SIZE; render(); }
  if (action === "delete-record") void deleteRecord(element);
  if (action === "play-record-video") void playRecordVideo(element);
  if (action === "close-record-video") closeRecordVideo();
  if (action === "remove-video") { selectedVideo = null; videoSelectionError = ""; render(); }
  if (action === "camera-start") void startCameraRecording();
  if (action === "camera-stop") stopCameraRecording();
  if (action === "camera-expand") enterCameraFullscreen();
  if (action === "camera-collapse") exitCameraFullscreen();
  if (action === "timer-start") startStopwatch(true);
  if (action === "timer-lap") addStopwatchLap();
  if (action === "timer-pause") pauseStopwatch();
  if (action === "timer-resume") startStopwatch(false);
  if (action === "timer-finish") finishStopwatch();
  if (action === "timer-expand") enterStopwatchFullscreen();
  if (action === "timer-collapse") exitStopwatchFullscreen();
  if (action === "pdf-expand") enterPdfFullscreen();
  if (action === "pdf-collapse") exitPdfFullscreen();
  if (action === "reset" && confirm("入力した採点をすべてリセットしますか？")) { resetStopwatch(); discardVideoRecordingNow(); selectedVideo = null; videoSelectionError = ""; state = makeInitialState(); saveState(); render(); }
  if (action === "new" && confirm("現在の採点を終了して、新しい採点を始めますか？")) { resetStopwatch(); discardVideoRecordingNow(); selectedVideo = null; videoSelectionError = ""; state = makeInitialState(); saveState(); location.hash = "#/score"; }
  if (action === "close-modal") { modal = null; render(); }
  if (action === "send-sheet") void sendToSheet();
}

function enterPdfFullscreen() {
  const viewer = document.querySelector<HTMLElement>(".pdf-viewer");
  if (!viewer) return;
  viewer.classList.add("pdf-viewer-expanded");
  document.body.classList.add("pdf-mode");
  if (!document.fullscreenElement && viewer.requestFullscreen) {
    void viewer.requestFullscreen().catch(() => undefined);
  }
}

function exitPdfFullscreen() {
  const collapse = () => {
    document.body.classList.remove("pdf-mode");
    document.querySelector<HTMLElement>(".pdf-viewer")?.classList.remove("pdf-viewer-expanded");
  };
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined).finally(collapse);
  else collapse();
}

function currentStopwatchElapsed() {
  return stopwatchStatus === "running" ? stopwatchElapsedMs + performance.now() - stopwatchStartedAt : stopwatchElapsedMs;
}

function startStopwatch(reset: boolean) {
  if (reset) {
    stopwatchElapsedMs = 0;
    stopwatchLaps = [];
  }
  stopwatchStartedAt = performance.now();
  stopwatchStatus = "running";
  enterStopwatchFullscreen();
  startStopwatchUpdates();
}

function enterStopwatchFullscreen() {
  const stopwatch = document.querySelector<HTMLElement>(".stopwatch");
  if (!stopwatch) return;
  stopwatch?.classList.add("stopwatch-expanded");
  document.body.classList.add("stopwatch-mode");
  if (!document.fullscreenElement) void stopwatch.requestFullscreen().catch(() => undefined);
  refreshStopwatch();
}

function exitStopwatchFullscreen() {
  const collapse = () => {
    document.body.classList.remove("stopwatch-mode");
    document.querySelector<HTMLElement>(".stopwatch")?.classList.remove("stopwatch-expanded");
    refreshStopwatch();
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined).finally(collapse);
  } else {
    collapse();
  }
}

function pauseStopwatch() {
  stopwatchElapsedMs = currentStopwatchElapsed();
  stopwatchStatus = "paused";
  stopStopwatchUpdates();
  refreshStopwatch();
}

function addStopwatchLap() {
  if (stopwatchStatus !== "running") return;
  stopwatchLaps.push(currentStopwatchElapsed());
  refreshStopwatch();
}

function finishStopwatch() {
  if (stopwatchStatus !== "paused") return;
  state.timeSeconds = secondsFromStopwatch(stopwatchElapsedMs);
  saveState();
  stopwatchStatus = "idle";
  stopStopwatchUpdates();
  const finish = () => {
    document.body.classList.remove("stopwatch-mode");
    if (videoRecordingStatus === "recording") stopCameraRecording();
    else render();
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined).finally(finish);
  } else {
    finish();
  }
}

function refreshStopwatch() {
  const stopwatch = document.querySelector<HTMLElement>(".stopwatch");
  if (!stopwatch) return;
  stopwatch.innerHTML = stopwatchContents();
  stopwatch.querySelectorAll<HTMLElement>("[data-action]").forEach((element) =>
    element.addEventListener("click", () => handleAction(element.dataset.action!, element)),
  );
  const laps = stopwatch.querySelector<HTMLOListElement>(".stopwatch-laps");
  if (laps) laps.scrollTop = laps.scrollHeight;
}

function resetStopwatch() {
  stopwatchStatus = "idle";
  stopwatchElapsedMs = 0;
  stopwatchStartedAt = 0;
  stopwatchLaps = [];
  stopStopwatchUpdates();
  document.body.classList.remove("stopwatch-mode");
  document.querySelector<HTMLElement>(".stopwatch")?.classList.remove("stopwatch-expanded");
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

function startStopwatchUpdates() {
  stopStopwatchUpdates();
  stopwatchTimer = window.setInterval(() => {
    const display = document.querySelector<HTMLElement>("[data-stopwatch-display]");
    if (display) display.textContent = formatStopwatch(currentStopwatchElapsed());
  }, 31);
}

function stopStopwatchUpdates() {
  if (stopwatchTimer === null) return;
  window.clearInterval(stopwatchTimer);
  stopwatchTimer = null;
}

async function sendToSheet() {
  if (sheetSending) return;
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount || !activeApiKey) {
    sheetStatus = "記録先がまだ設定されていません。"; render(); return;
  }
  if (activeAccount === "ADMIN") {
    sheetStatus = "管理アカウントから採点結果は保存できません。"; render(); return;
  }
  sheetSending = true;
  sheetStatus = selectedVideo ? "動画をアップロードして保存中…" : "送信中…"; render();
  try {
    const video = selectedVideo ? await fileToStoredVideo(selectedVideo) : undefined;
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, resultPayload(video), new AbortController(), selectedVideo ? 90000 : 15000);
    if (!result.ok) throw new Error(result.message || "GASで保存できませんでした");
    resetStopwatch();
    selectedVideo = null;
    videoSelectionError = "";
    state = makeInitialState();
    saveState();
    sheetStatus = "";
    location.hash = "#/score";
    render();
    return;
  } catch (error) {
    sheetStatus = `送信できませんでした。${communicationError(error)}`;
  } finally {
    sheetSending = false;
  }
  render();
}

function resultPayload(video?: StoredVideo) {
  const scores = sectionScores(state);
  return {
    apiKey: activeApiKey,
    requestId: pendingRequestId,
    recordedAt: new Date().toISOString(),
    timeSeconds: state.timeSeconds,
    notes: state.notes,
    video,
    ...scores,
    total: totalScore(state),
    unjudged: unjudgedCount(state),
  };
}

function fileToStoredVideo(file: File): Promise<StoredVideo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("動画を読み込めませんでした。"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) return reject(new Error("動画データを変換できませんでした。"));
      resolve({ name: file.name, type: file.type, size: file.size, base64: result.slice(separator + 1) });
    };
    reader.readAsDataURL(file);
  });
}

async function loginAccount(fromSwitch = false) {
  const input = document.querySelector<HTMLInputElement>(fromSwitch ? "#switch-account-key-input" : "#account-key-input");
  const remember = document.querySelector<HTMLInputElement>(fromSwitch ? "#remember-switch-account-input" : "#remember-account-input")?.checked ?? false;
  const key = input?.value.trim() ?? "";
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!key || !endpoint) {
    accountError = !key ? "APIキーを入力してください。" : "記録先がまだ設定されていません。";
    render();
    return;
  }
  accountError = "確認中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; account?: string; accountName?: string; message?: string }>(endpoint, { action: "auth", apiKey: key });
    const verifiedAccount = result.account ?? null;
    if (!result.ok || !isAccountKey(verifiedAccount)) throw new Error(result.message || "APIキーが違います。");
    if (verifiedAccount === "ADMIN") {
      if (remember) {
        localStorage.setItem(ACCOUNT_KEY, "ADMIN");
        localStorage.setItem(API_KEY_KEY, key);
      } else {
        localStorage.removeItem(ACCOUNT_KEY);
        localStorage.removeItem(API_KEY_KEY);
      }
      activeAccount = "ADMIN";
      activeApiKey = key;
      activeAccountName = "";
      adminModeUnlocked = true;
      adminError = "";
      accountError = "";
      accountSwitchOpen = false;
      managedAccounts = [];
      practiceRecords = [];
      recordsStatus = "";
      resetRecordFilters();
      resetStopwatch();
      const routeChanged = location.hash !== "#/admin";
      location.hash = "#/admin";
      render();
      if (!routeChanged) { void loadRecords(); void loadManagedAccounts(); }
      return;
    }
    activeAccount = verifiedAccount;
    activeApiKey = key;
    activeAccountName = typeof result.accountName === "string" ? result.accountName.slice(0, 50) : "";
    if (remember) {
      localStorage.setItem(ACCOUNT_KEY, activeAccount);
      localStorage.setItem(API_KEY_KEY, key);
    } else {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(API_KEY_KEY);
    }
    accountError = "";
    accountSwitchOpen = false;
    practiceRecords = [];
    recordsStatus = "";
    resetStopwatch();
    state = loadState();
    location.hash = "#/score";
    render();
  } catch (error) {
    accountError = error instanceof Error ? error.message : "APIキーを確認できませんでした。";
    render();
  }
}

async function loginAdmin() {
  const input = document.querySelector<HTMLInputElement>("#admin-password-input");
  const password = input?.value ?? "";
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!password || !endpoint) {
    adminError = !password ? "管理者パスワードを入力してください。" : "記録先がまだ設定されていません。";
    render();
    return;
  }
  adminError = "確認中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; account?: string; message?: string }>(endpoint, { action: "auth", apiKey: password });
    if (!result.ok || result.account !== "ADMIN") throw new Error(result.message || "管理者パスワードが違います。");
    activeAccount = "ADMIN";
    activeApiKey = password;
    adminError = "";
    practiceRecords = [];
    resetRecordFilters();
    recordsStatus = "";
    resetStopwatch();
    const routeChanged = location.hash !== "#/admin";
    location.hash = "#/admin";
    render();
    if (!routeChanged) { void loadRecords(); void loadManagedAccounts(); }
  } catch (error) {
    adminError = error instanceof Error ? error.message : "管理者パスワードを確認できませんでした。";
    render();
  }
}

function logoutAdmin() {
  const storedAccount = loadAccount();
  if (storedAccount === "ADMIN") {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(API_KEY_KEY);
    activeAccount = null;
    activeApiKey = null;
  } else {
    activeAccount = storedAccount;
    activeApiKey = localStorage.getItem(API_KEY_KEY) || activeAccount;
  }
  activeAccountName = "";
  adminModeUnlocked = false;
  managedAccounts = [];
  practiceRecords = [];
  recordsStatus = "";
  adminError = "";
  resetRecordFilters();
  state = loadState();
  location.hash = activeAccount ? "#/score" : "#/account";
  render();
  if (activeAccount && activeApiKey) void refreshAccountIdentity();
}

async function refreshAccountIdentity() {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeApiKey || activeAccount === "ADMIN") return;
  try {
    const result = await postJson<{ ok?: boolean; account?: string; accountName?: string }>(endpoint, { action: "auth", apiKey: activeApiKey });
    if (!result.ok || result.account !== activeAccount) return;
    activeAccountName = typeof result.accountName === "string" ? result.accountName.slice(0, 50) : "";
    render();
  } catch {
    // Offline use remains available; the private team name is simply not shown.
  }
}

async function loadManagedAccounts() {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || activeAccount !== "ADMIN" || !activeApiKey) return;
  accountManagementStatus = "アカウント情報を読み込み中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; accounts?: ManagedAccount[]; message?: string }>(endpoint, { action: "accounts", apiKey: activeApiKey });
    if (!result.ok) throw new Error(result.message || "アカウント情報を取得できませんでした");
    managedAccounts = sanitizeManagedAccounts(result.accounts);
    accountManagementStatus = `${managedAccounts.length}件のアカウントを管理中`;
  } catch (error) {
    accountManagementStatus = `読み込めませんでした。${communicationError(error)}`;
  }
  render();
}

async function saveManagedAccount(accountId?: string) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || activeAccount !== "ADMIN" || !activeApiKey) return;
  const nameInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-name="${accountId}"]` : "#new-account-name");
  const keyInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-key="${accountId}"]` : "#new-account-key");
  const name = nameInput?.value.trim() ?? "";
  const newApiKey = keyInput?.value.trim() ?? "";
  if (!name || (!accountId && newApiKey.length < 4)) {
    accountManagementStatus = !name ? "チーム名を入力してください。" : "APIキーは4文字以上にしてください。";
    render();
    return;
  }
  accountManagementStatus = accountId ? "変更を保存中…" : "アカウントを追加中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; accounts?: ManagedAccount[]; message?: string }>(endpoint, {
      action: "saveAccount", apiKey: activeApiKey, accountId: accountId || "", name, newApiKey,
    });
    if (!result.ok) throw new Error(result.message || "アカウントを保存できませんでした");
    managedAccounts = sanitizeManagedAccounts(result.accounts);
    accountManagementStatus = accountId ? "チーム名・APIキー設定を更新しました。" : "アカウントを追加しました。";
    await loadRecords();
  } catch (error) {
    accountManagementStatus = `保存できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
    render();
  }
}

async function loadRecords() {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount || !activeApiKey) {
    recordsStatus = "記録先がまだ設定されていません。";
    render();
    return;
  }
  recordsStatus = "読み込み中…";
  render();
  recordsAbortController?.abort();
  const controller = new AbortController();
  recordsAbortController = controller;
  try {
    const result = await postJson<{ ok?: boolean; records?: PracticeRecord[]; message?: string }>(endpoint, { action: "records", apiKey: activeApiKey }, controller);
    if (!result.ok) throw new Error(result.message || "記録を取得できませんでした");
    practiceRecords = sanitizePracticeRecords(result.records);
    recordVisibleCount = RECORD_PAGE_SIZE;
    recordsStatus = practiceRecords.length ? `${practiceRecords.length}件の記録を表示中` : "記録はまだありません。";
  } catch (error) {
    if (controller.signal.aborted && recordsAbortController !== controller) return;
    recordsStatus = `記録を読み込めませんでした。${communicationError(error)}`;
  } finally {
    if (recordsAbortController === controller) recordsAbortController = null;
  }
  render();
}

async function deleteRecord(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const rowNumber = Number(element.dataset.recordRow);
  const recordedAt = element.dataset.recordedAt ?? "";
  const recordAccount = element.dataset.recordAccount ?? activeAccount ?? "";
  if (!endpoint || !activeAccount || !activeApiKey || !Number.isInteger(rowNumber) || rowNumber < 2) return;
  if (!confirm(`${formatRecordDate(recordedAt)}の記録を削除しますか？\nスプレッドシートでは「削除」にチェックが入り、赤い行で保管されます。`)) return;
  recordsStatus = "削除中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, { action: "delete", apiKey: activeApiKey, account: recordAccount, rowNumber, recordedAt });
    if (!result.ok) throw new Error(result.message || "記録を削除できませんでした");
    await loadRecords();
  } catch (error) {
    recordsStatus = `削除できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
    render();
  }
}

async function playRecordVideo(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const rowNumber = Number(element.dataset.recordRow);
  const recordedAt = element.dataset.recordedAt ?? "";
  const recordAccount = element.dataset.recordAccount ?? activeAccount ?? "";
  if (!endpoint || !activeAccount || !activeApiKey || !Number.isInteger(rowNumber) || rowNumber < 2) return;
  recordsStatus = "動画を読み込み中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; video?: StoredVideo; message?: string }>(endpoint, {
      action: "video", apiKey: activeApiKey, account: recordAccount, rowNumber, recordedAt,
    }, new AbortController(), 90000);
    if (!result.ok || !result.video) throw new Error(result.message || "動画を取得できませんでした");
    const video = result.video;
    if (!video.type.startsWith("video/") || video.size <= 0 || video.size > MAX_VIDEO_BYTES || !video.base64) {
      throw new Error("動画データが無効です。");
    }
    closeRecordVideo(false);
    recordVideoModal = { url: URL.createObjectURL(base64ToBlob(video.base64, video.type)), name: video.name };
    recordsStatus = `${practiceRecords.length}件の記録を表示中`;
  } catch (error) {
    recordsStatus = `動画を読み込めませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
  }
  render();
}

function closeRecordVideo(shouldRender = true) {
  if (recordVideoModal) URL.revokeObjectURL(recordVideoModal.url);
  recordVideoModal = null;
  if (shouldRender) render();
}

function base64ToBlob(base64: string, type: string) {
  if (base64.length > Math.ceil(MAX_VIDEO_BYTES * 4 / 3) + 8) throw new Error("動画データが大きすぎます。");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function saveState() {
  if (!activeAccount) return;
  state.updatedAt = new Date().toISOString();
  pendingRequestId = createRequestId();
  localStorage.setItem(scoreStorageKey(), JSON.stringify(state));
}

function loadState(): ScoreState {
  try {
    return sanitizeScoreState(JSON.parse(activeAccount ? localStorage.getItem(scoreStorageKey()) || "null" : "null"));
  } catch { return makeInitialState(); }
}

async function postJson<T>(endpoint: string, payload: unknown, controller = new AbortController(), timeoutMs = 15000): Promise<T> {
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function communicationError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    ? "通信がタイムアウトしました。通信状態を確認して、もう一度お試しください。"
    : `通信状態またはGASの公開設定を確認してください（${error instanceof Error ? error.message : "通信エラー"}）。`;
}

function sanitizePracticeRecords(value: unknown): PracticeRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((record): record is PracticeRecord => {
    if (!record || typeof record !== "object") return false;
    const candidate = record as Partial<PracticeRecord>;
    return typeof candidate.account === "string" && isAccountKey(candidate.account) && candidate.account !== "ADMIN" &&
      (candidate.accountName === undefined || typeof candidate.accountName === "string") &&
      Number.isInteger(candidate.rowNumber) && Number(candidate.rowNumber) >= 2 &&
      typeof candidate.recordedAt === "string" && Number.isFinite(new Date(candidate.recordedAt).getTime()) &&
      typeof candidate.total === "number" && Number.isFinite(candidate.total) && candidate.total >= 0 && candidate.total <= MAX_SCORE &&
      typeof candidate.hasVideo === "boolean";
  });
}

function sanitizeManagedAccounts(value: unknown): ManagedAccount[] {
  if (!Array.isArray(value)) return [];
  return value.filter((account): account is ManagedAccount => {
    if (!account || typeof account !== "object") return false;
    const candidate = account as Partial<ManagedAccount>;
    return typeof candidate.id === "string" && isAccountKey(candidate.id) && candidate.id !== "ADMIN" &&
      typeof candidate.name === "string" && candidate.name.length > 0 && candidate.name.length <= 50 &&
      typeof candidate.legacy === "boolean" && typeof candidate.hasApiKey === "boolean";
  });
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadAccount(): AccountKey | null {
  const key = localStorage.getItem(ACCOUNT_KEY);
  return isAccountKey(key) ? key : null;
}

function loadApiKey() { return localStorage.getItem(API_KEY_KEY) || loadAccount(); }
function isAccountKey(value: string | null): value is AccountKey { return typeof value === "string" && (value === "ADMIN" || /^[A-Z0-9_]{1,32}$/.test(value)); }
function scoreStorageKey() { return `${STORAGE_KEY}-${activeAccount ?? "none"}`; }
function formatTime(seconds: number | null) {
  if (seconds === null) return "未入力";
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const remaining = centiseconds % 6000;
  return `${minutes}:${String(Math.floor(remaining / 100)).padStart(2, "0")}.${String(remaining % 100).padStart(2, "0")}`;
}
function formatRecordDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function formatFileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
function colorLabel(color: string) { return artifactColors.find((item) => item.value === color)?.label ?? color; }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
