const STORAGE_KEY = "vocab60_v1";

const DEFAULT_PLAN_TEXT =
`[내 60일 플랜]
- 매일: 신규 20개 + 오늘 복습
- 단어는 딱 3번만 등장한다:
  1) 학습: Day D
  2) 복습1: D+5
  3) 복습2: D+20
- 완벽히 외우려 하지 않는다.
  3초 내 떠오르면 OK, 망설이면 그냥 넘어간다.
- 모르면 다시 붙잡지 않는다. 다음 복습이 해결한다.
`;

const DAILY_NEW_LIMIT = 20;
const REVIEW_OFFSETS = [5, 20];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(startISO, endISO) {
  const a = parseISO(startISO); a.setHours(0,0,0,0);
  const b = parseISO(endISO);   b.setHours(0,0,0,0);
  return Math.floor((b.getTime() - a.getTime()) / (24*60*60*1000));
}
function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const s = { version: 1, startDate: null, cards: [], planText: DEFAULT_PLAN_TEXT, dayNewCount: {} };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return s;
  }
  try {
    const s = JSON.parse(raw);
    s.planText ??= DEFAULT_PLAN_TEXT;
    s.dayNewCount ??= {};
    s.cards ??= [];
    return s;
  } catch {
    localStorage.setItem(STORAGE_KEY + "_corrupt_backup", raw);
    const s = { version: 1, startDate: null, cards: [], planText: DEFAULT_PLAN_TEXT, dayNewCount: {} };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return s;
  }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentDayNumber(state) {
  if (!state.startDate) return null;
  return daysBetween(state.startDate, todayISO()) + 1;
}
function todayNewAdded(state, dayNo) {
  if (!dayNo) return 0;
  return Number(state.dayNewCount[String(dayNo)] ?? 0);
}
function incTodayNewAdded(state, dayNo, by) {
  state.dayNewCount[String(dayNo)] = todayNewAdded(state, dayNo) + by;
}

function cardDueToday(card, dayNo) {
  if (!dayNo) return false;
  if (card.createdDay === dayNo) return true;
  if (Array.isArray(card.reviews) && card.reviews.includes(dayNo)) return true;
  return false;
}

function createCard(item, createdDay) {
  const reviews = REVIEW_OFFSETS.map(off => createdDay + off);
  return {
    id: uid(),
    word: item.word,
    meaning: item.meaning,
    example: item.example ?? "",
    createdDay,
    reviews,
    createdAt: todayISO(),
    updatedAt: todayISO()
  };
}

// --- Parse (라인 삭제를 위해 "어느 줄이 유효했는지"도 같이 반환)
function normalizeLine(line) {
  return line.replace(/\t/g, " | ").trim();
}
function parseBatchWithLineInfo(text) {
  const rawLines = text.split("\n");
  const items = [];
  const validLineIndexes = []; // 추가에 사용된 "유효 라인 인덱스"
  rawLines.forEach((line0, idx) => {
    const line = normalizeLine(line0);
    if (!line) return;
    const parts = line.split("|").map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const word = parts[0];
    const meaning = parts[1];
    const example = parts.slice(2).join(" | ").trim();
    items.push({ word, meaning, example });
    validLineIndexes.push(idx);
  });
  return { rawLines, items, validLineIndexes };
}
function removeFirstNValidLines(text, validLineIndexes, n) {
  const lines = text.split("\n");
  const toRemove = new Set(validLineIndexes.slice(0, n));
  const kept = lines.filter((_, idx) => !toRemove.has(idx));
  // 앞뒤 공백 줄 정리(너무 공격적이면 불편하니 최소만)
  return kept.join("\n").replace(/^\n+/, "");
}

// --- Tabs
function setTab(tabName) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  $(`panel-${tabName}`).classList.remove("hidden");
}

// --- Study queue
let studyQueue = [];
let studyIndex = 0;
let revealed = false;

function buildTodayQueue(state) {
  const dayNo = currentDayNumber(state);
  if (!dayNo) return [];
  const due = state.cards.filter(c => cardDueToday(c, dayNo));
  due.sort((a, b) => {
    const aIsNew = a.createdDay === dayNo ? 0 : 1;
    const bIsNew = b.createdDay === dayNo ? 0 : 1;
    if (aIsNew !== bIsNew) return aIsNew - bIsNew; // 신규 먼저
    return a.createdDay - b.createdDay;
  });
  return due;
}

function startTodayStudy(state) {
  studyQueue = buildTodayQueue(state);
  studyIndex = 0;
  revealed = false;
  setTab("study");
  renderStudy(loadState());
}

function renderStudy(state) {
  $("planText").textContent = state.planText ?? DEFAULT_PLAN_TEXT;
  const dayNo = currentDayNumber(state);
  if (!dayNo) {
    $("studyMeta").textContent = "시작일을 먼저 설정하세요 (Today 탭).";
    $("studyWord").textContent = "-";
    $("studyMeaning").textContent = "-";
    $("studyExample").textContent = "-";
    $("studyBadge").textContent = "-";
    return;
  }

  if (studyQueue.length === 0) {
    $("studyMeta").textContent = "학습 큐가 비어있습니다. Today 탭에서 ‘학습 시작’을 누르세요.";
    $("studyWord").textContent = "-";
    $("studyMeaning").textContent = "-";
    $("studyExample").textContent = "-";
    $("studyBadge").textContent = "-";
    return;
  }

  if (studyIndex >= studyQueue.length) {
    $("studyMeta").textContent = "오늘 학습 완료 🎉";
    $("studyBadge").textContent = "DONE";
    $("studyWord").textContent = "완료!";
    $("studyMeaning").textContent = "Today로 돌아가서 신규/복습 상태를 확인하세요.";
    $("studyMeaning").classList.remove("hidden");
    $("studyExample").classList.add("hidden");
    return;
  }

  const c = studyQueue[studyIndex];
  const isNew = c.createdDay === dayNo;
  $("studyBadge").textContent = isNew ? "NEW" : "REVIEW";
  $("studyWord").textContent = c.word;
  $("studyMeaning").textContent = c.meaning;
  $("studyExample").textContent = c.example || "";
  $("studyMeaning").classList.toggle("hidden", !revealed);
  $("studyExample").classList.toggle("hidden", !revealed || !c.example);
  $("studyMeta").textContent = `Day ${dayNo} · ${studyIndex + 1}/${studyQueue.length}`;
}

function nextCard() {
  if (studyQueue.length === 0) return;
  revealed = false;
  studyIndex += 1;
  renderStudy(loadState());
}
function shuffleQueue() {
  for (let i = studyQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [studyQueue[i], studyQueue[j]] = [studyQueue[j], studyQueue[i]];
  }
  studyIndex = 0;
  revealed = false;
  renderStudy(loadState());
}

// --- Today render
function renderToday(state) {
  const dayNo = currentDayNumber(state);
  const hasStart = Boolean(state.startDate);

  $("dayLabel").textContent = hasStart ? `Day ${dayNo}` : "Day - (시작일 설정 필요)";
  $("startDateLabel").textContent = hasStart ? state.startDate : "미설정";
  $("todayDateLabel").textContent = todayISO();

  // 온보딩 카드 표시/숨김
  $("onboardingCard").style.display = hasStart ? "none" : "block";

  if (!hasStart) {
    $("todayNewCount").textContent = "-";
    $("todayReviewCount").textContent = "-";
    $("todaySummary").textContent = "시작일을 설정한 뒤, Add에서 오늘치(20개)를 추가하세요.";
    $("todayProgress").style.width = "0%";
    renderTodayPreview(state, []);
    return;
  }

  const due = state.cards.filter(c => cardDueToday(c, dayNo));
  const newCount = todayNewAdded(state, dayNo);
  const reviewCount = due.filter(c => c.createdDay !== dayNo).length;

  $("todayNewCount").textContent = String(newCount);
  $("todayReviewCount").textContent = String(reviewCount);

  const remaining = Math.max(0, DAILY_NEW_LIMIT - newCount);
  const totalTarget = DAILY_NEW_LIMIT + reviewCount; // 오늘 해야할 목표치(개념상)
  const doneLike = Math.min(newCount, DAILY_NEW_LIMIT); // 신규는 추가가 완료 기준
  // 진행률은 "신규 추가 완료 비율"을 중심으로 단순화(복습까지 합치면 오히려 스트레스)
  const pct = Math.round((doneLike / DAILY_NEW_LIMIT) * 100);
  $("todayProgress").style.width = `${pct}%`;

  $("todaySummary").textContent =
    `오늘 남은 신규: ${remaining}개 · 오늘 큐(신규+복습): ${due.length}개`;

  renderTodayPreview(state, due);
}

function renderTodayPreview(state, due) {
  const preview = $("todayPreview");
  preview.innerHTML = "";

  if (!state.startDate) {
    preview.innerHTML = `<div class="item"><div class="m">시작일 설정 후 오늘 목록이 생성됩니다.</div></div>`;
    return;
  }
  if (due.length === 0) {
    preview.innerHTML = `<div class="item"><div class="m">오늘 due 카드가 없습니다. (신규를 추가하면 오늘 목록에 포함됩니다)</div></div>`;
    return;
  }

  const dayNo = currentDayNumber(state);
  const show = due.slice(0, 12);
  for (const c of show) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="w">${escapeHtml(c.word)}</div>
      <div class="m">${escapeHtml(c.meaning)}</div>
      ${c.example ? `<div class="e">${escapeHtml(c.example)}</div>` : ""}
      <div class="meta">${c.createdDay === dayNo ? "NEW" : "REVIEW"} · reviews=${(c.reviews||[]).join(",")}</div>
    `;
    preview.appendChild(div);
  }
  if (due.length > show.length) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<div class="m dim">… +${due.length - show.length}개</div>`;
    preview.appendChild(div);
  }
}

// --- Add render + action
function renderAdd(state) {
  const dayNo = currentDayNumber(state);
  const hasStart = Boolean(state.startDate);

  $("dailyNewLimit").textContent = String(DAILY_NEW_LIMIT);
  $("totalCardCount").textContent = String(state.cards.length);

  if (!hasStart) {
    $("todayRemaining").textContent = "-";
    $("addResult").textContent = "시작일 설정 후 사용하세요.";
    return;
  }

  const newCount = todayNewAdded(state, dayNo);
  const remaining = Math.max(0, DAILY_NEW_LIMIT - newCount);
  $("todayRemaining").textContent = String(remaining);
  $("addResult").textContent = `오늘치 추가는 최대 ${remaining}개 남았습니다.`;
}

function addTodayBatchAndTrim(state) {
  const dayNo = currentDayNumber(state);
  if (!dayNo) return { ok:false, msg:"시작일을 먼저 설정하세요." };

  const already = todayNewAdded(state, dayNo);
  const remain = Math.max(0, DAILY_NEW_LIMIT - already);
  if (remain <= 0) return { ok:false, msg:`오늘 신규 ${DAILY_NEW_LIMIT}개를 이미 추가했습니다.` };

  const input = $("addInput").value;
  const { items, validLineIndexes } = parseBatchWithLineInfo(input);
  if (items.length === 0) return { ok:false, msg:"추가할 데이터가 없습니다. (word | meaning 형식인지 확인)" };

  const toAdd = items.slice(0, remain);

  const existing = new Set(state.cards.map(c => c.word.trim().toLowerCase()));
  const addedCards = [];
  let skipped = 0;

  for (const item of toAdd) {
    const key = item.word.trim().toLowerCase();
    if (existing.has(key)) { skipped++; continue; }
    const card = createCard(item, dayNo);
    state.cards.push(card);
    existing.add(key);
    addedCards.push(card);
  }

  // “실제로 추가된 개수”만큼 유효 라인을 제거
  const consumed = Math.min(validLineIndexes.length, addedCards.length + skipped);
  // 여기서 정책 선택:
  // - 중복도 사용자가 이미 처리한 줄로 보고 같이 제거하면, 다음날 반복 작업이 편함(추천)
  $("addInput").value = removeFirstNValidLines(input, validLineIndexes, consumed);

  incTodayNewAdded(state, dayNo, addedCards.length);
  saveState(state);

  return {
    ok:true,
    msg:`추가 완료: ${addedCards.length}개 (중복 스킵: ${skipped}개) · 오늘 누적 신규: ${todayNewAdded(state, dayNo)}개`
  };
}

// --- Search
function renderSearch(state, q) {
  const list = $("searchList");
  const meta = $("searchMeta");
  list.innerHTML = "";

  const query = (q ?? "").trim().toLowerCase();
  if (!query) {
    meta.textContent = `전체 ${state.cards.length}개`;
    return;
  }
  const hits = state.cards.filter(c => {
    const w = (c.word || "").toLowerCase();
    const m = (c.meaning || "").toLowerCase();
    const e = (c.example || "").toLowerCase();
    return w.includes(query) || m.includes(query) || e.includes(query);
  });

  meta.textContent = `검색 결과 ${hits.length}개 / 전체 ${state.cards.length}개`;

  for (const c of hits.slice(0, 80)) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="w">${escapeHtml(c.word)}</div>
      <div class="m">${escapeHtml(c.meaning)}</div>
      ${c.example ? `<div class="e">${escapeHtml(c.example)}</div>` : ""}
      <div class="meta">createdDay=${c.createdDay} · reviews=${(c.reviews||[]).join(",")}</div>
    `;
    list.appendChild(div);
  }
  if (hits.length > 80) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<div class="m dim">… +${hits.length - 80}개</div>`;
    list.appendChild(div);
  }
}

// --- Backup
function renderBackup(state) {
  $("backupMeta").textContent = `카드 ${state.cards.length}개 · 시작일 ${state.startDate ?? "미설정"}`;
  $("backupText").value = "";
}
function exportJson(state) {
  const json = JSON.stringify(state, null, 2);
  $("backupText").value = json;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocab60_backup_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function importJsonText(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.version !== 1 || !Array.isArray(obj.cards)) {
    throw new Error("형식이 올바르지 않습니다 (version/cards 확인).");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

// --- PWA install prompt
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("btnInstall").hidden = false;
});
$("btnInstall").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("btnInstall").hidden = true;
});

// Service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// --- Wire UI
let state = loadState();

function rerenderAll() {
  state = loadState();
  renderToday(state);
  renderStudy(state);
  renderAdd(state);
  renderSearch(state, $("searchInput").value);
  renderBackup(state);
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

// Today buttons
$("btnSetStartToday").addEventListener("click", () => {
  state = loadState();
  state.startDate = todayISO();
  saveState(state);
  rerenderAll();
  alert(`시작일을 ${state.startDate}로 설정했습니다.`);
});

$("btnResetAll").addEventListener("click", () => {
  const ok = confirm("전체 데이터를 초기화할까요? (되돌릴 수 없음)");
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  studyQueue = [];
  studyIndex = 0;
  revealed = false;
  state = loadState();
  rerenderAll();
});

$("btnStartToday").addEventListener("click", () => {
  state = loadState();
  if (!state.startDate) return alert("먼저 시작일을 설정하세요.");
  startTodayStudy(state);
});

$("btnQuickAdd").addEventListener("click", () => setTab("add"));
$("btnGoAdd").addEventListener("click", () => setTab("add"));

// Study
$("studyCard").addEventListener("click", () => {
  revealed = !revealed;
  renderStudy(loadState());
});
$("btnReveal").addEventListener("click", () => {
  revealed = true;
  renderStudy(loadState());
});
$("btnNext").addEventListener("click", () => nextCard());
$("btnShuffle").addEventListener("click", () => shuffleQueue());
$("btnBackToday").addEventListener("click", () => setTab("today"));

// Add
$("btnParsePreview").addEventListener("click", () => {
  const text = $("addInput").value;
  const { items } = parseBatchWithLineInfo(text);
  const wrap = $("addPreview");
  wrap.innerHTML = "";
  if (items.length === 0) {
    wrap.innerHTML = `<div class="item"><div class="m">미리보기 대상이 없습니다. (word | meaning 형식)</div></div>`;
    return;
  }
  for (const it of items.slice(0, 30)) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="w">${escapeHtml(it.word)}</div>
      <div class="m">${escapeHtml(it.meaning)}</div>
      ${it.example ? `<div class="e">${escapeHtml(it.example)}</div>` : ""}
    `;
    wrap.appendChild(div);
  }
});

$("btnAddBatch").addEventListener("click", () => {
  state = loadState();
  if (!state.startDate) return alert("먼저 시작일을 설정하세요.");
  const res = addTodayBatchAndTrim(state);
  $("addResult").textContent = res.msg;
  rerenderAll();
  alert(res.msg);
});

// Search
$("searchInput").addEventListener("input", (e) => {
  renderSearch(loadState(), e.target.value);
});

// Backup
$("btnExport").addEventListener("click", () => {
  exportJson(loadState());
  renderBackup(loadState());
});

$("btnCopyBackup").addEventListener("click", async () => {
  const t = $("backupText").value.trim();
  if (!t) return alert("먼저 Export 하거나 JSON이 있어야 합니다.");
  try {
    await navigator.clipboard.writeText(t);
    alert("복사했습니다.");
  } catch {
    alert("복사 실패(브라우저 권한). 텍스트를 직접 선택해서 복사하세요.");
  }
});

$("btnRestoreFromText").addEventListener("click", () => {
  const ok = confirm("이 텍스트로 복원(덮어쓰기)할까요?");
  if (!ok) return;
  const t = $("backupText").value.trim();
  if (!t) return alert("복원할 JSON이 없습니다.");
  try {
    importJsonText(t);
    studyQueue = [];
    studyIndex = 0;
    revealed = false;
    rerenderAll();
    alert("복원 완료");
  } catch (e) {
    alert(`복원 실패: ${e.message}`);
  }
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const ok = confirm("선택한 JSON으로 복원(덮어쓰기)할까요?");
  if (!ok) return;
  try {
    const text = await file.text();
    importJsonText(text);
    studyQueue = [];
    studyIndex = 0;
    revealed = false;
    rerenderAll();
    alert("Import 복원 완료");
  } catch (err) {
    alert(`Import 실패: ${err.message}`);
  } finally {
    e.target.value = "";
  }
});

// init
rerenderAll();
setTab("today");
