/* Vocab 60 - ultra simple personal PWA
   Plan:
   - daily new: 20
   - fixed reviews: D+5, D+20
   - no grading buttons, just "Next"
*/

const STORAGE_KEY = "vocab60_v1";

const DEFAULT_PLAN_TEXT =
`[내 60일 플랜]
- 매일: 신규 20개 + 오늘 복습
- 단어는 딱 3번만 등장한다:
  1) 학습: Day D
  2) 복습1: D+5
  3) 복습2: D+20
- 완벽하게 외우려 하지 않는다.
  3초 내 떠오르면 OK, 망설이면 그냥 넘어간다.
- 모르면 다시 붙잡지 않는다. 다음 복습이 해결한다.
`;

const DAILY_NEW_LIMIT = 20;
const REVIEW_OFFSETS = [5, 20];

function todayISO() {
  // local date YYYY-MM-DD
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseISO(iso) {
  // parse as local date to avoid timezone pitfalls
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  // normalize to midnight local
  a.setHours(0,0,0,0);
  b.setHours(0,0,0,0);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function addDaysISO(baseISO, days) {
  const d = parseISO(baseISO);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const s = {
      version: 1,
      startDate: null, // ISO
      cards: [],
      planText: DEFAULT_PLAN_TEXT,
      // per-day count for new additions, keyed by dayNumber string
      dayNewCount: {}
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return s;
  }
  try {
    const s = JSON.parse(raw);
    if (!s.version) throw new Error("bad schema");
    // minimal migrations
    s.planText ??= DEFAULT_PLAN_TEXT;
    s.dayNewCount ??= {};
    s.cards ??= [];
    return s;
  } catch {
    // if corrupted, start fresh but don't silently destroy—store backup
    localStorage.setItem(STORAGE_KEY + "_corrupt_backup", raw);
    const s = {
      version: 1,
      startDate: null,
      cards: [],
      planText: DEFAULT_PLAN_TEXT,
      dayNewCount: {}
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return s;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function requireStartDate(state) {
  if (!state.startDate) return null;
  return state.startDate;
}

function currentDayNumber(state) {
  const start = requireStartDate(state);
  if (!start) return null;
  const diff = daysBetween(start, todayISO());
  return diff + 1; // Day1 = start date
}

function cardDueToday(card, dayNo) {
  if (!dayNo) return false;
  if (card.createdDay === dayNo) return true;
  if (Array.isArray(card.reviews) && card.reviews.includes(dayNo)) return true;
  return false;
}

function todayNewAdded(state, dayNo) {
  if (!dayNo) return 0;
  return Number(state.dayNewCount[String(dayNo)] ?? 0);
}

function incTodayNewAdded(state, dayNo, by) {
  const k = String(dayNo);
  state.dayNewCount[k] = todayNewAdded(state, dayNo) + by;
}

function normalizeLine(line) {
  // support separators: | or tab
  return line.replace(/\t/g, " | ").trim();
}

function parseBatch(text) {
  const lines = text.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const items = [];
  for (const line0 of lines) {
    const line = normalizeLine(line0);
    const parts = line.split("|").map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length < 2) continue;
    const word = parts[0];
    const meaning = parts[1];
    const example = parts.slice(2).join(" | ").trim();
    items.push({ word, meaning, example });
  }
  return items;
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

// UI helpers
const $ = (id) => document.getElementById(id);

function setTab(tabName) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  $(`panel-${tabName}`).classList.remove("hidden");
}

function renderToday(state) {
  const dayNo = currentDayNumber(state);
  const start = state.startDate;

  $("dayLabel").textContent = start ? `Day ${dayNo}` : "Day - (시작일 설정 필요)";
  $("startDateLabel").textContent = start ? start : "미설정";
  $("todayDateLabel").textContent = todayISO();

  const due = start ? state.cards.filter(c => cardDueToday(c, dayNo)) : [];
  const newAdded = start ? todayNewAdded(state, dayNo) : 0;

  const summary = start
    ? `오늘 신규: ${Math.min(DAILY_NEW_LIMIT, DAILY_NEW_LIMIT - 0)} 목표 ${DAILY_NEW_LIMIT}개 / 오늘 이미 추가: ${newAdded}개 · 오늘 복습+신규 큐: ${due.length}개`
    : "시작일을 먼저 설정하세요 (아래 버튼).";

  $("todaySummary").textContent = summary;

  // preview
  const preview = $("todayPreview");
  preview.innerHTML = "";
  const show = due.slice(0, 12);
  if (!start) {
    preview.innerHTML = `<div class="item"><div class="m">시작일 설정 후 오늘 목록이 생성됩니다.</div></div>`;
    return;
  }
  if (due.length === 0) {
    preview.innerHTML = `<div class="item"><div class="m">오늘 due 카드가 없습니다. (신규를 추가하면 오늘 목록에 포함됩니다)</div></div>`;
    return;
  }
  for (const c of show) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="w">${escapeHtml(c.word)}</div>
      <div class="m">${escapeHtml(c.meaning)}</div>
      ${c.example ? `<div class="e">${escapeHtml(c.example)}</div>` : ""}
      <div class="meta">createdDay=${c.createdDay} · reviews=${(c.reviews||[]).join(",")}</div>
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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Study queue
let studyQueue = [];
let studyIndex = 0;
let revealed = false;

function buildTodayQueue(state) {
  const dayNo = currentDayNumber(state);
  if (!dayNo) return [];
  const due = state.cards.filter(c => cardDueToday(c, dayNo));
  // 기본 정렬: 오늘 신규(createdDay==today) 먼저, 그 다음 복습(오래된 createdDay 먼저)
  due.sort((a, b) => {
    const aIsNew = a.createdDay === dayNo ? 0 : 1;
    const bIsNew = b.createdDay === dayNo ? 0 : 1;
    if (aIsNew !== bIsNew) return aIsNew - bIsNew; // 신규 먼저
    return a.createdDay - b.createdDay;
  });
  return due;
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

  const c = studyQueue[studyIndex];
  const isNew = c.createdDay === dayNo;
  $("studyBadge").textContent = isNew ? "NEW" : "REVIEW";
  $("studyWord").textContent = c.word;
  $("studyMeaning").textContent = c.meaning;
  $("studyExample").textContent = c.example || "";
  $("studyExample").classList.toggle("hidden", !revealed || !c.example);
  $("studyMeaning").classList.toggle("hidden", !revealed);
  $("studyMeta").textContent = `Day ${dayNo} · ${studyIndex + 1}/${studyQueue.length}`;
}

function startTodayStudy(state) {
  studyQueue = buildTodayQueue(state);
  studyIndex = 0;
  revealed = false;
  setTab("study");
  renderStudy(state);
}

function nextCard(state) {
  if (studyQueue.length === 0) return;
  revealed = false;
  studyIndex += 1;
  if (studyIndex >= studyQueue.length) {
    // done
    $("studyMeta").textContent = "오늘 학습 완료 🎉 (Today 탭에서 목록 확인)";
    $("studyWord").textContent = "완료!";
    $("studyMeaning").textContent = "오늘 할 일을 끝냈습니다.";
    $("studyMeaning").classList.remove("hidden");
    $("studyExample").classList.add("hidden");
    $("studyBadge").textContent = "DONE";
    return;
  }
  renderStudy(state);
}

function shuffleQueue(state) {
  // Fisher–Yates
  for (let i = studyQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [studyQueue[i], studyQueue[j]] = [studyQueue[j], studyQueue[i]];
  }
  studyIndex = 0;
  revealed = false;
  renderStudy(state);
}

// Add
function renderAdd(state) {
  const dayNo = currentDayNumber(state);
  $("dailyNewLimit").textContent = String(DAILY_NEW_LIMIT);
  $("todayAddedCount").textContent = dayNo ? String(todayNewAdded(state, dayNo)) : "0";
  $("addResult").textContent = dayNo ? "오늘치 추가는 최대 20개로 제한됩니다." : "시작일 설정 후 사용하세요.";
  $("addPreview").innerHTML = "";
}

function addTodayBatch(state, text) {
  const dayNo = currentDayNumber(state);
  if (!dayNo) return { ok:false, msg:"시작일을 먼저 설정하세요." };

  const already = todayNewAdded(state, dayNo);
  const remain = Math.max(0, DAILY_NEW_LIMIT - already);
  if (remain <= 0) return { ok:false, msg:`오늘 신규 ${DAILY_NEW_LIMIT}개를 이미 추가했습니다.` };

  const parsed = parseBatch(text);
  if (parsed.length === 0) return { ok:false, msg:"추가할 데이터가 없습니다. (word | meaning 형식인지 확인)" };

  const toAdd = parsed.slice(0, remain);
  // 중복(단어 동일) 간단 방지: 기존 word 소문자 비교
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

  incTodayNewAdded(state, dayNo, addedCards.length);
  saveState(state);

  return {
    ok:true,
    msg:`추가 완료: ${addedCards.length}개 (중복/스킵: ${skipped}개) · 오늘 누적 추가: ${todayNewAdded(state, dayNo)}개`,
    addedCards
  };
}

function previewParse(text) {
  const parsed = parseBatch(text);
  return parsed.slice(0, 30);
}

// Search
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

// Backup
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

// PWA install prompt (best-effort)
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

// App init
let state = loadState();

function syncDayLabels() {
  const dayNo = currentDayNumber(state);
  $("dayLabel").textContent = state.startDate ? `Day ${dayNo}` : "Day - (시작일 설정 필요)";
}

function rerenderAll() {
  syncDayLabels();
  renderToday(state);
  renderStudy(state);
  renderAdd(state);
  renderSearch(state, $("searchInput").value);
  renderBackup(state);
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

// Today actions
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
  startTodayStudy(state);
});

// Study actions
$("studyCard").addEventListener("click", () => {
  revealed = !revealed;
  renderStudy(loadState());
});
$("btnReveal").addEventListener("click", () => {
  revealed = true;
  renderStudy(loadState());
});
$("btnNext").addEventListener("click", () => {
  nextCard(loadState());
});
$("btnShuffle").addEventListener("click", () => {
  shuffleQueue(loadState());
});

// Add actions
$("btnParsePreview").addEventListener("click", () => {
  const parsed = previewParse($("addInput").value);
  const wrap = $("addPreview");
  wrap.innerHTML = "";
  if (parsed.length === 0) {
    wrap.innerHTML = `<div class="item"><div class="m">미리보기 대상이 없습니다. (word | meaning 형식)</div></div>`;
    return;
  }
  for (const it of parsed) {
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
  const res = addTodayBatch(state, $("addInput").value);
  $("addResult").textContent = res.msg;
  if (res.ok) {
    // 제거: 추가한 만큼 입력창에서 줄을 빼는 건 복잡하니 MVP에서는 그대로 둠
    // 대신 오늘 목록/카운트 업데이트
    state = loadState();
    renderAdd(state);
    renderToday(state);
    alert(res.msg);
  } else {
    alert(res.msg);
  }
});

// Search actions
$("searchInput").addEventListener("input", (e) => {
  state = loadState();
  renderSearch(state, e.target.value);
});

// Backup actions
$("btnExport").addEventListener("click", () => {
  state = loadState();
  exportJson(state);
  renderBackup(state);
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
    state = loadState();
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
    state = loadState();
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

// initial
rerenderAll();
setTab("today");