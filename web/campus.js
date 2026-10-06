// 캠퍼스·설정 화면: 길찾기·캠퍼스 지도, 도서관, 학사일정(달력·캘린더 내보내기), 학교 사이트, 화면·백업 설정, 변경 내역, 리뷰.
"use strict";

// ================= 길찾기 (앱 RoomFinder·MapApps) =================
// "C25-224" → 건물 C25. 건물 좌표는 Actions가 학교 캠퍼스맵 API에서 받아 둔 buildings.json
const enc = encodeURIComponent;
const roomLinks = (room) => `<button class="btn ghost small" data-route="${esc(room)}">🧭 ${esc(buildingOf(room))} 길찾기</button>`;
function mapUrls(b, directions) {
  return [
    ["카카오맵", `https://map.kakao.com/link/${directions ? "to" : "map"}/${enc(b.name)},${b.lat},${b.lon}`],
    ["네이버 지도", directions ? `https://m.map.naver.com/route.nhn?menu=route&ename=${enc(b.name)}&ex=${b.lon}&ey=${b.lat}&pathType=3`
      : `https://m.map.naver.com/map.naver?lat=${b.lat}&lng=${b.lon}&dlevel=12`],
    ["구글 지도", directions ? `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking`
      : `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lon}`],
  ];
}
function buildingSheet(b) {
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div><h3>${esc(b.no)} ${esc(b.name)}</h3><p class="sub">${esc(b.campus)}</p>
    <label>길찾기 (걸어서)</label><div class="btns">${mapUrls(b, true).map(([l, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join("")}</div>
    <label style="display:block;margin-top:10px">지도에서 보기</label><div class="btns">${mapUrls(b, false).map(([l, u]) => `<a class="btn ghost" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join("")}</div>
    ${b.code ? `<p><a href="https://www.pknu.ac.kr/imageView.do?target=campus&cd=${enc(b.code)}" target="_blank" rel="noopener">건물 사진 ›</a></p>` : ""}
    <div class="btns" style="margin-top:12px"><button class="btn ghost" id="no">닫기</button></div></div>`;
  document.body.append(d);
  d.addEventListener("click", (e) => { if (e.target === d || e.target.id === "no") d.remove(); });
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-route]");
  if (!btn) return;
  const code = (btn.dataset.route.match(/^([A-Z]\d{1,2})-/) || [])[1];
  let list = [];
  try { list = (await load("buildings")).items || []; } catch {}
  const b = list.find((x) => x.no === code);
  if (b) buildingSheet(b);
  else toast(`${code || btn.dataset.route} 건물 위치를 찾지 못했어요`);
});

routes.map = {
  title: "캠퍼스 지도", sub: true, tab: "more",
  html() { return '<div id="mv"><div class="empty">불러오는 중…</div></div>'; },
  async after() {
    let list = [];
    try { list = (await load("buildings")).items || []; } catch {}
    if (current !== "map") return;
    if (!list.length) {
      $("#mv").innerHTML = '<section class="card"><div class="empty">건물 목록이 아직 없어요.</div><a class="btn ghost" href="https://www.pknu.ac.kr/main/133" target="_blank" rel="noopener">학교 캠퍼스맵 열기</a></section>';
      return;
    }
    const key = (no) => (no.match(/^\D*/)[0] || "~") + String(parseInt(no.replace(/^\D*/, "")) || 0).padStart(4, "0");
    $("#mv").innerHTML = `<input type="search" id="mq" placeholder="건물 이름·번호 (예: 미래관, C25)"><div id="ml"></div>
      <p class="note"><a href="https://www.pknu.ac.kr/main/133" target="_blank" rel="noopener">학교 캠퍼스맵(층별 호실) ›</a></p>`;
    const draw = () => {
      const q = $("#mq").value.trim().toUpperCase();
      const hit = list.filter((b) => !q || b.name.toUpperCase().includes(q) || b.no.toUpperCase().includes(q)).sort((a, b) => (key(a.no) < key(b.no) ? -1 : 1));
      const camps = ["대연캠퍼스", "용당캠퍼스"].filter((c) => hit.some((b) => b.campus === c));
      $("#ml").innerHTML = camps.map((c) => `<section class="card"><h2>${esc(c)}</h2>${hit.filter((b) => b.campus === c).map((b) =>
        `<div class="row" data-b="${list.indexOf(b)}" style="cursor:pointer"><span class="badge">${esc(b.no)}</span><div class="grow">${esc(b.name)}</div><span class="sub">›</span></div>`).join("")}</section>`).join("")
        || '<div class="empty">없어요</div>';
    };
    $("#mq").addEventListener("input", draw);
    $("#ml").addEventListener("click", (e) => { const r = e.target.closest("[data-b]"); if (r) buildingSheet(list[+r.dataset.b]); });
    draw();
  },
};

// ================= 도서관 =================
routes.library = {
  title: "도서관", sub: true, tab: "more",
  html() {
    return `<section class="card"><h2>자료 검색</h2>
        <form id="lf" class="chatbar" style="position:static;padding:0"><input type="search" id="lq" placeholder="책 제목·저자·키워드"><button class="btn">검색</button></form>
        <div class="btns" style="margin-top:8px"><button class="btn ghost small" id="leb">전자책에서</button><button class="btn ghost small" id="lar">학술논문에서</button></div>
        <p class="note">도서관 홈페이지 검색 결과로 열려요. 학술논문은 교외에서 학교 로그인이 필요해요.</p></section>
      <div id="lv"><div class="empty">좌석 불러오는 중…</div></div>`;
  },
  async after() {
    const q = () => $("#lq").value.trim();
    const search = (lmt) => {
      if (!q()) return toast("검색어를 적어 주세요");
      const p = new URLSearchParams({ mod: "list", verb: "detail", target: "total", "st[]": "KWRD", multi_query: "Y", type0: "TOTAL", query0: q(), b0: "and",
        "lmt[]": lmt, "inc[]": "TOTAL", lang: "TOTAL", range: "000000000021", record_per_page: "20", sortkey: "publisher_year", sortorder: "desc" });
      open(`https://libweb.pknu.ac.kr/resource/${lmt === "eb" ? "e-book" : "hsearch"}?${p}`, "_blank", "noopener");
    };
    $("#lf").onsubmit = (e) => { e.preventDefault(); search("TOTAL"); };
    $("#leb").onclick = () => search("eb");
    $("#lar").onclick = () => q() ? open(`https://libweb-pknu-ac-kr.libproxy.pknu.ac.kr/resource/article?app=eds&mod=list&field_code=keyword&query=${enc(q())}`, "_blank", "noopener") : toast("검색어를 적어 주세요");
    let lib;
    try { lib = await load("library", true); } catch {}
    if (current !== "library") return;
    const libs = lib?.items || [];
    $("#lv").innerHTML = libs.map((l) => `<section class="card"><h2>${esc(l.name)} 열람실</h2>${l.rooms.map((r) => {
      const hours = !r.start || !r.end ? "" : r.start === r.end ? "24시간" : `${r.start}~${r.end}`;
      return `<div class="row"><div class="grow"><b>${esc(r.name)}</b> <span class="sub">${hours}${r.open ? "" : " · 운영 안 함"}</span>
        <div class="bar"><i style="width:${r.total ? (r.used / r.total) * 100 : 0}%"></i></div></div>
        <div style="text-align:right"><b style="color:${r.remain > 0 ? "var(--green)" : "var(--red)"}">${r.remain}</b><span class="sub"> / ${r.total}</span></div></div>`;
    }).join("")}</section>`).join("")
      + `<p class="note">${lib?.updated ? `좌석 기준 ${esc(lib.updated.replace("T", " ").slice(0, 16))} · 30분마다 갱신. ` : "좌석 자료가 아직 없어요. "}
        실시간 좌석은 <a href="https://libweb.pknu.ac.kr/#mc-seat" target="_blank" rel="noopener">도서관 홈페이지 ›</a></p>`;
  },
};

// ================= 캘린더 내보내기 (.ics) =================
// 웹앱은 알림을 미리 맞춰 둘 수 없어서, 캘린더 앱에 알림째 넣게 한다
function downloadIcs(name, events) {
  if (!events.length) return toast("넣을 일정이 없어요");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const tx = (s) => String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const trig = (m) => `${m < 0 ? "-" : ""}PT${Math.abs(m)}M`;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//pknu-notice-web//KO", "CALSCALE:GREGORIAN"];
  events.forEach((e, i) => {
    L.push("BEGIN:VEVENT", `UID:${e.start}-${i}-${Date.now()}@pknu-notice-web`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const t = e.time.replace(":", ""), end = hm(Math.min(toMin(e.time) + 30, 1439)).replace(":", "");
      L.push(`DTSTART:${e.start}T${t}00`, `DTEND:${e.start}T${end}00`);
    } else L.push(`DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${shiftKey(e.end || e.start, 1)}`);
    L.push(`SUMMARY:${tx(e.title)}`);
    if (e.alarm != null) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${tx(e.title)}`, `TRIGGER:${trig(e.alarm)}`, "END:VALARM");
    L.push("END:VEVENT");
  });
  L.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([L.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  a.download = `${name}.ics`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// 수강신청 "내 차례" 알람: 학년별 시작 시각은 학사일정에 없어서 사용자가 맞춘다(앱 CourseRegPrefs)
function courseRegAlarm(ev) {
  if (!ev) return;
  const days = [];
  for (let k = ev.start; k <= (ev.end || ev.start); k = shiftKey(k, 1)) days.push(k);
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div><h3>${esc(courseRegShort(ev))} 내 차례</h3>
    <div class="grid2"><div><label>날짜</label><select id="rd">${days.map((k) => `<option value="${k}">${md(k)} (${DAYS[dayIndex(fromKey(k))]})</option>`).join("")}</select></div>
      <div><label>시각</label><input type="time" id="rt" value="09:00"></div></div>
    <label>알림</label><select id="rl">${[0, 5, 10, 30].map((m) => `<option value="${m}" ${m === 10 ? "selected" : ""}>${m ? m + "분 전" : "정각"}</option>`).join("")}</select>
    <div class="btns"><button class="btn" id="ok">캘린더 파일 받기</button><button class="btn ghost" id="no">취소</button></div></div>`;
  document.body.append(d);
  d.addEventListener("click", (e) => { if (e.target === d || e.target.id === "no") d.remove(); });
  $("#ok", d).onclick = () => {
    downloadIcs("수강신청", [{ title: `${courseRegShort(ev)} 내 차례`, start: $("#rd", d).value, time: $("#rt", d).value, alarm: -+$("#rl", d).value }]);
    d.remove();
  };
}

// ================= 학사일정: 목록·달력 =================
let calMonth = null;
routes.schedule = {
  title: "학사일정", sub: true, tab: "more",
  html() {
    const mode = store.get("schedView", "list"), tk = todayKey(), events = data.schedule?.events || [];
    const tabs = `<div class="chips"><button class="chip ${mode === "list" ? "on" : ""}" data-sv="list">목록</button><button class="chip ${mode === "cal" ? "on" : ""}" data-sv="cal">달력</button>
      <button class="chip" id="sics">다가오는 일정 캘린더에 넣기</button></div>`;
    if (mode === "list") {
      const groups = {};
      events.forEach((e) => (groups[e.start.slice(0, 6)] ||= []).push(e));
      return tabs + (Object.entries(groups).map(([ym, list]) => `<section class="card"><h2>${+ym.slice(0, 4)}년 ${+ym.slice(4)}월</h2>
        ${list.map((e) => ((e.end || e.start) < tk ? eventRow(e).replace('class="row"', 'class="row" style="opacity:.45"') : eventRow(e))).join("")}</section>`).join("")
        || '<div class="empty">일정이 없어요</div>');
    }
    calMonth ||= tk.slice(0, 6);
    const y = +calMonth.slice(0, 4), m = +calMonth.slice(4) - 1, first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate();
    const lead = dayIndex(first), cells = [];
    for (let i = 0; i < lead; i++) cells.push("<div></div>");
    for (let d = 1; d <= n; d++) {
      const k = keyOf(new Date(y, m, d)), evs = events.filter((e) => e.start <= k && k <= (e.end || e.start)), hol = data.holidays?.[k];
      cells.push(`<button class="day ${k === tk ? "today" : ""} ${hol || (lead + d - 1) % 7 === 6 ? "hol" : ""}" data-day="${k}">
        <span>${d}</span>${evs.slice(0, 2).map((e) => `<i>${esc(e.title)}</i>`).join("")}${evs.length > 2 ? `<i>+${evs.length - 2}</i>` : ""}</button>`);
    }
    return tabs + `<section class="card"><h2><button class="chip" id="cprev">‹</button> ${y}년 ${m + 1}월 <button class="chip" id="cnext">›</button></h2>
      <div class="cal">${DAYS.map((x) => `<b>${x}</b>`).join("")}${cells.join("")}</div></section><section class="card" id="cday"><div class="sub">날짜를 누르면 그날 일정이 보여요</div></section>`;
  },
  after() {
    view.querySelectorAll("[data-sv]").forEach((b) => (b.onclick = () => { store.set("schedView", b.dataset.sv); render(); }));
    $("#sics").onclick = () => downloadIcs("부경대 학사일정", upcomingEvents().map((e) => ({ title: e.title, start: e.start, end: e.end })));
    const mv = (n) => { const d = fromKey(calMonth + "01"); d.setMonth(d.getMonth() + n); calMonth = keyOf(d).slice(0, 6); render(); };
    $("#cprev") && ($("#cprev").onclick = () => mv(-1));
    $("#cnext") && ($("#cnext").onclick = () => mv(1));
    view.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.day, evs = (data.schedule?.events || []).filter((e) => e.start <= k && k <= (e.end || e.start));
      const tasks = allTasks().filter((t) => t.date === k), hol = data.holidays?.[k];
      $("#cday").innerHTML = `<h2>${md(k)} (${DAYS[dayIndex(fromKey(k))]})${hol ? ` <span class="badge red">${esc(hol)}</span>` : ""}</h2>`
        + (evs.map(eventRow).join("") + tasks.map(taskRow).join("") || '<div class="empty">일정이 없어요</div>');
    }));
  },
};

// ================= 학교 사이트 바로가기 =================
routes.links = {
  title: "학교 사이트", sub: true, tab: "more",
  html() {
    const L = [
      ["학사", [["이루미 (학사행정정보시스템)", "https://irumi.pknu.ac.kr/"], ["이루미 강의계획서 조회", "https://irumi.pknu.ac.kr/nxui/launch.html?screenid=Phone_screen_quick&menuId=U020913"],
        ["학사공지", "https://www.pknu.ac.kr/main/163"], ["학사일정", "https://www.pknu.ac.kr/main/31"], ["교육과정", "https://www.pknu.ac.kr/main/106"]]],
      ["자료실", [["강의편람", "https://www.pknu.ac.kr/main/28"], ["대학생활 가이드", "https://www.pknu.ac.kr/main/434"], ["비교과", "https://www.pknu.ac.kr/main/362"],
        ["대학생활 전자책", "https://www.pknu.ac.kr/ebook/col_life/kor/index.html"]]],
      ["캠퍼스", [["도서관", "https://libweb.pknu.ac.kr/"], ["캠퍼스맵", "https://www.pknu.ac.kr/main/133"], ["학식 식단", "https://www.pknu.ac.kr/main/399"]]],
    ];
    return L.map(([h, items]) => `<section class="card"><h2>${h}</h2>${items.map(([n, u]) => `<a class="row" href="${u}" target="_blank" rel="noopener" style="color:inherit"><div class="grow">${n}</div><span class="sub">↗</span></a>`).join("")}</section>`).join("")
      + '<p class="note">학과 홈페이지는 관심 게시판 목록의 게시판 주소로 들어갈 수 있어요.</p>';
  },
};

// ================= 화면·백업 설정 =================
const HOME_CARDS = [["chat", "AI 챗봇 배너"], ["reg", "수강신청 알리미"], ["menu", "오늘 학식"], ["schedule", "다가오는 학사일정"], ["notices", "최근 공지"]];
const SCALES = [[0.9, "작게"], [1, "보통"], [1.15, "크게"], [1.3, "아주 크게"]];
function applyLook() {
  const t = store.get("theme", "auto");
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  view.style.zoom = store.get("scale", 1);
}
// 개인 기록만 백업한다(알림 토큰·AI 사용 횟수 같은 이 기기 값은 뺀다)
const NOT_BACKED = ["pushOn", "pushToken", "aiUse", "hideInstall"];
routes.settings = {
  title: "화면·백업", sub: true, tab: "more",
  html() {
    const t = store.get("theme", "auto"), sc = store.get("scale", 1), hidden = new Set(store.get("homeHidden", []));
    return `<section class="card"><h2>테마</h2><div class="chips">${[["auto", "기기 설정 따라"], ["light", "밝게"], ["dark", "어둡게"]].map(([v, l]) => `<button class="chip ${t === v ? "on" : ""}" data-theme="${v}">${l}</button>`).join("")}</div></section>
      <section class="card"><h2>글자 크기</h2><div class="chips">${SCALES.map(([v, l]) => `<button class="chip ${sc === v ? "on" : ""}" data-scale="${v}">${l}</button>`).join("")}</div></section>
      <section class="card"><h2>홈 화면 카드</h2>${HOME_CARDS.map(([k, l]) => `<label class="row"><input type="checkbox" data-home="${k}" ${hidden.has(k) ? "" : "checked"}><div class="grow">${l}</div></label>`).join("")}</section>
      <section class="card"><h2>백업</h2><p class="sub">시간표·학점·담은 공지·설정을 파일로 받아 두었다가 다른 폰·브라우저에서 가져올 수 있어요. 안드로이드 앱의 설정 백업 파일도 가져올 수 있어요.</p>
        <div class="btns"><button class="btn" id="bexp">백업 파일 받기</button><label class="btn ghost">백업 가져오기<input type="file" id="bimp" accept=".json,application/json" hidden></label></div></section>
      <section class="card"><h2>데이터 모두 지우기</h2><p class="sub">이 브라우저에 저장된 시간표·학점·설정을 전부 지워요. 되돌릴 수 없어요.</p>
        <button class="btn danger" id="wipe">모두 지우기</button></section>`;
  },
  after() {
    view.querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => { store.set("theme", b.dataset.theme); applyLook(); render(); }));
    view.querySelectorAll("[data-scale]").forEach((b) => (b.onclick = () => { store.set("scale", +b.dataset.scale); applyLook(); render(); }));
    view.querySelectorAll("[data-home]").forEach((cb) => (cb.onchange = () => {
      store.set("homeHidden", [...view.querySelectorAll("[data-home]")].filter((x) => !x.checked).map((x) => x.dataset.home));
    }));
    $("#bexp").onclick = () => {
      const out = { app: "pknu-notice-web", saved: new Date().toISOString(), data: {} };
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!NOT_BACKED.includes(k)) out.data[k] = store.get(k, null); }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
      a.download = `공지알리미_백업_${todayKey()}.json`;
      document.body.append(a); a.click(); a.remove();
    };
    $("#bimp").onchange = async (e) => {
      try {
        const j = JSON.parse(await e.target.files[0].text());
        if (j.app === "pknu-notice-web") {
          Object.entries(j.data || {}).forEach(([k, v]) => { if (!NOT_BACKED.includes(k)) store.set(k, v); });
          readCache = null; toast("백업을 가져왔어요");
        } else toast(importAndroidBackup(JSON.stringify(j)));
        applyLook(); render();
      } catch (err) { console.warn(err); toast("가져오지 못했어요: 백업 파일인지 확인해 주세요"); }
    };
    $("#wipe").onclick = async () => {
      if (!confirm("이 브라우저에 저장된 시간표·학점·설정을 전부 지울까요? 되돌릴 수 없어요.")) return;
      if (store.get("pushOn", false)) await setPush(false);
      try { localStorage.clear(); } catch {}
      readCache = null; applyLook(); toast("모두 지웠어요"); location.hash = "#home";
    };
  },
};

// ================= 변경 내역 · 리뷰 =================
routes.news = {
  title: "변경 내역", sub: true, tab: "more",
  html() { return '<div id="nv"><div class="empty">불러오는 중…</div></div>'; },
  async after() {
    let log = [];
    try { log = await load("static/changelog"); } catch {}
    if (current !== "news") return;
    $("#nv").innerHTML = `<p class="note">안드로이드 앱 기준이에요. 웹앱에서 할 수 있는 기능은 같이 들어와요 (위젯·예약 알림·HelloLMS 연동은 안드로이드 전용).</p>`
      + log.slice(0, 40).map((v) => `<section class="card"><h2>${esc(v.v)} <span class="sub">${esc(v.date || "")}</span></h2>${(v.items || []).map((i) => `<p class="sub" style="margin:4px 0">• ${esc(i)}</p>`).join("")}</section>`).join("");
  },
};

// 리뷰는 구글 폼으로(앱 SettingsReview와 같은 폼). 메일 주소는 어느 쪽에도 나오지 않는다
const REVIEW_FORM = "1FAIpQLSfZUOEvlvL_N4pbtNwYheVMKKKuWBMYp25_raw2Wy7I7oVJvg";
routes.review = {
  title: "리뷰 남기기", sub: true, tab: "more",
  html() {
    const ua = navigator.userAgent, dev = /iPhone|iPad/.test(ua) ? "아이폰" : /Android/.test(ua) ? "안드로이드" : "PC";
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const info = `웹앱 · ${dev}${standalone ? " · 홈 화면" : " · 브라우저"}`;
    return `<section class="card"><h2>✍️ 리뷰·건의</h2>
      <p class="sub">불편한 점이나 바라는 기능을 구글 폼으로 보내 주세요. 로그인·메일 주소 없이 익명으로 가요. 같이 가는 정보: <b>${esc(info)}</b></p>
      <a class="btn" href="https://docs.google.com/forms/d/e/${REVIEW_FORM}/viewform?usp=pp_url&entry.1721073330=${enc(info)}" target="_blank" rel="noopener">구글 폼 열기</a></section>`;
  },
};
