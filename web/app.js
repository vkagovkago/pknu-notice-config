// 부경대 공지알리미 웹앱. 자료는 GitHub Actions가 30분마다 모아 data/*.json으로 올린다
// (tools/build_web_data.py). 시간표·관심 게시판 같은 개인 설정은 이 브라우저(localStorage)에만 남는다.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const PALETTE = ["#5B8DEF", "#2BB673", "#EF8354", "#B15BEF", "#EF5B5B", "#34B3C2", "#C7A15B", "#7A8899"];
const FIREBASE_JS = "12.19.0"; // https://www.gstatic.com/firebasejs/<버전>/...
const ANDROID_APK = "https://vkagovkago.github.io/pknu-notice-config/download/";

// ---------- 저장 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- 자료 ----------
const data = {};
async function load(name, force) {
  if (data[name] && !force) return data[name];
  // static/은 앱 assets에서 옮겨 온 고정 자료, 나머지는 Actions가 모은 자료
  const r = await fetch(name.startsWith("static/") ? `${name}.json` : `data/${name}.json`, { cache: force ? "reload" : "no-cache" });
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
// 학기 순서: 1학기 < 여름 < 2학기 < 겨울 (앱 Season 순서)
const SEASONS = "1S2W";
const termOrder = (k) => { const [y, t] = k.split("-"); return +y * 10 + SEASONS.indexOf(t); };
function termShift(k, n) {
  let [y, t] = k.split("-"), i = SEASONS.indexOf(t) + n;
  y = +y + Math.floor(i / 4); i = ((i % 4) + 4) % 4;
  return `${y}-${SEASONS[i]}`;
}
let viewTerm = termKey(); // 시간표 화면에서 보고 있는 학기

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
  return ids.flatMap((id) => (boards[id]?.items || []).map((n) => ({ ...n, board: boards[id].name, boardId: id })))
    .filter((n) => !isExcluded(n.title));
}
const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || b.no - a.no;
const bmKey = (n) => `${n.boardId}|${n.no}`;
const bookmarks = () => store.get("bookmarks", {}); // 키 → 공지(목록에서 빠져도 남게 통째로)
let readCache;
const readSet = () => (readCache ||= new Set(store.get("read", [])));
function markRead(k) {
  if (readSet().has(k)) return;
  readSet().add(k); store.set("read", [...readSet()].slice(-3000));
}
const keywords = () => store.get("keywords", []);
const hasKeyword = (t) => keywords().some((k) => k && t.includes(k));
// 제외 키워드(앱 KeywordPrefs 제외): 제목에 이 말이 든 공지는 목록·홈에서 뺀다
const excludes = () => store.get("excludes", []);
const isExcluded = (t) => excludes().some((k) => k && t.includes(k));
function highlight(title) {
  let t = esc(title);
  keywords().forEach((k) => { if (k) t = t.split(esc(k)).join(`<mark>${esc(k)}</mark>`); });
  return t;
}
const shown = {}; // 화면에 그린 공지(북마크할 때 통째로 저장하려고)
function noticeRow(n, showBoard = true) {
  const k = bmKey(n), bm = !!bookmarks()[k];
  shown[k] = n;
  const pin = n.pinned ? '<span class="badge">고정</span> ' : "";
  const dl = deadlineBadge(deadlineOf(n.title, n.date || ""));
  return `<div class="row nrow ${readSet().has(k) ? "read" : ""}"><a class="grow" href="${esc(n.url)}" target="_blank" rel="noopener" data-read="${esc(k)}">
    <div class="t">${pin}${dl}${highlight(n.title)}</div>
    <div class="sub">${showBoard ? esc(n.board) + " · " : ""}${esc(n.date)}</div></a>
    <button class="star ${bm ? "on" : ""}" data-bm="${esc(k)}" aria-label="${bm ? "담기 취소" : "담기"}">${bm ? "★" : "☆"}</button></div>`;
}
function toggleBookmark(k, btn) {
  const all = bookmarks();
  if (all[k]) delete all[k]; else if (shown[k]) all[k] = shown[k]; else return;
  store.set("bookmarks", all);
  btn.classList.toggle("on", !!all[k]); btn.textContent = all[k] ? "★" : "☆";
  toast(all[k] ? "공지를 담았어요 (공지 > ★ 담은 공지)" : "담기를 취소했어요");
}

// 제목에 적힌 마감일("…신청 안내(~9/20)"). 앱 NoticeDeadline.find와 같은 규칙인데, 웹은 본문을 못 읽어 제목만 본다.
const DL_WORDS = ["마감", "까지", "~", "신청기간", "신청 기간", "접수기간", "접수 기간", "모집기간", "모집 기간", "기한", "제출기한", "신청기한"];
const FULL_DATE = /(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/g;
const SHORT_DATE = /(^|\D)(\d{1,2})\s*[.\-월/]\s*(\d{1,2})\s*(?:일)?(?!\d)/g; // 뒤돌아보기 대신 앞 글자를 잡는다(옛 사파리)
const shiftKey = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
function datesIn(chunk, year) {
  const key = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}${pad(m)}${pad(d)}` : null);
  const out = [];
  for (const m of chunk.matchAll(FULL_DATE)) { const k = key(+m[1], +m[2], +m[3]); if (k) out.push(k); }
  for (const m of chunk.replace(FULL_DATE, " ").matchAll(SHORT_DATE)) { const k = key(year, +m[2], +m[3]); if (k) out.push(k); }
  return out;
}
function deadlineOf(text, noticeDate) {
  const nd = noticeDate.replace(/-/g, "");
  if (!text || nd.length !== 8) return null;
  const floor = shiftKey(nd, -7), ceil = shiftKey(nd, 400), wins = [];
  for (const w of DL_WORDS) {
    for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + 1)) {
      const ds = datesIn(text.slice(Math.max(0, at - 40), at + w.length + 40), +nd.slice(0, 4)).filter((d) => d >= floor && d <= ceil).sort();
      if (ds.length) wins.push(ds[ds.length - 1]);
    }
  }
  if (!wins.length) return null;
  const tk = todayKey(), fut = wins.filter((d) => d >= tk).sort();
  return fut[0] || wins.sort()[wins.length - 1];
}
function deadlineBadge(d) {
  if (!d) return "";
  const left = daysBetween(todayKey(), d);
  if (left < 0 || left > 30) return "";
  return `<span class="badge red">${left === 0 ? "오늘 마감" : left === 1 ? "내일 마감" : "D-" + left}</span> `;
}

// ---------- 시간표 ----------
const myClasses = () => store.get("timetable", []);
const saveClasses = (list) => store.set("timetable", list);
const termClasses = (term = termKey()) => myClasses().filter((c) => (c.term || termKey()) === term);

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
    const gap = hol ? null : gapMinutes(today, minute);
    const fav = favToday();
    const week = weekSummary();
    const soon = upcomingTasks(7).slice(0, 3);
    const reg = courseRegEvent();
    const hidden = new Set(store.get("homeHidden", []));
    const show = (id, html) => (hidden.has(id) ? "" : html);

    return `${backupCard()}
      ${!window.FIREBASE_CONFIG ? "" : show("chat", '<a class="card banner" href="#chat">🤖 <b>AI 챗봇</b>에게 학교생활 물어보기 ›</a>')}
      <section class="card"><h2>오늘 · ${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[di]})</h2>
        <div class="row"><span>🗓️</span><div class="grow">${cls}</div></div>
        ${gap ? `<a class="row" href="#rooms" style="color:inherit"><span>🚪</span><div class="grow">공강 ${durationLabel(gap)} — 빈 강의실 찾기</div></a>` : ""}
        <a class="row" href="#shuttle" style="color:inherit"><span>🚌</span><div class="grow">${bus}</div></a>
        ${fav.length ? `<a class="row" href="#menu" style="color:inherit"><span>❤️</span><div class="grow">오늘 학식에 좋아하는 메뉴: ${esc(fav.slice(0, 3).join(", "))}${fav.length > 3 ? ` 외 ${fav.length - 3}개` : ""}</div></a>` : ""}
        ${exam ? `<a class="row" href="#schedule" style="color:inherit"><span>📝</span><div class="grow">${exam}</div></a>` : ""}
        ${soon.map((t) => `<a class="row" href="#tasks" style="color:inherit"><span>📌</span><div class="grow">${esc(t.course)} ${esc(t.kind)}${t.title ? " · " + esc(t.title) : ""} <span class="badge red">${taskBadge(t)}</span></div></a>`).join("")}
      </section>
      ${week ? show("week", `<section class="card"><h2>${esc(week.title)}</h2>${week.lines.map((l) => `<div class="sub" style="margin:3px 0">${esc(l)}</div>`).join("")}</section>`) : ""}
      ${reg ? show("reg", `<section class="card"><h2>📋 ${esc(courseRegShort(reg))}</h2>${eventRow(reg)}
        <div class="btns"><button class="btn ghost" id="regics">내 차례 알람을 캘린더에 넣기</button></div>
        <p class="note">학년별 시작 시각은 학사공지·강의편람에서 확인해 주세요.</p></section>`) : ""}
      ${hidden.has("menu") ? "" : `<section class="card"><h2>오늘 학식 <a class="more" href="#menu">주간 보기 ›</a></h2>
        ${meals.length ? meals.map((c) => `<div class="row"><div class="grow"><b>${esc(c.name)}</b>
          ${c.meals.map((m) => `<div class="sub">${esc(m.name)}: ${esc(m.dishes.slice(0, 4).join(", "))}${m.dishes.length > 4 ? " …" : ""}</div>`).join("")}</div></div>`).join("")
          : '<div class="empty">오늘 올라온 식단이 없어요</div>'}
      </section>`}
      ${show("schedule", `<section class="card"><h2>다가오는 학사일정 <a class="more" href="#schedule">전체 ›</a></h2>
        ${events.map(eventRow).join("") || '<div class="empty">다가오는 일정이 없어요</div>'}
      </section>`)}
      ${show("notices", `<section class="card list"><h2>최근 공지 <a class="more" href="#notices">전체 ›</a></h2>
        ${notices.map((n) => noticeRow(n)).join("") || '<div class="empty">공지가 없어요</div>'}
        <p class="note">자료 기준 ${esc((data.notices?.updated || "").replace("T", " ").slice(0, 16))} · 30분마다 갱신</p>
      </section>`)}
      ${installCard()}`;
  },
  after() {
    $("#regics") && ($("#regics").onclick = () => courseRegAlarm(courseRegEvent()));
    $("#bnow") && ($("#bnow").onclick = () => { exportBackup(); render(); });
    $("#blater") && ($("#blater").onclick = () => { store.set("backupSnooze", Date.now() + 7 * DAY_MS); render(); });
  },
};

// 수강신청 알리미(앱 CourseReg): 학사일정 제목에 이 말이 든 것 중 끝나지 않은 가장 이른 일정
const REG_WORDS = ["수강신청", "수강변경", "수강취소", "현금등록"];
const courseRegShort = (e) => REG_WORDS.find((w) => e.title.replace(/\s/g, "").includes(w)) || "수강신청";
function courseRegEvent() {
  const tk = todayKey();
  return (data.schedule?.events || []).filter((e) => REG_WORDS.some((w) => e.title.replace(/\s/g, "").includes(w)) && tk <= (e.end || e.start))[0];
}

function upcomingEvents() {
  const tk = todayKey();
  return (data.schedule?.events || []).filter((e) => (e.end || e.start) >= tk);
}
function eventRow(e) {
  const tk = todayKey();
  const left = daysBetween(tk, e.start);
  const badge = (e.end || e.start) < tk ? '<span class="badge">끝남</span>' : e.start <= tk ? '<span class="badge green">진행중</span>' : `<span class="badge">D-${left}</span>`;
  const range = e.end && e.end !== e.start ? `${md(e.start)} ~ ${md(e.end)}` : md(e.start);
  return `<div class="row">${badge}<div class="grow"><div class="t">${esc(e.title)}</div><div class="sub">${range}</div></div></div>`;
}
// 지금(수업 중이면 그 수업이 끝난 뒤)부터 다음 수업까지 빈 시간(분). 1시간 미만이거나 아직 첫 수업 전이면 null — 앱 WeekPlanner.gapMinutes
function gapMinutes(classes, now, minGap = 60) {
  const real = classes.filter((c) => !c.online).sort((a, b) => a.start - b.start);
  const running = real.find((c) => c.start <= now && now < c.end);
  const from = running ? running.end : now;
  const next = real.find((c) => c.start > from);
  if (!next || (!running && !real.some((c) => c.end <= now))) return null;
  const g = next.start - from;
  return g >= minGap ? g : null;
}
const durationLabel = (m) => (m < 60 ? `${m}분` : m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`);

// 이번 주 요약(앱 WeekPlanner.weekSummary): 요일별 수업 수·이번 주 시험과제·마감 담은 공지·쉬는 날. 일요일엔 다음 주.
function weekSummary() {
  const now = new Date(), di = dayIndex(now);
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (di === 6 ? 1 : -di));
  const keys = range(7).map((i) => keyOf(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
  const inWeek = new Set(keys), hol = data.holidays || {}, lines = [];
  const real = termClasses().filter((c) => !c.online);
  const perDay = range(7).map((i) => [i, real.filter((c) => c.day === i).length]).filter(([i, n]) => n && !hol[keys[i]]);
  if (perDay.length) lines.push(`수업 ${perDay.reduce((s, [, n]) => s + n, 0)}개 (${perDay.map(([i, n]) => `${DAYS[i]} ${n}`).join(" · ")})`);
  const mdk = (k) => `${+k.slice(4, 6)}/${+k.slice(6, 8)}`;
  const wt = allTasks().filter((t) => !t.done && inWeek.has(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  wt.slice(0, 3).forEach((t) => lines.push(`${mdk(t.date)} [${t.kind}] ${t.course} · ${t.title || t.kind}`));
  if (wt.length > 3) lines.push(`시험·과제 외 ${wt.length - 3}건`);
  const wn = Object.values(bookmarks()).map((n) => [n.title, deadlineOf(n.title, n.date || "")]).filter(([, d]) => d && inWeek.has(d)).sort((a, b) => a[1].localeCompare(b[1]));
  wn.slice(0, 3).forEach(([t, d]) => lines.push(`${mdk(d)} 마감 ${t}`));
  if (wn.length > 3) lines.push(`마감 공지 외 ${wn.length - 3}건`);
  const off = keys.map((k, i) => (hol[k] ? `${mdk(k)}(${DAYS[i]}) ${hol[k]}` : null)).filter(Boolean);
  if (off.length) lines.push(`쉬는 날: ${off.join(", ")}`);
  return lines.length ? { title: `${di === 6 ? "다음 주" : "이번 주"} 요약 (${mdk(keys[0])}~${mdk(keys[6])})`, lines } : null;
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

// ---------- 기록 보관 ----------
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const hasRecords = () => !!(myClasses().length || store.get("tasks", []).length || Object.keys(bookmarks()).length
  || Object.keys(store.get("credits", {})).length || store.get("profile", null));
// 아이폰 사파리는 7일 넘게 안 연 사이트의 저장공간을 지울 수 있다(홈 화면 아이콘은 예외). 둘은 저장공간도 따로다.
const storageNote = () => (isIOS && !isStandalone() && hasRecords()
  ? `<p class="note warnnote">⚠ 사파리에서 그냥 쓰면 7일 넘게 안 열었을 때 기록이 지워질 수 있어요. <b>홈 화면에 추가</b>한 아이콘으로 쓰면 안전해요.
    사파리와 홈 화면 아이콘은 기록이 따로라, 여기 넣은 기록은 <a href="#settings">백업 → 가져오기</a>로 옮겨 주세요.</p>` : "");

// 마지막 백업(없으면 처음 기록이 보인 때)에서 30일이 지나면 홈에 알린다. "일주일 뒤에"를 누르면 그만큼 미룬다.
const DAY_MS = 864e5;
function backupCard() {
  if (!hasRecords()) return "";
  const now = Date.now(), last = store.get("lastBackup", 0), base = last || store.get("backupBase", 0);
  if (!base) { store.set("backupBase", now); return ""; }
  if (now - base < 30 * DAY_MS || now < store.get("backupSnooze", 0)) return "";
  return `<section class="card"><h2>💾 백업할 때가 됐어요</h2>
    <p class="sub">${last ? `마지막 백업 후 ${Math.floor((now - last) / DAY_MS)}일 지났어요.` : "아직 백업한 적이 없어요."}
      기록은 이 브라우저에만 있어서 폰을 바꾸거나 방문 기록을 지우면 사라져요. 파일로 받아 두면 언제든 다시 가져올 수 있어요.</p>
    <div class="btns"><button class="btn" id="bnow">지금 백업</button><button class="btn ghost" id="blater">일주일 뒤에</button></div></section>`;
}

// 아이폰 사파리에서 처음 열었을 때만 "홈 화면에 추가" 안내
function installCard() {
  if (isStandalone() || store.get("hideInstall", false)) return "";
  const ios = isIOS;
  const android = /Android/.test(navigator.userAgent);
  return `<section class="card"><h2>📲 앱처럼 쓰기</h2>
    ${ios ? '<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 앱처럼 아이콘이 생겨요. 시간표 같은 기록도 홈 화면 아이콘에서 써야 오래 안전하게 남아요.</p>'
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
        <button class="chip ${sel === "bm" ? "on" : ""}" data-f="bm">★ 담은 공지</button>
        ${keywords().length ? `<button class="chip ${sel === "kw" ? "on" : ""}" data-f="kw">🔑 키워드</button>` : ""}
        ${ids.map((id) => `<button class="chip ${sel === id ? "on" : ""}" data-f="${esc(id)}">${esc(boards[id]?.name || id)}</button>`).join("")}
        <a class="chip" href="#boards">＋ 게시판</a>
        <a class="chip" href="#keywords">키워드 설정</a>
      </div>
      <section class="card list" id="nlist"></section>`;
  },
  after() {
    const draw = () => {
      const sel = store.get("noticeFilter", "all");
      const q = $("#q").value.trim().replace(/\s+/g, "").toLowerCase();
      const ids = sel === "all" || sel === "kw" ? myBoards() : sel === "bm" ? [] : [sel];
      const errs = ids.map((id) => data.notices?.boards?.[id]).filter((b) => b?.error && !(b.items || []).length);
      let list = sel === "bm" ? Object.values(bookmarks()) : noticesOf(ids);
      if (sel === "kw") list = list.filter((n) => hasKeyword(n.title));
      if (q) list = list.filter((n) => n.title.replace(/\s+/g, "").toLowerCase().includes(q));
      const multi = sel === "all" || sel === "bm" || sel === "kw";
      list.sort((a, b) => (!multi && (b.pinned - a.pinned)) || byNewest(a, b));
      $("#nlist").innerHTML = (errs.length ? `<p class="note">⚠ ${errs.map((b) => esc(b.name)).join(", ")}: 지금은 목록을 받지 못했어요</p>` : "")
        + (list.slice(0, 150).map((n) => noticeRow(n, multi)).join("")
          || `<div class="empty">${sel === "bm" ? "공지 옆 ☆를 누르면 여기 모여요" : "공지가 없어요"}</div>`);
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

routes.keywords = {
  title: "키워드", sub: true, tab: "notices",
  html() {
    return `<section class="card"><h2>관심 키워드</h2>
      <p class="sub">제목에 이 말이 들어간 공지를 노랗게 표시하고, 공지 탭의 🔑 키워드 칩에 모아요. (예: 장학, 근로, 수강신청)</p>
      <form class="chatbar" id="kf" style="position:static"><input type="text" id="ki" placeholder="키워드 입력" autocomplete="off"><button class="btn">추가</button></form>
      <div class="chips" style="flex-wrap:wrap">${keywords().map((k, i) => `<button class="chip on" data-k="${i}">${esc(k)} ✕</button>`).join("") || '<span class="sub">아직 없어요</span>'}</div></section>
      <section class="card"><h2>제외 키워드</h2>
      <p class="sub">제목에 이 말이 들어간 공지는 목록과 홈에서 숨겨요. (예: 대학원, 채용)</p>
      <form class="chatbar" id="xf" style="position:static"><input type="text" id="xi" placeholder="숨길 말 입력" autocomplete="off"><button class="btn">추가</button></form>
      <div class="chips" style="flex-wrap:wrap">${excludes().map((k, i) => `<button class="chip" data-x="${i}">${esc(k)} ✕</button>`).join("") || '<span class="sub">아직 없어요</span>'}</div></section>`;
  },
  after() {
    $("#kf").onsubmit = (e) => {
      e.preventDefault();
      const k = $("#ki").value.trim();
      if (k && !keywords().includes(k)) store.set("keywords", [...keywords(), k].slice(0, 30));
      render();
    };
    view.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { store.set("keywords", keywords().filter((_, i) => i !== +b.dataset.k)); render(); }));
    $("#xf").onsubmit = (e) => {
      e.preventDefault();
      const k = $("#xi").value.trim();
      if (k && !excludes().includes(k)) store.set("excludes", [...excludes(), k].slice(0, 30));
      render();
    };
    view.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => { store.set("excludes", excludes().filter((_, i) => i !== +b.dataset.x)); render(); }));
  },
};

// ----- 학식 -----
// 좋아하는 메뉴(앱 MenuAlerts): 그 메뉴가 나오는 날 홈에 알려 주고 식단에서 칠한다. 띄어쓰기는 무시한다.
const favDishes = () => store.get("favDishes", []);
const favHit = (dish) => favDishes().some((f) => f && dish.replace(/\s/g, "").includes(f.replace(/\s/g, "")));
const dishHtml = (d) => (favHit(d) ? `<mark>${esc(d)}</mark>` : esc(d));
function favToday() {
  const tk = todayKey();
  return (data.menu?.cafeterias || []).flatMap((c) => (c.days?.[tk] || []).flatMap((m) => m.dishes.filter(favHit).map((d) => `${c.name} · ${d}`)));
}
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
          ${meals.length ? meals.map((x) => `<div class="meal"><b>${esc(x.name)}</b><p>${x.dishes.map(dishHtml).join(" · ")}</p></div>`).join("") : '<div class="sub">식단 없음</div>'}
          ${c.hours ? `<p class="note">${esc(c.hours)}</p>` : ""}</section>`;
      }).join("")}
      <section class="card"><h2>좋아하는 메뉴</h2>
        <p class="sub">적어 두면 그 메뉴가 나오는 날 홈의 오늘 카드에 알려 주고, 식단에서 노랗게 칠해요. (예: 돈까스, 떡볶이)</p>
        <form class="chatbar" id="ff" style="position:static"><input type="text" id="fi" placeholder="메뉴 이름" autocomplete="off"><button class="btn">추가</button></form>
        <div class="chips" style="flex-wrap:wrap">${favDishes().map((k, i) => `<button class="chip on" data-fav="${i}">${esc(k)} ✕</button>`).join("") || '<span class="sub">아직 없어요</span>'}</div></section>`;
  },
  after() {
    $("#ff") && ($("#ff").onsubmit = (e) => {
      e.preventDefault();
      const k = $("#fi").value.trim();
      if (k && !favDishes().includes(k)) store.set("favDishes", [...favDishes(), k].slice(0, 30));
      render();
    });
    view.querySelectorAll("[data-fav]").forEach((b) => (b.onclick = () => { store.set("favDishes", favDishes().filter((_, i) => i !== +b.dataset.fav)); render(); }));
  },
};

// ----- 시간표 -----
const range = (n) => [...Array(n).keys()];
// 시간표 격자. 마법사 미리보기에서도 쓴다(clickable=false면 칸을 눌러도 아무 일 없음)
function gridHtml(list, clickable = true) {
  const grid = list.filter((c) => !c.online);
  if (!grid.length) return "";
  const maxDay = Math.max(4, ...grid.map((c) => c.day));
  const startH = Math.min(9, ...grid.map((c) => Math.floor(c.start / 60)));
  const endH = Math.max(18, ...grid.map((c) => Math.ceil(c.end / 60)));
  const H = 48, ti = clickable && viewTerm === termKey() ? dayIndex() : -1, m = nowMinute();
  const nowTop = m >= startH * 60 && m < endH * 60 ? ((m - startH * 60) / 60) * H : null;
  const cols = range(maxDay + 1).map((d) => `<div class="col ${d === ti ? "today" : ""}" style="grid-row:2;height:${(endH - startH) * H}px">
    ${d === ti && nowTop != null ? `<div class="now" style="top:${nowTop}px"></div>` : ""}
    ${grid.filter((c) => c.day === d).map((c) => `<div class="blk" ${clickable ? `data-id="${esc(c.id)}"` : ""} style="top:${((c.start - startH * 60) / 60) * H}px;height:${((c.end - c.start) / 60) * H - 2}px;background:${PALETTE[(c.color || 0) % PALETTE.length]}55">
      <b>${esc(c.name)}</b><small>${esc(c.room || "")}</small></div>`).join("")}</div>`).join("");
  return `<div class="tt" style="--days:${maxDay + 1}">
    <div class="hd"></div>${range(maxDay + 1).map((d) => `<div class="hd ${d === ti ? "today" : ""}">${DAYS[d]}</div>`).join("")}
    <div class="hours" style="grid-row:2">${range(endH - startH).map((h) => `<div>${startH + h}</div>`).join("")}</div>${cols}</div>`;
}

// 수강신청 목록(앱 SugangList): "학수번호-분반 과목명" — 이루미 수강신청 화면에 옮겨 적기 좋게
async function copySugangList(term) {
  const lines = [...new Set(termClasses(term).map((c) => {
    const p = (c.courseKey || "").split("|");
    return p.length === 4 && /^\d+$/.test(p[0]) ? `${p[2]}-${p[3]} ${c.name}` : null;
  }).filter(Boolean))].sort();
  if (!lines.length) return toast("학수번호가 있는 과목이 없어요");
  try { await navigator.clipboard.writeText(lines.join("\n")); toast(`${lines.length}과목을 복사했어요 (학수번호-분반)`); }
  catch { prompt("아래를 길게 눌러 복사하세요", lines.join(" / ")); }
}

// 시간표 그림(앱 TimetableExport와 같은 배치): 학기 제목 + 표 + 비고 칸. 공유 창(사진 저장)이 되면 그쪽, 안 되면 내려받기.
async function saveTimetableImage(term) {
  const list = termClasses(term), grid = list.filter((c) => !c.online), online = list.filter((c) => c.online);
  if (!list.length) return toast("시간표가 비어 있어요");
  const days = [0, 1, 2, 3, 4, ...[5, 6].filter((d) => grid.some((c) => c.day === d))];
  const from = Math.min(9, ...grid.map((c) => Math.floor(c.start / 60))), to = Math.max(17, ...grid.map((c) => Math.ceil(c.end / 60)));
  const W = 1080, P = 36, head = 120, rowH = 130, hdr = 60, timeW = 62, remarkLine = 44;
  const gridH = hdr + (to - from) * rowH + (online.length ? 40 + online.length * remarkLine : 0);
  const H = head + gridH + 56, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), font = getComputedStyle(document.body).fontFamily;
  const F = (px, bold) => `${bold ? "700" : "500"} ${px}px ${font}`;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#222"; g.font = F(52, true); g.fillText(termLabel(term), P, 82);
  const x0 = P, y0 = head, w = W - P * 2, colW = (w - timeW) / days.length, line = "rgba(34,34,34,.24)";
  g.fillStyle = "#1E4FA3"; g.font = F(28, true); g.textAlign = "center";
  days.forEach((d, i) => g.fillText(DAYS[d], x0 + timeW + colW * i + colW / 2, y0 + hdr * 0.68));
  g.strokeStyle = line; g.lineWidth = 2; g.font = F(24); g.textAlign = "right";
  const gridBottom = y0 + hdr + (to - from) * rowH;
  for (let h = from; h <= to; h++) {
    const y = y0 + hdr + (h - from) * rowH;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke();
    if (h < to) g.fillText(String(h > 12 ? h - 12 : h), x0 + timeW - 8, y + 28);
  }
  for (let i = 0; i <= days.length; i++) { const x = x0 + timeW + colW * i; g.beginPath(); g.moveTo(x, y0 + hdr * 0.85); g.lineTo(x, gridBottom); g.stroke(); }
  g.textAlign = "left";
  const fit = (t, max) => { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
  grid.forEach((c) => {
    const col = days.indexOf(c.day); if (col < 0) return;
    const left = x0 + timeW + colW * col + 2, top = y0 + hdr + ((c.start - from * 60) / 60) * rowH + 2, bottom = y0 + hdr + ((c.end - from * 60) / 60) * rowH - 2;
    const hex = PALETTE[(c.color || 0) % PALETTE.length], mix = (k) => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.42 + 255 * 0.58);
    g.fillStyle = `rgb(${mix(1)},${mix(3)},${mix(5)})`; g.fillRect(left, top, colW - 4, bottom - top);
    const room = colW - 20; let y = top + 34;
    g.fillStyle = "#222"; g.font = F(27, true); if (y <= bottom) g.fillText(fit(c.name, room), left + 8, y);
    g.fillStyle = "#4a4a4a"; g.font = F(22); y += 30;
    const tl = [`${hm(c.start)} ~ ${hm(c.end)}`, `${hm(c.start)}~${hm(c.end)}`, hm(c.start)].find((t) => g.measureText(t).width <= room) || hm(c.start);
    if (y <= bottom) g.fillText(tl, left + 8, y);
    y += 28; if (y <= bottom && c.room) g.fillText(fit(c.room, room), left + 8, y);
  });
  if (online.length) {
    g.fillStyle = "#1E4FA3"; g.font = F(22); g.textAlign = "center"; g.fillText("비고", x0 + timeW / 2, gridBottom + remarkLine);
    g.textAlign = "left"; g.fillStyle = "#222";
    online.forEach((c, i) => g.fillText(fit(c.name + (c.note ? ` (${c.note})` : ""), w - timeW - 20), x0 + timeW + 12, gridBottom + remarkLine * (i + 1)));
  }
  g.fillStyle = "#969696"; g.font = F(26); g.textAlign = "right"; g.fillText("부경대 공지알리미", W - P, H - 20);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const file = new File([blob], `시간표_${term}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: termLabel(term) + " 시간표" }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("시간표 그림을 내려받았어요");
}

// 같은 요일에 시간이 겹치는 서로 다른 과목 쌍(앱 TimetableConflicts)
function clashes(list) {
  const real = list.filter((c) => !c.online), out = [], course = (c) => c.courseKey || c.name;
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) {
    const a = real[i], b = real[j];
    if (a.day === b.day && course(a) !== course(b) && a.start < b.end && b.start < a.end) out.push(a.start <= b.start ? [a, b] : [b, a]);
  }
  return out.sort((x, y) => x[0].day - y[0].day || x[0].start - y[0].start);
}

routes.timetable = {
  title: "시간표",
  html() {
    const list = termClasses(viewTerm), online = list.filter((c) => c.online), cl = clashes(list);
    const tasks = termTasks(viewTerm).filter((t) => !t.done);
    return `${storageNote()}<div class="termnav"><button class="chip" id="tprev" aria-label="이전 학기">‹</button><b>${termLabel(viewTerm)}</b>
        <button class="chip" id="tnext" aria-label="다음 학기">›</button>${viewTerm !== termKey() ? '<button class="chip" id="tnow">이번 학기로</button>' : ""}</div>
      ${cl.length ? `<section class="card"><h2>⚠ 시간이 겹쳐요</h2>${cl.map(([a, b]) => `<div class="sub">${DAYS[a.day]} ${hm(Math.max(a.start, b.start))} ${esc(a.name)} ↔ ${esc(b.name)}</div>`).join("")}</section>` : ""}
      ${gridHtml(list) || '<section class="card"><div class="empty">아직 수업이 없어요. 과목을 검색해서 담거나 직접 추가해 보세요.</div></section>'}
      ${online.length ? `<section class="card" style="margin-top:14px"><h2>시간 없는 수업 (원격·사전제작 등)</h2>${online.map((c) => `<div class="row" data-id="${esc(c.id)}"><div class="grow">${esc(c.name)}${c.note ? `<div class="sub">${esc(c.note)}</div>` : ""}</div></div>`).join("")}</section>` : ""}
      <section class="card" style="margin-top:14px"><h2>시험·과제 <a class="more" href="#tasks">전체 ›</a></h2>
        ${tasks.slice(0, 5).map(taskRow).join("") || '<div class="empty">적어 둔 시험·과제가 없어요</div>'}</section>
      <div class="btns">
        <a class="btn" href="#search">🔍 과목 검색해서 담기</a>
        <a class="btn ghost" href="#wizard">🪄 시간표 마법사</a>
        <button class="btn ghost" id="add">＋ 직접 추가</button>
        <a class="btn ghost" href="#credits">🎓 학점·졸업 요건</a>
        <button class="btn ghost" id="ttimg">🖼️ 시간표 그림 저장·공유</button>
        <button class="btn ghost" id="sugang">📋 수강신청 목록 복사</button>
        <label class="btn ghost">안드로이드 백업 가져오기<input type="file" id="imp" accept=".json,application/json" hidden></label>
      </div>
      <p class="note">시간표는 이 휴대폰 브라우저에만 저장돼요. 칸을 누르면 고치기·결석·길찾기를 할 수 있어요.</p>`;
  },
  after() {
    $("#ttimg").onclick = () => saveTimetableImage(viewTerm);
    $("#sugang").onclick = () => copySugangList(viewTerm);
    $("#tprev").onclick = () => { viewTerm = termShift(viewTerm, -1); render(); };
    $("#tnext").onclick = () => { viewTerm = termShift(viewTerm, 1); render(); };
    $("#tnow") && ($("#tnow").onclick = () => { viewTerm = termKey(); render(); });
    $("#add").onclick = () => classDialog();
    view.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => classDialog(myClasses().find((c) => c.id === el.dataset.id))));
    bindTaskRows();
    $("#imp").onchange = async (e) => {
      try { toast(importAndroidBackup(await e.target.files[0].text())); render(); }
      catch (err) { console.warn(err); toast("가져오지 못했어요: 앱의 설정 백업 파일인지 확인해 주세요"); }
    };
  },
};

// 결석 기록. 학칙상 2/3 이상 출석해야 학점 — 15주 × 주당 수업 칸 수로 어림한다(앱 Attendance)
const absKey = (c) => `${c.term}|${c.courseKey || c.name}`;
function absenceHtml(c) {
  const n = store.get("attendance", {})[absKey(c)] || 0;
  const weekly = Math.max(1, termClasses(c.term).filter((x) => !x.online && (x.courseKey || x.name) === (c.courseKey || c.name)).length);
  const limit = Math.floor((weekly * 15) / 3), left = limit - n;
  const msg = left < 0 ? "1/3을 넘었어요 — 학점을 받을 수 없어요" : left <= 1 ? `${left}회 더 빠지면 위험해요` : `${left}회까지 괜찮아요`;
  return `<label>결석</label><div class="btns" style="align-items:center"><button class="btn ghost" data-abs="-1">−</button><b>${n}회</b>
    <button class="btn ghost" data-abs="1">＋</button><span class="sub" ${left <= 1 ? 'style="color:var(--red)"' : ""}>${msg}</span></div>
    <p class="note">15주 × 주 ${weekly}회 = ${weekly * 15}회로 어림해 ${limit}회까지 봐요. 지각·공결 처리는 과목마다 다르니 강의계획서를 확인하세요.</p>`;
}

function classDialog(c) {
  const d = document.createElement("div");
  d.className = "dialog";
  const timeFields = c?.online ? "" : `<label for="cd">요일</label><select id="cd">${DAYS.map((x, i) => `<option value="${i}" ${(c ? c.day : 0) === i ? "selected" : ""}>${x}요일</option>`).join("")}</select>
    <div class="grid2"><div><label for="cs">시작</label><input type="time" id="cs" value="${hm(c?.start ?? 540)}"></div>
    <div><label for="ce">끝</label><input type="time" id="ce" value="${hm(c?.end ?? 615)}"></div></div>
    <label for="cr">강의실</label><input type="text" id="cr" value="${esc(c?.room || "")}" placeholder="예: C25-224">`;
  d.innerHTML = `<div><h3>${c ? "수업 고치기" : "수업 추가"}</h3>
    <label for="cn">과목 이름</label><input type="text" id="cn" value="${esc(c?.name || "")}">
    ${c?.note ? `<p class="sub">${esc(c.note)}</p>` : ""}${timeFields}
    ${c?.room ? `<div class="btns" style="margin-bottom:10px">${roomLinks(c.room)}</div>` : ""}
    ${c ? `<div id="abs">${absenceHtml(c)}</div><p><a href="#tasks/${encodeURIComponent(c.name)}" id="ctask">＋ 이 과목 시험·과제 적기</a></p>` : ""}
    <div class="btns"><button class="btn" id="ok">저장</button>${c ? `<button class="btn danger" id="del">${c.courseKey ? "과목 빼기" : "삭제"}</button>` : ""}<button class="btn ghost" id="no">취소</button></div></div>`;
  document.body.append(d);
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.id === "ctask") return d.remove();
    const b = e.target.closest("[data-abs]");
    if (!b) return;
    const all = store.get("attendance", {});
    all[absKey(c)] = Math.max(0, (all[absKey(c)] || 0) + +b.dataset.abs);
    store.set("attendance", all);
    $("#abs", d).innerHTML = absenceHtml(c);
  });
  $("#no", d).onclick = () => d.remove();
  // 검색해서 담은 과목은 요일마다 칸이 따로라, 지울 땐 같은 과목 칸을 한꺼번에 뺀다
  if (c) $("#del", d).onclick = () => { saveClasses(myClasses().filter((x) => x.id !== c.id && !(c.courseKey && x.courseKey === c.courseKey))); d.remove(); render(); };
  $("#ok", d).onclick = () => {
    const name = $("#cn", d).value.trim();
    if (c?.online) {
      if (!name) return toast("이름을 적어 주세요");
      saveClasses(myClasses().map((x) => (x.id === c.id ? { ...x, name } : x))); d.remove(); return render();
    }
    const start = toMin($("#cs", d).value), end = toMin($("#ce", d).value);
    if (!name || !(end > start)) return toast("이름과 시간을 확인해 주세요");
    const list = myClasses().filter((x) => x.id !== c?.id);
    const color = c?.color ?? freeColor(list);
    list.push({ ...c, id: c?.id || String(Date.now()), name, day: +$("#cd", d).value, start, end, room: $("#cr", d).value.trim(), color, term: c?.term || viewTerm, online: false });
    saveClasses(list); d.remove(); render();
  };
}
function freeColor(list) {
  const used = new Set(list.map((x) => (x.color || 0) % PALETTE.length));
  return [...PALETTE.keys()].find((i) => !used.has(i)) ?? list.length;
}

// 안드로이드 앱의 설정 백업(JSON)을 가져온다. 항목 구분 0x1E, 칸 구분 0x1F (앱 *Prefs.raw와 같은 형식)
function importAndroidBackup(text) {
  const j = JSON.parse(text), done = [];
  const rows = (raw, n) => (typeof raw === "string" && raw ? raw.split("\u001e").map((l) => l.split("\u001f")).filter((f) => f.length >= n) : []);
  if (typeof j.timetableEntries === "string") {
    const items = rows(j.timetableEntries, 7).map((f) => ({
      id: f[0], name: f[1], day: DAY_KEYS.indexOf(f[2]), start: +f[3], end: +f[4], room: f[5], color: +f[6] || 0,
      courseKey: f[7] || "", online: f[8] === "1", term: f[9] || termKey(),
    })).filter((c) => c.day >= 0 && c.name);
    const ids = new Set(items.map((c) => c.id));
    saveClasses([...myClasses().filter((c) => !ids.has(c.id)), ...items]);
    done.push(`수업 ${items.length}칸`);
  }
  if (Array.isArray(j.selectedBoardIds)) {
    const known = data.notices?.boards || {};
    const ids = j.selectedBoardIds.filter((id) => known[id]);
    if (ids.length) { store.set("boards", ids); done.push(`게시판 ${ids.length}곳`); }
  }
  if (Array.isArray(j.includeKeywords) && j.includeKeywords.length) { store.set("keywords", j.includeKeywords.slice(0, 30)); done.push("키워드"); }
  const tasks = rows(j.courseTasks, 7).map((f) => ({ id: f[0], term: f[1], course: f[2], kind: f[3], title: f[4], date: f[5], done: f[6] === "1" }));
  if (tasks.length) { store.set("tasks", tasks); done.push(`시험·과제 ${tasks.length}개`); }
  if (typeof j.attendance === "string" && j.attendance) {
    const att = {};
    j.attendance.split("\n").forEach((l) => { const i = l.lastIndexOf("="); if (i > 0 && !isNaN(+l.slice(i + 1))) att[l.slice(0, i)] = +l.slice(i + 1); });
    store.set("attendance", att); done.push("결석 기록");
  }
  if (typeof j.credits === "string" && j.credits) { importCredits(j.credits); done.push("학점·프로필"); }
  if (!done.length) throw new Error("빈 백업");
  return `가져왔어요: ${done.join(", ")}`;
}

// ----- 더보기 -----
routes.more = {
  title: "더보기",
  html() {
    const item = (href, icon, name, sub) => `<a class="row" href="${href}" style="color:inherit"><span>${icon}</span><div class="grow"><div>${name}</div><div class="sub">${sub}</div></div><span class="sub">›</span></a>`;
    return `<section class="card"><h2>학교생활</h2>
      ${window.FIREBASE_CONFIG ? item("#chat", "🤖", "AI 챗봇", "학교생활·앱 사용법 물어보기") : ""}
      ${item("#faq", "❓", "자주 묻는 질문", "휴학·수강신청·장학금 등")}
      ${item("#schedule", "📅", "학사일정", "목록·달력, 캘린더 앱에 넣기")}
      ${item("#shuttle", "🚌", "셔틀버스", "대연 ↔ 용당 시간표")}
      ${item("#rooms", "🚪", "빈 강의실", "지금 비어 있는 강의실 찾기")}
      ${item("#library", "📚", "도서관", "열람실 남은 좌석·자료 검색")}
      ${item("#map", "🗺️", "캠퍼스 지도", "건물 찾기·길찾기")}
      </section>
      <section class="card"><h2>수업·학점</h2>
      ${item("#search", "🔍", "과목 검색", "이번 학기 개설 과목 찾아 시간표에 담기")}
      ${item("#wizard", "🪄", "시간표 마법사", "안 겹치는 시간표 조합 전부 찾기")}
      ${item("#tasks", "📌", "시험·과제", "과목별 시험·과제 날짜 적어두기")}
      ${item("#credits", "🎓", "학점·졸업 요건", "이수 학점, 평점, 목표 평점, 졸업까지 남은 학점")}
      ${item("#curriculum", "📖", "교육과정", "학년도별 안내서 바로 펴기 · 입학연도별 졸업소요학점")}
      ${item("#docs", "📄", "자료실 문서", "교육과정·대학생활 가이드·강의편람 PDF, 문서 안 단어 찾기")}
      ${item("#contacts", "☎️", "학과 연락처", "학과 사무실 전화번호")}
      ${item("#links", "🔗", "학교 사이트 바로가기", "이루미·강의계획서·자료실 등")}
      </section>
      <section class="card"><h2>설정</h2>
      ${item("#boards", "📌", "관심 게시판", "공지를 모아 볼 게시판 고르기")}
      ${item("#keywords", "🔑", "관심 키워드", "제목에 이 말이 들어간 공지 강조")}
      ${window.FIREBASE_CONFIG?.vapidKey ? item("#push", "🔔", "새 공지 알림", "고른 게시판에 새 글이 올라오면 알림") : ""}
      ${item("#settings", "⚙️", "화면·백업", "테마, 글자 크기, 홈 카드, 백업, 데이터 지우기")}
      ${item("#news", "📰", "변경 내역", "앱에 새로 생긴 기능")}
      ${item("#review", "✍️", "리뷰 남기기", "불편한 점·바라는 기능 보내기")}
      </section>
      <section class="card"><h2>앱 정보</h2>
        <p class="sub">학생이 만든 비공식 앱이에요. 정확한 내용은 꼭 학교 공지 원문으로 확인해 주세요.</p>
        <p class="sub">로그인이 없고 개발자 서버도 없어요. 시간표·학점·담은 공지 같은 개인 기록은 이 브라우저에만 저장돼서 개발자도 볼 수 없어요.${window.FIREBASE_CONFIG ? " AI 챗봇 질문은 답을 만들기 위해 Google(Gemini)로, 새 공지 알림을 켜면 알림 번호와 고른 게시판만 Firebase로 가요." : ""}</p>
        <p class="sub">안드로이드는 <a href="${ANDROID_APK}">앱(APK)</a>으로 위젯·수업 알림까지 쓸 수 있어요.</p>
      </section>`;
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
      ${window.FIREBASE_CONFIG ? '<a class="btn ghost" href="#chat">🤖 찾는 답이 없으면 AI에게 묻기</a>' : ""}`;
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
      catch (err) { console.warn(err); chatLog[chatLog.length - 1].text = aiErrorText(err); }
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
// Firebase 앱 하나를 만들고, 키가 있으면 App Check(reCAPTCHA Enterprise)를 붙인다.
// 2026-11-02부터 Firebase AI Logic은 App Check 토큰이 없는 요청을 막는다.
let fbApp;
async function firebaseApp() {
  if (fbApp) return fbApp;
  const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_JS}/firebase-app.js`);
  fbApp = getApps()[0] || initializeApp(window.FIREBASE_CONFIG);
  const key = window.FIREBASE_CONFIG.recaptchaEnterpriseKey;
  if (key) {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_JS}/firebase-app-check.js`);
    initializeAppCheck(fbApp, { provider: new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
  }
  return fbApp;
}
// 무료 한도·붐빔은 모델마다 따로라, 걸리면 faq.json chatModels의 다음 모델로 넘어간다(앱 ChatBot.withFallback)
const isQuota = (e) => /quota|429|RESOURCE_EXHAUSTED/i.test(String(e));
const isBusy = (e) => isQuota(e) || /high demand|overloaded|503|UNAVAILABLE/i.test(String(e));
function aiErrorText(e) {
  const s = String(e);
  if (isQuota(e)) {
    const m = s.match(/retry in (?:(\d+)h)?(?:(\d+)m)?/);
    const h = +(m?.[1] || 0), min = +(m?.[2] || 0);
    if (h >= 1) return `오늘 앱 전체가 함께 쓰는 AI 무료 사용량을 다 썼어요. 약 ${h}시간 뒤에 다시 쓸 수 있어요. 그동안 자주 묻는 질문을 이용해 주세요.`;
    if (min >= 1) return `지금 AI 질문이 몰려 있어요. 약 ${min}분 뒤에 다시 물어봐 주세요.`;
    return "지금은 AI 질문이 몰려서 답할 수 없어요. 잠시 뒤에 다시 물어봐 주세요.";
  }
  if (isBusy(e)) return "AI 서버가 붐벼요. 잠시 뒤에 다시 물어봐 주세요.";
  return "답을 받지 못했어요. 인터넷 연결을 확인하고 다시 물어봐 주세요.";
}
const aiModels = () => (data.faq?.chatModels?.length ? data.faq.chatModels : [data.faq?.chatModel || "gemini-3.5-flash-lite"]);
async function aiModel(name, system) {
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_JS}/firebase-ai.js`);
  return getGenerativeModel(getAI(await firebaseApp(), { backend: new GoogleAIBackend() }), { model: name, systemInstruction: system });
}
async function withFallback(call) {
  let last;
  for (const name of aiModels()) {
    try { return await call(name); } catch (e) { last = e; if (!isBusy(e)) throw e; console.warn(name, "한도·붐빔, 다음 모델로", e); }
  }
  load("faq", true).catch(() => {});
  throw last || new Error("모델 없음");
}
async function askAI(history, q) {
  const system = systemPrompt();
  return withFallback(async (name) => {
    const chat = (await aiModel(name, system)).startChat({ history: history.map((t) => ({ role: t.me ? "user" : "model", parts: [{ text: t.text }] })) });
    const r = await chat.sendMessage(q);
    return r.response.text().trim() || "답을 만들지 못했어요. 질문을 조금 바꿔서 다시 물어봐 주세요.";
  });
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
    const { getMessaging, getToken, deleteToken } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-messaging.js`);
    const { getFirestore, doc, setDoc, deleteDoc } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);
    const app = await firebaseApp();
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
// 다른 화면 파일(study.js·campus.js)이 routes를 다 채운 뒤에 시작한다
addEventListener("DOMContentLoaded", () => {
  applyLook();
  // 브라우저에 "저장공간을 함부로 지우지 말라"고 요청(홈 화면 앱·크롬은 보통 허용, 거절돼도 그대로 쓴다)
  navigator.storage?.persist?.().catch(() => {});
  view.addEventListener("click", (e) => {
    const bm = e.target.closest("[data-bm]");
    if (bm) { e.preventDefault(); return toggleBookmark(bm.dataset.bm, bm); }
    const rd = e.target.closest("[data-read]");
    if (rd) { markRead(rd.dataset.read); rd.parentElement.classList.add("read"); }
  });
  $("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#more"));
  $("#refresh").onclick = async () => { await loadAll(true); toast("새로 불러왔어요"); render(); };
  addEventListener("hashchange", render);
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
