// 부경대 공지알리미 웹앱. 자료는 GitHub Actions가 30분마다 모아 data/*.json으로 올린다
// (tools/build_web_data.py). 시간표·관심 게시판 같은 개인 설정은 이 브라우저(localStorage)에만 남는다.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const PALETTE = ["#5B8DEF", "#2BB673", "#EF8354", "#B15BEF", "#EF5B5B", "#34B3C2", "#C7A15B", "#7A8899"];
const FIREBASE_JS = "12.19.0"; // https://www.gstatic.com/firebasejs/<버전>/...
const ANDROID_APK = "https://github.com/vkagovkago/pknu-notice-config/releases/latest/download/pknu-notice.apk";

// ---------- 저장 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- 자료 ----------
const data = {};
async function load(name, force) {
  if (data[name] && !force) return data[name];
  const r = await fetch(`data/${name}.json`, { cache: force ? "reload" : "no-cache" });
  if (!r.ok) throw new Error(name);
  return (data[name] = await r.json());
}
const loadAll = (force) => Promise.allSettled(["notices", "schedule", "menu", "shuttle", "faq", "holidays"].map((n) => load(n, force)));

// ---------- 날짜 ----------
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const dayIndex = (d = new Date()) => (d.getDay() + 6) % 7; // 월=0
const nowMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const md = (k) => `${+k.slice(4, 6)}.${+k.slice(6, 8)}`;
const fromKey = (k) => new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8));
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
function termKey(d = new Date()) {
  const y = d.getFullYear(), x = (d.getMonth() + 1) * 100 + d.getDate();
  if (x >= 1221) return `${y}-W`;
  if (x >= 901) return `${y}-2`;
  if (x >= 621) return `${y}-S`;
  if (x >= 301) return `${y}-1`;
  return `${y - 1}-W`;
}
function termLabel(k) {
  const [y, t] = k.split("-");
  return `${y}년 ${{ 1: "1학기", 2: "2학기", S: "여름 계절학기", W: "겨울 계절학기" }[t]}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- 공지 ----------
const myBoards = () => store.get("boards", ["academic"]);
function noticesOf(ids) {
  const boards = data.notices?.boards || {};
  return ids.flatMap((id) => (boards[id]?.items || []).map((n) => ({ ...n, board: boards[id].name, boardId: id })));
}
const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || b.no - a.no;
function noticeRow(n, showBoard = true) {
  const pin = n.pinned ? '<span class="badge">고정</span> ' : "";
  return `<a class="row" href="${esc(n.url)}" target="_blank" rel="noopener">
    <div class="grow"><div class="t">${pin}${esc(n.title)}</div>
    <div class="sub">${showBoard ? esc(n.board) + " · " : ""}${esc(n.date)}</div></div></a>`;
}

// ---------- 시간표 ----------
const myClasses = () => store.get("timetable", []);
const saveClasses = (list) => store.set("timetable", list);
const termClasses = () => myClasses().filter((c) => (c.term || termKey()) === termKey());

// ---------- 셔틀 ----------
function shuttleTable(month = new Date().getMonth() + 1) {
  const tables = data.shuttle?.tables || [];
  const label = (month >= 3 && month <= 6) || (month >= 9 && month <= 12) ? "학기중" : "방학중";
  return tables.find((t) => t.label === label) || tables[0];
}
const holidayToday = () => data.holidays?.[todayKey()];

// ================= 화면 =================
const routes = {};
let current = "home";

async function render() {
  const [route, arg] = (location.hash.slice(1) || "home").split("/");
  current = routes[route] ? route : "home";
  const page = routes[current];
  $("#title").textContent = page.title;
  $("#back").hidden = !page.sub;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (page.tab || current)));
  view.innerHTML = '<div class="empty">불러오는 중…</div>';
  await loadAll();
  view.innerHTML = page.html(decodeURIComponent(arg || ""));
  page.after?.(decodeURIComponent(arg || ""));
  window.scrollTo(0, 0);
}

// ----- 홈 -----
routes.home = {
  title: "부경대 공지알리미",
  html() {
    const now = new Date(), minute = nowMinute(), di = dayIndex(now), hol = holidayToday();
    const today = termClasses().filter((c) => !c.online && c.day === di).sort((a, b) => a.start - b.start);
    const next = today.find((c) => c.end > minute);
    let cls;
    if (!termClasses().length) cls = '<a href="#timetable">시간표를 넣으면 오늘 수업이 여기 보여요 ›</a>';
    else if (hol) cls = `오늘은 ${esc(hol)} — 쉬는 날이에요`;
    else if (!today.length) cls = "오늘은 수업이 없어요";
    else if (!next) cls = `오늘 수업 끝 (${today.length}개)`;
    else cls = `${next.start <= minute ? "지금" : "다음 " + hm(next.start)} <b>${esc(next.name)}</b>${next.room ? " · " + esc(next.room) : ""}`;

    const t = shuttleTable();
    let bus = "셔틀 시간표가 없어요";
    if (t) {
      const up = (list) => list.map(toMin).filter((m) => m >= minute)[0];
      const d = up(t.fromDaeyeon), y = up(t.fromYongdang);
      bus = di >= 5 ? "셔틀은 주말에 운행하지 않아요" : hol ? "셔틀은 공휴일에 운행하지 않아요"
        : d == null && y == null ? "오늘 셔틀 운행 끝"
        : [d != null && `대연→용당 ${hm(d)}`, y != null && `용당→대연 ${hm(y)}`].filter(Boolean).join(" · ");
    }

    const tk = todayKey();
    const meals = (data.menu?.cafeterias || []).map((c) => ({ name: c.name, meals: c.days?.[tk] || [] })).filter((c) => c.meals.length);
    const events = upcomingEvents().slice(0, 4);
    const notices = noticesOf(myBoards()).filter((n) => !n.pinned).sort(byNewest).slice(0, 6);
    const exam = examLine();

    return `
      <section class="card"><h2>오늘 · ${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[di]})</h2>
        <div class="row"><span>🗓️</span><div class="grow">${cls}</div></div>
        <a class="row" href="#shuttle" style="color:inherit"><span>🚌</span><div class="grow">${bus}</div></a>
        ${exam ? `<a class="row" href="#schedule" style="color:inherit"><span>📝</span><div class="grow">${exam}</div></a>` : ""}
      </section>
      <section class="card"><h2>오늘 학식 <a class="more" href="#menu">주간 보기 ›</a></h2>
        ${meals.length ? meals.map((c) => `<div class="row"><div class="grow"><b>${esc(c.name)}</b>
          ${c.meals.map((m) => `<div class="sub">${esc(m.name)}: ${esc(m.dishes.slice(0, 4).join(", "))}${m.dishes.length > 4 ? " …" : ""}</div>`).join("")}</div></div>`).join("")
          : '<div class="empty">오늘 올라온 식단이 없어요</div>'}
      </section>
      <section class="card"><h2>다가오는 학사일정 <a class="more" href="#schedule">전체 ›</a></h2>
        ${events.map(eventRow).join("") || '<div class="empty">다가오는 일정이 없어요</div>'}
      </section>
      <section class="card list"><h2>최근 공지 <a class="more" href="#notices">전체 ›</a></h2>
        ${notices.map((n) => noticeRow(n)).join("") || '<div class="empty">공지가 없어요</div>'}
        <p class="note">자료 기준 ${esc((data.notices?.updated || "").replace("T", " ").slice(0, 16))} · 30분마다 갱신</p>
      </section>
      ${installCard()}`;
  },
};

function upcomingEvents() {
  const tk = todayKey();
  return (data.schedule?.events || []).filter((e) => (e.end || e.start) >= tk);
}
function eventRow(e) {
  const tk = todayKey();
  const left = daysBetween(tk, e.start);
  const badge = e.start <= tk ? '<span class="badge green">진행중</span>' : `<span class="badge">D-${left}</span>`;
  const range = e.end && e.end !== e.start ? `${md(e.start)} ~ ${md(e.end)}` : md(e.start);
  return `<div class="row">${badge}<div class="grow"><div class="t">${esc(e.title)}</div><div class="sub">${range}</div></div></div>`;
}
function examLine() {
  const tk = todayKey();
  const ev = upcomingEvents().filter((e) => /(중간|기말)고사/.test(e.title) && !e.title.includes("대학원"))[0];
  if (!ev) return "";
  const name = ev.title.match(/(중간|기말)고사/)[0], left = daysBetween(tk, ev.start);
  if (left > 30) return "";
  const range = ev.end && ev.end !== ev.start ? `${md(ev.start)}~${md(ev.end)}` : md(ev.start);
  return left <= 0 ? `${name} 기간이에요 (${range})` : `${name} D-${left} (${range})`;
}

// 아이폰 사파리에서 처음 열었을 때만 "홈 화면에 추가" 안내
function installCard() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || store.get("hideInstall", false)) return "";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const android = /Android/.test(navigator.userAgent);
  return `<section class="card"><h2>📲 앱처럼 쓰기</h2>
    ${ios ? '<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 앱처럼 아이콘이 생겨요.</p>'
      : android ? `<p>안드로이드는 <a href="${ANDROID_APK}">앱(APK)을 받아</a> 쓰면 위젯·수업 알림까지 쓸 수 있어요.</p>`
      : "<p>휴대폰에서 열어 홈 화면에 추가하면 앱처럼 쓸 수 있어요.</p>"}
    <button class="btn ghost" onclick="store.set('hideInstall',true);render()">다시 보지 않기</button></section>`;
}

// ----- 공지 -----
routes.notices = {
  title: "공지사항",
  html() {
    const ids = myBoards(), boards = data.notices?.boards || {};
    const sel = store.get("noticeFilter", "all");
    return `
      <input type="search" id="q" placeholder="공지 검색 (내 게시판 전체)" value="${esc(store.get("noticeQuery", ""))}">
      <div class="chips">
        <button class="chip ${sel === "all" ? "on" : ""}" data-f="all">전체</button>
        ${ids.map((id) => `<button class="chip ${sel === id ? "on" : ""}" data-f="${esc(id)}">${esc(boards[id]?.name || id)}</button>`).join("")}
        <a class="chip" href="#boards">＋ 게시판</a>
      </div>
      <section class="card list" id="nlist"></section>`;
  },
  after() {
    const draw = () => {
      const sel = store.get("noticeFilter", "all");
      const q = $("#q").value.trim().replace(/\s+/g, "").toLowerCase();
      const ids = sel === "all" ? myBoards() : [sel];
      const errs = ids.map((id) => data.notices?.boards?.[id]).filter((b) => b?.error && !(b.items || []).length);
      let list = noticesOf(ids);
      if (q) list = list.filter((n) => n.title.replace(/\s+/g, "").toLowerCase().includes(q));
      list.sort((a, b) => (sel !== "all" && (b.pinned - a.pinned)) || byNewest(a, b));
      $("#nlist").innerHTML = (errs.length ? `<p class="note">⚠ ${errs.map((b) => esc(b.name)).join(", ")}: 지금은 목록을 받지 못했어요</p>` : "")
        + (list.slice(0, 150).map((n) => noticeRow(n, sel === "all")).join("") || '<div class="empty">공지가 없어요</div>');
    };
    $("#q").addEventListener("input", () => { store.set("noticeQuery", $("#q").value); draw(); });
    view.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      store.set("noticeFilter", b.dataset.f);
      view.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    }));
    draw();
  },
};

routes.boards = {
  title: "관심 게시판", sub: true, tab: "notices",
  html() {
    const boards = data.notices?.boards || {}, mine = new Set(myBoards());
    const groups = {};
    Object.entries(boards).forEach(([id, b]) => (groups[b.college] ||= []).push([id, b]));
    return `<input type="search" id="bq" placeholder="학과·게시판 이름 검색">
      <p class="note">고른 게시판의 공지가 홈과 공지 탭에 모여요.</p>
      ${Object.entries(groups).map(([college, list]) => `<section class="card" data-group>
        <h2>${esc(college)}</h2>
        ${list.map(([id, b]) => `<label class="row" data-name="${esc(b.name)}"><input type="checkbox" value="${esc(id)}" ${mine.has(id) ? "checked" : ""}>
          <div class="grow">${esc(b.name)}</div></label>`).join("")}</section>`).join("")}`;
  },
  after() {
    view.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
      const ids = [...view.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value);
      store.set("boards", ids.length ? ids : ["academic"]);
      if (cb.checked) store.set("noticeFilter", "all");
    }));
    $("#bq").addEventListener("input", () => {
      const q = $("#bq").value.trim();
      view.querySelectorAll("[data-group]").forEach((g) => {
        let any = false;
        g.querySelectorAll("[data-name]").forEach((r) => { const ok = !q || r.dataset.name.includes(q); r.hidden = !ok; any ||= ok; });
        g.hidden = !any;
      });
    });
  },
};

// ----- 학식 -----
routes.menu = {
  title: "학식",
  html(arg) {
    const m = data.menu;
    if (!m?.cafeterias?.length) return '<div class="empty">이번 주 식단이 아직 없어요</div>';
    const monday = fromKey(m.monday);
    const keys = DAYS.map((_, i) => keyOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
    const tk = todayKey();
    const sel = arg && keys.includes(arg) ? arg : keys.includes(tk) ? tk : keys[0];
    return `<div class="chips">${keys.map((k, i) => `<a class="chip ${k === sel ? "on" : ""}" href="#menu/${k}">${DAYS[i]} ${md(k)}</a>`).join("")}</div>
      ${m.cafeterias.map((c) => {
        const meals = c.days[sel] || [];
        return `<section class="card"><h2>${esc(c.name)}</h2>
          ${meals.length ? meals.map((x) => `<div class="meal"><b>${esc(x.name)}</b><p>${esc(x.dishes.join(" · "))}</p></div>`).join("") : '<div class="sub">식단 없음</div>'}
          ${c.hours ? `<p class="note">${esc(c.hours)}</p>` : ""}</section>`;
      }).join("")}`;
  },
};

// ----- 시간표 -----
routes.timetable = {
  title: "시간표",
  html() {
    const list = termClasses(), grid = list.filter((c) => !c.online), online = list.filter((c) => c.online);
    const maxDay = Math.max(4, ...grid.map((c) => c.day));
    const startH = Math.min(9, ...grid.map((c) => Math.floor(c.start / 60)));
    const endH = Math.max(18, ...grid.map((c) => Math.ceil(c.end / 60)));
    const ti = dayIndex(), H = 48;
    const cols = [...Array(maxDay + 1).keys()].map((d) => `<div class="col ${d === ti ? "today" : ""}" style="grid-row:2;height:${(endH - startH) * H}px">
      ${grid.filter((c) => c.day === d).map((c) => `<div class="blk" data-id="${c.id}" style="top:${(c.start - startH * 60) / 60 * H}px;height:${(c.end - c.start) / 60 * H - 2}px;background:${PALETTE[c.color % PALETTE.length]}55">
        <b>${esc(c.name)}</b><small>${esc(c.room)}</small></div>`).join("")}</div>`).join("");
    return `<p class="sub">${termLabel(termKey())}</p>
      ${grid.length ? `<div class="tt" style="--days:${maxDay + 1}">
        <div class="hd"></div>${[...Array(maxDay + 1).keys()].map((d) => `<div class="hd ${d === ti ? "today" : ""}">${DAYS[d]}</div>`).join("")}
        <div class="hours" style="grid-row:2">${[...Array(endH - startH).keys()].map((h) => `<div>${startH + h}</div>`).join("")}</div>${cols}
      </div>` : '<section class="card"><div class="empty">아직 수업이 없어요. 아래에서 추가하거나 안드로이드 앱 백업을 가져오세요.</div></section>'}
      ${online.length ? `<section class="card" style="margin-top:14px"><h2>시간 없는 수업 (원격 등)</h2>${online.map((c) => `<div class="row" data-id="${c.id}"><div class="grow">${esc(c.name)}</div></div>`).join("")}</section>` : ""}
      <div class="btns" style="margin-top:14px">
        <button class="btn" id="add">＋ 수업 추가</button>
        <label class="btn ghost">안드로이드 백업 가져오기<input type="file" id="imp" accept=".json,application/json" hidden></label>
      </div>
      <p class="note">시간표는 이 휴대폰 브라우저에만 저장돼요. 칸을 누르면 고치거나 지울 수 있어요.</p>`;
  },
  after() {
    $("#add").onclick = () => classDialog();
    view.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => classDialog(myClasses().find((c) => c.id === el.dataset.id))));
    $("#imp").onchange = async (e) => {
      try {
        const n = importAndroidBackup(await e.target.files[0].text());
        toast(`수업 ${n}개를 가져왔어요`); render();
      } catch (err) { toast("가져오지 못했어요: 앱의 설정 백업 파일인지 확인해 주세요"); }
    };
  },
};

function classDialog(c) {
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div><h3>${c ? "수업 고치기" : "수업 추가"}</h3>
    <label for="cn">과목 이름</label><input type="text" id="cn" value="${esc(c?.name || "")}">
    <label for="cd">요일</label><select id="cd">${DAYS.map((x, i) => `<option value="${i}" ${(c ? c.day : 0) === i ? "selected" : ""}>${x}요일</option>`).join("")}</select>
    <div class="grid2"><div><label for="cs">시작</label><input type="time" id="cs" value="${hm(c?.start ?? 540)}"></div>
    <div><label for="ce">끝</label><input type="time" id="ce" value="${hm(c?.end ?? 615)}"></div></div>
    <label for="cr">강의실</label><input type="text" id="cr" value="${esc(c?.room || "")}">
    <div class="btns"><button class="btn" id="ok">저장</button>${c ? '<button class="btn danger" id="del">삭제</button>' : ""}<button class="btn ghost" id="no">취소</button></div></div>`;
  document.body.append(d);
  d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
  $("#no", d).onclick = () => d.remove();
  if (c) $("#del", d).onclick = () => { saveClasses(myClasses().filter((x) => x.id !== c.id)); d.remove(); render(); };
  $("#ok", d).onclick = () => {
    const name = $("#cn", d).value.trim(), start = toMin($("#cs", d).value), end = toMin($("#ce", d).value);
    if (!name || !(end > start)) return toast("이름과 시간을 확인해 주세요");
    const list = myClasses().filter((x) => x.id !== c?.id);
    const used = new Set(list.map((x) => x.color % PALETTE.length));
    const color = c?.color ?? [...PALETTE.keys()].find((i) => !used.has(i)) ?? list.length;
    list.push({ id: c?.id || String(Date.now()), name, day: +$("#cd", d).value, start, end, room: $("#cr", d).value.trim(), color, term: c?.term || termKey(), online: false });
    saveClasses(list); d.remove(); render();
  };
}

// 안드로이드 앱의 설정 백업(JSON)에서 시간표만 가져온다. 항목 구분 0x1E, 칸 구분 0x1F (TimetablePrefs와 같은 형식)
function importAndroidBackup(text) {
  const raw = JSON.parse(text).timetableEntries;
  if (typeof raw !== "string") throw new Error("no timetable");
  const items = raw.split("\u001e").map((line) => line.split("\u001f")).filter((f) => f.length >= 7).map((f) => ({
    id: f[0], name: f[1], day: DAY_KEYS.indexOf(f[2]), start: +f[3], end: +f[4], room: f[5], color: +f[6] || 0,
    online: f[8] === "1", term: f[9] || termKey(),
  })).filter((c) => c.day >= 0 && c.name);
  const ids = new Set(items.map((c) => c.id));
  saveClasses([...myClasses().filter((c) => !ids.has(c.id)), ...items]);
  return items.filter((c) => c.term === termKey()).length;
}

// ----- 더보기 -----
routes.more = {
  title: "더보기",
  html() {
    const item = (href, icon, name, sub) => `<a class="row" href="${href}" style="color:inherit"><span>${icon}</span><div class="grow"><div>${name}</div><div class="sub">${sub}</div></div><span class="sub">›</span></a>`;
    return `<section class="card">
      ${item("#chat", "🤖", "AI 챗봇", "학교생활·앱 사용법 물어보기")}
      ${item("#faq", "❓", "자주 묻는 질문", "휴학·수강신청·장학금 등")}
      ${item("#schedule", "📅", "학사일정", "이번 학기 전체 일정")}
      ${item("#shuttle", "🚌", "셔틀버스", "대연 ↔ 용당 시간표")}
      ${item("#boards", "📌", "관심 게시판", "공지를 모아 볼 게시판 고르기")}
      ${item("#push", "🔔", "새 공지 알림", "고른 게시판에 새 글이 올라오면 알림")}
      </section>
      <section class="card"><h2>앱 정보</h2>
        <p class="sub">학생이 만든 비공식 앱이에요. 정확한 내용은 꼭 학교 공지 원문으로 확인해 주세요.</p>
        <p class="sub">안드로이드는 <a href="${ANDROID_APK}">앱(APK)</a>으로 위젯·수업 알림까지 쓸 수 있어요.</p>
      </section>`;
  },
};

routes.schedule = {
  title: "학사일정", sub: true, tab: "more",
  html() {
    const tk = todayKey(), events = data.schedule?.events || [];
    const groups = {};
    events.forEach((e) => (groups[e.start.slice(0, 6)] ||= []).push(e));
    return Object.entries(groups).map(([ym, list]) => `<section class="card"><h2>${+ym.slice(0, 4)}년 ${+ym.slice(4)}월</h2>
      ${list.map((e) => ((e.end || e.start) < tk ? eventRow(e).replace('class="row"', 'class="row" style="opacity:.45"') : eventRow(e))).join("")}</section>`).join("")
      || '<div class="empty">일정이 없어요</div>';
  },
};

routes.shuttle = {
  title: "셔틀버스", sub: true, tab: "more",
  html() {
    const tables = data.shuttle?.tables || [], cur = shuttleTable(), minute = nowMinute();
    const weekend = dayIndex() >= 5 || holidayToday();
    const row = (list, isCur) => {
      const next = isCur && !weekend ? list.map(toMin).find((m) => m >= minute) : null;
      return `<div class="times">${list.map((s) => { const m = toMin(s); return `<span class="${isCur && !weekend && m < minute ? "past" : ""} ${m === next ? "next" : ""}">${s}</span>`; }).join("")}</div>`;
    };
    return (weekend ? '<p class="note">오늘은 셔틀이 운행하지 않아요 (주말·공휴일).</p>' : "")
      + tables.map((t) => `<section class="card"><h2>${esc(t.label)} ${t === cur ? '<span class="badge green">지금</span>' : ""}</h2>
        <p class="sub">대연 → 용당</p>${row(t.fromDaeyeon, t === cur)}<p class="sub" style="margin-top:12px">용당 → 대연</p>${row(t.fromYongdang, t === cur)}</section>`).join("")
      + `<p class="note">${esc(data.shuttle?.note || "")}</p>`;
  },
};

routes.faq = {
  title: "자주 묻는 질문", sub: true, tab: "more",
  html() {
    const items = data.faq?.items || [], cats = ["전체", ...new Set(items.map((i) => i.category))];
    return `<input type="search" id="fq" placeholder="궁금한 것 검색 (예: 휴학, 장학금)">
      <div class="chips">${cats.map((c, i) => `<button class="chip ${i === 0 ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <section class="card" id="flist"></section>
      <a class="btn ghost" href="#chat">🤖 찾는 답이 없으면 AI에게 묻기</a>`;
  },
  after() {
    let cat = "전체";
    const draw = () => {
      const q = $("#fq").value.trim().replace(/\s+/g, "");
      const list = (data.faq?.items || []).filter((i) => (cat === "전체" || i.category === cat)
        && (!q || (i.q + i.a).replace(/\s+/g, "").includes(q)));
      $("#flist").innerHTML = list.map((i) => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p>
        ${i.link ? `<p><a href="${esc(i.link)}" target="_blank" rel="noopener">관련 페이지 ›</a></p>` : ""}</details>`).join("") || '<div class="empty">찾는 질문이 없어요</div>';
    };
    $("#fq").addEventListener("input", draw);
    view.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => {
      cat = b.dataset.c; view.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); draw();
    }));
    draw();
  },
};

// ----- AI 챗봇 (Firebase AI Logic, 안드로이드 앱과 같은 프로젝트·하루 횟수 규칙) -----
const chatLog = [];
routes.chat = {
  title: "AI 챗봇", sub: true, tab: "more",
  html() {
    if (!window.FIREBASE_CONFIG) return '<section class="card"><div class="empty">AI 챗봇은 준비 중이에요.<br>자주 묻는 질문에서 먼저 찾아봐 주세요.</div><a class="btn ghost" href="#faq">자주 묻는 질문</a></section>';
    return `<p class="sub" id="left"></p>
      <div class="chat" id="chat">${chatLog.length ? "" : `<div class="bubble bot">부경대 생활이나 이 앱 사용법을 물어보세요. 자주 묻는 질문과 최근 공지를 보고 답해요. AI라 틀릴 수 있으니 중요한 건 학교 공지로 꼭 확인해 주세요. 질문은 답을 만들기 위해 Google(Gemini)로 보내져요 — 학번·연락처는 적지 마세요.</div>`}</div>
      <form class="chatbar" id="cf"><input type="text" id="ci" placeholder="질문을 적어주세요" autocomplete="off"><button class="btn">보내기</button></form>`;
  },
  after() {
    if (!window.FIREBASE_CONFIG) return;
    const box = $("#chat");
    const draw = () => {
      box.querySelectorAll(".log").forEach((x) => x.remove());
      chatLog.forEach((t) => box.insertAdjacentHTML("beforeend", `<div class="bubble log ${t.me ? "me" : "bot"}">${esc(t.text)}</div>`));
      $("#left").textContent = `오늘 남은 질문 ${remainingToday()}개`;
      window.scrollTo(0, document.body.scrollHeight);
    };
    draw();
    $("#cf").onsubmit = async (e) => {
      e.preventDefault();
      const q = $("#ci").value.trim();
      if (!q) return;
      if (remainingToday() <= 0) return toast(dailyLimit() === 0 ? "AI 기능을 잠시 쉬고 있어요" : "오늘 질문을 다 썼어요. 내일 다시 물어봐 주세요.");
      const history = chatLog.slice(-10);
      chatLog.push({ me: true, text: q }); $("#ci").value = ""; draw();
      chatLog.push({ me: false, text: "답을 만드는 중…" }); draw();
      try { chatLog[chatLog.length - 1].text = await askAI(history, q); countOne(); }
      catch (err) {
        console.warn(err);
        chatLog[chatLog.length - 1].text = /quota|429/i.test(String(err)) ? "지금은 질문이 너무 많이 몰려서 답할 수 없어요. 잠시 뒤에 다시 물어봐 주세요." : "답을 받지 못했어요. 인터넷 연결을 확인하고 다시 물어봐 주세요.";
      }
      if (current === "chat") draw();
    };
  },
};
const dailyLimit = () => Math.max(0, Math.min(200, data.faq?.dailyLimit ?? 30));
function remainingToday() {
  const u = store.get("aiUse", {});
  return Math.max(0, dailyLimit() - (u.day === todayKey() ? u.n : 0));
}
function countOne() {
  const u = store.get("aiUse", {});
  store.set("aiUse", { day: todayKey(), n: (u.day === todayKey() ? u.n : 0) + 1 });
}
let aiModel;
async function askAI(history, q) {
  const v = FIREBASE_JS;
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-ai.js`);
  if (!aiModel) {
    const app = getApps()[0] || initializeApp(window.FIREBASE_CONFIG);
    aiModel = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
      model: data.faq?.chatModel || "gemini-3.8-flash",
      systemInstruction: systemPrompt(),
    });
  }
  const chat = aiModel.startChat({ history: history.map((t) => ({ role: t.me ? "user" : "model", parts: [{ text: t.text }] })) });
  const r = await chat.sendMessage(q);
  return r.response.text().trim() || "답을 만들지 못했어요. 질문을 조금 바꿔서 다시 물어봐 주세요.";
}
// 안드로이드 ChatBot.systemPrompt와 같은 원칙: 자료에 있는 것만, 학사 숫자는 지어내지 않는다
function systemPrompt() {
  const faq = (data.faq?.items || []).map((i) => `Q: ${i.q}\nA: ${i.a}${i.link ? " (" + i.link + ")" : ""}`).join("\n\n");
  const notices = noticesOf(myBoards()).sort(byNewest).slice(0, 40).map((n) => `- [${n.board}] ${n.title} (${n.date}) ${n.url}`).join("\n");
  const events = upcomingEvents().slice(0, 25).map((e) => `- ${e.title}: ${e.start}${e.end && e.end !== e.start ? "~" + e.end : ""}`).join("\n");
  return `너는 국립부경대학교 학생을 돕는 "부경대 공지알리미" 앱의 도우미다. 한국어로 짧고 친절하게, 마크다운 없이 답한다.
아래 자료에 있는 내용으로만 답하고, 자료에 없는 학사 날짜·학점·금액은 지어내지 말고 "학교 공지나 학과 사무실에서 확인해 주세요"라고 안내한다.
오늘은 ${todayKey()}이다.

[자주 묻는 질문]
${faq}

[다가오는 학사일정]
${events}

[최근 공지]
${notices}`;
}

// ----- 새 공지 알림 (웹 푸시) -----
routes.push = {
  title: "새 공지 알림", sub: true, tab: "more",
  html() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (!window.FIREBASE_CONFIG?.vapidKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return `<section class="card"><div class="empty">새 공지 알림은 준비 중이에요.</div>
        ${ios && !standalone ? '<p class="sub">아이폰은 먼저 사파리에서 <b>공유 → 홈 화면에 추가</b>를 한 뒤 그 아이콘으로 열어야 알림을 받을 수 있어요 (iOS 16.4 이상).</p>' : ""}</section>`;
    }
    const on = store.get("pushOn", false);
    return `<section class="card"><h2>새 공지 알림</h2>
      <p class="sub">관심 게시판(${myBoards().length}곳)에 새 글이 올라오면 알려드려요. 학교 사이트를 30분마다 확인해서 조금 늦을 수 있고, 밤 22시~아침 8시에는 보내지 않아요.</p>
      ${ios && !standalone ? '<p class="note">⚠ 아이폰은 홈 화면에 추가한 아이콘으로 열어야 알림을 켤 수 있어요.</p>' : ""}
      <div class="btns"><button class="btn" id="pon">${on ? "알림 게시판 다시 맞추기" : "알림 켜기"}</button>${on ? '<button class="btn danger" id="poff">알림 끄기</button>' : ""}</div></section>`;
  },
  after() {
    $("#pon") && ($("#pon").onclick = () => setPush(true));
    $("#poff") && ($("#poff").onclick = () => setPush(false));
  },
};
async function setPush(on) {
  try {
    const v = FIREBASE_JS;
    const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
    const { getMessaging, getToken, deleteToken } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-messaging.js`);
    const { getFirestore, doc, setDoc, deleteDoc } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);
    const app = getApps()[0] || initializeApp(window.FIREBASE_CONFIG);
    const messaging = getMessaging(app), db = getFirestore(app);
    const reg = await navigator.serviceWorker.ready;
    if (!on) {
      const old = store.get("pushToken", null);
      if (old) await deleteDoc(doc(db, "webPush", old)).catch(() => {});
      await deleteToken(messaging).catch(() => {});
      store.set("pushOn", false); store.set("pushToken", null);
      toast("알림을 껐어요"); return render();
    }
    if ((await Notification.requestPermission()) !== "granted") return toast("알림 권한을 허용해야 받을 수 있어요");
    const token = await getToken(messaging, { vapidKey: window.FIREBASE_CONFIG.vapidKey, serviceWorkerRegistration: reg });
    // 토큰과 고른 게시판만 저장한다(이름·기기 정보 없음). 서버(GitHub Actions)가 새 글이 있는 게시판의 토큰에만 보낸다.
    await setDoc(doc(db, "webPush", token), { token, boards: myBoards().slice(0, 60), updated: Date.now() });
    store.set("pushOn", true); store.set("pushToken", token);
    toast("알림을 켰어요"); render();
  } catch (err) {
    console.warn(err); toast("알림을 켜지 못했어요");
  }
}

// ---------- 시작 ----------
$("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#more"));
$("#refresh").onclick = async () => { await loadAll(true); toast("새로 불러왔어요"); render(); };
addEventListener("hashchange", render);
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
