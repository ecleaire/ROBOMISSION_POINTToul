import "./style.css";
import { DEFAULT_GAS_WEB_APP_URL } from "./config";
import { judgingGroups } from "./judging";
import { formatStopwatch, secondsFromStopwatch } from "./stopwatch";
import {
  MAX_SCORE,
  duplicateArtifactColors,
  isComplete,
  makeInitialState,
  sectionScores,
  totalScore,
  unjudgedCount,
  type ArtifactColor,
  type Score,
  type ScoreState,
} from "./model";

type AccountKey = "A" | "B" | "C";

interface PracticeRecord {
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
}

const RULES_PDF_URL = `${import.meta.env.BASE_URL}assets/rules/WRO-2026-Junior-Google-Translate-JA.pdf`;

const STORAGE_KEY = "robomission-junior-score-v2";
const ACCOUNT_KEY = "robomission-junior-account";
const app = document.querySelector<HTMLDivElement>("#app")!;
let activeAccount = loadAccount();
let state = loadState();
let modal: { group: string } | null = null;
let sheetStatus = "";
let accountError = "";
let recordsStatus = "";
let practiceRecords: PracticeRecord[] = [];
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
});
window.addEventListener("keydown", (event) => {
  if (!modal) return;
  if (event.key === "Escape") modal = null;
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }),
  );
}

if (!location.hash) location.hash = "#/score";
render();

function render() {
  const route = location.hash.replace(/^#\/?/, "") || "score";
  const content =
    !activeAccount || route === "account"
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
            : scoringView();

  app.innerHTML = `${content}${modal ? modalView() : ""}`;
  bindEvents();
}

function shell(content: string, options: { back?: string; title?: string } = {}) {
  const route = location.hash.replace(/^#\/?/, "") || "score";
  const activeRoute = route === "result" ? "score" : route;
  const modes = [
    ["score", "採点"],
    ["photos", "判定写真"],
    ["records", "練習記録"],
    ["rules", "ルール"],
  ];
  return `
    <header class="app-header">
      <div class="app-brand">
        <div><p>WRO 2026 / ROBOMISSION</p><strong>RoboMission Assist</strong></div>
        <span class="current-mode">${options.title ?? "RoboMission Junior"}</span>
        ${activeAccount ? `<label class="account-switch">アカウント
          <select id="header-account-select" aria-label="アカウントを切り替える">
            ${(["A", "B", "C"] as AccountKey[]).map((key) => `<option value="${key}" ${key === activeAccount ? "selected" : ""}>${key}</option>`).join("")}
          </select>
        </label>` : ""}
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
      <p>先生から伝えられた1文字のキーを入力してください。採点と記録はキーごとに分かれます。</p>
      <label>APIキー<input id="account-key-input" type="password" maxlength="1" autocomplete="off" autocapitalize="characters" placeholder="APIキー" /></label>
      ${accountError ? `<p class="warning" role="alert">${escapeHtml(accountError)}</p>` : ""}
      <button class="primary" data-action="login-account">このキーで始める</button>
    </section>
  `, { title: "アカウント" });
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
      <div class="score-sheet-guide">① ロボットの結果を見る　② 当てはまる□にチェック　③ 合計点を確認　<span>同じ□をもう一度押すと解除・0点は得点欄をタップ</span></div>
      <div class="sheet-row sheet-columns">
        <strong>ミッション／対象</strong><strong>高得点条件</strong><strong>部分点条件</strong><strong>得点</strong><strong>最大</strong>
      </div>
      ${sheetSection("visitors", "1. 訪問者を案内する")}
      ${visitorNames.map((name, index) => sheetScoreRow("visitors", index, name, state.visitors[index], [[10, "対応色エリア内・直立"], [5, "一部だけ、または倒れている"], [0, "エリア外・違う色"]], 10)).join("")}
      ${sheetSubtotal(scores.visitors, 40)}
      ${sheetSection("redTowers", "2. 塔を再建する（赤い塔）")}
      ${state.redTowers.map((score, index) => sheetScoreRow("redTowers", index, `赤い塔 ${index + 1}`, score, [[15, "完全に入り、直立"], [10, "一部だけ入り、直立"], [0, "エリア外・倒れている"]], 15)).join("")}
      ${sheetSubtotal(scores.redTowers, 30)}
      ${sheetSection("yellowTowers", "2. 塔を再建する（黄色い塔）")}
      ${state.yellowTowers.map((score, index) => sheetScoreRow("yellowTowers", index, `黄色い塔 ${index + 1}`, score, [[25, "上部が正しく、土台が完全に入る"], [15, "上部が正しく、土台が一部入る"], [0, "上部が不正・直立していない"]], 25)).join("")}
      ${sheetSubtotal(scores.yellowTowers, 50)}
      ${sheetSection("artifacts", "3. 遺物を博物館に運ぶ")}
      ${state.artifacts.map((artifact, index) => sheetScoreRow("artifacts", index, `遺物 ${index + 1}`, artifact.score, [[15, "対応色に完全に入り、直立"], [5, "一部だけ、または倒れている"], [0, "エリア外・違う色"]], 15, artifactColorSelect(index, artifact.color))).join("")}
      ${sheetSubtotal(scores.artifacts, 60)}
      ${sheetSection("dirt", "4. 石畳の汚れを落とす", `<button class="sheet-quick" data-action="all-dirt">すべて満点</button>`)}
      ${state.dirt.map((score, index) => sheetScoreRow("dirt", index, `汚れ ${index + 1}`, score, [[2, "石畳に触れていない"], [0, "石畳に触れている"]], 2)).join("")}
      ${sheetSubtotal(scores.dirt, 20)}
      ${sheetSection("bonus", "5. ボーナスポイント")}
      ${["赤いバリア", "白いバリア", "オウム"].map((name, index) => sheetScoreRow("bonus", index, name, state.bonus[index], [[10, "移動・損傷していない"], [0, "移動または損傷している"]], 10)).join("")}
      ${sheetSubtotal(scores.bonus, 30)}
      <div class="sheet-row sheet-total"><strong>合計得点</strong><span></span><span></span><strong>${total}</strong><strong>${MAX_SCORE}</strong></div>
      <div class="sheet-row sheet-maximum"><strong>最大得点</strong><span></span><span></span><strong>${MAX_SCORE}</strong><strong>${MAX_SCORE}</strong></div>
      <div class="sheet-footer-tools">
        ${timePicker(state.timeSeconds)}
        <label class="notes-card">メモ<textarea data-notes rows="2" maxlength="500" placeholder="ミスした部分や次回の注意点">${escapeHtml(state.notes)}</textarea></label>
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

function stopwatchContents() {
  const controls = stopwatchStatus === "idle"
    ? `<button class="timer-lap" type="button" disabled>⚑ <span>ラップ</span></button><button class="timer-start" data-action="timer-start">◀ <span>スタート</span></button>`
    : stopwatchStatus === "running"
      ? `<button class="timer-lap" data-action="timer-lap">⚑ <span>ラップ</span></button><button class="timer-pause" data-action="timer-pause">Ⅱ <span>停止</span></button>`
      : `<button class="timer-finish" data-action="timer-finish">■ <span>タイマー終了</span></button><button class="timer-resume" data-action="timer-resume">◀ <span>再開</span></button>`;
  return `<div class="stopwatch-time"><span>STOPWATCH</span><strong data-stopwatch-display>${formatStopwatch(currentStopwatchElapsed())}</strong></div>
    <div class="stopwatch-controls">${controls}</div>
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
    <button type="button" class="sheet-score-cell ${score === 0 ? "selected-zero" : ""}" title="${escapeHtml(zero[1])}" data-score-section="${section}" data-score-index="${index}" data-score-value="0" aria-pressed="${score === 0}">
      <strong>${score ?? 0}</strong>
    </button>
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

function resultView() {
  const sections = sectionScores(state);
  const unjudged = unjudgedCount(state);
  const duplicates = duplicateArtifactColors(state);
  return shell(`
    <section class="result-card" id="result-card">
      <p class="eyebrow">スコア</p>
      <h1>採点結果</h1>
      <div class="result-meta"><span>競技時間 ${formatTime(state.timeSeconds)}</span></div>
      ${state.notes ? `<p class="result-notes"><strong>メモ</strong>${escapeHtml(state.notes)}</p>` : ""}
      <div class="final-score"><span>合計得点</span><strong>${totalScore(state)} <small>/ ${MAX_SCORE} 点</small></strong></div>
      <dl class="score-breakdown">
        ${resultRow("訪問者を案内する", sections.visitors, 40)}
        ${resultRow("赤い塔を再建する", sections.redTowers, 30)}
        ${resultRow("黄色い塔を再建する", sections.yellowTowers, 50)}
        ${resultRow("遺物を博物館に運ぶ", sections.artifacts, 60)}
        ${resultRow("石畳の汚れを落とす", sections.dirt, 20)}
        ${resultRow("ボーナスポイント", sections.bonus, 30)}
      </dl>
      <div class="completion ${isComplete(state) ? "complete" : "incomplete"}">${isComplete(state) ? "✓ すべて判定済み" : `! 未判定 ${unjudged}項目${duplicates.length ? "・遺物の色重複あり" : ""}${state.artifacts.some((item) => item.color === "unused") ? "・遺物の色未選択あり" : ""}`}</div>
    </section>
    <section class="result-actions">
      <button class="secondary" data-nav="score">採点へ戻る</button>
    </section>
    <section class="sheet-panel card">
      <h2>Googleスプレッドシートへ記録</h2>
      <p>アカウント<strong>${activeAccount}</strong>のシートへ、この結果を1行追加します。</p>
      <button class="primary" data-action="send-sheet">${activeAccount}の記録として保存</button>
      ${sheetStatus ? `<p class="sheet-status" role="status">${escapeHtml(sheetStatus)}</p>` : ""}
    </section>
    <button class="text-button new-score" data-action="new">＋ 新しい採点を始める</button>
  `, { back: "score", title: "採点結果" });
}

function recordsView() {
  return shell(`
    <section class="page-intro records-intro">
      <p class="eyebrow">アカウント ${activeAccount}</p>
      <h1>記録</h1>
      <p>${activeAccount}に対応するシートの記録だけを表示しています。削除した記録は、シートの「削除」チェックを外すと再表示されます。完全に消す場合はシートで行を削除してください。</p>
      <button class="secondary" data-action="load-records">↻ 記録を更新</button>
    </section>
    ${recordsStatus ? `<p class="sheet-status records-status" role="status">${escapeHtml(recordsStatus)}</p>` : ""}
    <section class="records-list">
      ${practiceRecords.length ? practiceRecords.map((record) => `
        <article class="record-card card">
          <div><p>${formatRecordDate(record.recordedAt)}</p><h2>競技時間 ${formatTime(record.timeSeconds)}</h2><span>${record.notes ? escapeHtml(record.notes) : "ミッション別の採点記録"}</span></div>
          <strong>${record.total}<small> / ${MAX_SCORE}点</small></strong>
          ${record.unjudged ? `<em>未判定 ${record.unjudged}項目</em>` : `<em class="complete">判定済み</em>`}
          <button class="record-delete" data-action="delete-record" data-record-row="${record.rowNumber}" data-recorded-at="${escapeHtml(record.recordedAt)}">この記録を削除</button>
        </article>`).join("") : `<div class="empty-state card"><strong>まだ記録がありません</strong><p>採点結果から最初の記録を保存してください。</p></div>`}
    </section>
  `, { back: "score", title: `${activeAccount}の記録` });
}

function resultRow(label: string, score: number, max: number) {
  return `<div><dt>${label}</dt><dd>${score} <small>/ ${max}</small></dd></div>`;
}

function photoGalleryView() {
  return shell(`
    <section class="page-intro"><p class="eyebrow">公式ルール掲載例</p><h1>判定写真</h1><p>見たいミッションを選んでください。写真は端末に保存され、オフラインでも確認できます。</p></section>
    <div class="gallery-grid">${Object.entries(judgingGroups).map(([key, group]) => `
      <button class="gallery-card" data-photos="${key}">
        <img src="${group.photos[0].src}" alt="" /><span><strong>${group.title.replace("の判定写真", "")}</strong><small>${group.photos.length}枚の判定例</small></span>
      </button>`).join("")}</div>
  `, { back: "score", title: "判定写真" });
}

function rulesView() {
  return shell(`
    <section class="page-intro rules-intro">
      <div><p class="eyebrow">Google翻訳版</p><h1>ルールPDF</h1><p>PDF内の検索ボタン、またはキーボードの Ctrl + F（Macは ⌘ + F）で単語や文字を検索できます。</p></div>
      <a class="secondary pdf-open" href="${RULES_PDF_URL}" target="_blank" rel="noopener">PDFを大きく開く</a>
    </section>
    <section class="pdf-viewer card">
      <iframe src="${RULES_PDF_URL}#page=1&zoom=page-width" title="WRO 2026 RoboMission Junior Google翻訳版ルールPDF"></iframe>
      <p>この端末でPDFが表示されない場合は、<a href="${RULES_PDF_URL}" target="_blank" rel="noopener">PDFを大きく開く</a>を押してください。</p>
    </section>
  `, { back: "score", title: "ルール" });
}

function modalView() {
  if (!modal) return "";
  const group = judgingGroups[modal.group];
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="photo-modal" role="dialog" aria-modal="true" aria-label="${group.title}" onclick="event.stopPropagation()">
      <header><div><strong>${group.title}</strong><small>${group.photos.length}件の判定例を一覧表示</small></div><button class="icon-button" data-action="close-modal" aria-label="閉じる">×</button></header>
      <div class="photo-matrix">
        ${group.photos.map((photo) => `<article class="photo-example">
          <img src="${photo.src}" alt="${escapeHtml(photo.description)}" />
          <div><span class="photo-label ${photo.score === "0点" ? "zero" : ""}">${photo.score}</span><strong>${photo.label}</strong><p>${escapeHtml(photo.description)}</p></div>
        </article>`).join("")}
      </div>
    </section>
  </div>`;
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) =>
    element.addEventListener("click", () => (location.hash = `#/${element.dataset.nav}`)),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-score-section]").forEach((button) =>
    button.addEventListener("click", () => toggleScore(button)),
  );
  document.querySelector<HTMLSelectElement>("#header-account-select")?.addEventListener("change", (event) => {
    const key = (event.currentTarget as HTMLSelectElement).value;
    if (!isAccountKey(key) || key === activeAccount) return;
    activeAccount = key;
    localStorage.setItem(ACCOUNT_KEY, key);
    state = loadState();
    practiceRecords = [];
    recordsStatus = "";
    sheetStatus = "";
    resetStopwatch();
    render();
    if (location.hash === "#/records") void loadRecords();
  });
  document.querySelectorAll<HTMLSelectElement>("[data-time-part]").forEach((select) =>
    select.addEventListener("change", updateTime),
  );
  document.querySelector<HTMLTextAreaElement>("[data-notes]")?.addEventListener("input", (event) => {
    state.notes = (event.currentTarget as HTMLTextAreaElement).value;
    saveState();
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
    element.addEventListener("click", () => handleAction(element.dataset.action!, element)),
  );
  document.querySelector<HTMLInputElement>("#account-key-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loginAccount();
  });
}

function toggleScore(button: HTMLButtonElement) {
  const section = button.dataset.scoreSection!;
  const index = Number(button.dataset.scoreIndex);
  const selectedScore = Number(button.dataset.scoreValue);
  const currentScore = section === "artifacts"
    ? state.artifacts[index].score
    : (state[section as keyof Pick<ScoreState, "visitors" | "redTowers" | "yellowTowers" | "dirt" | "bonus">] as Score[])[index];
  updateScore(section, index, currentScore === selectedScore ? null : selectedScore as Score);
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
  if (action === "login-account") loginAccount();
  if (action === "load-records") void loadRecords();
  if (action === "delete-record") void deleteRecord(element);
  if (action === "all-dirt") { state.dirt.fill(2); saveState(); render(); }
  if (action === "timer-start") startStopwatch(true);
  if (action === "timer-lap") addStopwatchLap();
  if (action === "timer-pause") pauseStopwatch();
  if (action === "timer-resume") startStopwatch(false);
  if (action === "timer-finish") finishStopwatch();
  if (action === "reset" && confirm("入力した採点をすべてリセットしますか？")) { resetStopwatch(); state = makeInitialState(); saveState(); render(); }
  if (action === "new" && confirm("現在の採点を終了して、新しい採点を始めますか？")) { resetStopwatch(); state = makeInitialState(); saveState(); location.hash = "#/score"; }
  if (action === "close-modal") { modal = null; render(); }
  if (action === "send-sheet") void sendToSheet();
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
  refreshStopwatch();
  const stopwatch = document.querySelector<HTMLElement>(".stopwatch");
  stopwatch?.classList.add("stopwatch-expanded");
  document.body.classList.add("stopwatch-mode");
  if (!document.fullscreenElement && stopwatch) void stopwatch.requestFullscreen().catch(() => undefined);
  startStopwatchUpdates();
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
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount) {
    sheetStatus = "記録先がまだ設定されていません。"; render(); return;
  }
  sheetStatus = "送信中…"; render();
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(resultPayload()) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { ok?: boolean; message?: string };
    if (!result.ok) throw new Error(result.message || "GASで保存できませんでした");
    sheetStatus = "";
    location.hash = "#/score";
    render();
    return;
  } catch (error) {
    sheetStatus = `送信できませんでした。GASの公開設定を確認してください（${error instanceof Error ? error.message : "通信エラー"}）。`;
  }
  render();
}

function resultPayload() {
  const scores = sectionScores(state);
  return {
    apiKey: activeAccount,
    recordedAt: new Date().toISOString(),
    timeSeconds: state.timeSeconds,
    notes: state.notes,
    ...scores,
    total: totalScore(state),
    unjudged: unjudgedCount(state),
  };
}

function loginAccount() {
  const input = document.querySelector<HTMLInputElement>("#account-key-input");
  const key = input?.value.trim().toUpperCase() ?? "";
  if (!isAccountKey(key)) {
    accountError = "APIキーが違います。A・B・Cのいずれかを入力してください。";
    render();
    return;
  }
  activeAccount = key;
  localStorage.setItem(ACCOUNT_KEY, key);
  accountError = "";
  practiceRecords = [];
  recordsStatus = "";
  resetStopwatch();
  state = loadState();
  location.hash = "#/score";
  render();
}

async function loadRecords() {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  if (!endpoint || !activeAccount) {
    recordsStatus = "記録先がまだ設定されていません。";
    render();
    return;
  }
  recordsStatus = "読み込み中…";
  render();
  try {
    const url = new URL(endpoint);
    url.searchParams.set("key", activeAccount);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { ok?: boolean; records?: PracticeRecord[]; message?: string };
    if (!result.ok) throw new Error(result.message || "記録を取得できませんでした");
    practiceRecords = result.records ?? [];
    recordsStatus = practiceRecords.length ? `${practiceRecords.length}件の記録を表示中` : "記録はまだありません。";
  } catch (error) {
    recordsStatus = `記録を読み込めませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
  }
  render();
}

async function deleteRecord(element: HTMLElement) {
  const endpoint = DEFAULT_GAS_WEB_APP_URL || import.meta.env.VITE_GAS_WEB_APP_URL || "";
  const rowNumber = Number(element.dataset.recordRow);
  const recordedAt = element.dataset.recordedAt ?? "";
  if (!endpoint || !activeAccount || !Number.isInteger(rowNumber) || rowNumber < 2) return;
  if (!confirm(`${formatRecordDate(recordedAt)}の記録を削除しますか？\nスプレッドシートでは「削除」にチェックが入り、赤い行で保管されます。`)) return;
  recordsStatus = "削除中…";
  render();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", apiKey: activeAccount, rowNumber, recordedAt }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { ok?: boolean; message?: string };
    if (!result.ok) throw new Error(result.message || "記録を削除できませんでした");
    await loadRecords();
  } catch (error) {
    recordsStatus = `削除できませんでした（${error instanceof Error ? error.message : "通信エラー"}）。`;
    render();
  }
}

function saveState() {
  if (!activeAccount) return;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(scoreStorageKey(), JSON.stringify(state));
}

function loadState(): ScoreState {
  try {
    const saved = JSON.parse(activeAccount ? localStorage.getItem(scoreStorageKey()) || "null" : "null") as Partial<ScoreState> | null;
    return saved ? { ...makeInitialState(), ...saved } as ScoreState : makeInitialState();
  } catch { return makeInitialState(); }
}

function loadAccount(): AccountKey | null {
  const key = localStorage.getItem(ACCOUNT_KEY);
  return isAccountKey(key) ? key : null;
}

function isAccountKey(value: string | null): value is AccountKey { return value === "A" || value === "B" || value === "C"; }
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
function colorLabel(color: string) { return artifactColors.find((item) => item.value === color)?.label ?? color; }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
