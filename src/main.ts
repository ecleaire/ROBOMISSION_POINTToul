import "./style.css";
import { DEFAULT_GAS_WEB_APP_URL } from "./config";
import { isAppleTouchDevice } from "./device";
import { judgingGroups } from "./judging";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";
import { APP_VERSION } from "./version";
import {
  boardPoint,
  boardElementBounds,
  cloneCourtBoard,
  drawCourtBoard,
  emptyCourtBoard,
  findBoardElement,
  moveBoardElement,
  rotateBoardElement,
  scaleBoardElement,
  sanitizeCourtBoard,
  serializeCourtBoard,
  type BoardElement,
  type BoardTool,
  type CourtBoard,
} from "./courtBoard";
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
  board: CourtBoard;
}

interface FreeMemo {
  account: string;
  accountName: string;
  memoId: string;
  createdAt: string;
  updatedAt: string;
  content: string;
  board: CourtBoard;
}

interface BoardEditorState {
  target: { kind: "free" | "record" | "score"; memoId?: string; account: string; rowNumber?: number; recordedAt?: string };
  board: CourtBoard;
  tool: BoardTool;
  color: string;
  undo: CourtBoard[];
  redo: CourtBoard[];
  drawing: BoardElement | null;
  pointerId: number | null;
  selectedIndex: number;
  transform: {
    mode: "move" | "resize" | "rotate";
    index: number;
    startX: number;
    startY: number;
    startDistance: number;
    startAngle: number;
    original: BoardElement;
    changed: boolean;
  } | null;
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

interface NewsItem {
  source: string;
  title: string;
  url: string;
  updatedAt: string;
}

type RulesDocument = "translated" | "general" | "hyogo";

interface PendingVideoUpload {
  file: File;
  apiKey: string;
  account: string;
  rowNumber: number;
  recordedAt: string;
  status: "uploading" | "failed";
  message: string;
}

const RULES_PDF_URL = `${import.meta.env.BASE_URL}assets/rules/WRO-2026-Junior-Google-Translate-JA.pdf`;
const RULES_DRIVE_PREVIEW_URL = "https://drive.google.com/file/d/1pDAgqy-Of24bbA4MeKslJ9SWUc-vH1zU/preview";
const PUBLIC_APP_URL = "https://ecleaire.github.io/ROBOMISSION_POINTToul/";
const PUBLIC_RULES_PDF_URL = `${PUBLIC_APP_URL}assets/rules/WRO-2026-Junior-Google-Translate-JA.pdf`;
const RULES_GOOGLE_VIEWER_URL = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(PUBLIC_RULES_PDF_URL)}`;
const GOOGLE_TRANSLATED_RULES_URL = "https://drive.google.com/file/d/1pDAgqy-Of24bbA4MeKslJ9SWUc-vH1zU/view?usp=sharing";
const GENERAL_TRANSLATED_RULES_URL = "https://drive.google.com/file/d/1ZCRLU9Hyz346ps0kLGW7k1T1-7njKPQL/view?usp=sharing";
const GENERAL_TRANSLATED_RULES_PREVIEW_URL = "https://drive.google.com/file/d/1ZCRLU9Hyz346ps0kLGW7k1T1-7njKPQL/preview";
const WORLD_RULES_URL = "https://drive.google.com/file/d/1OVybBEc3_l8hV7nrjWLtlJUsXoLXGws0/view?usp=sharing";
const HYOGO_LOCAL_RULES_URL = "https://drive.google.com/file/d/1tdMoVbPFivoZVrjN3pIAhV6ZkiQGaDwc/view?usp=drivesdk";
const HYOGO_LOCAL_RULES_PREVIEW_URL = "https://drive.google.com/file/d/1tdMoVbPFivoZVrjN3pIAhV6ZkiQGaDwc/preview";
const COURT_IMAGE_URL = `${import.meta.env.BASE_URL}assets/memo/junior-course.webp`;

const STORAGE_KEY = "robomission-junior-score-v2";
const ACCOUNT_KEY = "robomission-junior-account";
const API_KEY_KEY = "robomission-junior-api-key";
const ACCOUNT_STORAGE_MIGRATION_KEY = "robomission-account-storage-version";
const ACCOUNT_STORAGE_VERSION = "2026-07-15-optional-save-v1";
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_RECORDING_MS = 3 * 60 * 1000;
const VIDEO_RECORDING_BITRATE = 1_000_000;
const RECORD_VIDEO_CACHE_NAME = "robomission-record-videos-v1";
const MAX_CACHED_RECORD_VIDEOS = 3;
const NEWS_CACHE_KEY = "robomission-hyogo-news-v1";
const HYOGO_EVENT_URL = "https://wro-hyogo.jp/2026%E5%B9%B4-%E9%96%8B%E5%82%AC%E6%A6%82%E8%A6%81/";
const HYOGO_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("関西学院初等部 〒665-0844 兵庫県宝塚市武庫川町6番27号")}`;
const HYOGO_MAP_EMBED_URL = `https://www.google.com/maps?q=${encodeURIComponent("関西学院初等部 〒665-0844 兵庫県宝塚市武庫川町6番27号")}&output=embed`;
const FALLBACK_HYOGO_NEWS: NewsItem[] = [
  { source: "兵庫", title: "〖2026〗選手・コーチのみなさまへ", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E9%81%B8%E6%89%8B%E3%83%BB%E3%82%B3%E3%83%BC%E3%83%81%E3%81%AE%E3%81%BF%E3%81%AA%E3%81%95%E3%81%BE%E3%81%B8/", updatedAt: "2026.07.15" },
  { source: "兵庫", title: "〖2026〗大会当日の注意事項について", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E5%A4%A7%E4%BC%9A%E5%BD%93%E6%97%A5%E3%81%AE%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/", updatedAt: "2026.07.08" },
  { source: "兵庫", title: "〖2026〗ルール補足とローカルルールについて", url: "https://wro-hyogo.jp/%E3%80%902026%E3%80%91%E3%83%AB%E3%83%BC%E3%83%AB%E8%A3%9C%E8%B6%B3%E3%81%A8%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E3%83%AB%E3%83%BC%E3%83%AB%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/", updatedAt: "2026.06.27" },
];
// 軽量化のため公開版には最新3件だけ保持し、追加時は最古の1件を削除する。
const APP_UPDATES = [
  { version: "1.4.4", updatedAt: "2026.07.17", title: "General Rules・採点コートメモを追加", description: "3種類のルールPDF切替と、採点中の文章メモへコート画像を書き込んで結果と一緒に保存する機能を追加しました。" },
  { version: "1.4.3", updatedAt: "2026.07.17", title: "ニュース内ボタンの画面遷移を修正", description: "「大会情報」「アプリ更新内容」を押した時に採点へ戻らず、ニュース内の該当位置へ移動するよう修正しました。" },
  { version: "1.4.2", updatedAt: "2026.07.17", title: "メモ・ルール・大会情報を改善", description: "コート操作ボタンのはみ出しを修正し、兵庫予選会PDFのアプリ内切替表示と会場ミニマップを追加しました。" },
] as const;

if (localStorage.getItem(ACCOUNT_STORAGE_MIGRATION_KEY) !== ACCOUNT_STORAGE_VERSION) {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(API_KEY_KEY);
  localStorage.setItem(ACCOUNT_STORAGE_MIGRATION_KEY, ACCOUNT_STORAGE_VERSION);
}

const app = document.querySelector<HTMLDivElement>("#app")!;
let activeAccount: string | null = loadAccount();
let activeApiKey = loadApiKey();
let activeAccountName = "";
let state = loadState();
let modal: { group: string } | null = null;
let accountSwitchOpen = false;
let accountSwitchDraft = "";
let accountSwitchRemember = false;
let sheetStatus = "";
let accountError = "";
let recordsStatus = "";
let practiceRecords: PracticeRecord[] = [];
let freeMemos: FreeMemo[] = [];
let freeMemoStatus = "";
let newFreeMemoBoard = emptyCourtBoard();
let boardEditor: BoardEditorState | null = null;
const RECORD_PAGE_SIZE = 50;
let recordVisibleCount = RECORD_PAGE_SIZE;
let recordsAbortController: AbortController | null = null;
let recordsAutoRefreshTimer: number | null = null;
let newsItems = loadNewsCache();
let newsStatus = "保存済みのお知らせを表示しています。";
let newsLoading = false;
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
let rulesConnectionsPrepared = false;
let activeRulesDocument: RulesDocument = "translated";
const persistentRulesFrames: Partial<Record<RulesDocument, HTMLIFrameElement>> = {};
let rulesFrameParking: HTMLDivElement | null = null;
let cameraStream: MediaStream | null = null;
let cameraPreviewPlaceholder: Comment | null = null;
let videoRecorder: MediaRecorder | null = null;
let videoChunks: Blob[] = [];
let videoRecordingBytes = 0;
let videoRecordingStartedAt = 0;
let videoRecordingStatus: "idle" | "starting" | "recording" | "processing" = "idle";
let videoRecordingTimer: number | null = null;
let videoRecordingLimitTimer: number | null = null;
let discardRecordedVideo = false;
let pendingVideoUpload: PendingVideoUpload | null = null;
let systemNotice = "";
if (!activeAccount) void clearRecordVideoCache();
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
  configureRecordsAutoRefresh();
  if (location.hash === "#/admin" && activeAccount === "ADMIN") { void loadRecords(); void loadManagedAccounts(); }
  if (location.hash === "#/news") void loadHyogoNews();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && location.hash === "#/records" && activeAccount) void loadRecords();
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action="camera-expand"]') : null;
  if (!target) return;
  event.preventDefault();
  enterCameraFullscreen(true);
}, { capture: true });
window.addEventListener("keydown", (event) => {
  if (boardEditor && event.key === "Escape") { closeCourtBoard(); return; }
  if (!modal && !accountSwitchOpen) return;
  if (event.key !== "Escape") return;
  modal = null;
  accountSwitchOpen = false;
  render();
});
function handleFullscreenChange() {
  if (activeFullscreenElement()) return;
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
    collapseCameraFullscreen();
  }
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const reloadKey = `robomission-sw-reloaded-${APP_VERSION}`;
    if (videoRecordingStatus !== "idle" || sessionStorage.getItem(reloadKey)) return;
    sessionStorage.setItem(reloadKey, "1");
    location.reload();
  });
  window.addEventListener("load", () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => registration.update())
      .catch(() => undefined),
  );
}

if (activeAccount === "ADMIN") location.hash = "#/admin";
else if (!location.hash) location.hash = "#/score";
render();
configureRecordsAutoRefresh();
if (location.hash === "#/admin" && activeAccount === "ADMIN") { void loadRecords(); void loadManagedAccounts(); }
if (location.hash === "#/news" && activeAccount) void loadHyogoNews();
if (activeAccount && activeAccount !== "ADMIN" && activeApiKey) void refreshAccountIdentity();

function render() {
  parkRulesFrame();
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
        : route === "memo"
          ? memoView()
        : route === "photos"
          ? photoGalleryView()
        : route === "news"
          ? newsView()
          : route === "rules"
            ? rulesView()
            : route === "links"
              ? linksView()
            : scoringView();

  app.innerHTML = `${content}${systemNoticeView()}${modal ? modalView() : ""}${accountSwitchOpen ? accountSwitchModal() : ""}${recordVideoModal ? recordVideoModalView() : ""}`;
  bindEvents();
  attachRulesFrame();
  renderCourtBoardPreviews();
}

function systemNoticeView() {
  if (pendingVideoUpload) {
    return `<aside class="system-notice ${pendingVideoUpload.status === "failed" ? "error" : ""}" role="status">
      <span>${escapeHtml(pendingVideoUpload.message)}</span>
      ${pendingVideoUpload.status === "failed" ? `<button data-action="retry-video-upload">動画を再送</button>` : ""}
    </aside>`;
  }
  return systemNotice ? `<aside class="system-notice" role="status"><span>${escapeHtml(systemNotice)}</span></aside>` : "";
}

function shell(content: string, options: { back?: string; title?: string } = {}) {
  const route = location.hash.replace(/^#\/?/, "") || "score";
  const activeRoute = route === "result" ? "score" : route;
  const modes: string[][] = [
    ["score", "採点"],
    ["photos", "判定写真"],
    ["records", "練習記録"],
    ["memo", "メモ"],
    ["news", "ニュース"],
    ["rules", "ルール"],
    ["links", "リンク・大会情報"],
  ];
  if (adminModeUnlocked || activeAccount === "ADMIN") modes.push(["admin", "管理"]);
  return `
    <header class="app-header">
      <div class="app-brand">
        <div><p>WRO 2026 / ROBOMISSION</p><strong>RoboMission Assist <small class="version-badge">v${APP_VERSION}</small></strong></div>
        <span class="current-mode">${options.title ?? "RoboMission Junior"}</span>
        ${activeAccount ? `<div class="account-switch ${activeAccount === "ADMIN" ? "admin-account-switch" : ""}"><span>${activeAccount === "ADMIN" ? "管理モード" : escapeHtml(activeAccountName || "アカウント")}</span><button type="button" data-action="open-account-switch">切替</button></div>` : ""}
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
    <form class="account-switch-modal card" data-account-switch-form role="dialog" aria-modal="true" aria-label="アカウントを切り替える">
      <header><div><strong>アカウントを切り替える</strong><small>チーム名はAPIキー確認後に表示されます</small></div><button class="icon-button" type="button" data-action="close-account-switch" aria-label="閉じる">×</button></header>
      <label>APIキー<input id="switch-account-key-input" type="password" maxlength="128" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" inputmode="text" value="${escapeHtml(accountSwitchDraft)}" placeholder="切り替えるアカウントのAPIキー" /></label>
      <label class="remember-account"><input id="remember-switch-account-input" type="checkbox" ${accountSwitchRemember ? "checked" : ""} /><span>この端末にアカウント情報を保存する</span></label>
      ${accountError ? `<p class="warning" role="alert">${escapeHtml(accountError)}</p>` : ""}
      <button class="primary" type="submit">このアカウントへ切り替える</button>
    </form>
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
        <label>新しいAPIキー<input data-managed-key="${account.id}" type="password" maxlength="128" autocomplete="new-password" placeholder="変更しない場合は空欄" /></label>
        <button class="primary" data-action="update-account" data-account-id="${account.id}">変更を保存</button>
      </article>`).join("") || `<p class="empty-account-list">アカウント情報を読み込んでいます…</p>`}
    </div>
    <div class="new-managed-account">
      <h3>新しいアカウントを追加</h3>
      <label>チーム名<input id="new-account-name" maxlength="50" placeholder="チーム名" /></label>
      <label>APIキー<input id="new-account-key" type="password" maxlength="128" autocomplete="new-password" placeholder="APIキー" /></label>
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
        <section class="score-memo-card" aria-label="採点メモ">
          <label class="notes-card">メモ<textarea data-notes rows="2" maxlength="500" placeholder="ミスした部分や次回の注意点">${escapeHtml(state.notes)}</textarea></label>
          ${courtBoardView("score", "", "", 0, "", state.board)}
        </section>
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
      ${cameraStream ? `<button type="button" class="camera-expand" data-action="camera-expand" aria-label="カメラ映像を全画面表示">⛶ 全画面</button>
        <button type="button" class="camera-collapse" data-action="camera-collapse" aria-label="カメラ映像の全画面表示を解除">× 全画面解除</button>
        ${isRecording ? `<div class="camera-stopwatch-overlay" data-camera-stopwatch-overlay>${cameraStopwatchContents()}</div>` : ""}
        ${isRecording ? `<button type="button" class="camera-overlay-stop" data-action="camera-stop">■ 録画停止</button>` : ""}` : ""}
    </div>
    <div class="camera-recorder-info"><strong>動画録画</strong><small>音声なし・最長3分。録画中もストップウォッチを操作できます。</small></div>
    <div class="camera-recorder-actions">
      ${cameraStream ? `<button type="button" class="camera-main-expand" data-action="camera-expand">⛶ カメラを全画面</button>` : ""}
      ${isRecording
        ? `<button type="button" class="camera-stop" data-action="camera-stop">■ 録画停止</button>`
        : `<button type="button" class="camera-start" data-action="camera-start" ${isBusy ? "disabled" : ""}>${videoRecordingStatus === "starting" ? "カメラ準備中…" : videoRecordingStatus === "processing" ? "動画処理中…" : "● 録画開始"}</button>`}
    </div>
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

function cameraStopwatchContents() {
  const controls = stopwatchStatus === "idle"
    ? `<button class="camera-timer-lap" type="button" disabled>⚑<span>ラップ</span></button><button class="camera-timer-start" data-action="timer-start">▶<span>競技開始</span></button>`
    : stopwatchStatus === "running"
      ? `<button class="camera-timer-lap" data-action="timer-lap">⚑<span>ラップ</span></button><button class="camera-timer-pause" data-action="timer-pause">Ⅱ<span>停止</span></button>`
      : `<button class="camera-timer-finish" data-action="timer-finish">■<span>競技終了</span></button><button class="camera-timer-resume" data-action="timer-resume">▶<span>再開</span></button>`;
  const latestLap = stopwatchLaps.at(-1);
  return `<span class="camera-stopwatch-label">競技ストップウォッチ</span>
    <strong data-camera-stopwatch-display>${formatStopwatch(currentStopwatchElapsed())}</strong>
    <div class="camera-stopwatch-controls">${controls}</div>
    ${latestLap === undefined ? "" : `<small>ラップ ${stopwatchLaps.length}　${formatStopwatch(latestLap)}</small>`}`;
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
    enterCameraFullscreen(false);
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

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function activeFullscreenElement() {
  const fullscreenDocument = document as FullscreenCapableDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

function requestElementFullscreen(element: FullscreenCapableElement) {
  if (activeFullscreenElement()) return;
  try {
    const request = element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element);
    if (!request) return;
    const result = request();
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // iOSなど全画面API非対応端末ではCSS全面表示を維持する。
  }
}

function enterCameraFullscreen(requestNativeFullscreen = true) {
  const preview = document.querySelector<HTMLElement>(".camera-preview-wrap");
  if (!preview || !cameraStream) return;
  if (!preview.classList.contains("camera-preview-expanded")) {
    cameraPreviewPlaceholder = document.createComment("camera-preview-home");
    preview.before(cameraPreviewPlaceholder);
    document.body.appendChild(preview);
  }
  preview.classList.add("camera-preview-expanded");
  document.body.classList.add("camera-mode");
  if (requestNativeFullscreen) requestElementFullscreen(preview);
}

function collapseCameraFullscreen() {
  document.body.classList.remove("camera-mode");
  const preview = document.querySelector<HTMLElement>(".camera-preview-wrap");
  preview?.classList.remove("camera-preview-expanded");
  if (preview && cameraPreviewPlaceholder?.parentNode) {
    cameraPreviewPlaceholder.parentNode.insertBefore(preview, cameraPreviewPlaceholder);
    cameraPreviewPlaceholder.remove();
  }
  cameraPreviewPlaceholder = null;
}

function exitCameraFullscreen() {
  const fullscreenDocument = document as FullscreenCapableDocument;
  const exit = document.exitFullscreen?.bind(document) ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
  if (activeFullscreenElement() && document.body.classList.contains("camera-mode") && exit) {
    try {
      const result = exit();
      if (result instanceof Promise) void result.catch(() => undefined).finally(collapseCameraFullscreen);
      else collapseCameraFullscreen();
    } catch {
      collapseCameraFullscreen();
    }
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
    <section class="sheet-panel card">
      <h2>Googleスプレッドシートへ記録</h2>
      ${activeAccount === "ADMIN" ? `<label>保存先アカウント<select data-admin-score-account><option value="">選択してください</option>${managedAccounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join("")}</select></label>` : `<p><strong>${escapeHtml(activeAccountName || "現在のアカウント")}</strong>のシートへ、この結果を1行追加します。</p>`}
      <button class="primary" data-action="send-sheet" ${sheetSending ? "disabled" : ""}>${sheetSending ? "保存中…" : "このチームの記録として保存"}</button>
      ${sheetStatus ? `<p class="sheet-status" role="status">${escapeHtml(sheetStatus)}</p>` : ""}
    </section>
    <button class="text-button new-score" data-action="new">＋ 新しい採点を始める</button>
  `, { back: "score", title: "採点結果" });
}

function recordsView() {
  const filteredRecords = filteredPracticeRecords();
  const visibleRecords = filteredRecords.slice(0, recordVisibleCount);
  const isAdmin = activeAccount === "ADMIN";
  const activeFilterCount = [recordFilters.query, recordFilters.dateFrom, recordFilters.dateTo, recordFilters.minScore, recordFilters.maxScore, isAdmin && recordFilters.account !== "ALL" ? recordFilters.account : ""].filter(Boolean).length;
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
      <header class="record-filter-header">
        <div><p class="eyebrow">SEARCH / SORT</p><h2>履歴を探す</h2><span>${activeFilterCount ? `${activeFilterCount}個の条件で絞り込み中` : "すべての記録を表示"}</span></div>
        <label class="record-sort">並び順<select data-record-filter="sort" aria-label="履歴の並び順">
          <option value="newest" ${recordFilters.sort === "newest" ? "selected" : ""}>新しい順</option>
          <option value="oldest" ${recordFilters.sort === "oldest" ? "selected" : ""}>古い順</option>
          <option value="score-desc" ${recordFilters.sort === "score-desc" ? "selected" : ""}>得点が高い順</option>
          <option value="score-asc" ${recordFilters.sort === "score-asc" ? "selected" : ""}>得点が低い順</option>
        </select></label>
      </header>
      <label class="record-search">検索
        <input data-record-filter="query" type="search" value="${escapeHtml(recordFilters.query)}" placeholder="メモ・日付・点数を検索" />
      </label>
      <div class="record-filter-groups">
        <fieldset><legend>期間</legend><div class="filter-range">
          <label>開始日<input data-record-filter="dateFrom" type="date" value="${recordFilters.dateFrom}" /></label><span>〜</span>
          <label>終了日<input data-record-filter="dateTo" type="date" value="${recordFilters.dateTo}" /></label>
        </div></fieldset>
        <fieldset><legend>得点</legend><div class="filter-range score-range">
          <label>最低点<input data-record-filter="minScore" type="number" min="0" max="${MAX_SCORE}" inputmode="numeric" value="${recordFilters.minScore}" placeholder="0" /></label><span>〜</span>
          <label>最高点<input data-record-filter="maxScore" type="number" min="0" max="${MAX_SCORE}" inputmode="numeric" value="${recordFilters.maxScore}" placeholder="${MAX_SCORE}" /></label>
        </div></fieldset>
        ${isAdmin ? `<fieldset><legend>アカウント</legend><label>表示するチーム<select data-record-filter="account">
          <option value="ALL" ${recordFilters.account === "ALL" ? "selected" : ""}>すべてのチーム</option>
          ${managedAccounts.map((account) => `<option value="${account.id}" ${recordFilters.account === account.id ? "selected" : ""}>${escapeHtml(account.name)}</option>`).join("")}
        </select></label></fieldset>` : ""}
      </div>
      <div class="record-filter-actions">
        <button class="primary" data-action="apply-record-filters">検索・絞り込み</button>
        <button class="secondary" data-action="reset-record-filters" ${activeFilterCount ? "" : "disabled"}>条件をクリア</button>
      </div>
      <strong class="record-filter-count">${filteredRecords.length}件ヒット・${visibleRecords.length}件表示 <small>（全${practiceRecords.length}件）</small></strong>
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

function memoView() {
  const isAdmin = activeAccount === "ADMIN";
  const records = [...practiceRecords].sort((left, right) =>
    new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime(),
  );
  return shell(`
    <section class="page-intro memo-intro">
      <p class="eyebrow">${isAdmin ? "全アカウント" : escapeHtml(activeAccountName || "現在のアカウント")}</p>
      <h1>メモ</h1>
      <p>練習した回ごとに、気づいたことや次に試すことを記録できます。</p>
      <button class="secondary" data-action="load-memo-data">↻ 一覧を更新</button>
    </section>
    ${recordsStatus ? `<p class="sheet-status records-status" role="status">${escapeHtml(recordsStatus)}</p>` : ""}
    <section class="free-memo-section">
      <div class="section-heading"><div><p class="eyebrow">MEMO</p><h2>メモ</h2></div><span>練習回に関係なく保存できます</span></div>
      <article class="memo-record free-memo-new card" data-free-memo>
        ${isAdmin ? `<label>保存先アカウント
          <select data-free-memo-account-select>
            <option value="">選択してください</option>
            ${managedAccounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join("")}
          </select>
        </label>` : ""}
        <label>新しいメモ
          <textarea data-free-memo-content maxlength="1000" placeholder="アイデア、準備物、次回試したいことなど"></textarea>
        </label>
        ${courtBoardView("free", "", activeAccount === "ADMIN" ? "" : activeAccount || "", 0, "", newFreeMemoBoard)}
        <div class="memo-save-row"><small>1000文字まで</small><button class="primary" data-action="save-free-memo">新しいメモを保存</button></div>
      </article>
      ${freeMemoStatus ? `<p class="sheet-status" role="status">${escapeHtml(freeMemoStatus)}</p>` : ""}
      <div class="memo-list free-memo-list">
        ${freeMemos.length ? freeMemos.map((memo) => `
          <article class="memo-record card" data-free-memo>
            <header><div><p>${formatRecordDate(memo.updatedAt)}${isAdmin ? `　<span class="record-account">${escapeHtml(memo.accountName || memo.account)}</span>` : ""}</p><strong>メモ</strong></div></header>
            <label>内容<textarea data-free-memo-content maxlength="1000">${escapeHtml(memo.content)}</textarea></label>
            ${courtBoardView("free", memo.memoId, memo.account, 0, "", memo.board)}
            <div class="memo-save-row"><button class="memo-delete" data-action="delete-free-memo" data-memo-id="${escapeHtml(memo.memoId)}" data-memo-account="${memo.account}">削除</button><button class="primary" data-action="save-free-memo" data-memo-id="${escapeHtml(memo.memoId)}" data-memo-account="${memo.account}">変更を保存</button></div>
          </article>`).join("") : `<div class="empty-state card"><strong>メモはまだありません</strong><p>上の欄から最初のメモを作成できます。</p></div>`}
      </div>
    </section>
    <div class="section-heading round-memo-heading"><div><p class="eyebrow">ROUND MEMO</p><h2>練習回のメモ</h2></div><span>採点結果に紐づくメモです</span></div>
    <section class="memo-list">
      ${records.length ? records.map((record) => `
        <article class="memo-record card" data-memo-record>
          <header>
            <div><p>${formatRecordDate(record.recordedAt)}${isAdmin ? `　<span class="record-account">${escapeHtml(record.accountName || record.account)}</span>` : ""}</p><strong>${record.total} / ${MAX_SCORE}点</strong></div>
            <span>競技時間 ${formatTime(record.timeSeconds)}</span>
          </header>
          <label>${record.notes ? "この回のメモ" : "新しいメモ"}
            <textarea data-record-memo maxlength="500" placeholder="ミスしたところ、良かったところ、次に試すことなど">${escapeHtml(record.notes)}</textarea>
          </label>
          ${courtBoardView("record", "", record.account, record.rowNumber, record.recordedAt, record.board)}
          <div class="memo-save-row"><small>500文字まで</small><button class="primary" data-action="save-record-memo" data-record-account="${record.account}" data-record-row="${record.rowNumber}" data-recorded-at="${escapeHtml(record.recordedAt)}">メモを保存</button></div>
        </article>`).join("") : `<div class="empty-state card"><strong>まだ記録がありません</strong><p>採点結果を保存すると、その回のメモをここで作れます。</p></div>`}
    </section>
  `, { back: "score", title: "メモ" });
}

function courtBoardView(kind: "free" | "record" | "score", memoId: string, account: string, rowNumber: number, recordedAt: string, board: CourtBoard) {
  const hasMarks = board.elements.length > 0;
  return `<section class="court-board-card ${hasMarks ? "has-marks" : ""}">
    <div class="court-board-preview" data-board-preview data-board-kind="${kind}" data-board-id="${escapeHtml(memoId)}" data-board-account="${escapeHtml(account)}" data-board-row="${rowNumber}" data-recorded-at="${escapeHtml(recordedAt)}">
      <img src="${COURT_IMAGE_URL}" alt="WRO 2026 RoboMission Junior コート" loading="lazy" decoding="async" /><canvas aria-hidden="true"></canvas>
    </div>
    <div><strong>${hasMarks ? "コート書き込みあり" : "コートに印や文字を追加"}</strong><small>○・×・□・△・ペン・文字・色変更</small></div>
    <button type="button" class="secondary" data-action="edit-board" data-board-kind="${kind}" data-board-id="${escapeHtml(memoId)}" data-board-account="${escapeHtml(account)}" data-board-row="${rowNumber}" data-recorded-at="${escapeHtml(recordedAt)}">${hasMarks ? "編集する" : "コートを開く"}</button>
  </section>`;
}

function boardForTarget(kind: string, memoId: string, account: string, rowNumber: number, recordedAt: string) {
  if (kind === "score") return state.board;
  if (kind === "free") {
    if (!memoId) return newFreeMemoBoard;
    return freeMemos.find((memo) => memo.memoId === memoId && memo.account === account)?.board ?? emptyCourtBoard();
  }
  return practiceRecords.find((record) => record.account === account && record.rowNumber === rowNumber && record.recordedAt === recordedAt)?.board ?? emptyCourtBoard();
}

function renderCourtBoardPreviews() {
  document.querySelectorAll<HTMLElement>("[data-board-preview]").forEach((preview) => {
    const canvas = preview.querySelector<HTMLCanvasElement>("canvas");
    const image = preview.querySelector<HTMLImageElement>("img");
    if (!canvas || !image) return;
    const board = boardForTarget(preview.dataset.boardKind || "", preview.dataset.boardId || "", preview.dataset.boardAccount || "", Number(preview.dataset.boardRow || 0), preview.dataset.recordedAt || "");
    const hasMarks = board.elements.length > 0;
    const card = preview.closest<HTMLElement>(".court-board-card");
    card?.classList.toggle("has-marks", hasMarks);
    const label = card?.querySelector<HTMLElement>("div:not(.court-board-preview) > strong");
    const button = card?.querySelector<HTMLButtonElement>("[data-action='edit-board']");
    if (label) label.textContent = hasMarks ? "コート書き込みあり" : "コートに印や文字を追加";
    if (button) button.textContent = hasMarks ? "編集する" : "コートを開く";
    const draw = () => drawCourtBoard(canvas, board);
    if (image.complete) window.requestAnimationFrame(draw);
    else image.addEventListener("load", () => window.requestAnimationFrame(draw), { once: true });
  });
}

function openCourtBoard(element: HTMLElement) {
  closeCourtBoard();
  const kind = element.dataset.boardKind === "record" ? "record" : element.dataset.boardKind === "score" ? "score" : "free";
  const memoId = element.dataset.boardId || "";
  const account = element.dataset.boardAccount || element.closest<HTMLElement>("[data-free-memo]")?.querySelector<HTMLSelectElement>("[data-free-memo-account-select]")?.value || activeAccount || "";
  const rowNumber = Number(element.dataset.boardRow || 0);
  const recordedAt = element.dataset.recordedAt || "";
  boardEditor = {
    target: { kind, memoId, account, rowNumber, recordedAt },
    board: cloneCourtBoard(boardForTarget(kind, memoId, account, rowNumber, recordedAt)),
    tool: "select",
    color: "#e53935",
    undo: [],
    redo: [],
    drawing: null,
    pointerId: null,
    selectedIndex: -1,
    transform: null,
  };
  document.body.insertAdjacentHTML("beforeend", `<section class="board-editor" data-board-editor role="dialog" aria-modal="true" aria-label="コート書き込み">
    <header><div><strong>コート書き込み</strong><small>選択ツールで配置済みの印・文字を編集できます</small></div><button type="button" class="board-editor-close" data-board-command="cancel">× 閉じる</button></header>
    <div class="board-toolbar" aria-label="書き込みツール">
      ${[["select", "↖ 選択"], ["pen", "✎ ペン"], ["circle", "○"], ["cross", "×"], ["square", "□"], ["triangle", "△"], ["text", "文字"], ["eraser", "消しゴム"]].map(([tool, label]) => `<button type="button" data-board-tool="${tool}" class="${tool === "select" ? "active" : ""}">${label}</button>`).join("")}
      <span class="board-colors" aria-label="色を選択">${["#e53935", "#1565c0", "#00897b", "#f9a825", "#000000", "#ffffff"].map((color) => `<button type="button" data-board-color="${color}" style="--board-color:${color}" class="${color === "#e53935" ? "active" : ""}" aria-label="${color}を選択"></button>`).join("")}<input type="color" data-board-color-picker value="#e53935" aria-label="その他の色" /></span>
      <button type="button" data-board-command="undo">↶ 戻す</button><button type="button" data-board-command="redo">↷ やり直す</button><button type="button" class="board-clear" data-board-command="clear">全消去</button>
    </div>
    <div class="board-selection-bar" data-board-selection-bar hidden><strong>選択中</strong><span>ドラッグ：移動　□：大きさ　○：回転</span><button type="button" data-board-command="edit-text" hidden>文字を編集</button><button type="button" class="board-delete" data-board-command="delete-selected">削除</button></div>
    <div class="board-stage-shell"><div class="board-stage"><img src="${COURT_IMAGE_URL}" alt="WRO 2026 RoboMission Junior コート" /><canvas data-board-canvas aria-label="コート書き込み領域"></canvas></div></div>
    <footer><span>選択で移動・大きさ・角度・文字を編集できます</span><button type="button" class="primary" data-board-command="done">${kind === "score" ? "この書き込みを採点メモに入れる" : "この書き込みをメモに入れる"}</button></footer>
  </section>`);
  document.body.classList.add("board-editor-mode");
  bindCourtBoardEditor();
}

function bindCourtBoardEditor() {
  const root = document.querySelector<HTMLElement>("[data-board-editor]");
  const canvas = root?.querySelector<HTMLCanvasElement>("[data-board-canvas]");
  const image = root?.querySelector<HTMLImageElement>(".board-stage img");
  if (!root || !canvas || !image || !boardEditor) return;
  const draw = () => {
    if (!boardEditor) return;
    const board = boardEditor.drawing ? { version: 1 as const, elements: [...boardEditor.board.elements, boardEditor.drawing] } : boardEditor.board;
    drawCourtBoard(canvas, board, boardEditor.selectedIndex);
  };
  const selectTool = (button: HTMLButtonElement) => {
    if (!boardEditor) return;
    boardEditor.transform = null;
    boardEditor.drawing = null;
    boardEditor.pointerId = null;
    boardEditor.tool = button.dataset.boardTool as BoardTool;
    if (boardEditor.tool !== "select") boardEditor.selectedIndex = -1;
    canvas.dataset.tool = boardEditor.tool;
    root.querySelectorAll("[data-board-tool]").forEach((item) => item.classList.toggle("active", item === button));
    updateBoardSelectionUI();
    draw();
  };
  root.querySelectorAll<HTMLButtonElement>("[data-board-tool]").forEach((button) => button.addEventListener("click", () => {
    selectTool(button);
  }));
  const chooseColor = (color: string) => {
    if (!boardEditor) return;
    boardEditor.color = color;
    const selected = boardEditor.board.elements[boardEditor.selectedIndex];
    if (boardEditor.tool === "select" && selected && selected.color !== color) {
      saveBoardUndo();
      selected.color = color;
      draw();
    }
  };
  root.querySelectorAll<HTMLButtonElement>("[data-board-color]").forEach((button) => button.addEventListener("click", () => {
    if (!boardEditor) return;
    chooseColor(button.dataset.boardColor || "#e53935");
    root.querySelector<HTMLInputElement>("[data-board-color-picker]")!.value = boardEditor.color;
    root.querySelectorAll("[data-board-color]").forEach((item) => item.classList.toggle("active", item === button));
  }));
  root.querySelector<HTMLInputElement>("[data-board-color-picker]")?.addEventListener("change", (event) => {
    if (!boardEditor) return;
    chooseColor((event.currentTarget as HTMLInputElement).value);
    root.querySelectorAll("[data-board-color]").forEach((item) => item.classList.remove("active"));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-board-command]").forEach((button) => button.addEventListener("click", () => runBoardCommand(button.dataset.boardCommand || "")));
  canvas.dataset.tool = "select";
  updateBoardSelectionUI();
  if (image.complete) window.requestAnimationFrame(draw); else image.addEventListener("load", draw, { once: true });
  window.addEventListener("resize", draw, { once: true });
  canvas.addEventListener("pointerdown", (event) => {
    if (!boardEditor || boardEditor.pointerId !== null) return;
    event.preventDefault();
    const point = boardPoint(canvas, event.clientX, event.clientY);
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    if (boardEditor.tool === "select") {
      const selected = boardEditor.board.elements[boardEditor.selectedIndex];
      const handle = selected ? selectionHandleAt(canvas, selected, event.clientX, event.clientY) : null;
      const index = handle ? boardEditor.selectedIndex : findBoardElement(boardEditor.board, point.x, point.y, aspect);
      if (index < 0) {
        boardEditor.selectedIndex = -1;
        updateBoardSelectionUI();
        draw();
        return;
      }
      boardEditor.selectedIndex = index;
      const item = boardEditor.board.elements[index];
      const bounds = boardElementBounds(item, aspect);
      boardEditor.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      boardEditor.transform = {
        mode: handle || "move",
        index,
        startX: point.x,
        startY: point.y,
        startDistance: Math.max(.001, Math.hypot((point.x - bounds.cx) * aspect, point.y - bounds.cy)),
        startAngle: Math.atan2(point.y - bounds.cy, (point.x - bounds.cx) * aspect),
        original: { ...item, points: item.points ? [...item.points] : undefined },
        changed: false,
      };
      boardEditor.color = item.color;
      root.querySelector<HTMLInputElement>("[data-board-color-picker]")!.value = item.color;
      updateBoardSelectionUI();
      draw();
      return;
    }
    if (boardEditor.tool === "text") {
      openBoardTextInput("", "コートに文字を追加", (text) => {
        if (!boardEditor) return;
        saveBoardUndo();
        boardEditor.board.elements.push({ type: "text", color: boardEditor.color, x: point.x, y: point.y, text, size: .055 });
        draw();
      });
      return;
    }
    if (boardEditor.tool === "eraser") {
      const index = findBoardElement(boardEditor.board, point.x, point.y);
      if (index >= 0) { saveBoardUndo(); boardEditor.board.elements.splice(index, 1); draw(); }
      return;
    }
    saveBoardUndo();
    boardEditor.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    boardEditor.drawing = boardEditor.tool === "pen"
      ? { type: "pen", color: boardEditor.color, x: point.x, y: point.y, points: [point.x, point.y] }
      : { type: boardEditor.tool, color: boardEditor.color, x: point.x, y: point.y, x2: point.x, y2: point.y };
    draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (boardEditor?.transform && boardEditor.pointerId === event.pointerId) {
      event.preventDefault();
      const point = boardPoint(canvas, event.clientX, event.clientY);
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const transform = boardEditor.transform;
      const bounds = boardElementBounds(transform.original, aspect);
      let changed = false;
      let next = transform.original;
      if (transform.mode === "move") {
        const dx = point.x - transform.startX; const dy = point.y - transform.startY;
        changed = Math.hypot(dx * aspect, dy) > .002;
        next = moveBoardElement(transform.original, dx, dy, aspect);
      } else if (transform.mode === "resize") {
        const distance = Math.hypot((point.x - bounds.cx) * aspect, point.y - bounds.cy);
        const factor = distance / transform.startDistance;
        changed = Math.abs(factor - 1) > .01;
        next = scaleBoardElement(transform.original, factor, aspect);
      } else {
        const angle = Math.atan2(point.y - bounds.cy, (point.x - bounds.cx) * aspect);
        const delta = (angle - transform.startAngle) * 180 / Math.PI;
        changed = Math.abs(delta) > .5;
        next = rotateBoardElement(transform.original, delta);
      }
      if (changed && !transform.changed) { saveBoardUndo(); transform.changed = true; }
      if (changed) boardEditor.board.elements[transform.index] = next;
      draw();
      return;
    }
    if (!boardEditor?.drawing || boardEditor.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = boardPoint(canvas, event.clientX, event.clientY);
    if (boardEditor.drawing.type === "pen") {
      const points = boardEditor.drawing.points!;
      if (Math.hypot(points[points.length - 2] - point.x, points[points.length - 1] - point.y) > .0025 && points.length < 800) points.push(point.x, point.y);
    } else {
      boardEditor.drawing.x2 = point.x;
      boardEditor.drawing.y2 = point.y;
    }
    draw();
  });
  const finish = (event: PointerEvent) => {
    if (boardEditor?.transform && boardEditor.pointerId === event.pointerId) {
      boardEditor.transform = null;
      boardEditor.pointerId = null;
      updateBoardSelectionUI();
      draw();
      return;
    }
    if (!boardEditor?.drawing || boardEditor.pointerId !== event.pointerId) return;
    const item = boardEditor.drawing;
    if (item.type !== "pen" && Math.abs((item.x2 || item.x) - item.x) < .015 && Math.abs((item.y2 || item.y) - item.y) < .015) {
      item.x2 = Math.min(1, item.x + .08); item.y2 = Math.min(1, item.y + .13);
    }
    boardEditor.board.elements.push(item);
    boardEditor.drawing = null;
    boardEditor.pointerId = null;
    draw();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
}

function selectionHandleAt(canvas: HTMLCanvasElement, item: BoardElement, clientX: number, clientY: number): "resize" | "rotate" | null {
  const rect = canvas.getBoundingClientRect();
  const bounds = boardElementBounds(item, rect.width / rect.height);
  const center = { x: bounds.cx * rect.width, y: bounds.cy * rect.height };
  const radians = (item.rotation ?? 0) * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: center.x + (x - center.x) * Math.cos(radians) - (y - center.y) * Math.sin(radians),
    y: center.y + (x - center.x) * Math.sin(radians) + (y - center.y) * Math.cos(radians),
  });
  const resize = rotate(bounds.right * rect.width, bounds.bottom * rect.height);
  const rotation = rotate(center.x, bounds.top * rect.height - 28);
  const x = clientX - rect.left; const y = clientY - rect.top;
  if (Math.hypot(x - rotation.x, y - rotation.y) <= 28) return "rotate";
  if (Math.hypot(x - resize.x, y - resize.y) <= 28) return "resize";
  return null;
}

function updateBoardSelectionUI() {
  const root = document.querySelector<HTMLElement>("[data-board-editor]");
  const bar = root?.querySelector<HTMLElement>("[data-board-selection-bar]");
  if (!root || !bar || !boardEditor) return;
  const item = boardEditor.board.elements[boardEditor.selectedIndex];
  bar.hidden = !item || boardEditor.tool !== "select";
  if (!item) return;
  const names: Record<BoardElement["type"], string> = { pen: "ペン", circle: "○", cross: "×", square: "□", triangle: "△", text: "文字" };
  const label = bar.querySelector("strong");
  if (label) label.textContent = `${names[item.type]}を選択中`;
  const editText = bar.querySelector<HTMLButtonElement>("[data-board-command='edit-text']");
  if (editText) editText.hidden = item.type !== "text";
}

function openBoardTextInput(initialValue: string, title: string, onSave: (text: string) => void) {
  document.querySelector("[data-board-text-dialog]")?.remove();
  const root = document.querySelector<HTMLElement>("[data-board-editor]");
  if (!root) return;
  root.insertAdjacentHTML("beforeend", `<section class="board-text-dialog" data-board-text-dialog role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div><strong>${escapeHtml(title)}</strong><label>文字（40文字まで）<input type="text" maxlength="40" value="${escapeHtml(initialValue)}" data-board-text-input autocomplete="off" /></label><div><button type="button" data-board-text-cancel>キャンセル</button><button type="button" class="primary" data-board-text-save>決定</button></div></div>
  </section>`);
  const dialog = root.querySelector<HTMLElement>("[data-board-text-dialog]")!;
  const input = dialog.querySelector<HTMLInputElement>("[data-board-text-input]")!;
  const close = () => dialog.remove();
  const save = () => {
    const text = input.value.trim().slice(0, 40);
    if (!text) { input.focus(); return; }
    close();
    onSave(text);
  };
  dialog.querySelector("[data-board-text-cancel]")?.addEventListener("click", close);
  dialog.querySelector("[data-board-text-save]")?.addEventListener("click", save);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); save(); }
    if (event.key === "Escape") { event.stopPropagation(); close(); }
  });
  window.setTimeout(() => { input.focus(); input.select(); }, 0);
}

function saveBoardUndo() {
  if (!boardEditor) return;
  boardEditor.undo.push(cloneCourtBoard(boardEditor.board));
  if (boardEditor.undo.length > 30) boardEditor.undo.shift();
  boardEditor.redo = [];
}

function runBoardCommand(command: string) {
  if (!boardEditor) return;
  if (command === "cancel") { closeCourtBoard(); return; }
  if (command === "clear") {
    if (boardEditor.board.elements.length && confirm("コート上の書き込みをすべて消しますか？")) { saveBoardUndo(); boardEditor.board = emptyCourtBoard(); boardEditor.selectedIndex = -1; updateBoardSelectionUI(); redrawBoardEditor(); }
    return;
  }
  if (command === "undo" && boardEditor.undo.length) {
    boardEditor.redo.push(cloneCourtBoard(boardEditor.board)); boardEditor.board = boardEditor.undo.pop()!; boardEditor.selectedIndex = Math.min(boardEditor.selectedIndex, boardEditor.board.elements.length - 1); updateBoardSelectionUI(); redrawBoardEditor(); return;
  }
  if (command === "redo" && boardEditor.redo.length) {
    boardEditor.undo.push(cloneCourtBoard(boardEditor.board)); boardEditor.board = boardEditor.redo.pop()!; boardEditor.selectedIndex = Math.min(boardEditor.selectedIndex, boardEditor.board.elements.length - 1); updateBoardSelectionUI(); redrawBoardEditor(); return;
  }
  if (command === "delete-selected") {
    if (boardEditor.selectedIndex >= 0) {
      saveBoardUndo();
      boardEditor.board.elements.splice(boardEditor.selectedIndex, 1);
      boardEditor.selectedIndex = -1;
      updateBoardSelectionUI();
      redrawBoardEditor();
    }
    return;
  }
  if (command === "edit-text") {
    boardEditor.transform = null;
    boardEditor.pointerId = null;
    const index = boardEditor.selectedIndex;
    const item = boardEditor.board.elements[index];
    if (item?.type === "text") {
      openBoardTextInput(item.text || "", "文字を編集", (text) => {
        if (!boardEditor) return;
        const current = boardEditor.board.elements[index];
        if (current?.type !== "text" || text === current.text) return;
        saveBoardUndo(); current.text = text; updateBoardSelectionUI(); redrawBoardEditor();
      });
    }
    return;
  }
  if (command === "done") {
    const { target } = boardEditor;
    const saved = cloneCourtBoard(boardEditor.board);
    if (target.kind === "score") {
      state.board = saved;
      saveState();
    } else if (target.kind === "free") {
      if (target.memoId) {
        const memo = freeMemos.find((item) => item.memoId === target.memoId && item.account === target.account);
        if (memo) memo.board = saved;
      } else newFreeMemoBoard = saved;
    } else {
      const record = practiceRecords.find((item) => item.account === target.account && item.rowNumber === target.rowNumber && item.recordedAt === target.recordedAt);
      if (record) record.board = saved;
    }
    closeCourtBoard();
    renderCourtBoardPreviews();
  }
}

function redrawBoardEditor() {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-board-canvas]");
  if (canvas && boardEditor) drawCourtBoard(canvas, boardEditor.board, boardEditor.selectedIndex);
}

function closeCourtBoard() {
  document.querySelector("[data-board-editor]")?.remove();
  document.body.classList.remove("board-editor-mode");
  boardEditor = null;
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
  const isHyogo = activeRulesDocument === "hyogo";
  const isGeneral = activeRulesDocument === "general";
  const documentTitle = isHyogo
    ? "兵庫予選会 ルール補足及びローカルルール"
    : isGeneral ? "Google翻訳版-General-Rules" : "Google翻訳版 RoboMission Juniorルール";
  const externalUrl = isHyogo
    ? HYOGO_LOCAL_RULES_URL
    : isGeneral ? GENERAL_TRANSLATED_RULES_URL
    : useDriveViewer ? GOOGLE_TRANSLATED_RULES_URL : RULES_PDF_URL;
  const driveBased = isHyogo || isGeneral || useDriveViewer;
  return shell(`
    <section class="page-intro rules-intro">
      <div><p class="eyebrow">${isHyogo ? "WRO HYOGO" : "Google翻訳版"}</p><h1>${documentTitle}</h1><p>${driveBased ? "複数ページ対応ビューアで表示しています。上下にスクロールして全ページを確認できます。" : "PDF内の検索ボタン、またはキーボードの Ctrl + F（Macは ⌘ + F）で単語や文字を検索できます。"}</p></div>
      <div class="pdf-actions"><button class="primary pdf-open" data-action="pdf-expand">⛶ 全画面表示</button><a class="secondary pdf-open" href="${externalUrl}" target="_blank" rel="noopener">別画面で開く</a></div>
    </section>
    <nav class="rule-document-tabs" aria-label="表示するルールPDF">
      <button type="button" data-action="select-rule-document" data-rule-document="translated" class="${activeRulesDocument === "translated" ? "active" : ""}">Google翻訳版</button>
      <button type="button" data-action="select-rule-document" data-rule-document="general" class="${isGeneral ? "active" : ""}">Google翻訳版-General-Rules</button>
      <button type="button" data-action="select-rule-document" data-rule-document="hyogo" class="${isHyogo ? "active" : ""}">兵庫予選会 補足・ローカルルール</button>
    </nav>
    <section class="pdf-viewer card">
      <button class="pdf-collapse" data-action="pdf-collapse" aria-label="PDFの全画面表示を終了">× 全画面解除</button>
      <div class="rules-frame-host" data-rules-frame-host></div>
      <p>${isHyogo ? `表示できない場合は、<a href="${HYOGO_LOCAL_RULES_URL}" target="_blank" rel="noopener">兵庫予選会PDFを別画面で開く</a>を押してください。` : isGeneral ? `表示できない場合は、<a href="${GENERAL_TRANSLATED_RULES_URL}" target="_blank" rel="noopener">General Rules PDFを別画面で開く</a>を押してください。` : useDriveViewer ? `表示できない場合は、<a href="${RULES_DRIVE_PREVIEW_URL}" target="_blank" rel="noopener">Google Drive版</a>または<a href="${RULES_PDF_URL}" target="_blank" rel="noopener">端末内PDF</a>を開いてください。` : `この端末でPDFが表示されない場合は、<a href="${RULES_PDF_URL}" target="_blank" rel="noopener">別画面で開く</a>を押してください。`}</p>
    </section>
  `, { back: "score", title: "ルール" });
}

function newsView() {
  return shell(`
    <section class="page-intro news-intro">
      <div><p class="eyebrow">EVENT / APP UPDATES</p><h1>ニュース</h1><p>兵庫予選会の大会情報と、RoboMission Assistの更新内容をまとめています。</p></div>
      <button class="primary" data-action="load-news" ${newsLoading ? "disabled" : ""}>${newsLoading ? "確認中…" : "↻ 最新情報を確認"}</button>
    </section>
    <nav class="news-jump" aria-label="ニュース内メニュー"><button type="button" data-action="scroll-news-section" data-news-target="news-event">大会情報</button><button type="button" data-action="scroll-news-section" data-news-target="news-app-updates">アプリ更新内容</button></nav>
    <section class="news-section" id="news-event" aria-labelledby="news-event-title">
      <div class="news-section-heading"><div><p class="eyebrow">WRO HYOGO 2026</p><h2 id="news-event-title">大会情報</h2></div><a href="${HYOGO_EVENT_URL}" target="_blank" rel="noopener noreferrer">公式情報を見る ↗</a></div>
      ${hyogoEventCard()}
      <div class="news-subheading"><h3>兵庫予選会の最新情報</h3><span>直近3件</span></div>
      ${newsStatus ? `<p class="news-status" role="status">${escapeHtml(newsStatus)}</p>` : ""}
      <div class="news-list" aria-label="兵庫予選会の最新情報">
        ${newsItems.map((item) => `<article class="news-card card"><span class="news-source">${escapeHtml(item.source)}</span><h2>【${escapeHtml(item.source)}】「${escapeHtml(item.title)}」が更新されました。</h2><time datetime="${item.updatedAt.replaceAll(".", "-")}">更新日時：${escapeHtml(item.updatedAt)}</time><a href="${item.url}" target="_blank" rel="noopener noreferrer">記事を見る <b aria-hidden="true">↗</b></a></article>`).join("")}
      </div>
      <a class="news-source-link" href="https://wro-hyogo.jp/" target="_blank" rel="noopener noreferrer">WRO Japan 2026 公認 兵庫予選会 公式サイトを見る ↗</a>
    </section>
    <section class="news-section" id="news-app-updates" aria-labelledby="news-app-updates-title">
      <div class="news-section-heading"><div><p class="eyebrow">CHANGELOG</p><h2 id="news-app-updates-title">アプリ更新内容</h2></div><span>現在 v${APP_VERSION}</span></div>
      <div class="app-update-list">${APP_UPDATES.map((update) => `<article class="app-update-card card"><div><span class="update-version">v${update.version}</span><time datetime="${update.updatedAt.replaceAll(".", "-")}">${update.updatedAt}</time></div><h3>${escapeHtml(update.title)}</h3><p>${escapeHtml(update.description)}</p></article>`).join("")}</div>
    </section>
  `, { title: "ニュース" });
}

function hyogoEventCard() {
  return `<article class="event-info link-section card">
    <header><div><p class="eyebrow">WRO HYOGO 2026</p><h2>ロボミッション【エキスパート競技】</h2></div><a href="${HYOGO_EVENT_URL}" target="_blank" rel="noopener noreferrer">開催概要 詳細</a></header>
    <div class="event-info-grid">
      <section><h3>■ スケジュール</h3><p class="event-date">2026年7月26日（日）</p><dl class="event-schedule">
        ${[["12:00 ～ 12:15", "開場・受付"], ["12:15 ～ 12:45", "開会式"], ["12:45 ～ 13:45", "調整①"], ["13:45 ～ 14:15", "抽選・競技①"], ["14:15 ～ 14:25", "エクストラチャレンジルール発表"], ["14:25 ～ 15:45", "調整②"], ["15:45 ～ 16:15", "抽選・競技②"], ["16:15 ～ 16:40", "片付け・スコア集計・チャペル移動"], ["16:40 ～ 17:10", "閉会式"]].map(([time, activity]) => `<div><dt>${time}</dt><dd>${activity}</dd></div>`).join("")}
      </dl></section>
      <section class="event-venue"><h3>■ 場所</h3><strong>関西学院初等部</strong><address>〒665-0844<br />兵庫県宝塚市武庫川町6番27号</address><p>ロボミッション（エキスパート競技）・ロボスポーツ競技 会場</p><div class="event-mini-map"><iframe src="${HYOGO_MAP_EMBED_URL}" title="関西学院初等部 周辺地図" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div><a class="map-button" href="${HYOGO_MAP_URL}" target="_blank" rel="noopener noreferrer">Googleマップで表示 ↗</a></section>
    </div>
  </article>`;
}

function linksView() {
  return shell(`
    <section class="page-intro links-intro">
      <p class="eyebrow">EVENT / RELATED LINKS</p>
      <h1>リンク・大会情報</h1>
      <p>兵庫予選会の大会情報と、WROの公式情報・ルール・関連動画をまとめています。</p>
    </section>
    <section class="link-groups">
      ${hyogoEventCard()}
      ${linkGroup("WRO ホームページ", [
        ["WRO Japan", "2026年シーズンの国内情報", "https://www.wroj.org/action/2026"],
        ["WRO 国際", "World Robot Olympiad公式サイト", "https://wro-association.org/"],
        ["WRO兵庫", "兵庫地区の大会・予選会情報", "https://wro-hyogo.jp/"],
      ])}
      ${linkGroup("ルール関連", [
        ["Google翻訳", "RoboMission JuniorルールのGoogle翻訳版", GOOGLE_TRANSLATED_RULES_URL],
        ["世界大会ルール", "RoboMission Juniorの世界大会ルール", WORLD_RULES_URL],
        ["兵庫予選会 ルール補足及びローカルルール", "兵庫予選会で適用される補足・ローカルルール", HYOGO_LOCAL_RULES_URL],
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
        <p><strong>開発支援：</strong>OpenAI ChatGPT / Codex</p>
      </article>
    </section>
  `, { back: "score", title: "リンク・大会情報" });
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
      <section class="judging-rules" aria-label="判定ルール">
        <h3>判定ルール</h3>
        <div>${group.rules.map((rule) => `<article><span class="photo-label ${rule.label === "満点" ? "full" : rule.label === "部分点" ? "partial" : rule.score === "0点" ? "zero" : "info"}">${rule.score}</span><p><strong>${escapeHtml(rule.label)}</strong>${escapeHtml(rule.description)}</p></article>`).join("")}</div>
      </section>
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
      if (target === "rules") prepareRulesConnections();
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
      const sameRoute = location.hash === `#/${target}`;
      location.hash = `#/${target}`;
      if (target === "records" && sameRoute) void loadRecords();
      if (target === "memo" && sameRoute) void loadMemoData();
      if (target === "news" && sameRoute) void loadHyogoNews();
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
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-record-filter]").forEach((input) => {
    if (input.dataset.recordFilter !== "query") {
      input.addEventListener("change", () => {
        updateRecordFiltersFromInputs();
        recordVisibleCount = RECORD_PAGE_SIZE;
        render();
      });
    }
  });
  document.querySelector<HTMLInputElement>('[data-record-filter="query"]')?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      updateRecordFiltersFromInputs();
      recordVisibleCount = RECORD_PAGE_SIZE;
      render();
    }
  });
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) =>
    element.addEventListener("click", (event) => {
      if (element.classList.contains("modal-backdrop") && event.target !== element) return;
      handleAction(element.dataset.action!, element);
    }),
  );
  document.querySelector<HTMLInputElement>("#account-key-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loginAccount();
  });
  const switchInput = document.querySelector<HTMLInputElement>("#switch-account-key-input");
  switchInput?.addEventListener("input", () => { accountSwitchDraft = switchInput.value; });
  document.querySelector<HTMLInputElement>("#remember-switch-account-input")?.addEventListener("change", (event) => {
    accountSwitchRemember = (event.currentTarget as HTMLInputElement).checked;
  });
  document.querySelector<HTMLFormElement>("[data-account-switch-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void loginAccount(true);
  });
  if (accountSwitchOpen && switchInput && document.activeElement !== switchInput) {
    window.requestAnimationFrame(() => switchInput.focus());
  }
  document.querySelector<HTMLInputElement>("#admin-password-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loginAdmin();
  });
  attachCameraPreview();
}

function prepareRulesConnections() {
  if (rulesConnectionsPrepared) return;
  rulesConnectionsPrepared = true;
  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = "https://docs.google.com";
  preconnect.crossOrigin = "anonymous";
  document.head.appendChild(preconnect);
  const drivePreconnect = document.createElement("link");
  drivePreconnect.rel = "preconnect";
  drivePreconnect.href = "https://drive.google.com";
  document.head.appendChild(drivePreconnect);
  const dnsPrefetch = document.createElement("link");
  dnsPrefetch.rel = "dns-prefetch";
  dnsPrefetch.href = "https://lh3.googleusercontent.com";
  document.head.appendChild(dnsPrefetch);
}

function parkRulesFrame() {
  const connectedFrames = Object.values(persistentRulesFrames).filter((frame) => frame?.isConnected);
  if (!connectedFrames.length) return;
  if (!rulesFrameParking) {
    rulesFrameParking = document.createElement("div");
    rulesFrameParking.className = "rules-frame-parking";
    rulesFrameParking.setAttribute("aria-hidden", "true");
    document.body.appendChild(rulesFrameParking);
  }
  connectedFrames.forEach((frame) => rulesFrameParking?.appendChild(frame!));
}

function attachRulesFrame() {
  const host = document.querySelector<HTMLElement>("[data-rules-frame-host]");
  if (!host) return;
  let frame = persistentRulesFrames[activeRulesDocument];
  if (!frame) {
    const useDriveViewer = isAppleTouchDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    frame = document.createElement("iframe");
    frame.src = activeRulesDocument === "hyogo"
      ? HYOGO_LOCAL_RULES_PREVIEW_URL
      : activeRulesDocument === "general"
        ? GENERAL_TRANSLATED_RULES_PREVIEW_URL
        : useDriveViewer ? RULES_GOOGLE_VIEWER_URL : `${RULES_PDF_URL}#page=1&zoom=page-width`;
    frame.loading = "eager";
    frame.allow = "fullscreen";
    frame.referrerPolicy = "no-referrer";
    frame.title = activeRulesDocument === "hyogo"
      ? "兵庫予選会 ルール補足及びローカルルールPDF"
      : activeRulesDocument === "general"
        ? "Google翻訳版 General Rules PDF"
        : "WRO 2026 RoboMission Junior Google翻訳版ルールPDF";
    persistentRulesFrames[activeRulesDocument] = frame;
  }
  host.appendChild(frame);
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
  if (action === "open-account-switch") { accountError = ""; accountSwitchDraft = ""; accountSwitchRemember = false; accountSwitchOpen = true; render(); }
  if (action === "close-account-switch") { accountSwitchOpen = false; accountSwitchDraft = ""; accountSwitchRemember = false; accountError = ""; render(); }
  if (action === "login-admin") void loginAdmin();
  if (action === "logout-admin") logoutAdmin();
  if (action === "load-accounts") void loadManagedAccounts();
  if (action === "create-account") void saveManagedAccount();
  if (action === "update-account") void saveManagedAccount(element.dataset.accountId);
  if (action === "load-records") void loadRecords();
  if (action === "edit-board") openCourtBoard(element);
  if (action === "load-news") void loadHyogoNews();
  if (action === "scroll-news-section") {
    const target = element.dataset.newsTarget;
    if (target === "news-event" || target === "news-app-updates") {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  if (action === "load-memo-data") void loadMemoData();
  if (action === "apply-record-filters") { updateRecordFiltersFromInputs(); recordVisibleCount = RECORD_PAGE_SIZE; render(); }
  if (action === "reset-record-filters") { resetRecordFilters(); recordVisibleCount = RECORD_PAGE_SIZE; render(); }
  if (action === "show-more-records") { recordVisibleCount += RECORD_PAGE_SIZE; render(); }
  if (action === "save-record-memo") void saveRecordMemo(element);
  if (action === "save-free-memo") void saveFreeMemo(element);
  if (action === "delete-free-memo") void deleteFreeMemo(element);
  if (action === "delete-record") void deleteRecord(element);
  if (action === "play-record-video") void playRecordVideo(element);
  if (action === "close-record-video") closeRecordVideo();
  if (action === "remove-video") { selectedVideo = null; videoSelectionError = ""; render(); }
  if (action === "retry-video-upload") void retryPendingVideoUpload();
  if (action === "camera-start") void startCameraRecording();
  if (action === "camera-stop") stopCameraRecording();
  if (action === "camera-expand") enterCameraFullscreen();
  if (action === "camera-collapse") exitCameraFullscreen();
  if (action === "timer-start") startStopwatch(true, !element.closest(".camera-preview-wrap"));
  if (action === "timer-lap") addStopwatchLap();
  if (action === "timer-pause") pauseStopwatch();
  if (action === "timer-resume") startStopwatch(false, !element.closest(".camera-preview-wrap"));
  if (action === "timer-finish") finishStopwatch();
  if (action === "timer-expand") enterStopwatchFullscreen();
  if (action === "timer-collapse") exitStopwatchFullscreen();
  if (action === "pdf-expand") enterPdfFullscreen();
  if (action === "pdf-collapse") exitPdfFullscreen();
  if (action === "select-rule-document") {
    const document = element.dataset.ruleDocument;
    if (document === "translated" || document === "general" || document === "hyogo") {
      activeRulesDocument = document;
      render();
    }
  }
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

function startStopwatch(reset: boolean, expand = true) {
  if (reset) {
    stopwatchElapsedMs = 0;
    stopwatchLaps = [];
  }
  stopwatchStartedAt = performance.now();
  stopwatchStatus = "running";
  if (expand) enterStopwatchFullscreen();
  else refreshStopwatch();
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
  if (document.body.classList.contains("camera-mode")) {
    refreshStopwatch();
    return;
  }
  const finish = () => {
    document.body.classList.remove("stopwatch-mode");
    render();
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined).finally(finish);
  } else {
    finish();
  }
}

function refreshStopwatch() {
  const stopwatch = document.querySelector<HTMLElement>(".stopwatch");
  if (stopwatch) {
    stopwatch.innerHTML = stopwatchContents();
    stopwatch.querySelectorAll<HTMLElement>("[data-action]").forEach((element) =>
      element.addEventListener("click", () => handleAction(element.dataset.action!, element)),
    );
    const laps = stopwatch.querySelector<HTMLOListElement>(".stopwatch-laps");
    if (laps) laps.scrollTop = laps.scrollHeight;
  }
  const cameraStopwatch = document.querySelector<HTMLElement>("[data-camera-stopwatch-overlay]");
  if (cameraStopwatch) {
    cameraStopwatch.innerHTML = cameraStopwatchContents();
    cameraStopwatch.querySelectorAll<HTMLElement>("[data-action]").forEach((element) =>
      element.addEventListener("click", () => handleAction(element.dataset.action!, element)),
    );
  }
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
    const formatted = formatStopwatch(currentStopwatchElapsed());
    document.querySelectorAll<HTMLElement>("[data-stopwatch-display], [data-camera-stopwatch-display]").forEach((display) => {
      display.textContent = formatted;
    });
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
  const targetAccount = activeAccount === "ADMIN"
    ? document.querySelector<HTMLSelectElement>("[data-admin-score-account]")?.value ?? ""
    : activeAccount;
  if (!targetAccount) { sheetStatus = "保存先アカウントを選択してください。"; render(); return; }
  sheetSending = true;
  sheetStatus = "得点を保存中…"; render();
  const videoFile = selectedVideo;
  const preparedVideo = videoFile ? fileToStoredVideo(videoFile) : null;
  try {
    const result = await postJson<{ ok?: boolean; message?: string; rowNumber?: number; recordedAt?: string }>(endpoint, resultPayload(targetAccount), new AbortController(), 15000);
    if (!result.ok) throw new Error(result.message || "GASで保存できませんでした");
    if (videoFile && preparedVideo && Number.isInteger(result.rowNumber) && result.recordedAt) {
      pendingVideoUpload = {
        file: videoFile,
        apiKey: activeApiKey,
        account: targetAccount,
        rowNumber: result.rowNumber!,
        recordedAt: result.recordedAt,
        status: "uploading",
        message: "得点を保存しました。動画をバックグラウンドで送信中…",
      };
    }
    resetStopwatch();
    selectedVideo = null;
    videoSelectionError = "";
    state = makeInitialState();
    saveState();
    sheetStatus = "";
    pendingRequestId = createRequestId();
    location.hash = "#/score";
    render();
    if (pendingVideoUpload && preparedVideo) void uploadPendingVideo(preparedVideo);
    return;
  } catch (error) {
    sheetStatus = `送信できませんでした。${communicationError(error)}`;
  } finally {
    sheetSending = false;
  }
  render();
}

async function uploadPendingVideo(preparedVideo?: Promise<StoredVideo>) {
  const upload = pendingVideoUpload;
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!upload || !endpoint) return;
  upload.status = "uploading";
  upload.message = "得点を保存しました。動画をバックグラウンドで送信中…";
  render();
  try {
    const video = preparedVideo ? await preparedVideo : await fileToStoredVideo(upload.file);
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, {
      action: "attachVideo",
      apiKey: upload.apiKey,
      account: upload.account,
      rowNumber: upload.rowNumber,
      recordedAt: upload.recordedAt,
      video,
    }, new AbortController(), 90000);
    if (!result.ok) throw new Error(result.message || "動画を保存できませんでした");
    pendingVideoUpload = null;
    systemNotice = "動画の保存が完了しました。";
    render();
    window.setTimeout(() => { systemNotice = ""; render(); }, 4000);
  } catch (error) {
    if (pendingVideoUpload !== upload) return;
    upload.status = "failed";
    upload.message = `得点は保存済みです。動画だけ送信できませんでした。${communicationError(error)}`;
    render();
  }
}

async function retryPendingVideoUpload() {
  if (!pendingVideoUpload || pendingVideoUpload.status === "uploading") return;
  await uploadPendingVideo();
}

function resultPayload(targetAccount?: string, video?: StoredVideo) {
  const scores = sectionScores(state);
  return {
    apiKey: activeApiKey,
    account: targetAccount || activeAccount,
    requestId: pendingRequestId,
    recordedAt: new Date().toISOString(),
    timeSeconds: state.timeSeconds,
    notes: state.notes,
    board: serializeCourtBoard(state.board),
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
  const remember = fromSwitch ? accountSwitchRemember : document.querySelector<HTMLInputElement>("#remember-account-input")?.checked ?? false;
  const key = input?.value.trim() ?? "";
  if (fromSwitch) accountSwitchDraft = key;
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
      if (activeAccount !== "ADMIN") void clearRecordVideoCache();
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
      accountSwitchDraft = "";
      accountSwitchRemember = false;
      accountSwitchOpen = false;
      managedAccounts = [];
      practiceRecords = [];
      freeMemos = [];
      freeMemoStatus = "";
      recordsStatus = "";
      resetRecordFilters();
      resetStopwatch();
      const routeChanged = location.hash !== "#/admin";
      location.hash = "#/admin";
      render();
      if (!routeChanged) { void loadRecords(); void loadManagedAccounts(); }
      return;
    }
    if (activeAccount !== verifiedAccount) void clearRecordVideoCache();
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
    accountSwitchDraft = "";
    accountSwitchRemember = false;
    accountSwitchOpen = false;
    practiceRecords = [];
    freeMemos = [];
    freeMemoStatus = "";
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
    if (activeAccount !== "ADMIN") void clearRecordVideoCache();
    activeAccount = "ADMIN";
    activeApiKey = password;
    adminError = "";
    practiceRecords = [];
    freeMemos = [];
    freeMemoStatus = "";
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
  void clearRecordVideoCache();
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
  freeMemos = [];
  freeMemoStatus = "";
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

async function loadManagedAccounts(shouldRender = true) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || activeAccount !== "ADMIN" || !activeApiKey) return;
  accountManagementStatus = "アカウント情報を読み込み中…";
  if (shouldRender) render();
  try {
    const result = await postJson<{ ok?: boolean; accounts?: ManagedAccount[]; message?: string }>(endpoint, { action: "accounts", apiKey: activeApiKey });
    if (!result.ok) throw new Error(result.message || "アカウント情報を取得できませんでした");
    managedAccounts = sanitizeManagedAccounts(result.accounts);
    accountManagementStatus = `${managedAccounts.length}件のアカウントを管理中`;
  } catch (error) {
    accountManagementStatus = `読み込めませんでした。${communicationError(error)}`;
  }
  if (shouldRender) render();
}

async function saveManagedAccount(accountId?: string) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || activeAccount !== "ADMIN" || !activeApiKey) return;
  const nameInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-name="${accountId}"]` : "#new-account-name");
  const keyInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-key="${accountId}"]` : "#new-account-key");
  const name = nameInput?.value.trim() ?? "";
  const newApiKey = keyInput?.value.trim() ?? "";
  if (!name || (!accountId && !newApiKey)) {
    accountManagementStatus = !name ? "チーム名を入力してください。" : "APIキーを入力してください。";
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

async function loadRecords(shouldRender = true) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount || !activeApiKey) {
    recordsStatus = "記録先がまだ設定されていません。";
    if (shouldRender) render();
    return;
  }
  recordsStatus = "読み込み中…";
  if (shouldRender) render();
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
  if (shouldRender) render();
}

function configureRecordsAutoRefresh() {
  if (recordsAutoRefreshTimer !== null) window.clearInterval(recordsAutoRefreshTimer);
  recordsAutoRefreshTimer = null;
  if (!activeAccount || (location.hash !== "#/records" && location.hash !== "#/memo")) return;
  if (location.hash === "#/memo") {
    void loadMemoData();
    return;
  }
  void loadRecords();
  recordsAutoRefreshTimer = window.setInterval(() => {
    if (!document.hidden && location.hash === "#/records") void loadRecords();
  }, 60000);
}

async function loadMemoData() {
  recordsStatus = "読み込み中…";
  freeMemoStatus = "メモを読み込み中…";
  if (activeAccount === "ADMIN") accountManagementStatus = "アカウント情報を読み込み中…";
  render();
  await Promise.all([
    loadRecords(false),
    loadFreeMemos(false),
    ...(activeAccount === "ADMIN" ? [loadManagedAccounts(false)] : []),
  ]);
  render();
}

async function loadFreeMemos(shouldRender = true) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount || !activeApiKey) {
    freeMemoStatus = "メモの保存先がまだ設定されていません。";
    if (shouldRender) render();
    return;
  }
  freeMemoStatus = "メモを読み込み中…";
  if (shouldRender) render();
  try {
    const result = await postJson<{ ok?: boolean; memos?: Array<Partial<FreeMemo> & { board?: unknown }>; message?: string }>(endpoint, { action: "freeMemos", apiKey: activeApiKey });
    if (!result.ok) throw new Error(result.message || "メモを取得できませんでした");
    freeMemos = (Array.isArray(result.memos) ? result.memos : []).filter((memo) =>
      memo && typeof memo.memoId === "string" && typeof memo.content === "string",
    ).map((memo) => ({
      account: String(memo.account || ""), accountName: String(memo.accountName || ""), memoId: String(memo.memoId || "").slice(0, 80),
      createdAt: String(memo.createdAt || ""), updatedAt: String(memo.updatedAt || ""), content: String(memo.content || "").slice(0, 1000), board: sanitizeCourtBoard(memo.board),
    }));
    freeMemoStatus = freeMemos.length ? `${freeMemos.length}件のメモを表示中` : "メモはまだありません。";
  } catch (error) {
    freeMemoStatus = `メモを読み込めませんでした。${communicationError(error)}`;
  }
  if (shouldRender) render();
}

async function saveFreeMemo(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const card = element.closest<HTMLElement>("[data-free-memo]");
  const content = card?.querySelector<HTMLTextAreaElement>("[data-free-memo-content]")?.value.trim() ?? "";
  const memoId = element.dataset.memoId ?? "";
  const selectedAccount = card?.querySelector<HTMLSelectElement>("[data-free-memo-account-select]")?.value ?? "";
  const memoAccount = element.dataset.memoAccount || selectedAccount || activeAccount || "";
  const currentBoard = memoId
    ? freeMemos.find((memo) => memo.memoId === memoId && memo.account === memoAccount)?.board ?? emptyCourtBoard()
    : newFreeMemoBoard;
  if (!content && !currentBoard.elements.length) { freeMemoStatus = "メモの内容またはコート書き込みを入力してください。"; render(); return; }
  if (activeAccount === "ADMIN" && !memoId && !selectedAccount) { freeMemoStatus = "保存先アカウントを選択してください。"; render(); return; }
  if (!endpoint || !activeApiKey || !activeAccount) return;
  const previousMemos = freeMemos.map((memo) => ({ ...memo }));
  const now = new Date().toISOString();
  const optimisticId = memoId || `saving-${Date.now()}`;
  const accountName = managedAccounts.find((account) => account.id === memoAccount)?.name || activeAccountName || memoAccount;
  const existingIndex = freeMemos.findIndex((memo) => memo.memoId === memoId && memo.account === memoAccount);
  const optimisticMemo: FreeMemo = { account: memoAccount, accountName, memoId: optimisticId, createdAt: now, updatedAt: now, content, board: cloneCourtBoard(currentBoard) };
  if (existingIndex >= 0) freeMemos[existingIndex] = { ...freeMemos[existingIndex], content, board: cloneCourtBoard(currentBoard), updatedAt: now };
  else freeMemos = [optimisticMemo, ...freeMemos];
  freeMemoStatus = "メモを保存中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; memo?: Partial<FreeMemo>; message?: string }>(endpoint, {
      action: "saveFreeMemo", apiKey: activeApiKey, account: memoAccount, memoId, content, board: serializeCourtBoard(currentBoard),
    });
    if (!result.ok) throw new Error(result.message || "メモを保存できませんでした");
    if (!memoId && result.memo?.memoId) {
      freeMemos = freeMemos.map((memo) => memo.memoId === optimisticId ? {
        ...memo, memoId: String(result.memo!.memoId), createdAt: String(result.memo!.createdAt || now), updatedAt: String(result.memo!.updatedAt || now),
      } : memo);
    }
    if (!memoId) newFreeMemoBoard = emptyCourtBoard();
    freeMemoStatus = "メモを保存しました。";
  } catch (error) {
    freeMemos = previousMemos;
    freeMemoStatus = `メモを保存できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
  }
  render();
}

async function deleteFreeMemo(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const memoId = element.dataset.memoId ?? "";
  const memoAccount = element.dataset.memoAccount ?? activeAccount ?? "";
  if (!endpoint || !activeApiKey || !activeAccount || !memoId || !confirm("このメモを削除しますか？")) return;
  const previousMemos = freeMemos;
  freeMemos = freeMemos.filter((memo) => !(memo.memoId === memoId && memo.account === memoAccount));
  freeMemoStatus = "メモを削除中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, {
      action: "deleteFreeMemo", apiKey: activeApiKey, account: memoAccount, memoId,
    });
    if (!result.ok) throw new Error(result.message || "メモを削除できませんでした");
    freeMemoStatus = "メモを削除しました。";
    render();
  } catch (error) {
    freeMemos = previousMemos;
    freeMemoStatus = `メモを削除できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
    render();
  }
}

async function saveRecordMemo(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const card = element.closest<HTMLElement>("[data-memo-record]");
  const notes = card?.querySelector<HTMLTextAreaElement>("[data-record-memo]")?.value.trim() ?? "";
  const rowNumber = Number(element.dataset.recordRow);
  const recordedAt = element.dataset.recordedAt ?? "";
  const recordAccount = element.dataset.recordAccount ?? activeAccount ?? "";
  if (!endpoint || !activeAccount || !activeApiKey || !Number.isInteger(rowNumber) || rowNumber < 2) return;
  const record = practiceRecords.find((item) => item.account === recordAccount && item.rowNumber === rowNumber && item.recordedAt === recordedAt);
  const previousNotes = record?.notes ?? "";
  const previousBoard = cloneCourtBoard(record?.board ?? emptyCourtBoard());
  if (record) record.notes = notes;
  recordsStatus = "メモを保存中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, {
      action: "saveMemo", apiKey: activeApiKey, account: recordAccount, rowNumber, recordedAt, notes, board: serializeCourtBoard(record?.board ?? emptyCourtBoard()),
    });
    if (!result.ok) throw new Error(result.message || "メモを保存できませんでした");
    recordsStatus = "メモを保存しました。";
  } catch (error) {
    if (record) { record.notes = previousNotes; record.board = previousBoard; }
    recordsStatus = `メモを保存できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
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
    const cachedVideo = await getCachedRecordVideo(recordAccount, rowNumber, recordedAt);
    if (cachedVideo) {
      closeRecordVideo(false);
      recordVideoModal = { url: URL.createObjectURL(cachedVideo.blob), name: cachedVideo.name };
      recordsStatus = "端末に保存した動画を表示中";
      render();
      return;
    }
    const result = await postJson<{ ok?: boolean; video?: StoredVideo; message?: string }>(endpoint, {
      action: "video", apiKey: activeApiKey, account: recordAccount, rowNumber, recordedAt,
    }, new AbortController(), 90000);
    if (!result.ok || !result.video) throw new Error(result.message || "動画を取得できませんでした");
    const video = result.video;
    if (!video.type.startsWith("video/") || video.size <= 0 || video.size > MAX_VIDEO_BYTES || !video.base64) {
      throw new Error("動画データが無効です。");
    }
    closeRecordVideo(false);
    const blob = base64ToBlob(video.base64, video.type);
    recordVideoModal = { url: URL.createObjectURL(blob), name: video.name };
    void cacheRecordVideo(recordAccount, rowNumber, recordedAt, video.name, blob);
    recordsStatus = `${practiceRecords.length}件の記録を表示中`;
  } catch (error) {
    recordsStatus = `動画を読み込めませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
  }
  render();
}

function recordVideoCacheUrl(account: string, rowNumber: number, recordedAt: string) {
  const url = new URL(`${import.meta.env.BASE_URL}__record_video_cache__`, location.origin);
  url.searchParams.set("account", account);
  url.searchParams.set("row", String(rowNumber));
  url.searchParams.set("date", recordedAt);
  return url.toString();
}

async function getCachedRecordVideo(account: string, rowNumber: number, recordedAt: string) {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(RECORD_VIDEO_CACHE_NAME);
    const request = recordVideoCacheUrl(account, rowNumber, recordedAt);
    const response = await cache.match(request);
    if (!response) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("video/") || blob.size <= 0 || blob.size > MAX_VIDEO_BYTES) {
      await cache.delete(request);
      return null;
    }
    const encodedName = response.headers.get("x-video-name") || "record-video";
    return { blob, name: decodeURIComponent(encodedName) };
  } catch {
    return null;
  }
}

async function cacheRecordVideo(account: string, rowNumber: number, recordedAt: string, name: string, blob: Blob) {
  if (!("caches" in window) || !blob.type.startsWith("video/") || blob.size > MAX_VIDEO_BYTES) return;
  try {
    const cache = await caches.open(RECORD_VIDEO_CACHE_NAME);
    const request = recordVideoCacheUrl(account, rowNumber, recordedAt);
    const existing = await cache.match(request);
    if (!existing) {
      const keys = [...await cache.keys()];
      while (keys.length >= MAX_CACHED_RECORD_VIDEOS) {
        const oldest = keys.shift();
        if (oldest) await cache.delete(oldest);
      }
    }
    await cache.put(request, new Response(blob, { headers: { "content-type": blob.type, "x-video-name": encodeURIComponent(name) } }));
  } catch {
    // Storage limits vary by browser. Playback still works without the local cache.
  }
}

async function clearRecordVideoCache() {
  if (!("caches" in window)) return;
  try { await caches.delete(RECORD_VIDEO_CACHE_NAME); } catch { /* キャッシュ非対応端末 */ }
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

function sanitizeNews(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).filter((item): item is NewsItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<NewsItem>;
    try {
      return candidate.source === "兵庫" && typeof candidate.title === "string" && candidate.title.length > 0 && candidate.title.length <= 160 && typeof candidate.updatedAt === "string" && /^\d{4}\.\d{2}\.\d{2}$/.test(candidate.updatedAt) && typeof candidate.url === "string" && new URL(candidate.url).origin === "https://wro-hyogo.jp";
    } catch { return false; }
  });
}

function loadNewsCache(): NewsItem[] {
  try {
    const cached = sanitizeNews(JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null"));
    return cached.length ? cached : FALLBACK_HYOGO_NEWS;
  } catch { return FALLBACK_HYOGO_NEWS; }
}

async function loadHyogoNews() {
  if (newsLoading) return;
  newsLoading = true;
  newsStatus = "兵庫予選会サイトの最新情報を確認しています…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; news?: unknown; message?: string }>(DEFAULT_GAS_WEB_APP_URL, { action: "news" }, new AbortController(), 10000);
    const latest = sanitizeNews(result.news);
    if (!result.ok || !latest.length) throw new Error(result.message || "最新情報を取得できませんでした。");
    newsItems = latest;
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(latest));
    newsStatus = "兵庫予選会公式サイトから最新3件を取得しました。";
  } catch {
    newsStatus = "通信できなかったため、保存済みのお知らせを表示しています。";
  } finally {
    newsLoading = false;
    if (location.hash === "#/news") render();
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
  }).map((record) => ({ ...record, board: sanitizeCourtBoard((record as PracticeRecord & { board?: unknown }).board) }));
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
