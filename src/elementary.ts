import "./elementary.css";
import { DEFAULT_GAS_WEB_APP_URL } from "./config";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";

type Mode = "score" | "judging" | "course" | "rules" | "links" | "result" | "login" | "admin";
type ScoreValue = 0 | 5 | 10 | 15 | 20;
type ElementaryJudgeGroupId = "cables" | "prepare" | "notes" | "bonus";

interface ElementaryAccount {
  apiKey: string;
  account: string;
  accountName: string;
  remember: boolean;
}

interface ManagedAccount {
  id: string;
  name: string;
  legacy?: boolean;
  hasApiKey?: boolean;
  app?: "shared" | "junior" | "elementary";
}

interface StoredVideo {
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface ElementaryState {
  timeSeconds: number | null;
  memo: string;
  cables: ScoreValue[];
  microphone: ScoreValue;
  instruments: ScoreValue[];
  notes: ScoreValue[];
  bonusClef: ScoreValue;
  bonusSpeakers: ScoreValue[];
  bonusAmplifier: ScoreValue;
  updatedAt: string;
}

interface MissionRow {
  section: keyof ElementaryScoreBreakdown;
  key: keyof Pick<ElementaryState, "cables" | "instruments" | "notes" | "bonusSpeakers"> | "microphone" | "bonusClef" | "bonusAmplifier";
  index?: number;
  label: string;
  high?: [ScoreValue, string];
  partial?: [ScoreValue, string];
  max: number;
}

interface ElementaryScoreBreakdown {
  cables: number;
  prepare: number;
  notes: number;
  bonus: number;
}

const ELEMENTARY_VERSION = "0.4.19";
const MAX_SCORE = 255;
const STORAGE_KEY = "robomission-elementary-score-v1";
const ACCOUNT_KEY = "robomission-elementary-account-v1";
const COURSE_IMAGE = `${import.meta.env.BASE_URL}assets/elementary/memo/elementary-course.webp`;
const RULE_PDF = `${import.meta.env.BASE_URL}assets/elementary/rules/WRO-2026-RoboMission-Elementary-Game-Rules.pdf`;
const RULES_PDF_CACHE_NAME = "robomission-rules-pdf-v2";
const JUDGING_IMAGE_BASE = `${import.meta.env.BASE_URL}assets/elementary/judging/`;
const JUNIOR_APP_URL = "https://ecleaire.github.io/ROBOMISSION_POINTToul/";
const ELEMENTARY_APP_URL = "https://ecleaire.github.io/ROBOMISSION_POINTToul/elementary/";
const NOTE_LABELS = ["赤の音符", "青の音符", "緑の音符", "黄色の音符", "白の音符", "黒の音符"];

let mode: Mode = modeFromHash();
let state = loadState();
let account = loadAccount();
let loginError = "";
let adminMode = account?.account === "ADMIN";
let adminStatus = "";
let managedAccounts: ManagedAccount[] = [];
let saveStatus = "";
let judgeModal: ElementaryJudgeGroupId | null = null;
let elementaryOnline = navigator.onLine;
let stopwatch: { status: "idle" | "running" | "paused"; startedAt: number; elapsedMs: number } = {
  status: "idle",
  startedAt: 0,
  elapsedMs: Math.round((state.timeSeconds ?? 0) * 1000),
};
let timerId = 0;
let stopwatchLaps: number[] = [];
let nativeFullscreenTarget: "stopwatch" | null = null;
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let videoChunks: Blob[] = [];
let recordedVideo: File | null = null;
let recordingStatus: "idle" | "starting" | "recording" | "processing" = "idle";
let recordingStartedAt = 0;
let recordingElapsedMs = 0;
const rulesPdfCacheTasks = new Set<string>();

const app = document.querySelector<HTMLDivElement>("#elementary-app")!;

function makeInitialState(): ElementaryState {
  return {
    timeSeconds: null,
    memo: "",
    cables: [0, 0],
    microphone: 0,
    instruments: [0, 0, 0],
    notes: [0, 0, 0, 0, 0, 0],
    bonusClef: 0,
    bonusSpeakers: [0, 0],
    bonusAmplifier: 0,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeState(value: unknown): ElementaryState {
  const initial = makeInitialState();
  if (!value || typeof value !== "object") return initial;
  const saved = value as Partial<ElementaryState>;
  const scoreArray = (source: unknown, length: number, allowed: ScoreValue[]) => {
    const values = Array.isArray(source) ? source : [];
    return Array.from({ length }, (_, index) => allowed.includes(values[index]) ? values[index] as ScoreValue : 0);
  };
  const score = (source: unknown, allowed: ScoreValue[]) => allowed.includes(source as ScoreValue) ? source as ScoreValue : 0;
  return {
    timeSeconds: typeof saved.timeSeconds === "number" && Number.isFinite(saved.timeSeconds) && saved.timeSeconds >= 0 ? saved.timeSeconds : null,
    memo: typeof saved.memo === "string" ? saved.memo.slice(0, 800) : "",
    cables: scoreArray(saved.cables, 2, [0, 5, 15]),
    microphone: score(saved.microphone, [0, 10, 20]),
    instruments: scoreArray(saved.instruments, 3, [0, 15]),
    notes: scoreArray(saved.notes, 6, [0, 10, 20]),
    bonusClef: score(saved.bonusClef, [0, 10]),
    bonusSpeakers: scoreArray(saved.bonusSpeakers, 2, [0, 10]),
    bonusAmplifier: score(saved.bonusAmplifier, [0, 10]),
    updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : initial.updatedAt,
  };
}

function sectionScores(s = state): ElementaryScoreBreakdown {
  return {
    cables: sum(s.cables),
    prepare: s.microphone + sum(s.instruments),
    notes: sum(s.notes),
    bonus: s.bonusClef + sum(s.bonusSpeakers) + s.bonusAmplifier,
  };
}

function totalScore(s = state) {
  return Object.values(sectionScores(s)).reduce((total, value) => total + value, 0);
}

function render() {
  const title = modeTitle(mode);
  app.innerHTML = `
    <header class="elementary-header">
      <div class="elementary-brand">
        <div>
          <p>2026 / ROBOMISSION</p>
          <h1>RoboMission Elementary Assist <span>v${ELEMENTARY_VERSION}</span></h1>
        </div>
        <span class="elementary-current-mode">${title}</span>
      </div>
      <nav aria-label="Elementary menu">
        ${navButton("score", "採点")}
        ${navButton("judging", "判定写真")}
        ${navButton("course", "コース")}
        ${navButton("rules", "ルール")}
        ${navButton("links", account ? "リンク・大会情報" : "リンク")}
        ${navButton("login", account ? "ログイン中" : "ログイン")}
        ${adminMode ? navButton("admin", "管理") : ""}
      </nav>
    </header>
    <div class="elementary-account-bar ${account ? "logged-in" : ""}">
      ${account ? `<span>ログイン中：${escapeHtml(account.accountName || account.account)}</span><button type="button" data-action="logout">ログアウト</button>` : `<span>未ログイン：採点・ストップウォッチ・判定写真・ルール確認は使用できます。録画・記録保存はログイン後に使えます。</span><button type="button" data-mode="login">ログイン</button>`}
    </div>
    <main class="elementary-main">
      ${mode === "score" ? scoreView() : mode === "judging" ? judgingView() : mode === "course" ? courseView() : mode === "rules" ? rulesView() : mode === "links" ? linksView() : mode === "login" ? loginView() : mode === "admin" ? adminView() : resultView()}
    </main>
    ${floatingStopwatchView()}
    ${judgeModal ? judgeModalView(judgeModal) : ""}
  `;
  bindEvents();
  if (mode === "rules") void cacheElementaryRulesPdfForNextView();
}

function navButton(target: Mode, label: string) {
  return `<button type="button" class="${mode === target ? "active" : ""}" data-mode="${target}">${label}</button>`;
}

function modeTitle(target: Mode) {
  const labels: Record<Mode, string> = {
    score: "採点",
    judging: "判定写真",
    course: "コース",
    rules: "ルール",
    links: account ? "リンク・大会情報" : "リンク",
    result: "結果",
    login: "アカウント",
    admin: "管理",
  };
  return labels[target] ?? "採点";
}

function modeFromHash(): Mode {
  const value = location.hash.replace(/^#\/?/, "") as Mode;
  return ["score", "judging", "course", "rules", "links", "result", "login", "admin"].includes(value) ? value : "score";
}

function scoreView() {
  const scores = sectionScores();
  const total = totalScore();
  return `
    <aside class="elementary-save-state-strip" aria-label="保存状況"><span class="${elementaryOnline ? "online" : "offline"}">${elementaryOnline ? "● オンライン" : "● オフライン"}</span><strong>入力内容は端末に保存済み</strong><span>送信待ちなし</span></aside>
    <section class="elementary-score-card">
      <div class="elementary-title-bar">WRO 2026 RoboMission Elementary　得点チェック</div>
      ${stopwatchView()}
      ${videoRecorderView()}
      <div class="elementary-guide">① ロボットの結果を見る　② 当てはまる□にチェック　③ 合計点を確認</div>
      <div class="elementary-sheet" role="table" aria-label="Elementary scoring sheet">
        <div class="elementary-row elementary-columns"><strong>ミッション／対象</strong><strong>高得点</strong><strong>部分点</strong><strong>得点</strong><strong>最大得点</strong></div>
        ${sectionHeader("1. アンプとスピーカーをつなぐ", "cables")}
        ${sheetRows(cableRows())}
        ${subtotal(scores.cables, 30)}
        ${sectionHeader("2. ショーの準備をする", "prepare")}
        ${sheetRows(prepareRows())}
        ${subtotal(scores.prepare, 65)}
        ${sectionHeader("3. 曲を演奏する", "notes")}
        ${sheetRows(noteRows())}
        ${subtotal(scores.notes, 120)}
        ${sectionHeader("4. ボーナスポイント", "bonus")}
        ${sheetRows(bonusRows())}
        ${subtotal(scores.bonus, 40)}
        <div class="elementary-row elementary-total"><strong>合計得点</strong><span></span><span></span><strong>${total}</strong><strong>${MAX_SCORE}</strong></div>
        <div class="elementary-row elementary-maximum"><strong>満点</strong><span></span><span></span><strong>${MAX_SCORE}</strong><strong>${MAX_SCORE}</strong></div>
        <div class="elementary-sheet-footer-tools">
          ${timePicker(state.timeSeconds)}
          <section class="elementary-memo-card" aria-label="採点メモ">
            <label class="elementary-notes-card">メモ<textarea data-memo rows="2" maxlength="800" placeholder="ミスした部分、練習で気づいたことなど">${escapeHtml(state.memo)}</textarea></label>
          </section>
        </div>
      </div>
    </section>
    <div class="elementary-bottom-space"></div>
    <nav class="elementary-bottom">
      <button type="button" class="secondary" data-action="reset">採点をリセット</button>
      <button type="button" class="primary" data-mode="result"><span>結果を見る</span><strong>合計得点 ${total} / ${MAX_SCORE}点</strong></button>
    </nav>
  `;
}

function stopwatchView() {
  return `<section class="elementary-stopwatch">${stopwatchContents()}</section>`;
}

function stopwatchContents() {
  const elapsed = currentElapsedMs();
  const timerControls = stopwatch.status === "idle"
    ? `<button type="button" class="timer-lap" disabled>⚑ <span>ラップ</span></button><button type="button" class="timer-start" data-timer="start">◀ <span>スタート</span></button>${elapsed > 0 ? `<button type="button" class="timer-reset" data-timer="reset">↺ <span>リセット</span></button>` : ""}`
    : stopwatch.status === "running"
      ? `<button type="button" class="timer-lap" data-timer="lap">⚑ <span>ラップ</span></button><button type="button" class="timer-pause" data-timer="pause">Ⅱ <span>停止</span></button>`
      : `<button type="button" class="timer-finish" data-timer="finish">■ <span>タイマー終了</span></button><button type="button" class="timer-resume" data-timer="resume">◀ <span>再開</span></button>`;
  return `
    <div class="stopwatch-time"><span>STOPWATCH</span><strong data-elementary-stopwatch-display>${formatStopwatch(elapsed)}</strong></div>
    <div class="stopwatch-controls">
      ${timerControls}
      <button type="button" class="timer-expand" data-timer="expand" aria-label="ストップウォッチを全画面表示">⛶ <span>全画面</span></button>
      <button type="button" class="timer-collapse" data-timer="collapse">× <span>全画面解除</span></button>
    </div>
    ${stopwatchLaps.length ? `<ol class="stopwatch-laps" aria-label="ラップ記録">${stopwatchLaps.map((lap, index) => `<li><span>ラップ ${index + 1}</span><strong>${formatStopwatch(lap)}</strong></li>`).join("")}</ol>` : ""}
  `;
}

function floatingStopwatchView() {
  if (mode === "score" || stopwatch.status === "idle") return "";
  const actionButton = stopwatch.status === "running"
    ? `<button type="button" data-timer="pause">Ⅱ 停止</button>`
    : `<button type="button" data-timer="resume">▶ 再開</button>`;
  return `<aside class="floating-stopwatch" aria-label="継続中のストップウォッチ">
    <button type="button" class="floating-stopwatch-time" data-mode="score">
      <span>${stopwatch.status === "running" ? "計測中" : "一時停止"}</span>
      <strong data-floating-stopwatch-display>${formatStopwatch(currentElapsedMs())}</strong>
    </button>
    <div>
      ${stopwatch.status === "running" ? `<button type="button" data-timer="lap">⚑ ラップ</button>` : ""}
      ${actionButton}
      <button type="button" data-mode="score">採点へ</button>
    </div>
  </aside>`;
}

function videoRecorderView() {
  if (!account) return "";
  const recordingTime = recordingStatus === "recording" ? formatStopwatch(recordingElapsedMs || Date.now() - recordingStartedAt) : "";
  return `<section class="elementary-recorder ${recordingStatus === "recording" ? "recording" : ""}">
    <div><strong>動画録画</strong><span>${recordedVideo ? `${escapeHtml(recordedVideo.name)} / ${(recordedVideo.size / 1024 / 1024).toFixed(1)}MB` : recordingStatus === "recording" ? `録画中 ${recordingTime}` : "ログイン中のみ録画できます。保存時に得点と一緒に送信します。"}</span></div>
    <video data-recorder-preview autoplay muted playsinline></video>
    <div class="elementary-recorder-actions">
      ${recordingStatus === "recording" ? `<button type="button" class="danger" data-recording="stop">■ 停止</button>` : `<button type="button" class="primary" data-recording="start" ${recordingStatus !== "idle" ? "disabled" : ""}>● 録画開始</button>`}
      ${recordedVideo ? `<button type="button" class="secondary" data-recording="clear">動画を削除</button>` : ""}
    </div>
  </section>`;
}

function sectionHeader(label: string, groupId: ElementaryJudgeGroupId) {
  return `<div class="elementary-section"><strong>${label}</strong><button type="button" data-judge-modal="${groupId}">▧ 写真</button></div>`;
}

function timePicker(value: number | null) {
  const centiseconds = value === null ? null : Math.max(0, Math.round(value * 100));
  const minutes = centiseconds === null ? "" : String(Math.min(2, Math.max(0, Math.floor(centiseconds / 6000))));
  const seconds = centiseconds === null ? 0 : Math.floor((centiseconds % 6000) / 100);
  const hundredths = centiseconds === null ? 0 : centiseconds % 100;
  const numberOptions = (length: number, selected: number) => Array.from({ length }, (_, number) =>
    `<option value="${number}" ${number === selected ? "selected" : ""}>${String(number).padStart(2, "0")}</option>`,
  ).join("");
  return `<section class="elementary-time-card">
    <div><strong>競技時間</strong><small>タイマー終了時に自動反映・手動修正できます</small></div>
    <div class="elementary-time-selects">
      <label><select data-time-part="minutes" aria-label="競技時間の分"><option value="" ${minutes === "" ? "selected" : ""}>--</option><option value="0" ${minutes === "0" ? "selected" : ""}>0</option><option value="1" ${minutes === "1" ? "selected" : ""}>1</option><option value="2" ${minutes === "2" ? "selected" : ""}>2</option></select><span>分</span></label>
      <label><select data-time-part="seconds" aria-label="競技時間の秒">${numberOptions(60, seconds)}</select><span>秒</span></label>
      <label><select data-time-part="hundredths" aria-label="競技時間の100分の1秒">${numberOptions(100, hundredths)}</select><span>1/100秒</span></label>
    </div>
  </section>`;
}

function sheetRows(rows: MissionRow[]) {
  return rows.map((row) => {
    const score = getScore(row);
    return `<div class="elementary-row">
      <strong class="elementary-target">${escapeHtml(row.label)}</strong>
      ${row.high ? checkCell(row, row.high) : `<span class="elementary-empty">-</span>`}
      ${row.partial ? checkCell(row, row.partial) : `<span class="elementary-empty">-</span>`}
      <strong class="elementary-score ${score === 0 ? "zero" : ""}">${score}</strong>
      <strong class="elementary-max">${row.max}</strong>
    </div>`;
  }).join("");
}

function checkCell(row: MissionRow, option: [ScoreValue, string]) {
  const selected = getScore(row) === option[0];
  return `<button type="button" class="elementary-check ${selected ? "selected" : ""}" data-score-key="${row.key}" data-score-index="${row.index ?? ""}" data-score-value="${option[0]}">
    <span>${selected ? "✓" : ""}</span><small>${option[0]}点</small><em>${escapeHtml(option[1])}</em>
  </button>`;
}

function subtotal(score: number, max: number) {
  return `<div class="elementary-row elementary-subtotal"><strong>小計</strong><span></span><span></span><strong>${score}</strong><strong>${max}</strong></div>`;
}

function cableRows(): MissionRow[] {
  return [0, 1].map((index) => ({ section: "cables", key: "cables", index, label: `ケーブル ${index + 1}`, high: [15, "灰色エリア内・直立"], partial: [5, "一部だけ、または倒れている"], max: 15 }));
}

function prepareRows(): MissionRow[] {
  return [
    { section: "prepare", key: "microphone", label: "マイク", high: [20, "対象エリア内・直立"], partial: [10, "一部だけ、または倒れている"], max: 20 },
    ...["ギター", "キーボード", "コンガ"].map((label, index) => ({ section: "prepare" as const, key: "instruments" as const, index, label, high: [15, "バックステージ内"] as [ScoreValue, string], max: 15 })),
  ];
}

function noteRows(): MissionRow[] {
  return NOTE_LABELS.map((label, index) => ({ section: "notes", key: "notes", index, label, high: [20, "対応色エリア内・直立"], partial: [10, "一部だけ、または倒れている"], max: 20 }));
}

function bonusRows(): MissionRow[] {
  return [
    { section: "bonus", key: "bonusClef", label: "ト音記号", high: [10, "移動・損傷なし"], max: 10 },
    ...[0, 1].map((index) => ({ section: "bonus" as const, key: "bonusSpeakers" as const, index, label: `スピーカー ${index + 1}`, high: [10, "移動・損傷なし"] as [ScoreValue, string], max: 10 })),
    { section: "bonus", key: "bonusAmplifier", label: "アンプ", high: [10, "移動・損傷なし"], max: 10 },
  ];
}

function elementaryJudgeGroups(): Record<ElementaryJudgeGroupId, { title: string; text: string; rules: string[][]; images: string[][] }> {
  return {
    cables: {
      title: "アンプとスピーカーをつなぐ",
      text: "ケーブルは灰色エリアに置きます。完全に入るとは、対象物が対応エリアに触れ、マット上の他エリアに触れていない状態です。",
      rules: [["15点", "灰色エリア内に完全に入り、直立"], ["5点", "一部だけ入っている、または直立していない"], ["0点", "エリア外"]],
      images: [
        ["cables/15-full.webp", "15点：完全にエリア内・直立"],
        ["cables/5-partly.webp", "5点：一部だけエリア内"],
        ["cables/5-not-upright.webp", "5点：直立していない"],
        ["cables/0-outside.webp", "0点：エリア外"],
        ["cables/30-both.webp", "30点：2本とも成功"],
      ],
    },
    prepare: {
      title: "ショーの準備",
      text: "マイクはステージ上の薄緑エリア、楽器は左下のピンク色バックステージへ運びます。",
      rules: [["20点", "マイクが対象エリア内・直立"], ["10点", "マイクが一部だけ、または直立していない"], ["15点", "楽器がバックステージ内"]],
      images: [
        ["microphone/20-full.webp", "マイク 20点：完全にエリア内・直立"],
        ["microphone/10-partly.webp", "マイク 10点：一部だけエリア内"],
        ["microphone/10-not-upright.webp", "マイク 10点：直立していない"],
        ["microphone/0-outside.webp", "マイク 0点：エリア外"],
        ["instruments/15-full-1.webp", "楽器 15点：バックステージ内"],
        ["instruments/15-full-2.webp", "楽器 15点：バックステージ内"],
        ["instruments/0-partial.webp", "楽器 0点：完全に入っていない"],
        ["instruments/0-outside.webp", "楽器 0点：エリア外"],
        ["instruments/45-all.webp", "楽器 45点：3つとも成功"],
      ],
    },
    notes: {
      title: "曲を演奏する",
      text: "6色の音符を対応する色の音符ターゲットエリアへ置きます。灰色のふちもターゲットエリアに含まれます。",
      rules: [["20点", "対応色エリア内に完全に入り、直立"], ["10点", "一部だけ、または直立していない"], ["0点", "エリア外、または色違い"]],
      images: [
        ["notes/20-full.webp", "20点：対応色エリア内・直立"],
        ["notes/20-still-full.webp", "20点：完全に入っている例"],
        ["notes/10-partly.webp", "10点：一部だけエリア内"],
        ["notes/10-not-upright.webp", "10点：直立していない"],
        ["notes/0-outside.webp", "0点：エリア外"],
        ["notes/0-wrong-color-1.webp", "0点：色違い"],
        ["notes/0-wrong-color-2.webp", "0点：色違い"],
      ],
    },
    bonus: {
      title: "ボーナスポイント",
      text: "ト音記号・スピーカー・アンプが開始時の状態から移動または損傷していない場合に得点します。",
      rules: [["10点", "移動していない、損傷していない"], ["0点", "移動、転倒、損傷あり"]],
      images: [
        ["bonus/10-clef-ok.webp", "ト音記号 10点：移動・損傷なし"],
        ["bonus/10-speaker-ok.webp", "スピーカー 10点：移動・損傷なし"],
        ["bonus/0-speaker-moved.webp", "スピーカー 0点：移動あり"],
        ["bonus/0-speaker-not-upright.webp", "スピーカー 0点：直立していない"],
        ["bonus/0-speaker-damaged.webp", "スピーカー 0点：損傷あり"],
        ["bonus/10-amplifier-ok-1.webp", "アンプ 10点：移動・損傷なし"],
        ["bonus/0-amplifier-moved.webp", "アンプ 0点：移動あり"],
        ["bonus/10-amplifier-ok-2.webp", "アンプ 10点：移動・損傷なし"],
        ["bonus/0-amplifier-damaged.webp", "アンプ 0点：損傷あり"],
      ],
    },
  };
}

function judgingRuleClass(score: string, groupTitle: string) {
  return score === "0点" ? "zero" : score === "5点" || (score === "10点" && groupTitle !== "ボーナスポイント") ? "partial" : "full";
}

function judgingRulesHtml(group: ReturnType<typeof elementaryJudgeGroups>[ElementaryJudgeGroupId]) {
  return `<div>${group.rules.map(([score, desc]) => `<article><span class="photo-label ${judgingRuleClass(score, group.title)}">${escapeHtml(score)}</span><p><strong>${score === "0点" ? "0点" : judgingRuleClass(score, group.title) === "partial" ? "部分点" : "満点"}</strong>${escapeHtml(desc)}</p></article>`).join("")}</div>`;
}

function judgingPhotosHtml(group: ReturnType<typeof elementaryJudgeGroups>[ElementaryJudgeGroupId]) {
  return `<div class="photo-matrix">${group.images.map(([src, alt]) => {
    const score = alt.match(/\d+点|0点/)?.[0] ?? "";
    const labelClass = score === "0点" ? "zero" : judgingRuleClass(score, group.title);
    const label = labelClass === "zero" ? "0点" : labelClass === "partial" ? "部分点" : "満点";
    return `<article class="photo-example">
      <img src="${JUDGING_IMAGE_BASE}${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />
      <div><span class="photo-label ${labelClass}">${escapeHtml(score || label)}</span><strong>${label}</strong><p>${escapeHtml(alt)}</p></div>
    </article>`;
  }).join("")}</div>`;
}

function judgingView() {
  const entries = Object.entries(elementaryJudgeGroups()) as [ElementaryJudgeGroupId, ReturnType<typeof elementaryJudgeGroups>[ElementaryJudgeGroupId]][];
  return `<section class="elementary-page">
    <section class="elementary-page-intro">
      <p class="eyebrow">公式ルール掲載例</p>
      <h2>判定写真</h2>
      <p>見たいミッションを選んでください。判定ルールと写真を一覧で確認できます。</p>
    </section>
    <div class="elementary-gallery-grid">${entries.map(([id, group]) => `
      <button type="button" class="elementary-gallery-card card" data-judge-modal="${id}">
        <img src="${JUDGING_IMAGE_BASE}${group.images[0][0]}" alt="" loading="lazy" decoding="async" />
        <span><strong>${escapeHtml(group.title)}</strong><small>${group.images.length}枚の判定例</small></span>
      </button>`).join("")}</div>
  </section>`;
}

function judgeModalView(groupId: ElementaryJudgeGroupId) {
  const group = elementaryJudgeGroups()[groupId];
  return `<div class="modal-backdrop elementary-modal-backdrop" data-action="close-judge-modal">
    <section class="photo-modal elementary-photo-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(group.title)}の判定写真">
      <header>
        <div><strong>${escapeHtml(group.title)}の判定写真</strong><small>${group.images.length}件の判定例を一覧表示</small></div>
        <button type="button" class="elementary-modal-close" data-action="close-judge-modal" aria-label="閉じる">×</button>
      </header>
      <section class="judging-rules" aria-label="判定ルール">
        <h3>判定ルール</h3>
        ${judgingRulesHtml(group)}
      </section>
      ${judgingPhotosHtml(group)}
    </section>
  </div>`;
}

function courseView() {
  return `<section class="elementary-page">
    <p class="eyebrow">COURSE IMAGE</p><h2>コース</h2>
    <div class="card elementary-course"><img src="${COURSE_IMAGE}" alt="WRO 2026 RoboMission Elementary コース画像" loading="eager" decoding="async" /></div>
  </section>`;
}

function rulesView() {
  return `<section class="elementary-page">
    <p class="eyebrow">RULE PDF</p><h2>Elementary ルール</h2>
    <div class="elementary-rule-actions"><a class="primary" href="${RULE_PDF}" target="_blank" rel="noopener noreferrer">PDFを別タブで開く</a></div>
    <div class="card elementary-pdf"><iframe src="${RULE_PDF}#page=1&zoom=page-width" title="WRO 2026 RoboMission Elementary Game Rules"></iframe></div>
  </section>`;
}

async function cacheElementaryRulesPdfForNextView() {
  if (!("caches" in window)) return;
  const url = new URL(RULE_PDF, location.href).toString();
  if (rulesPdfCacheTasks.has(url)) return;
  rulesPdfCacheTasks.add(url);
  try {
    const cache = await caches.open(RULES_PDF_CACHE_NAME);
    if (await cache.match(url)) return;
    const response = await fetch(url, { cache: "reload" });
    if (response.ok) await cache.put(url, response.clone());
  } catch {
    // PDFキャッシュに失敗しても、通常表示はそのまま続ける。
  } finally {
    rulesPdfCacheTasks.delete(url);
  }
}

function linksView() {
  const loggedIn = Boolean(account);
  return `<section class="elementary-page elementary-links">
    <p class="eyebrow">EVENT / RELATED LINKS</p><h2>${loggedIn ? "リンク・大会情報" : "リンク"}</h2>
    <p class="elementary-page-lead">${loggedIn ? "大会情報・ルール・関連動画をまとめています。" : "ログインなしで確認できる公開リンク、QRコード、クレジットを表示しています。"}</p>
    <div class="card elementary-link-section">
      <h3>WRO ホームページ</h3>
      <div class="elementary-link-grid">
        ${elementaryLink("WRO Japan", "2026年シーズンの国内情報", "https://www.wroj.org/action/2026")}
        ${elementaryLink("WRO 国際", "World Robot Olympiad公式サイト", "https://wro-association.org/")}
      </div>
    </div>
    <div class="card elementary-link-section">
      <h3>公開URL QRコード</h3>
      <div class="elementary-qr-grid">
        ${publicQr("RoboMission Junior Assist", JUNIOR_APP_URL, `${import.meta.env.BASE_URL}assets/robomission-public-url-qr.png`)}
        ${publicQr("RoboMission Elementary Assist", ELEMENTARY_APP_URL, `${import.meta.env.BASE_URL}assets/robomission-elementary-public-url-qr.png`)}
      </div>
    </div>
    <div class="card elementary-link-section">
      <h3>ライセンス / クレジット</h3>
      <p>採点条件・ルール・判定写真は、World Robot Olympiad Association Ltd.が公開するWRO 2026 RoboMission Elementaryの資料を参照しています。ルール本文と画像の権利は各権利者に帰属します。</p>
    </div>
  </section>`;
}

function elementaryLink(label: string, description: string, href: string) {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span><b>↗</b></a>`;
}

function publicQr(label: string, href: string, image: string) {
  return `<a class="elementary-public-qr" href="${href}" target="_blank" rel="noopener noreferrer"><img src="${image}" alt="${escapeHtml(label)} 公開URL QRコード" loading="lazy" decoding="async" /><span><strong>${escapeHtml(label)}</strong><small>${href}</small></span></a>`;
}

function adminView() {
  if (account?.account !== "ADMIN") return loginView();
  return `<section class="elementary-page elementary-admin">
    <p class="eyebrow">PRIVATE ACCOUNT MANAGEMENT</p><h2>管理</h2>
    <div class="card elementary-link-section">
      <div class="elementary-admin-head"><p>Elementaryで使うアカウントを管理します。a0 / rmam / システム動作確認 / テストは共通アカウントとして扱います。</p><button type="button" class="secondary" data-action="load-accounts">↻ 更新</button></div>
      ${adminStatus ? `<p class="warning">${escapeHtml(adminStatus)}</p>` : ""}
      <div class="elementary-managed-list">
        ${managedAccounts.map((item) => `<article class="elementary-managed-account" data-managed-account="${escapeHtml(item.id)}">
          <div><strong>${escapeHtml(item.name)}</strong><small>ID: ${escapeHtml(item.id)}${item.app ? ` / ${item.app}` : ""}</small></div>
          <label>チーム名<input data-managed-name="${escapeHtml(item.id)}" maxlength="50" value="${escapeHtml(item.name)}" /></label>
          <label>APIキー<input data-managed-key="${escapeHtml(item.id)}" type="password" maxlength="128" autocomplete="new-password" placeholder="変更しない場合は空欄" /></label>
          <label>区分<select data-managed-app="${escapeHtml(item.id)}"><option value="elementary" ${item.app === "elementary" ? "selected" : ""}>Elementary</option><option value="shared" ${item.app === "shared" ? "selected" : ""}>共通</option><option value="junior" ${item.app === "junior" ? "selected" : ""}>Junior</option></select></label>
          <button type="button" class="primary" data-action="save-managed-account" data-account-id="${escapeHtml(item.id)}">変更を保存</button>
        </article>`).join("") || `<p>アカウント情報を読み込んでいます…</p>`}
      </div>
      <div class="elementary-managed-account new">
        <h3>新しいElementaryアカウントを追加</h3>
        <label>チーム名<input id="elementary-new-account-name" maxlength="50" placeholder="チーム名" /></label>
        <label>APIキー<input id="elementary-new-account-key" type="password" maxlength="128" autocomplete="new-password" placeholder="APIキー" /></label>
        <label>区分<select id="elementary-new-account-app"><option value="elementary">Elementary</option><option value="shared">共通</option><option value="junior">Junior</option></select></label>
        <button type="button" class="primary" data-action="save-managed-account">アカウントを追加</button>
      </div>
    </div>
  </section>`;
}

function resultView() {
  const scores = sectionScores();
  return `<section class="elementary-page">
    <p class="eyebrow">RESULT</p><h2>採点結果</h2>
    <div class="card elementary-result">
      <span>合計得点</span><strong>${totalScore()} <small>/ ${MAX_SCORE}点</small></strong>
      <dl>
        ${resultRow("アンプとスピーカー", scores.cables, 30)}
        ${resultRow("ショーの準備", scores.prepare, 65)}
        ${resultRow("曲を演奏する", scores.notes, 120)}
        ${resultRow("ボーナス", scores.bonus, 40)}
      </dl>
      <p>競技時間：${state.timeSeconds === null ? "未入力" : formatStopwatch(Math.round(state.timeSeconds * 1000))}</p>
      ${state.memo ? `<p class="elementary-result-memo">${escapeHtml(state.memo)}</p>` : ""}
      ${recordedVideo ? `<p class="elementary-result-video">録画：${escapeHtml(recordedVideo.name)} / ${(recordedVideo.size / 1024 / 1024).toFixed(1)}MB</p>` : ""}
      ${saveStatus ? `<p class="elementary-save-status">${escapeHtml(saveStatus)}</p>` : ""}
      ${account ? `<button type="button" class="primary" data-action="save-result">このアカウントに保存</button>` : `<button type="button" class="primary" data-mode="login">ログインして保存する</button>`}
      <button type="button" class="primary" data-mode="score">採点へ戻る</button>
    </div>
  </section>`;
}

function loginView() {
  return `<section class="elementary-page">
    <div class="card elementary-login">
      <div class="elementary-login-icon">鍵</div>
      <p class="eyebrow">OPTIONAL LOGIN</p>
      <h1>${account ? "ログイン中" : "ログイン"}</h1>
      ${account ? `<p><strong>${escapeHtml(account.accountName || account.account)}</strong> としてログインしています。</p><p>結果・メモ・ストップウォッチ時間・録画をこのアカウントに保存できます。</p><button type="button" class="secondary" data-action="logout">ログアウト</button>` : `
        <p>ログインしなくても採点とストップウォッチは使えます。結果保存と録画を使う場合だけログインしてください。</p>
        <label>APIキー<input id="elementary-api-key" type="password" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" placeholder="APIキー" /></label>
        <label class="elementary-remember"><input id="elementary-remember" type="checkbox" /><span>この端末にアカウント情報を保存する</span></label>
        ${loginError ? `<p class="warning" role="alert">${escapeHtml(loginError)}</p>` : ""}
        <button type="button" class="primary" data-action="login">ログイン</button>
        <button type="button" class="secondary" data-mode="score">ログインせず採点する</button>
      `}
    </div>
  </section>`;
}

function resultRow(label: string, score: number, max: number) {
  return `<div><dt>${label}</dt><dd>${score} / ${max}点</dd></div>`;
}

function getScore(row: MissionRow): ScoreValue {
  if (row.key === "microphone" || row.key === "bonusClef" || row.key === "bonusAmplifier") return state[row.key];
  return state[row.key][row.index ?? 0] as ScoreValue;
}

function setScore(key: MissionRow["key"], index: number | undefined, value: ScoreValue) {
  const nextValue = getScore({ key, index } as MissionRow) === value ? 0 : value;
  if (key === "microphone" || key === "bonusClef" || key === "bonusAmplifier") {
    state[key] = nextValue;
  } else {
    state[key][index ?? 0] = nextValue;
  }
  state.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function bindEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    const nextMode = button.dataset.mode as Mode;
    if (location.hash !== `#/${nextMode}`) {
      location.hash = `#/${nextMode}`;
    } else {
      mode = nextMode;
      render();
    }
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-score-key]").forEach((button) => button.addEventListener("click", () => {
    setScore(button.dataset.scoreKey as MissionRow["key"], button.dataset.scoreIndex ? Number(button.dataset.scoreIndex) : undefined, Number(button.dataset.scoreValue) as ScoreValue);
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-judge-modal]").forEach((button) => button.addEventListener("click", () => {
    judgeModal = button.dataset.judgeModal as ElementaryJudgeGroupId;
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-action="close-judge-modal"]').forEach((element) => element.addEventListener("click", (event) => {
    if (element.classList.contains("elementary-modal-backdrop") && event.target !== element) return;
    judgeModal = null;
    render();
  }));
  app.querySelector<HTMLTextAreaElement>("[data-memo]")?.addEventListener("input", (event) => {
    state.memo = (event.currentTarget as HTMLTextAreaElement).value.slice(0, 800);
    state.updatedAt = new Date().toISOString();
    saveState();
  });
  app.querySelectorAll<HTMLSelectElement>("[data-time-part]").forEach((select) => {
    select.addEventListener("change", updateTime);
  });
  app.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener("click", () => {
    if (!confirm("Elementaryの採点をリセットしますか？")) return;
    state = makeInitialState();
    resetStopwatch();
    saveState();
    render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-timer]").forEach((button) => button.addEventListener("click", () => timerAction(button.dataset.timer!)));
  app.querySelectorAll<HTMLButtonElement>("[data-recording]").forEach((button) => button.addEventListener("click", () => void recordingAction(button.dataset.recording!)));
  app.querySelector<HTMLButtonElement>('[data-action="login"]')?.addEventListener("click", () => void login());
  app.querySelector<HTMLInputElement>("#elementary-api-key")?.addEventListener("keydown", (event) => { if (event.key === "Enter") void login(); });
  app.querySelector<HTMLButtonElement>('[data-action="logout"]')?.addEventListener("click", logout);
  app.querySelector<HTMLButtonElement>('[data-action="load-accounts"]')?.addEventListener("click", () => void loadManagedAccounts());
  app.querySelectorAll<HTMLButtonElement>('[data-action="save-managed-account"]').forEach((button) => {
    button.addEventListener("click", () => void saveManagedAccount(button.dataset.accountId || ""));
  });
  app.querySelector<HTMLButtonElement>('[data-action="save-result"]')?.addEventListener("click", () => void saveResult());
  const preview = app.querySelector<HTMLVideoElement>("[data-recorder-preview]");
  if (preview && mediaStream && preview.srcObject !== mediaStream) preview.srcObject = mediaStream;
}

function updateTime() {
  const minutes = app.querySelector<HTMLSelectElement>('[data-time-part="minutes"]')?.value ?? "";
  const seconds = Number(app.querySelector<HTMLSelectElement>('[data-time-part="seconds"]')?.value ?? 0);
  const hundredths = Number(app.querySelector<HTMLSelectElement>('[data-time-part="hundredths"]')?.value ?? 0);
  state.timeSeconds = minutes === "" ? null : Number(minutes) * 60 + seconds + hundredths / 100;
  state.updatedAt = new Date().toISOString();
  saveState();
}

function timerAction(action: string) {
  if (action === "start") {
    const hasStopwatchView = Boolean(app.querySelector(".elementary-stopwatch"));
    if (stopwatch.status === "idle") {
      stopwatch.elapsedMs = 0;
      stopwatchLaps = [];
    }
    stopwatch.status = "running";
    stopwatch.startedAt = Date.now();
    refreshStopwatch();
    enterStopwatchFullscreen();
    if (!hasStopwatchView) render();
    startTicker();
    return;
  } else if (action === "resume") {
    if (stopwatch.status !== "paused") return;
    const hasStopwatchView = Boolean(app.querySelector(".elementary-stopwatch"));
    stopwatch.status = "running";
    stopwatch.startedAt = Date.now();
    refreshStopwatch();
    if (!hasStopwatchView) render();
    startTicker();
    return;
  } else if (action === "pause") {
    stopwatch.elapsedMs = currentElapsedMs();
    stopwatch.status = "paused";
    state.timeSeconds = secondsFromStopwatch(stopwatch.elapsedMs);
    saveState();
    if (app.querySelector(".elementary-stopwatch")) refreshStopwatch();
    else render();
    return;
  } else if (action === "finish") {
    if (stopwatch.status !== "paused") return;
    stopwatch.elapsedMs = currentElapsedMs();
    stopwatch.status = "idle";
    state.timeSeconds = secondsFromStopwatch(stopwatch.elapsedMs);
    saveState();
    window.clearInterval(timerId);
    exitStopwatchFullscreen();
    render();
    return;
  } else if (action === "reset") {
    resetStopwatch();
    saveState();
    render();
    return;
  } else if (action === "expand") {
    enterStopwatchFullscreen();
    refreshStopwatch();
    return;
  } else if (action === "collapse") {
    exitStopwatchFullscreen();
    refreshStopwatch();
    return;
  } else if (action === "lap") {
    if (stopwatch.status !== "running") return;
    stopwatchLaps.push(currentElapsedMs());
    state.timeSeconds = secondsFromStopwatch(currentElapsedMs());
    saveState();
    refreshStopwatch();
    return;
  }
}

function currentElapsedMs() {
  return stopwatch.status === "running" ? stopwatch.elapsedMs + Date.now() - stopwatch.startedAt : stopwatch.elapsedMs;
}

function startTicker() {
  window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    if (stopwatch.status !== "running") return;
    const formatted = formatStopwatch(currentElapsedMs());
    app.querySelectorAll<HTMLElement>("[data-elementary-stopwatch-display], [data-floating-stopwatch-display]").forEach((el) => {
      el.textContent = formatted;
    });
  }, 120);
}

function refreshStopwatch() {
  const element = app.querySelector<HTMLElement>(".elementary-stopwatch");
  if (!element) return;
  element.innerHTML = stopwatchContents();
  element.querySelectorAll<HTMLButtonElement>("[data-timer]").forEach((button) =>
    button.addEventListener("click", () => timerAction(button.dataset.timer!)),
  );
  const laps = element.querySelector<HTMLOListElement>(".stopwatch-laps");
  if (laps) laps.scrollTop = laps.scrollHeight;
}

function resetStopwatch() {
  stopwatch = { status: "idle", startedAt: 0, elapsedMs: 0 };
  stopwatchLaps = [];
  window.clearInterval(timerId);
  state.timeSeconds = null;
  exitStopwatchFullscreen();
}

type FullscreenCapableElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenCapableDocument = Document & { webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenElement?: Element | null };

function activeFullscreenElement() {
  const fullscreenDocument = document as FullscreenCapableDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

function requestElementFullscreen(element: FullscreenCapableElement) {
  if (activeFullscreenElement()) return;
  try {
    const request = element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element);
    if (!request) return;
    nativeFullscreenTarget = "stopwatch";
    const result = request();
    if (result instanceof Promise) void result.catch(() => { nativeFullscreenTarget = null; });
  } catch {
    nativeFullscreenTarget = null;
  }
}

function exitNativeFullscreen() {
  const fullscreenDocument = document as FullscreenCapableDocument;
  const exit = document.exitFullscreen?.bind(document) ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
  if (!activeFullscreenElement() || !exit) return null;
  nativeFullscreenTarget = null;
  try { return exit(); } catch { return null; }
}

function enterStopwatchFullscreen() {
  const element = app.querySelector<HTMLElement>(".elementary-stopwatch");
  if (!element) return;
  element.classList.add("elementary-stopwatch-expanded");
  document.body.classList.add("elementary-stopwatch-mode");
  requestElementFullscreen(element);
}

function exitStopwatchFullscreen() {
  document.body.classList.remove("elementary-stopwatch-mode");
  app.querySelector<HTMLElement>(".elementary-stopwatch")?.classList.remove("elementary-stopwatch-expanded");
  const result = exitNativeFullscreen();
  if (result instanceof Promise) void result.catch(() => undefined);
}

function loadState() {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
  catch { return makeInitialState(); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadAccount(): ElementaryAccount | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as Partial<ElementaryAccount> | null;
    if (!parsed || typeof parsed.apiKey !== "string" || typeof parsed.account !== "string") return null;
    return { apiKey: parsed.apiKey, account: parsed.account, accountName: String(parsed.accountName || parsed.account), remember: true };
  } catch {
    return null;
  }
}

function saveAccount() {
  if (account?.remember) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  else localStorage.removeItem(ACCOUNT_KEY);
}

async function login() {
  const key = document.querySelector<HTMLInputElement>("#elementary-api-key")?.value.trim() || "";
  const remember = document.querySelector<HTMLInputElement>("#elementary-remember")?.checked ?? false;
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!key || !endpoint) {
    loginError = !key ? "APIキーを入力してください。" : "保存先が設定されていません。";
    render();
    return;
  }
  loginError = "確認中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; account?: string; accountName?: string; message?: string }>(endpoint, { action: "auth", apiKey: key, app: "elementary" });
    if (!result.ok || !result.account) throw new Error(result.message || "APIキーを確認できませんでした。");
    account = { apiKey: key, account: result.account, accountName: result.accountName || result.account, remember };
    adminMode = result.account === "ADMIN";
    saveAccount();
    loginError = "";
    mode = adminMode ? "admin" : "score";
    if (adminMode) void loadManagedAccounts(false);
  } catch (error) {
    loginError = error instanceof Error ? error.message : "ログインできませんでした。";
  }
  render();
}

function logout() {
  stopRecording();
  account = null;
  adminMode = false;
  managedAccounts = [];
  adminStatus = "";
  recordedVideo = null;
  localStorage.removeItem(ACCOUNT_KEY);
  saveStatus = "";
  mode = "score";
  render();
}

function sharedAccountName(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === "a0" || normalized === "rmam" || normalized === "システム動作確認" || normalized === "テスト";
}

function sanitizeManagedAccounts(accounts: unknown): ManagedAccount[] {
  if (!Array.isArray(accounts)) return [];
  return accounts.map((item) => {
    const accountItem = item as Partial<ManagedAccount>;
    const id = String(accountItem.id || "").slice(0, 32);
    const name = String(accountItem.name || id).slice(0, 50);
    const rawApp = accountItem.app === "junior" || accountItem.app === "elementary" || accountItem.app === "shared" ? accountItem.app : "";
    const app = sharedAccountName(id) || sharedAccountName(name) ? "shared" : rawApp || "elementary";
    return { id, name, legacy: Boolean(accountItem.legacy), hasApiKey: Boolean(accountItem.hasApiKey), app };
  }).filter((item) => item.id && (item.app === "elementary" || item.app === "shared"));
}

async function loadManagedAccounts(shouldRender = true) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || account?.account !== "ADMIN") return;
  adminStatus = "アカウント情報を読み込み中…";
  if (shouldRender) render();
  try {
    const result = await postJson<{ ok?: boolean; accounts?: ManagedAccount[]; message?: string }>(endpoint, { action: "accounts", apiKey: account.apiKey, app: "elementary" });
    if (!result.ok) throw new Error(result.message || "アカウント情報を取得できませんでした。");
    managedAccounts = sanitizeManagedAccounts(result.accounts);
    adminStatus = `${managedAccounts.length}件のアカウントを管理中`;
  } catch (error) {
    adminStatus = `読み込めませんでした。${error instanceof Error ? error.message : "通信エラー"}`;
  }
  if (shouldRender) render();
}

async function saveManagedAccount(accountId = "") {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || account?.account !== "ADMIN") return;
  const nameInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-name="${CSS.escape(accountId)}"]` : "#elementary-new-account-name");
  const keyInput = document.querySelector<HTMLInputElement>(accountId ? `[data-managed-key="${CSS.escape(accountId)}"]` : "#elementary-new-account-key");
  const appSelect = document.querySelector<HTMLSelectElement>(accountId ? `[data-managed-app="${CSS.escape(accountId)}"]` : "#elementary-new-account-app");
  const name = nameInput?.value.trim() ?? "";
  const newApiKey = keyInput?.value.trim() ?? "";
  const appKind = sharedAccountName(accountId) || sharedAccountName(name) ? "shared" : (appSelect?.value || "elementary");
  if (!name || (!accountId && !newApiKey)) {
    adminStatus = !name ? "チーム名を入力してください。" : "APIキーを入力してください。";
    render();
    return;
  }
  adminStatus = accountId ? "変更を保存中…" : "アカウントを追加中…";
  render();
  try {
    const result = await postJson<{ ok?: boolean; accounts?: ManagedAccount[]; message?: string }>(endpoint, {
      action: "saveAccount", apiKey: account.apiKey, accountId, name, newApiKey, app: appKind,
    });
    if (!result.ok) throw new Error(result.message || "アカウントを保存できませんでした。");
    managedAccounts = sanitizeManagedAccounts(result.accounts);
    adminStatus = accountId ? "アカウントを更新しました。" : "Elementaryアカウントを追加しました。";
  } catch (error) {
    adminStatus = `保存できませんでした。${error instanceof Error ? error.message : "通信エラー"}`;
  }
  render();
}

async function recordingAction(action: string) {
  if (!account) { mode = "login"; render(); return; }
  if (action === "start") await startRecording();
  if (action === "stop") stopRecording();
  if (action === "clear") { recordedVideo = null; render(); }
}

async function startRecording() {
  if (recordingStatus !== "idle" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    saveStatus = "この端末では録画を開始できません。";
    render();
    return;
  }
  recordingStatus = "starting";
  render();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: false });
    const preview = app.querySelector<HTMLVideoElement>("[data-recorder-preview]");
    if (preview) preview.srcObject = mediaStream;
    videoChunks = [];
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType, videoBitsPerSecond: 4_500_000 } : undefined);
    mediaRecorder.ondataavailable = (event) => { if (event.data.size) videoChunks.push(event.data); };
    mediaRecorder.onstop = () => {
      const type = mediaRecorder?.mimeType || "video/webm";
      const blob = new Blob(videoChunks, { type });
      recordedVideo = new File([blob], `elementary_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`, { type });
      mediaStream?.getTracks().forEach((track) => track.stop());
      mediaStream = null;
      mediaRecorder = null;
      recordingStatus = "idle";
      render();
    };
    recordingStartedAt = Date.now();
    recordingElapsedMs = 0;
    recordingStatus = "recording";
    render();
    const livePreview = app.querySelector<HTMLVideoElement>("[data-recorder-preview]");
    if (livePreview) livePreview.srcObject = mediaStream;
    mediaRecorder.start(1000);
    window.setTimeout(() => { if (recordingStatus === "recording") stopRecording(); }, 180000);
    startRecordingTicker();
  } catch (error) {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    mediaRecorder = null;
    recordingStatus = "idle";
    saveStatus = `録画を開始できませんでした。${error instanceof Error ? error.message : ""}`;
  }
  if (recordingStatus !== "recording") render();
}

function stopRecording() {
  if (mediaRecorder && recordingStatus === "recording") {
    recordingStatus = "processing";
    mediaRecorder.stop();
  } else {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    mediaRecorder = null;
    recordingStatus = "idle";
  }
}

function startRecordingTicker() {
  const tick = () => {
    if (recordingStatus !== "recording") return;
    recordingElapsedMs = Date.now() - recordingStartedAt;
    const label = app.querySelector<HTMLElement>(".elementary-recorder span");
    if (label) label.textContent = `録画中 ${formatStopwatch(recordingElapsedMs)}`;
    window.setTimeout(tick, 250);
  };
  tick();
}

async function saveResult() {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !account) { mode = "login"; render(); return; }
  saveStatus = "保存中…";
  render();
  try {
    const scores = sectionScores();
    const video = recordedVideo ? await fileToStoredVideo(recordedVideo) : undefined;
    const payload = {
      action: "saveElementary",
      app: "elementary",
      apiKey: account.apiKey,
      account: account.account,
      requestId: `elementary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timeSeconds: state.timeSeconds,
      visitors: scores.cables,
      redTowers: scores.prepare,
      yellowTowers: scores.notes,
      artifacts: 0,
      dirt: 0,
      bonus: scores.bonus,
      unjudged: 0,
      notes: elementarySavedMemo(scores),
      video,
    };
    const result = await postJson<{ ok?: boolean; message?: string }>(endpoint, payload, new AbortController(), recordedVideo ? 90000 : 15000);
    if (!result.ok) throw new Error(result.message || "保存できませんでした。");
    saveStatus = "保存しました。";
    recordedVideo = null;
    state = makeInitialState();
    resetStopwatch();
    saveState();
    mode = "score";
  } catch (error) {
    saveStatus = `保存できませんでした。${error instanceof Error ? error.message : "通信エラー"}`;
  }
  render();
}

function elementarySavedMemo(scores: ElementaryScoreBreakdown) {
  const parts = [
    "Elementary",
    `アンプとスピーカー:${scores.cables}/30`,
    `ショーの準備:${scores.prepare}/65`,
    `曲を演奏:${scores.notes}/120`,
    `ボーナス:${scores.bonus}/40`,
    `合計:${totalScore()}/${MAX_SCORE}`,
  ];
  if (state.memo) parts.push(`メモ:${state.memo}`);
  return parts.join("\n").slice(0, 1000);
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

async function postJson<T>(endpoint: string, payload: unknown, controller = new AbortController(), timeoutMs = 15000): Promise<T> {
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), signal: controller.signal });
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function handleFullscreenChange() {
  if (activeFullscreenElement() || nativeFullscreenTarget !== "stopwatch") return;
  nativeFullscreenTarget = null;
  document.body.classList.remove("elementary-stopwatch-mode");
  app.querySelector<HTMLElement>(".elementary-stopwatch")?.classList.remove("elementary-stopwatch-expanded");
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
window.addEventListener("online", () => { elementaryOnline = true; render(); });
window.addEventListener("offline", () => { elementaryOnline = false; render(); });
window.addEventListener("hashchange", () => {
  mode = modeFromHash();
  if (mode !== "admin") judgeModal = null;
  render();
});

if (adminMode) {
  mode = "admin";
  void loadManagedAccounts(false);
}
render();
