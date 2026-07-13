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

const STORAGE_KEY = "robomission-junior-score-v2";
const ACCOUNT_KEY = "robomission-junior-account";
const app = document.querySelector<HTMLDivElement>("#app")!;
let activeAccount = loadAccount();
let state = loadState();
let modal: { group: string; index: number } | null = null;
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
  if (event.key === "ArrowRight") moveModal(1);
  if (event.key === "ArrowLeft") moveModal(-1);
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }),
  );
}

if (!location.hash) location.hash = "#/";
render();

function render() {
  const route = location.hash.replace(/^#\/?/, "") || "home";
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
            : homeView();

  app.innerHTML = `${content}${modal ? modalView() : ""}`;
  bindEvents();
}

function shell(content: string, options: { back?: string; title?: string } = {}) {
  const route = location.hash.replace(/^#\/?/, "") || "home";
  const activeRoute = route === "result" ? "score" : route;
  const modes = [
    ["home", "ホーム"],
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

function homeView() {
  const hasProgress = localStorage.getItem(scoreStorageKey()) && hasAnyProgress(state);
  return shell(`
    <section class="hero">
      <h1>RoboMission Junior<br><span>得点計算</span></h1>
      <p>判定写真を見ながら、ひとりでも迷わず採点できます。</p>
    </section>
    <section class="home-actions" aria-label="メインメニュー">
      <button class="primary jumbo" data-nav="score">${hasProgress ? "前回の採点を続ける" : "採点を始める"}<span>→</span></button>
      <button class="secondary jumbo" data-nav="photos">判定写真を見る<span>▧</span></button>
      <button class="secondary jumbo" data-nav="records">${activeAccount}の記録を見る<span>↗</span></button>
      <button class="secondary jumbo" data-nav="rules">ルールについて<span>?</span></button>
    </section>
  `);
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
  `, { back: "home", title: "採点する" });
}

function stopwatchView() {
  const controls = stopwatchStatus === "idle"
    ? `<button class="timer-start" data-action="timer-start">◀ <span>スタート</span></button>`
    : stopwatchStatus === "running"
      ? `<button class="timer-lap" data-action="timer-lap">⚑ <span>ラップ</span></button><button class="timer-pause" data-action="timer-pause">Ⅱ <span>停止</span></button>`
      : `<button class="timer-finish" data-action="timer-finish">■ <span>タイマー終了</span></button><button class="timer-resume" data-action="timer-resume">◀ <span>再開</span></button>`;
  const latestLap = stopwatchLaps.at(-1);
  return `<section class="stopwatch" aria-label="ストップウォッチ">
    <div class="stopwatch-time"><span>STOPWATCH</span><strong data-stopwatch-display>${formatStopwatch(currentStopwatchElapsed())}</strong></div>
    <div class="stopwatch-controls">${controls}</div>
    ${latestLap === undefined ? "" : `<small class="stopwatch-lap">ラップ ${stopwatchLaps.length}　${formatStopwatch(latestLap)}</small>`}
  </section>`;
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
      <button class="primary" data-action="download">結果を画像として保存</button>
      <button class="secondary" data-action="print">結果を印刷</button>
      <button class="secondary" data-nav="score">採点画面へ戻る</button>
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
      <p>${activeAccount}に対応するシートの記録だけを表示しています。</p>
      <button class="secondary" data-action="load-records">↻ 記録を更新</button>
    </section>
    ${recordsStatus ? `<p class="sheet-status records-status" role="status">${escapeHtml(recordsStatus)}</p>` : ""}
    <section class="records-list">
      ${practiceRecords.length ? practiceRecords.map((record) => `
        <article class="record-card card">
          <div><p>${formatRecordDate(record.recordedAt)}</p><h2>競技時間 ${formatTime(record.timeSeconds)}</h2><span>${record.notes ? escapeHtml(record.notes) : "ミッション別の採点記録"}</span></div>
          <strong>${record.total}<small> / ${MAX_SCORE}点</small></strong>
          ${record.unjudged ? `<em>未判定 ${record.unjudged}項目</em>` : `<em class="complete">判定済み</em>`}
        </article>`).join("") : `<div class="empty-state card"><strong>まだ記録がありません</strong><p>採点結果から最初の記録を保存してください。</p></div>`}
    </section>
  `, { back: "home", title: `${activeAccount}の記録` });
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
  `, { back: "home", title: "判定写真" });
}

function rulesView() {
  return shell(`
    <section class="page-intro"><p class="eyebrow">採点前に確認</p><h1>ルールについて</h1></section>
    <article class="rules card">
      <h2>「完全に入る」とは</h2>
      <p>対象物が対応するエリアに触れていて、マット上のほかのエリアには触れていない状態です。</p>
      <h2>未判定と0点は別です</h2>
      <p>まだ確認していない項目は「未判定」のままです。条件を満たさなかった場合は、0点を明示的に選んでください。</p>
      <h2>移動・損傷の考え方</h2>
      <p>バリアやオウムの一部が灰色エリア外のマットに触れると「移動」です。開始時と同じ状態でなくなった場合（部品が外れた場合など）は「損傷」です。</p>
    </article>
  `, { back: "home", title: "ルール" });
}

function modalView() {
  if (!modal) return "";
  const group = judgingGroups[modal.group];
  const photo = group.photos[modal.index];
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="photo-modal" role="dialog" aria-modal="true" aria-label="${group.title}" onclick="event.stopPropagation()">
      <header><div><strong>${group.title}</strong><small>${modal.index + 1} / ${group.photos.length}</small></div><button class="icon-button" data-action="close-modal" aria-label="閉じる">×</button></header>
      <div class="photo-frame"><img src="${photo.src}" alt="${escapeHtml(photo.description)}" data-action="zoom-photo" /></div>
      <div class="photo-caption"><span class="photo-label ${photo.score === "0点" ? "zero" : ""}">${photo.label}・${photo.score}</span><p>${photo.description}</p></div>
      <nav><button data-action="prev-photo" aria-label="前の写真">←</button><div>${group.photos.map((_, index) => `<i class="${index === modal!.index ? "active" : ""}"></i>`).join("")}</div><button data-action="next-photo" aria-label="次の写真">→</button></nav>
    </section>
  </div>`;
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) =>
    element.addEventListener("click", () => (location.hash = `#/${element.dataset.nav === "home" ? "" : element.dataset.nav}`)),
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
    button.addEventListener("click", () => { modal = { group: button.dataset.photos!, index: 0 }; render(); }),
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
  if (action === "all-dirt") { state.dirt.fill(2); saveState(); render(); }
  if (action === "timer-start") startStopwatch(true);
  if (action === "timer-lap") addStopwatchLap();
  if (action === "timer-pause") pauseStopwatch();
  if (action === "timer-resume") startStopwatch(false);
  if (action === "timer-finish") finishStopwatch();
  if (action === "reset" && confirm("入力した採点をすべてリセットしますか？")) { resetStopwatch(); state = makeInitialState(); saveState(); render(); }
  if (action === "new" && confirm("現在の採点を終了して、新しい採点を始めますか？")) { resetStopwatch(); state = makeInitialState(); saveState(); location.hash = "#/score"; }
  if (action === "close-modal") { modal = null; render(); }
  if (action === "prev-photo") { moveModal(-1); render(); }
  if (action === "next-photo") { moveModal(1); render(); }
  if (action === "zoom-photo") element.classList.toggle("zoomed");
  if (action === "print") window.print();
  if (action === "download") downloadResultImage();
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
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
  render();
  startStopwatchUpdates();
}

function pauseStopwatch() {
  stopwatchElapsedMs = currentStopwatchElapsed();
  stopwatchStatus = "paused";
  stopStopwatchUpdates();
  render();
}

function addStopwatchLap() {
  if (stopwatchStatus !== "running") return;
  stopwatchLaps.push(currentStopwatchElapsed());
  render();
}

function finishStopwatch() {
  if (stopwatchStatus !== "paused") return;
  state.timeSeconds = secondsFromStopwatch(stopwatchElapsedMs);
  saveState();
  stopwatchStatus = "idle";
  stopStopwatchUpdates();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  render();
}

function resetStopwatch() {
  stopwatchStatus = "idle";
  stopwatchElapsedMs = 0;
  stopwatchStartedAt = 0;
  stopwatchLaps = [];
  stopStopwatchUpdates();
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

function moveModal(change: number) {
  if (!modal) return;
  const length = judgingGroups[modal.group].photos.length;
  modal.index = (modal.index + change + length) % length;
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
    sheetStatus = "スプレッドシートに記録しました。";
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
  location.hash = "#/";
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

function downloadResultImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 1500;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#f4f8fc"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#1261a6"; context.fillRect(0, 0, canvas.width, 240);
  context.fillStyle = "white"; context.font = "700 44px sans-serif"; context.fillText("RoboMission Junior 得点記録", 80, 100);
  context.font = "700 58px sans-serif"; context.fillText("採点結果", 80, 185);
  context.fillStyle = "#102a43"; context.font = "700 36px sans-serif"; context.fillText(`競技時間 ${formatTime(state.timeSeconds)}`, 80, 330);
  context.fillStyle = "#e8f7ef"; roundRect(context, 70, 390, 1060, 250, 32); context.fill();
  context.fillStyle = "#116b45"; context.font = "700 36px sans-serif"; context.fillText("合計得点", 120, 475);
  context.font = "800 96px sans-serif"; context.fillText(`${totalScore(state)} / ${MAX_SCORE} 点`, 120, 590);
  const rows = [["訪問者を案内する", sectionScores(state).visitors, 40], ["赤い塔を再建する", sectionScores(state).redTowers, 30], ["黄色い塔を再建する", sectionScores(state).yellowTowers, 50], ["遺物を博物館に運ぶ", sectionScores(state).artifacts, 60], ["石畳の汚れを落とす", sectionScores(state).dirt, 20], ["ボーナスポイント", sectionScores(state).bonus, 30]] as const;
  context.font = "600 34px sans-serif";
  rows.forEach(([label, score, max], index) => { const y = 750 + index * 105; context.fillStyle = "#102a43"; context.fillText(label, 100, y); context.textAlign = "right"; context.fillText(`${score} / ${max}`, 1100, y); context.textAlign = "left"; context.strokeStyle = "#d5e1ec"; context.beginPath(); context.moveTo(100, y + 32); context.lineTo(1100, y + 32); context.stroke(); });
  context.fillStyle = "#52677a"; context.font = "28px sans-serif"; context.fillText(`未判定：${unjudgedCount(state)}項目`, 100, 1390); context.fillText("WRO 2026 RoboMission Junior 得点記録", 100, 1440);
  canvas.toBlob((blob) => { if (!blob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "robomission-score.png"; link.click(); URL.revokeObjectURL(link.href); }, "image/png");
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath(); context.roundRect(x, y, width, height, radius);
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
function hasAnyProgress(value: ScoreState) { return Boolean(value.notes || value.timeSeconds !== null || unjudgedCount(value) < 25); }
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
