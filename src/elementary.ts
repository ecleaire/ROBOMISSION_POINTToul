import "./elementary.css";
import { DEFAULT_GAS_WEB_APP_URL } from "./config";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";

type Mode = "score" | "judging" | "course" | "rules" | "result" | "login";
type ScoreValue = 0 | 5 | 10 | 15 | 20;
type ElementaryJudgeGroupId = "cables" | "prepare" | "notes" | "bonus";

interface ElementaryAccount {
  apiKey: string;
  account: string;
  accountName: string;
  remember: boolean;
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

const ELEMENTARY_VERSION = "0.4.1";
const MAX_SCORE = 255;
const STORAGE_KEY = "robomission-elementary-score-v1";
const ACCOUNT_KEY = "robomission-elementary-account-v1";
const COURSE_IMAGE = `${import.meta.env.BASE_URL}assets/elementary/memo/elementary-course.webp`;
const RULE_PDF = `${import.meta.env.BASE_URL}assets/elementary/rules/WRO-2026-RoboMission-Elementary-Game-Rules.pdf`;
const JUDGING_IMAGE_BASE = `${import.meta.env.BASE_URL}assets/elementary/judging/`;
const NOTE_LABELS = ["赤の音符", "青の音符", "緑の音符", "黄色の音符", "白の音符", "黒の音符"];

let mode: Mode = "score";
let state = loadState();
let account = loadAccount();
let loginError = "";
let saveStatus = "";
let judgeModal: ElementaryJudgeGroupId | null = null;
let stopwatch = { running: false, startedAt: 0, elapsedMs: Math.round((state.timeSeconds ?? 0) * 1000) };
let timerId = 0;
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let videoChunks: Blob[] = [];
let recordedVideo: File | null = null;
let recordingStatus: "idle" | "starting" | "recording" | "processing" = "idle";
let recordingStartedAt = 0;
let recordingElapsedMs = 0;

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
  app.innerHTML = `
    <header class="elementary-header">
      <div>
        <p>WRO 2026 / ROBOMISSION ELEMENTARY</p>
        <h1>RoboMission Elementary Assist <span>v${ELEMENTARY_VERSION}</span></h1>
      </div>
      <nav aria-label="Elementary menu">
        ${navButton("score", "採点")}
        ${navButton("judging", "判定")}
        ${navButton("course", "コース")}
        ${navButton("rules", "ルール")}
        ${navButton("result", "結果")}
        ${navButton("login", account ? "ログイン中" : "ログイン")}
      </nav>
    </header>
    <div class="elementary-account-bar ${account ? "logged-in" : ""}">
      ${account ? `<span>ログイン中：${escapeHtml(account.accountName || account.account)}</span><button type="button" data-action="logout">ログアウト</button>` : `<span>未ログイン：採点とストップウォッチは使用できます。録画・保存はログイン後に使えます。</span><button type="button" data-mode="login">ログイン</button>`}
    </div>
    <main class="elementary-main">
      ${mode === "score" ? scoreView() : mode === "judging" ? judgingView() : mode === "course" ? courseView() : mode === "rules" ? rulesView() : mode === "login" ? loginView() : resultView()}
    </main>
    ${judgeModal ? judgeModalView(judgeModal) : ""}
  `;
  bindEvents();
}

function navButton(target: Mode, label: string) {
  return `<button type="button" class="${mode === target ? "active" : ""}" data-mode="${target}">${label}</button>`;
}

function scoreView() {
  const scores = sectionScores();
  const total = totalScore();
  return `
    <section class="elementary-score-card">
      <div class="elementary-title-bar">WRO 2026 RoboMission Elementary 得点チェック</div>
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
      </div>
      <section class="elementary-memo card">
        <label>メモ<textarea data-memo maxlength="800" placeholder="ミスした部分、練習で気づいたことなど">${escapeHtml(state.memo)}</textarea></label>
      </section>
    </section>
    <div class="elementary-bottom-space"></div>
    <nav class="elementary-bottom">
      <button type="button" class="secondary" data-action="reset">採点をリセット</button>
      <button type="button" class="primary" data-mode="result"><span>結果を見る</span><strong>合計得点 ${total} / ${MAX_SCORE}点</strong></button>
    </nav>
  `;
}

function stopwatchView() {
  const elapsed = currentElapsedMs();
  return `
    <section class="elementary-stopwatch">
      <div><span>STOPWATCH</span><strong>${formatStopwatch(elapsed)}</strong></div>
      <div>
        <button type="button" data-timer="lap">⚑ ラップ</button>
        <button type="button" class="primary" data-timer="${stopwatch.running ? "pause" : "start"}">${stopwatch.running ? "Ⅱ 停止" : "▶ スタート"}</button>
        <button type="button" data-timer="finish">■ 終了</button>
      </div>
    </section>
  `;
}

function videoRecorderView() {
  if (!account) return `<section class="elementary-recorder locked"><strong>動画録画</strong><span>ログインユーザー限定機能です。録画を保存したい場合はログインしてください。</span><button type="button" data-mode="login">ログイン</button></section>`;
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
  return `<div class="elementary-rule-list">${group.rules.map(([score, desc]) => `<span class="${judgingRuleClass(score, group.title)}"><strong>${score}</strong>${escapeHtml(desc)}</span>`).join("")}</div>`;
}

function judgingPhotosHtml(group: ReturnType<typeof elementaryJudgeGroups>[ElementaryJudgeGroupId]) {
  return `<div class="elementary-judge-photo-grid">${group.images.map(([src, alt]) => `<figure><img src="${JUDGING_IMAGE_BASE}${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`).join("")}</div>`;
}

function judgingView() {
  const groups = Object.values(elementaryJudgeGroups());
  return `<section class="elementary-page">
    <p class="eyebrow">JUDGING RULES</p><h2>判定ルール</h2>
    <div class="elementary-judge-grid">${groups.map((group) => `
      <article class="card elementary-judge-card">
        <h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.text)}</p>
        ${judgingRulesHtml(group)}
        <details class="elementary-judge-photos" open><summary>判定写真を見る</summary>${judgingPhotosHtml(group)}</details>
      </article>`).join("")}</div>
  </section>`;
}

function judgeModalView(groupId: ElementaryJudgeGroupId) {
  const group = elementaryJudgeGroups()[groupId];
  return `<div class="elementary-modal-backdrop" data-action="close-judge-modal">
    <section class="elementary-photo-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(group.title)}の判定写真">
      <header>
        <div><strong>${escapeHtml(group.title)}の判定写真</strong><small>${group.images.length}件の判定例を一覧表示</small></div>
        <button type="button" class="elementary-modal-close" data-action="close-judge-modal" aria-label="閉じる">×</button>
      </header>
      <div class="elementary-modal-body">
        <h3>判定ルール</h3>
        ${judgingRulesHtml(group)}
        ${judgingPhotosHtml(group)}
      </div>
    </section>
  </div>`;
}

function courseView() {
  return `<section class="elementary-page">
    <p class="eyebrow">COURSE IMAGE</p><h2>コース画像</h2>
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
      <h2>${account ? "ログイン中" : "ログイン"}</h2>
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
  if (key === "microphone" || key === "bonusClef" || key === "bonusAmplifier") {
    state[key] = state[key] === value ? 0 : value;
  } else {
    state[key][index ?? 0] = state[key][index ?? 0] === value ? 0 : value;
  }
  state.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function bindEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.mode as Mode;
    render();
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
  app.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener("click", () => {
    if (!confirm("Elementaryの採点をリセットしますか？")) return;
    state = makeInitialState();
    stopwatch = { running: false, startedAt: 0, elapsedMs: 0 };
    saveState();
    render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-timer]").forEach((button) => button.addEventListener("click", () => timerAction(button.dataset.timer!)));
  app.querySelectorAll<HTMLButtonElement>("[data-recording]").forEach((button) => button.addEventListener("click", () => void recordingAction(button.dataset.recording!)));
  app.querySelector<HTMLButtonElement>('[data-action="login"]')?.addEventListener("click", () => void login());
  app.querySelector<HTMLInputElement>("#elementary-api-key")?.addEventListener("keydown", (event) => { if (event.key === "Enter") void login(); });
  app.querySelector<HTMLButtonElement>('[data-action="logout"]')?.addEventListener("click", logout);
  app.querySelector<HTMLButtonElement>('[data-action="save-result"]')?.addEventListener("click", () => void saveResult());
  const preview = app.querySelector<HTMLVideoElement>("[data-recorder-preview]");
  if (preview && mediaStream && preview.srcObject !== mediaStream) preview.srcObject = mediaStream;
}

function timerAction(action: string) {
  if (action === "start") {
    stopwatch.running = true;
    stopwatch.startedAt = Date.now();
    startTicker();
  } else if (action === "pause") {
    stopwatch.elapsedMs = currentElapsedMs();
    stopwatch.running = false;
    state.timeSeconds = secondsFromStopwatch(stopwatch.elapsedMs);
    saveState();
  } else if (action === "finish") {
    stopwatch.elapsedMs = currentElapsedMs();
    stopwatch.running = false;
    state.timeSeconds = secondsFromStopwatch(stopwatch.elapsedMs);
    saveState();
  } else if (action === "lap") {
    state.timeSeconds = secondsFromStopwatch(currentElapsedMs());
    saveState();
  }
  render();
}

function currentElapsedMs() {
  return stopwatch.running ? stopwatch.elapsedMs + Date.now() - stopwatch.startedAt : stopwatch.elapsedMs;
}

function startTicker() {
  window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    if (!stopwatch.running) return;
    const el = app.querySelector<HTMLElement>(".elementary-stopwatch strong");
    if (el) el.textContent = formatStopwatch(currentElapsedMs());
  }, 120);
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
    const result = await postJson<{ ok?: boolean; account?: string; accountName?: string; message?: string }>(endpoint, { action: "auth", apiKey: key });
    if (!result.ok || !result.account) throw new Error(result.message || "APIキーを確認できませんでした。");
    account = { apiKey: key, account: result.account, accountName: result.accountName || result.account, remember };
    saveAccount();
    loginError = "";
    mode = "score";
  } catch (error) {
    loginError = error instanceof Error ? error.message : "ログインできませんでした。";
  }
  render();
}

function logout() {
  stopRecording();
  account = null;
  recordedVideo = null;
  localStorage.removeItem(ACCOUNT_KEY);
  saveStatus = "";
  mode = "score";
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
    stopwatch = { running: false, startedAt: 0, elapsedMs: 0 };
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

render();
