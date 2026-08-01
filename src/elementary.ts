import "./elementary.css";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";

type Mode = "score" | "judging" | "course" | "rules" | "result";
type ScoreValue = 0 | 5 | 10 | 15 | 20;

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

const ELEMENTARY_VERSION = "0.2.0";
const MAX_SCORE = 255;
const STORAGE_KEY = "robomission-elementary-score-v1";
const COURSE_IMAGE = `${import.meta.env.BASE_URL}assets/elementary/memo/elementary-course.webp`;
const RULE_PDF = `${import.meta.env.BASE_URL}assets/elementary/rules/WRO-2026-RoboMission-Elementary-Game-Rules.pdf`;
const JUDGING_IMAGE_BASE = `${import.meta.env.BASE_URL}assets/elementary/judging/`;
const NOTE_LABELS = ["赤の音符", "青の音符", "緑の音符", "黄色の音符", "白の音符", "黒の音符"];

let mode: Mode = "score";
let state = loadState();
let stopwatch = { running: false, startedAt: 0, elapsedMs: Math.round((state.timeSeconds ?? 0) * 1000) };
let timerId = 0;

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
      </nav>
    </header>
    <main class="elementary-main">
      ${mode === "score" ? scoreView() : mode === "judging" ? judgingView() : mode === "course" ? courseView() : mode === "rules" ? rulesView() : resultView()}
    </main>
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
      <div class="elementary-guide">① ロボットの結果を見る　② 当てはまる□にチェック　③ 合計点を確認</div>
      <div class="elementary-sheet" role="table" aria-label="Elementary scoring sheet">
        <div class="elementary-row elementary-columns"><strong>ミッション／対象</strong><strong>高得点</strong><strong>部分点</strong><strong>得点</strong><strong>最大得点</strong></div>
        ${sectionHeader("1. アンプとスピーカーをつなぐ")}
        ${sheetRows(cableRows())}
        ${subtotal(scores.cables, 30)}
        ${sectionHeader("2. ショーの準備をする")}
        ${sheetRows(prepareRows())}
        ${subtotal(scores.prepare, 65)}
        ${sectionHeader("3. 曲を演奏する")}
        ${sheetRows(noteRows())}
        ${subtotal(scores.notes, 120)}
        ${sectionHeader("4. ボーナスポイント")}
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

function sectionHeader(label: string) {
  return `<div class="elementary-section"><strong>${label}</strong><button type="button" data-mode="judging">判定を見る</button></div>`;
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

function judgingView() {
  const groups = [
    {
      title: "アンプとスピーカーをつなぐ",
      text: "ケーブルは灰色エリアに置きます。完全に入るとは、対象物が対応エリアに触れ、マット上の他エリアに触れていない状態です。",
      rules: [["15点", "灰色エリア内に完全に入り、直立"], ["5点", "一部だけ入っている、または直立していない"], ["0点", "エリア外"]],
      images: [["cables-1.webp", "ケーブル判定例 1"], ["cables-2-microphone-1.webp", "ケーブル判定例 2"]],
    },
    {
      title: "ショーの準備",
      text: "マイクはステージ上の薄緑エリア、楽器は左下のピンク色バックステージへ運びます。",
      rules: [["20点", "マイクが対象エリア内・直立"], ["10点", "マイクが一部だけ、または直立していない"], ["15点", "楽器がバックステージ内"]],
      images: [["cables-2-microphone-1.webp", "マイク判定例 1"], ["microphone-2-instruments.webp", "マイク・楽器判定例"], ["instruments-notes-1.webp", "楽器判定例"]],
    },
    {
      title: "曲を演奏する",
      text: "6色の音符を対応する色の音符ターゲットエリアへ置きます。灰色のふちもターゲットエリアに含まれます。",
      rules: [["20点", "対応色エリア内に完全に入り、直立"], ["10点", "一部だけ、または直立していない"], ["0点", "エリア外、または色違い"]],
      images: [["instruments-notes-1.webp", "音符判定例 1"], ["notes-2.webp", "音符判定例 2"]],
    },
    {
      title: "ボーナスポイント",
      text: "ト音記号・スピーカー・アンプが開始時の状態から移動または損傷していない場合に得点します。",
      rules: [["10点", "移動していない、損傷していない"], ["0点", "移動、転倒、損傷あり"]],
      images: [["bonus.webp", "ボーナス判定例"]],
    },
  ];
  return `<section class="elementary-page">
    <p class="eyebrow">JUDGING RULES</p><h2>判定ルール</h2>
    <div class="elementary-judge-grid">${groups.map((group) => `
      <article class="card elementary-judge-card">
        <h3>${group.title}</h3><p>${group.text}</p>
        <div>${group.rules.map(([score, desc]) => `<span class="${score === "0点" ? "zero" : score === "10点" || score === "5点" ? "partial" : "full"}"><strong>${score}</strong>${desc}</span>`).join("")}</div>
        <details class="elementary-judge-photos"><summary>判定写真を見る</summary>${group.images.map(([src, alt]) => `<figure><img src="${JUDGING_IMAGE_BASE}${src}" alt="${alt}" loading="lazy" decoding="async" /><figcaption>${alt}</figcaption></figure>`).join("")}</details>
      </article>`).join("")}</div>
  </section>`;
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
      <button type="button" class="primary" data-mode="score">採点へ戻る</button>
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

render();
