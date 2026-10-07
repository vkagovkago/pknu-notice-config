// 수업·학점 화면: 과목 검색·담기, 시간표 마법사, 빈 강의실, 시험·과제, 학점·졸업 요건, 교육과정.
// 계산 규칙은 안드로이드 앱(CourseCatalog·SyllabusTime·TimetableWizard·EmptyRooms·Credits·GradRequirements)을 옮긴 것 —
// 앱에서 규칙을 고치면 여기도 같이 고친다.
"use strict";

// ================= 과목 목록 (config 저장소 courses/<학기>.json) =================
const SEASON_CODE = { 1: "U0003001", S: "U0003003", 2: "U0003002", W: "U0003004" };
const unent = (s) => (s.includes("&") ? Object.assign(document.createElement("textarea"), { innerHTML: s }).value : s);
const fmtNum = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

// 교시 → 시각. 50분 수업(60분 간격)과 75분 수업(90분 간격) 두 체계, 둘 다 1교시 09:00 (앱 PeriodGrid)
function runsOf(ps) {
  const out = [];
  ps.forEach((p, i) => (i && p === ps[i - 1] + 1 ? (out[out.length - 1][1] = p) : out.push([p, p])));
  return out;
}
function timeBlocks(text) {
  return [...String(text || "").matchAll(/([월화수목금토일])\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)/g)].map((m) => ({
    day: DAYS.indexOf(m[1]),
    periods: [...new Set(m[2].split(",").map((x) => +x.trim()).filter((p) => p >= 1 && p <= 14))].sort((a, b) => a - b),
  })).filter((b) => b.periods.length);
}
// 주당 시간 / 교시 수가 1.25 이상이면 75분 체계("화4 목4" 3시간 = 75분 두 번)
function gridOf(hours, count) {
  return hours > 0 && count > 0 && hours / count >= 1.25 ? { gap: 90, len: 75 } : { gap: 60, len: 50 };
}
function slotsOf(text, hours) {
  const blocks = timeBlocks(text), g = gridOf(hours, blocks.reduce((s, b) => s + b.periods.length, 0));
  return blocks.flatMap((b) => runsOf(b.periods).map(([a, z]) => ({ day: b.day, start: 540 + (a - 1) * g.gap, end: 540 + (z - 1) * g.gap + g.len })));
}
function describeTime(c) {
  if (c.cyber) return `${c.cyber} 인터넷 강의 (정해진 시간 없음)`;
  if (c.pre) return c.time ? `${c.time} (사전제작)` : "(사전제작)";
  const blocks = timeBlocks(c.time);
  if (!blocks.length) return c.time || "시간 미정";
  const g = gridOf(c.hours, blocks.reduce((s, b) => s + b.periods.length, 0));
  return blocks.map((b) => `${DAYS[b.day]} ${b.periods.join(",")}교시 (${runsOf(b.periods).map(([a, z]) => `${hm(540 + (a - 1) * g.gap)}~${hm(540 + (z - 1) * g.gap + g.len)}`).join(", ")})`).join(" · ");
}

function makeCourse(o) {
  const nums = o.credit.split("-").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number);
  const point = parseFloat(o.credit.split("-")[0]);
  const cyber = !o.college && !o.dept && /^[KU]/.test(o.no) ? (o.no[0] === "K" ? "KCU" : "OCU") : null;
  const c = { ...o, point: isNaN(point) ? null : point, hours: nums.length >= 3 ? nums[1] + nums[2] : 0, cyber, pre: o.method.includes("사전제작") };
  c.online = !!(cyber || c.pre);
  c.slots = cyber ? [] : slotsOf(o.time, c.hours);
  c.grades = o.grade.includes("전체") ? ["1", "2", "3", "4"] : (o.grade.match(/[1-4]/g) || ["기타"]);
  c.creditTok = c.point == null ? "?" : c.point >= 4 ? "4+" : fmtNum(c.point);
  return c;
}

const catCache = {};
async function catalog(term) {
  if (catCache[term]) return catCache[term];
  const raw = await load(`courses/${term}`);
  const f = Object.fromEntries(raw.fields.map((n, i) => [n, i]));
  const [y, t] = term.split("-");
  const s = (r, n) => unent(r[f[n]] == null ? "" : String(r[f[n]]));
  return (catCache[term] = raw.rows.map((r) => makeCourse({
    term, no: s(r, "no"), cls: s(r, "cls"), name: s(r, "name"), staff: s(r, "staff"), college: s(r, "college"), dept: s(r, "dept"),
    cat: s(r, "cat"), credit: s(r, "credit"), method: s(r, "method"), time: s(r, "time"), room: s(r, "room"),
    grade: s(r, "grade"), grad: s(r, "grad") === "1", key: `${y}|${SEASON_CODE[t]}|${s(r, "no")}|${s(r, "cls")}`,
  })).filter((c) => c.no));
}

const isAdded = (c, term) => termClasses(term).some((x) => x.courseKey === c.key || (c.online && x.online && x.name === c.name));
// 시간표에 담는다. 요일마다 칸이 하나씩, 시간 없는 수업은 비고 칸 하나(사전제작은 적힌 시간을 겹침 계산용으로 같이 둔다)
function addCourse(c, term = c.term) {
  if (isAdded(c, term)) return "이미 담은 과목이에요";
  const all = myClasses(), color = freeColor(termClasses(term));
  const meta = { courseKey: c.key, term, credit: c.point, cat: c.cat, dept: c.dept, color, room: c.room };
  const add = c.online || !c.slots.length
    ? [{ ...meta, id: c.key, name: c.name, online: true, day: 0, start: 0, end: 0, note: describeTime(c), vslots: c.pre ? c.slots : [] }]
    : c.slots.map((s, j) => ({ ...meta, id: `${c.key}#${j}`, name: c.name, day: s.day, start: s.start, end: s.end, online: false }));
  saveClasses([...all, ...add]);
  return `${c.name}을(를) 담았어요`;
}
function conflictsWith(c, term) {
  const busy = termClasses(term).filter((x) => x.courseKey !== c.key)
    .flatMap((x) => (x.online ? (x.vslots || []) : [x]).map((s) => ({ day: s.day, start: s.start, end: s.end, name: x.name })));
  return [...new Set(busy.filter((b) => c.slots.some((s) => s.day === b.day && s.start < b.end && s.end > b.start)).map((b) => b.name))];
}

// ================= 과목 검색 =================
const sq = { text: "", field: "name", college: "", dept: "", grade: "", cat: "", credit: "", sort: "", free: false, grad: false };
let results = [];
const CYBER = "@cyber";
routes.search = {
  title: "과목 검색", sub: true, tab: "timetable",
  html(arg) {
    const wiz = arg.startsWith("wiz:");
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
    return `<p class="sub">${termLabel(viewTerm)} 개설 과목${wiz ? " · <b>마법사 후보 고르기</b>" : ""}</p>
      <div class="searchbar"><select id="sf">${[["name", "과목명"], ["staff", "교수명"], ["code", "과목코드"], ["room", "장소"]].map(([v, l]) => opt(v, l, sq.field)).join("")}</select>
        <input type="search" id="sq" placeholder="검색어" value="${esc(sq.text)}"></div>
      <div class="grid2"><select id="scol"></select><select id="sdep"></select></div>
      <div class="grid2"><select id="sgr">${[["", "전체 학년"], ["1", "1학년"], ["2", "2학년"], ["3", "3학년"], ["4", "4학년"], ["기타", "기타"]].map(([v, l]) => opt(v, l, sq.grade)).join("")}</select>
        <select id="scat"></select></div>
      <div class="grid2"><select id="scr">${[["", "전체 학점"], ["1", "1학점"], ["2", "2학점"], ["3", "3학점"], ["4+", "4학점 이상"]].map(([v, l]) => opt(v, l, sq.credit)).join("")}</select>
        <select id="sso">${[["", "기본 순"], ["code", "과목코드 순"], ["name", "과목명 순"]].map(([v, l]) => opt(v, l, sq.sort)).join("")}</select></div>
      <label class="check"><input type="checkbox" id="sfree" ${sq.free ? "checked" : ""}> 내 시간표와 안 겹치는 과목만</label>
      <label class="check"><input type="checkbox" id="sgrad" ${sq.grad ? "checked" : ""}> 대학원 과목 보기</label>
      <section class="card list" id="slist"><div class="empty">과목 목록 불러오는 중…</div></section>`;
  },
  async after(arg) {
    const wizGroup = arg.startsWith("wiz:") ? arg.slice(4) : null, term = viewTerm;
    let items;
    try { items = await catalog(term); } catch {
      if (current === "search") $("#slist").innerHTML = `<div class="empty">${termLabel(term)} 과목 목록이 아직 없어요.<br>학기가 열리면 올라와요.</div>`;
      return;
    }
    if (current !== "search") return;
    const opts = (el, first, list, cur) => (el.innerHTML = `<option value="">${first}</option>` + list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join(""));
    const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const fillDepts = () => opts($("#sdep"), "전체 학과", uniq(items.filter((c) => !sq.college || c.college === sq.college).map((c) => c.dept)), sq.dept);
    opts($("#scol"), "전체 단과대학", uniq(items.map((c) => c.college)), sq.college);
    // KCU·OCU 학점교류 인터넷 강의(단과대학·학과 칸이 빈 줄)
    if (items.some((c) => c.cyber)) $("#scol").insertAdjacentHTML("beforeend", `<option value="${CYBER}" ${sq.college === CYBER ? "selected" : ""}>인터넷 강의 (KCU·OCU)</option>`);
    fillDepts();
    opts($("#scat"), "전체 이수구분", uniq(items.map((c) => c.cat)), sq.cat);
    const norm = (s) => s.replace(/\s/g, "").toLowerCase();
    const draw = () => {
      const t = norm(sq.text);
      results = items.filter((c) => (sq.college === CYBER ? c.cyber : c.grad === sq.grad
        && (!sq.college || c.college === sq.college) && (!sq.dept || c.dept === sq.dept))
        && (!sq.grade || c.grades.includes(sq.grade)) && (!sq.cat || c.cat === sq.cat) && (!sq.credit || c.creditTok === sq.credit)
        && (!t || (sq.field === "name" ? norm(c.name).includes(t) : sq.field === "staff" ? norm(c.staff).includes(t)
          : sq.field === "room" ? norm(c.room).includes(t) : `${c.no}-${c.cls}`.includes(t)))
        && (!sq.free || (c.slots.length && !conflictsWith(c, term).length)));
      if (sq.sort === "code") results.sort((a, b) => a.no.localeCompare(b.no) || a.cls.localeCompare(b.cls));
      if (sq.sort === "name") results.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.cls.localeCompare(b.cls));
      const wizKeys = wizGroup ? new Set((wizardGroups(term).find((g) => g.id === wizGroup)?.cands) || []) : null;
      $("#slist").innerHTML = `<p class="note">${results.length}과목${results.length > 100 ? " — 앞의 100개만 보여요. 조건을 더 좁혀 보세요" : ""}</p>`
        + results.slice(0, 100).map((c, i) => {
          const clash = c.slots.length ? conflictsWith(c, term) : [];
          const on = wizKeys ? wizKeys.has(c.key) : isAdded(c, term);
          return `<div class="row"><div class="grow" data-ci="${i}"><div class="t"><b>${esc(c.name)}</b> <span class="sub">${esc(c.cls)}분반</span></div>
            <div class="sub">${esc(c.cyber ? `${c.cyber} 학점교류` : c.staff || "교수 미정")} · ${esc(c.cat)} · ${c.point == null ? "?" : fmtNum(c.point)}학점 · ${esc(c.method)}${c.grade ? " · " + esc(c.grade) + (/^\d/.test(c.grade) ? "학년" : "") : ""}</div>
            <div class="sub">${esc(describeTime(c))}${c.room ? " · " + esc(c.room) : ""}</div>
            ${clash.length ? `<div class="sub" style="color:var(--red)">⚠ ${esc(clash.join(", "))}와(과) 겹쳐요</div>` : ""}</div>
            <button class="btn small ${on ? "ghost" : ""}" data-add="${i}">${wizKeys ? (on ? "후보 ✓" : "후보로") : on ? "담음" : "담기"}</button></div>`;
        }).join("");
    };
    let timer;
    $("#sq").addEventListener("input", () => { sq.text = $("#sq").value; clearTimeout(timer); timer = setTimeout(draw, 150); });
    const bind = (id, k, fn) => $(id).addEventListener("change", (e) => { sq[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; fn?.(); draw(); });
    bind("#sf", "field"); bind("#scol", "college", () => { sq.dept = ""; fillDepts(); }); bind("#sdep", "dept");
    bind("#sgr", "grade"); bind("#scat", "cat"); bind("#scr", "credit"); bind("#sso", "sort"); bind("#sfree", "free"); bind("#sgrad", "grad");
    $("#slist").addEventListener("click", (e) => {
      const b = e.target.closest("[data-add]"), row = e.target.closest("[data-ci]");
      if (b) {
        const c = results[+b.dataset.add];
        if (wizGroup) toggleWizardCand(term, wizGroup, c.key);
        else if (isAdded(c, term)) removeCourse(c, term);
        else toast(addCourse(c, term));
        draw();
      } else if (row) courseDialog(results[+row.dataset.ci], term, draw);
    });
    draw();
  },
};

function removeCourse(c, term) {
  saveClasses(myClasses().filter((x) => !((x.term || termKey()) === term && (x.courseKey === c.key || (c.online && x.online && x.name === c.name)))));
  toast("시간표에서 뺐어요");
}

function courseDialog(c, term, onChange) {
  const d = document.createElement("div");
  d.className = "dialog";
  const clash = c.slots.length ? conflictsWith(c, term) : [];
  const groups = wizardGroups(term);
  const row = (k, v) => (v ? `<div class="row"><span class="sub" style="width:72px">${k}</span><div class="grow">${v}</div></div>` : "");
  d.innerHTML = `<div><h3>${esc(c.name)} <span class="sub">${esc(c.cls)}분반</span></h3>
    ${row("교수", c.cyber ? "" : esc(c.staff))}${row("강의시간", esc(describeTime(c)))}${row("강의실", esc(c.room))}
    ${row("이수구분", esc(c.cat))}${row("학점-이론-실습", esc(c.credit))}${row("강의형태", esc(c.method))}
    ${row("개설학과", esc([c.college, c.dept].filter(Boolean).join(" · ")))}${row("학년", esc(c.grade))}${row("과목코드", `${esc(c.no)}-${esc(c.cls)}`)}
    ${row("영어강의", c.kor === "N" ? "예" : "")}
    ${clash.length ? `<p class="sub" style="color:var(--red)">⚠ ${esc(clash.join(", "))}와(과) 시간이 겹쳐요</p>` : ""}
    ${c.room ? `<div class="btns" style="margin:8px 0">${roomLinks(c.room)}</div>` : ""}
    <p class="note">강의계획서 원문은 이루미에서 볼 수 있어요: <a href="https://irumi.pknu.ac.kr/nxui/launch.html?screenid=Phone_screen_quick&menuId=U020913" target="_blank" rel="noopener">이루미 강의계획서 조회 ›</a></p>
    <div class="btns" style="margin-top:12px">
      <button class="btn" id="cadd">${isAdded(c, term) ? "시간표에서 빼기" : "시간표에 담기"}</button>
      <select id="cwiz" style="width:auto;margin:0"><option value="">마법사 그룹에 넣기…</option>${groups.map((g, i) => `<option value="${g.id}">그룹 ${i + 1}</option>`).join("")}<option value="new">새 그룹</option></select>
      <button class="btn ghost" id="cno">닫기</button></div></div>`;
  document.body.append(d);
  const close = () => { d.remove(); onChange?.(); };
  d.addEventListener("click", (e) => { if (e.target === d) close(); });
  $("#cno", d).onclick = close;
  $("#cadd", d).onclick = () => { if (isAdded(c, term)) removeCourse(c, term); else toast(addCourse(c, term)); close(); };
  $("#cwiz", d).onchange = (e) => {
    let id = e.target.value;
    if (!id) return;
    if (id === "new") id = addWizardGroup(term);
    toggleWizardCand(term, id, c.key, true);
    close();
  };
}

// ================= 시간표 마법사 (앱 TimetableWizard) =================
const wizardGroups = (term) => store.get(`wizard:${term}`, []);
const saveWizard = (term, gs) => store.set(`wizard:${term}`, gs);
function addWizardGroup(term) {
  const id = String(Date.now());
  saveWizard(term, [...wizardGroups(term), { id, cands: [] }]);
  return id;
}
function toggleWizardCand(term, gid, key, onlyAdd) {
  saveWizard(term, wizardGroups(term).map((g) => {
    if (g.id !== gid) return g;
    const has = g.cands.includes(key);
    if (has && !onlyAdd) return { ...g, cands: g.cands.filter((k) => k !== key) };
    if (!has) toast("후보에 넣었어요");
    return has ? g : { ...g, cands: [...g.cands, key] };
  }));
}
const overlaps = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;
const MAX_PLANS = 20000;
// 그룹마다 하나씩, 서로·고정 수업과 안 겹치는 조합(겹치면 그 갈래를 버리는 되추적)
function buildPlans(groups, fixed) {
  const gs = groups.filter((g) => g.length), out = [], picks = [], taken = [...fixed];
  if (!gs.length) return [];
  const slotsOfCand = (c) => (c.online ? [] : c.slots);
  (function go(i) {
    if (out.length >= MAX_PLANS) return;
    if (i === gs.length) return void out.push([...picks]);
    for (const c of gs[i]) {
      const s = slotsOfCand(c);
      if (s.some((a) => taken.some((b) => overlaps(a, b)))) continue;
      picks.push(c); taken.push(...s);
      go(i + 1);
      picks.pop(); taken.splice(taken.length - s.length, s.length);
    }
  })(0);
  return out.map((p) => {
    const slots = p.flatMap(slotsOfCand), byDay = {};
    slots.forEach((s) => (byDay[s.day] ||= []).push(s));
    const gaps = Object.values(byDay).reduce((sum, day) => {
      day.sort((a, b) => a.start - b.start);
      return sum + day.slice(1).reduce((g, s, i) => g + Math.max(0, s.start - day[i].end), 0);
    }, 0);
    return { picks: p, days: Object.keys(byDay).length, gaps, earliest: slots.length ? Math.min(...slots.map((s) => s.start)) : null };
  });
}
const SORTS = {
  gaps: ["공강 적은 순", (a, b) => a.gaps - b.gaps || a.days - b.days],
  days: ["등교일 적은 순", (a, b) => a.days - b.days || a.gaps - b.gaps],
  morning: ["아침 수업 적은 순", (a, b) => (b.earliest ?? 1e9) - (a.earliest ?? 1e9) || a.gaps - b.gaps],
};
let plans = [];
routes.wizard = {
  title: "시간표 마법사", sub: true, tab: "timetable",
  html() {
    return `<p class="sub">${termLabel(viewTerm)}</p>
      <p class="note">그룹마다 후보(같은 과목의 여러 분반, 또는 아무거나 하나만 들으면 되는 과목들)를 넣으면, 그룹마다 하나씩 골라 시간이 안 겹치는 조합을 전부 찾아요.</p>
      <div id="wgroups"><div class="empty">불러오는 중…</div></div>
      <div class="btns"><button class="btn ghost" id="gadd">＋ 그룹 추가</button></div>
      <label class="check"><input type="checkbox" id="wfix" ${store.get("wizFix", true) ? "checked" : ""}> 지금 시간표에 있는 수업과도 안 겹치게</label>
      <div class="grid2"><select id="wsort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${store.get("wizSort", "gaps") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn" id="wrun">조합 찾기</button></div>
      <div id="wres"></div>`;
  },
  async after() {
    const term = viewTerm;
    let items = [];
    try { items = await catalog(term); } catch {}
    if (current !== "wizard") return;
    const byKey = Object.fromEntries(items.map((c) => [c.key, c]));
    const groups = wizardGroups(term);
    $("#wgroups").innerHTML = groups.map((g, i) => `<section class="card"><h2>그룹 ${i + 1} <a class="more" href="#search/wiz:${g.id}">＋ 후보 검색</a></h2>
      ${g.cands.map((k) => byKey[k]).filter(Boolean).map((c) => `<div class="row"><div class="grow"><b>${esc(c.name)}</b> <span class="sub">${esc(c.cls)}분반 · ${esc(c.staff)}</span>
        <div class="sub">${esc(describeTime(c))}</div></div><button class="chip" data-rm="${g.id}|${esc(c.key)}">✕</button></div>`).join("") || '<div class="sub">후보가 없어요 — ＋ 후보 검색에서 넣어 주세요</div>'}
      <button class="btn danger small" data-gdel="${g.id}" style="margin-top:8px">그룹 지우기</button></section>`).join("")
      || '<section class="card"><div class="empty">그룹을 추가하고 후보 과목을 넣어 보세요.</div></section>';
    $("#gadd").onclick = () => { location.hash = `#search/wiz:${addWizardGroup(term)}`; };
    $("#wgroups").onclick = (e) => {
      const rm = e.target.closest("[data-rm]"), del = e.target.closest("[data-gdel]");
      if (rm) { const [gid, key] = rm.dataset.rm.split(/\|(.+)/); toggleWizardCand(term, gid, key); render(); }
      if (del && confirm("이 그룹을 지울까요?")) { saveWizard(term, wizardGroups(term).filter((g) => g.id !== del.dataset.gdel)); render(); }
    };
    const showPlans = () => {
      const sort = $("#wsort").value;
      store.set("wizSort", sort);
      const list = [...plans].sort(SORTS[sort][1]).slice(0, 30);
      $("#wres").innerHTML = `<p class="note">조합 ${plans.length >= MAX_PLANS ? MAX_PLANS + "개 이상" : plans.length + "개"}${plans.length > 30 ? " — 앞의 30개" : ""}</p>`
        + (list.map((p, i) => `<section class="card"><h2>${i + 1}. 등교 ${p.days}일 · 공강 ${Math.floor(p.gaps / 60)}시간${p.gaps % 60 ? " " + (p.gaps % 60) + "분" : ""}${p.earliest != null ? " · 첫 수업 " + hm(p.earliest) : ""}</h2>
          ${p.picks.map((c) => `<div class="sub">• ${esc(c.name)} ${esc(c.cls)}분반 — ${esc(describeTime(c))}</div>`).join("")}
          <details><summary>미리보기</summary>${gridHtml(p.picks.flatMap((c, j) => (c.online ? [] : c.slots.map((s) => ({ ...s, name: c.name, room: c.room, color: j })))), false)}</details>
          <button class="btn small" data-apply="${plans.indexOf(p)}" style="margin-top:8px">이 조합으로 담기</button></section>`).join("")
          || '<section class="card"><div class="empty">안 겹치는 조합이 없어요. 후보를 늘리거나 "지금 시간표와도 안 겹치게"를 꺼 보세요.</div></section>');
    };
    $("#wsort").onchange = () => plans.length && showPlans();
    $("#wrun").onclick = () => {
      store.set("wizFix", $("#wfix").checked);
      const gs = wizardGroups(term).map((g) => g.cands.map((k) => byKey[k]).filter(Boolean));
      const candKeys = new Set(gs.flat().map((c) => c.key)), candNames = new Set(gs.flat().map((c) => c.name));
      const fixed = $("#wfix").checked ? termClasses(term).filter((x) => !x.online && !candKeys.has(x.courseKey) && !candNames.has(x.name)) : [];
      plans = buildPlans(gs, fixed);
      showPlans();
    };
    $("#wres").onclick = (e) => {
      const b = e.target.closest("[data-apply]");
      if (!b || !confirm("이 조합의 과목을 시간표에 담을까요? (이미 담은 과목은 건너뛰어요)")) return;
      plans[+b.dataset.apply].picks.forEach((c) => addCourse(c, term));
      toast("시간표에 담았어요"); location.hash = "#timetable";
    };
  },
};

// ================= 빈 강의실 (config 저장소 rooms.json, 앱 EmptyRooms) =================
const buildingOf = (room) => room.split("-")[0];
const buildingOrder = (a, b) => a[0].localeCompare(b[0]) || (parseInt(a.slice(1)) || 0) - (parseInt(b.slice(1)) || 0);
routes.rooms = {
  title: "빈 강의실", sub: true, tab: "more",
  html() { return '<div id="rv"><div class="empty">불러오는 중…</div></div>'; },
  async after() {
    let rd;
    try { rd = await load("rooms"); } catch { if (current === "rooms") $("#rv").innerHTML = '<div class="empty">강의실 자료를 받지 못했어요</div>'; return; }
    if (current !== "rooms") return;
    const blds = [...new Set(Object.keys(rd.rooms).map(buildingOf))].sort(buildingOrder);
    const di = Math.min(dayIndex(), 5), m = nowMinute();
    const from = m >= 540 && m < 1260 ? m - (m % 10) : 540;
    const st = store.get("roomsPick", {});
    $("#rv").innerHTML = `${rd.term !== termKey() ? `<p class="note">⚠ ${termLabel(rd.term)} 시간표 기준이에요. 새 학기 자료는 개강 뒤 올라와요.</p>` : ""}
      <div class="grid2"><select id="rb">${blds.map((b) => `<option ${b === st.b ? "selected" : ""}>${b}</option>`).join("")}</select>
        <select id="rd">${DAYS.slice(0, 6).map((x, i) => `<option value="${i}" ${i === di ? "selected" : ""}>${x}요일</option>`).join("")}</select></div>
      <div class="grid2"><input type="time" id="rf" value="${hm(from)}">
        <select id="rl">${[[50, "50분"], [75, "1시간 15분"], [120, "2시간"], [180, "3시간"]].map(([v, l]) => `<option value="${v}" ${+st.l === v ? "selected" : ""}>${l} 동안</option>`).join("")}</select></div>
      <div id="rbl" class="btns" style="margin-bottom:10px"></div>
      <section class="card list" id="rlist"></section>
      <p class="note">"비었다" = 그 시간에 잡힌 수업이 없다는 뜻이에요. 동아리·시험·보강처럼 강의계획서에 없는 사용은 몰라요. 자료 기준 ${esc(rd.generated || "")}</p>`;
    const draw = () => {
      const b = $("#rb").value, day = DAY_KEYS[+$("#rd").value], s = toMin($("#rf").value || "09:00"), e = s + +$("#rl").value;
      store.set("roomsPick", { b, l: $("#rl").value });
      $("#rbl").innerHTML = roomLinks(b + "-");
      const free = Object.entries(rd.rooms).filter(([r]) => buildingOf(r) === b).map(([room, slots]) => {
        const today = slots.filter((x) => x[0] === day);
        if (today.some((x) => x[1] < e && x[2] > s)) return null;
        const next = today.filter((x) => x[1] >= e).map((x) => x[1]);
        return { room, next: next.length ? Math.min(...next) : null };
      }).filter(Boolean).sort((a, b2) => (b2.next ?? 1e9) - (a.next ?? 1e9) || a.room.localeCompare(b2.room));
      $("#rlist").innerHTML = `<h2>${b} · ${hm(s)}~${hm(e)} 빈 강의실 ${free.length}곳</h2>`
        + (free.map((f) => `<div class="row"><div class="grow"><b>${esc(f.room)}</b></div><span class="sub">${f.next == null ? "그날 남은 수업 없음" : "다음 수업 " + hm(f.next)}</span></div>`).join("")
          || '<div class="empty">이 시간엔 빈 강의실이 없어요</div>');
    };
    ["#rb", "#rd", "#rf", "#rl"].forEach((id) => $(id).addEventListener("change", draw));
    draw();
  },
};

// ================= 시험·과제 (앱 CourseTask) =================
const KINDS = ["시험", "과제", "발표", "기타"];
const allTasks = () => store.get("tasks", []);
const saveTasks = (list) => store.set("tasks", list);
const termTasks = (term) => allTasks().filter((t) => t.term === term).sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
const taskLeft = (t) => (t.date?.length === 8 ? daysBetween(todayKey(), t.date) : null);
const upcomingTasks = (within) => allTasks().filter((t) => !t.done && taskLeft(t) != null && taskLeft(t) >= 0 && taskLeft(t) <= within).sort((a, b) => a.date.localeCompare(b.date));
function taskBadge(t) {
  const d = taskLeft(t);
  return d == null ? "" : d === 0 ? "오늘" : d > 0 ? `D-${d}` : "지남";
}
function taskRow(t) {
  const d = taskLeft(t);
  return `<div class="row" data-task="${esc(t.id)}" style="${t.done ? "opacity:.5" : ""}"><input type="checkbox" data-done="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="끝냄">
    <div class="grow"><div class="t">${esc(t.course)} · ${esc(t.kind)}${t.title ? " · " + esc(t.title) : ""}</div><div class="sub">${t.date ? md(t.date) : ""}</div></div>
    ${t.done ? "" : `<span class="badge ${d != null && d <= 3 ? "red" : ""}">${taskBadge(t)}</span>`}</div>`;
}
function bindTaskRows() {
  view.querySelectorAll("[data-done]").forEach((cb) => cb.addEventListener("change", (e) => {
    e.stopPropagation();
    saveTasks(allTasks().map((t) => (t.id === cb.dataset.done ? { ...t, done: cb.checked } : t)));
    render();
  }));
  view.querySelectorAll("[data-task]").forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.matches("input")) return;
    taskDialog(allTasks().find((t) => t.id === r.dataset.task));
  }));
}
function taskDialog(t, course = "") {
  const names = [...new Set(termClasses(t?.term || viewTerm).map((c) => c.name))];
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div><h3>${t ? "시험·과제 고치기" : "시험·과제 적기"}</h3>
    <label for="tc">과목</label><input type="text" id="tc" list="tcl" value="${esc(t?.course || course)}"><datalist id="tcl">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    <div class="grid2"><div><label for="tk">종류</label><select id="tk">${KINDS.map((k) => `<option ${k === (t?.kind || "과제") ? "selected" : ""}>${k}</option>`).join("")}</select></div>
      <div><label for="td">날짜</label><input type="date" id="td" value="${t?.date ? `${t.date.slice(0, 4)}-${t.date.slice(4, 6)}-${t.date.slice(6)}` : ""}"></div></div>
    <label for="tt">내용 (선택)</label><input type="text" id="tt" value="${esc(t?.title || "")}" placeholder="예: 중간고사 범위 1~6장">
    <div class="btns"><button class="btn" id="ok">저장</button>${t ? '<button class="btn danger" id="del">삭제</button>' : ""}<button class="btn ghost" id="no">취소</button></div></div>`;
  document.body.append(d);
  const close = () => { d.remove(); render(); };
  d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
  $("#no", d).onclick = () => d.remove();
  if (t) $("#del", d).onclick = () => { saveTasks(allTasks().filter((x) => x.id !== t.id)); close(); };
  $("#ok", d).onclick = () => {
    const c = $("#tc", d).value.trim(), date = $("#td", d).value.replace(/-/g, "");
    if (!c || date.length !== 8) return toast("과목과 날짜를 적어 주세요");
    const item = { id: t?.id || String(Date.now()), term: t?.term || viewTerm, course: c, kind: $("#tk", d).value, title: $("#tt", d).value.trim(), date, done: t?.done || false };
    saveTasks([...allTasks().filter((x) => x.id !== item.id), item]);
    close();
  };
}
routes.tasks = {
  title: "시험·과제", sub: true, tab: "timetable",
  html() {
    const list = termTasks(viewTerm), open = list.filter((t) => !t.done), done = list.filter((t) => t.done);
    return `<p class="sub">${termLabel(viewTerm)}</p>
      <section class="card"><h2>남은 것</h2>${open.map(taskRow).join("") || '<div class="empty">적어 둔 시험·과제가 없어요</div>'}</section>
      ${done.length ? `<section class="card"><h2>끝낸 것</h2>${done.map(taskRow).join("")}</section>` : ""}
      <div class="btns"><button class="btn" id="tadd">＋ 시험·과제 적기</button>${open.length ? '<button class="btn ghost" id="tics">캘린더 앱에 넣기</button>' : ""}</div>
      <p class="note">웹앱은 알림을 미리 맞춰 둘 수 없어서, 캘린더 앱에 넣으면 하루 전 알림이 같이 들어가요.</p>`;
  },
  after(arg) {
    bindTaskRows();
    $("#tadd").onclick = () => taskDialog(null);
    $("#tics") && ($("#tics").onclick = () => downloadIcs("시험과제", termTasks(viewTerm).filter((t) => !t.done && t.date >= todayKey()).map((t) => ({
      title: `[${t.kind}] ${t.course}${t.title ? " · " + t.title : ""}`, start: t.date, alarm: -24 * 60 + 9 * 60,
    }))));
    if (arg) { history.replaceState(null, "", "#tasks"); taskDialog(null, arg); }
  },
};

// ================= 학점·졸업 요건 (앱 Credits·GradRequirements) =================
const GRADES = { "A+": 4.5, A0: 4.0, "B+": 3.5, B0: 3.0, "C+": 2.5, C0: 2.0, "D+": 1.5, D0: 1.0, F: 0, P: null };
const CATEGORIES = ["전공필수", "전공선택", "전공공통", "필수교양", "균형교양", "자유선택", "교직필수"];
const MAJOR_CATS = ["전공필수", "전공선택", "전공공통"];
const isMajorCat = (c) => MAJOR_CATS.includes(c) || c.includes("전공");
const profile = () => store.get("profile", null);

function cyberOfKey(key) {
  const p = key.split("|");
  if (p[0] === "KCU" || p[0] === "OCU") return p[0];
  return /^[KU]/.test(p[2] || "") ? (p[2][0] === "K" ? "KCU" : "OCU") : null;
}
function creditRows() {
  const ov = store.get("credits", {}), groups = {};
  myClasses().forEach((e) => (groups[e.courseKey || `manual|${e.term || termKey()}|${e.name}`] ||= []).push(e));
  return Object.entries(groups).map(([key, es]) => {
    const f = es[0], o = ov[key] || {}, cyber = f.online && cyberOfKey(key);
    return {
      key, term: f.term || termKey(), name: f.name, dept: f.dept || null,
      credit: o.credit ?? f.credit ?? (cyber ? 3 : null),
      cat: o.cat || f.cat || (cyber ? "자유선택" : ""), excluded: !!o.excluded, grade: o.grade || "",
    };
  });
}
// 안드로이드 백업에서 온 칸에는 학점·이수구분이 없다 — 그 학기 과목 목록에서 찾아 채운다(한 번만 시도)
async function fillMeta() {
  const need = myClasses().filter((e) => e.courseKey && e.credit == null && !e.metaTried);
  if (!need.length) return false;
  const terms = [...new Set(need.map((e) => e.term))], found = {};
  for (const t of terms) { try { (await catalog(t)).forEach((c) => (found[c.key] = c)); } catch {} }
  saveClasses(myClasses().map((e) => {
    if (!e.courseKey || e.credit != null || e.metaTried) return e;
    const c = found[e.courseKey];
    return c ? { ...e, credit: c.point, cat: c.cat, dept: c.dept, metaTried: true } : { ...e, metaTried: true };
  }));
  return true;
}
const counted = (rows, cur) => rows.filter((r) => !r.excluded && r.credit != null && r.grade !== "F" && termOrder(r.term) <= termOrder(cur));
function gpaOf(rows) {
  const g = rows.filter((r) => !r.excluded && r.credit != null && GRADES[r.grade] != null);
  const cr = g.reduce((s, r) => s + r.credit, 0), pts = g.reduce((s, r) => s + r.credit * GRADES[r.grade], 0);
  return { credits: cr, points: pts, gpa: cr ? pts / cr : null };
}
const percent = (g) => Math.round((g * 10 + 55) * 10) / 10;

// 학과 이름의 어간: "기계공학과"·"기계공학전공" → "기계공학" (표와 이루미 개설 학과 이름이 엇갈려서)
function stem(s) {
  let r = s.replace(/&#32;/g, "").replace(/ /g, "").replace(/\(.*?\)/g, "");
  if (r.includes("학부") && !r.endsWith("학부")) r = r.slice(r.lastIndexOf("학부") + 2);
  r = r.replace(/전공$/, "");
  return r.replace(/(학과|학부)$/, "학");
}
function sameDept(a, b) {
  if (!a || !b) return false;
  const x = stem(a), y = stem(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}
const matchesMain = (p, d) => d != null && ((p.mainAlias || []).includes(d) || sameDept(d, p.major));
function secondOf(p, d) {
  if (d == null) return null;
  const a = (p.secondAlias || {})[d];
  if (a) { const s = p.seconds.find((x) => x.dept === a); if (s) return s; }
  if ((p.mainAlias || []).includes(d)) return null;
  return p.seconds.find((x) => sameDept(d, x.dept)) || null;
}
const deptRow = (gd, year, name) => (gd.years[year] || []).find((x) => x.name === name);
function gradReqRows(gd, p, rows, cur) {
  const main = deptRow(gd, p.year, p.major);
  if (!main) return [];
  const c = counted(rows, cur), sum = (f) => c.filter(f).reduce((s, r) => s + r.credit, 0);
  const isGyo = (r) => r.cat.includes("교양"), isMajor = (r) => isMajorCat(r.cat);
  const hasDouble = p.seconds.some((s) => s.kind === "DOUBLE");
  const isFirst = (r) => isMajor(r) && !secondOf(p, r.dept) && (!r.dept || matchesMain(p, r.dept));
  const out = [];
  out.push({ label: "교양", earned: sum(isGyo), need: main.gyo, text: main.gyo != null && main.gyoMax > main.gyo ? `${main.gyo}~${main.gyoMax}` : null });
  if (main.gyoReq != null) out.push({ label: "필수교양", earned: sum((r) => r.cat === "필수교양"), need: main.gyoReq, sub: true });
  if (main.gyoBal != null) out.push({ label: "균형교양", earned: sum((r) => r.cat === "균형교양"), need: main.gyoBal, sub: true });
  const firstNeed = hasDouble ? main.first ?? main.major : main.major;
  out.push({ label: hasDouble ? `제1전공 (${p.major})` : `전공 (${p.major})`, earned: sum(isFirst), need: firstNeed });
  if (main.majorReq != null) out.push({ label: "전공 공통·필수", earned: sum((r) => ["전공필수", "전공공통"].includes(r.cat) && isFirst(r)), need: main.majorReq, sub: true });
  let doubleNeed = 0;
  p.seconds.forEach((sm) => {
    const need = sm.kind === "DOUBLE" ? deptRow(gd, p.year, sm.dept)?.double ?? 36 : gd.minor ?? 21;
    if (sm.kind === "DOUBLE") doubleNeed += need;
    out.push({ label: `${sm.kind === "DOUBLE" ? "복수전공" : "부전공"} ${sm.dept}`, earned: sum((r) => secondOf(p, r.dept) === sm && !isGyo(r)), need });
  });
  const free = hasDouble ? (firstNeed != null ? main.total - (main.gyo || 0) - firstNeed - doubleNeed : null) : main.free;
  out.push({ label: p.seconds.some((s) => s.kind === "MINOR") ? "자유선택 등 (부전공 포함)" : "자유선택 등",
    earned: sum((r) => !isGyo(r) && !isFirst(r) && secondOf(p, r.dept)?.kind !== "DOUBLE"), need: free > 0 ? free : null });
  return out;
}
// 전공 구분인데 개설 학과가 주전공도 다전공도 아닌 과목(학과 이름이 바뀐 경우 사용자가 돌린다)
function otherDeptMajors(p, rows, cur) {
  const out = {};
  counted(rows, cur).forEach((r) => {
    if (isMajorCat(r.cat) && r.dept && !matchesMain(p, r.dept) && !secondOf(p, r.dept)) out[r.dept] = (out[r.dept] || 0) + r.credit;
  });
  return out;
}
// 그 학기의 학적: "2학년 1학기"·"휴학"·"졸업유예"·"초과 1학기" (앱 GradProfile.standing, 봄 입학 기준)
function standing(p, k) {
  const [y, t] = k.split("-");
  if (t === "S" || t === "W" || +y < p.year) return null;
  if (p.leaves.includes(k)) return "휴학";
  if (p.deferrals.includes(k)) return "졸업유예";
  const before = [...p.leaves, ...p.deferrals].filter((x) => termOrder(x) >= p.year * 10 && termOrder(x) < termOrder(k)).length;
  const n = (+y - p.year) * 2 + (t === "2" ? 1 : 0) - before;
  const over = n - (p.years + 1 - p.entryGrade) * 2;
  return over >= 0 ? `초과 ${over + 1}학기` : `${p.entryGrade + Math.floor(n / 2)}학년 ${(n % 2) + 1}학기`;
}
function decodeProfile(s) {
  const f = s?.split("\u001f");
  if (!f || f.length < 2 || !+f[0] || !f[1]) return null;
  const list = (i) => (f[i] || "").split("|").filter(Boolean);
  const seconds = f.length > 10
    ? list(10).map((e) => ({ kind: e.split(">")[0], dept: e.split(">")[1] })).filter((x) => ["DOUBLE", "MINOR"].includes(x.kind) && x.dept)
    : ["DOUBLE", "MINOR"].includes(f[2]) && f[3] ? [{ kind: f[2], dept: f[3] }] : [];
  const secondAlias = {};
  list(5).forEach((e) => { if (e.includes(">")) secondAlias[e.split(">")[0]] = e.split(">")[1]; else if (seconds[0]) secondAlias[e] = seconds[0].dept; });
  return {
    year: +f[0], major: f[1], seconds, mainAlias: list(4), secondAlias,
    entryGrade: Math.min(4, Math.max(1, +f[6] || 1)), leaves: list(7), years: Math.min(6, Math.max(4, +f[8] || 4)), deferrals: list(9),
  };
}
function importCredits(raw) {
  const parts = raw.split("\u001d"), items = {};
  (parts[0] || "").split("\u001e").forEach((l) => {
    const f = l.split("\u001f");
    if (f.length >= 4 && f.length <= 5) items[f[0]] = { credit: f[1] === "" ? null : +f[1], cat: f[2], excluded: f[3] === "1", grade: f[4] || "" };
  });
  store.set("credits", items);
  store.set("gradTarget", +(parts[1] || 0) || 0);
  const ct = {};
  (parts[2] || "").split(",").forEach((x) => { const [k, v] = x.split("="); if (k?.trim() && +v > 0) ct[k.trim()] = +v; });
  store.set("catTargets", ct);
  const p = decodeProfile(parts[3]);
  if (p) store.set("profile", p);
}
const bar = (earned, need) => (need ? `<div class="bar"><i style="width:${Math.min(100, (earned / need) * 100)}%"></i></div>` : "");

routes.credits = {
  title: "학점·졸업 요건", sub: true, tab: "timetable",
  html() { return '<div id="cv"><div class="empty">계산하는 중…</div></div>'; },
  async after() {
    await fillMeta();
    let gd = null;
    try { gd = await load("static/grad_requirements"); } catch {}
    if (current !== "credits") return;
    const cur = termKey(), rows = creditRows(), p = profile();
    const c = rows.filter((r) => !r.excluded && r.credit != null && r.grade !== "F");
    const sum = (f) => c.filter(f).reduce((s, r) => s + r.credit, 0);
    const done = sum((r) => termOrder(r.term) < termOrder(cur)), now = sum((r) => r.term === cur), planned = sum((r) => termOrder(r.term) > termOrder(cur));
    const unknown = rows.filter((r) => !r.excluded && r.credit == null).length;
    const main = p && gd ? deptRow(gd, p.year, p.major) : null;
    const graduation = main?.total || store.get("gradTarget", 0);
    const all = gpaOf(rows), major = gpaOf(rows.filter((r) => MAJOR_CATS.includes(r.cat)));
    const taken = done + now, nowUngraded = sum((r) => r.term === cur && !r.grade);
    const remaining = Math.max(0, graduation - taken) + nowUngraded;
    const tg = +store.get("targetGpa", 0);
    const need = tg && remaining > 0 ? (tg * (all.credits + remaining) - all.points) / remaining : null;
    const req = p && gd ? gradReqRows(gd, p, rows, cur) : [];
    const others = p ? otherDeptMajors(p, rows, cur) : {};
    const byCat = {};
    c.filter((r) => termOrder(r.term) <= termOrder(cur)).forEach((r) => (byCat[r.cat || "미분류"] = (byCat[r.cat || "미분류"] || 0) + r.credit));
    const targets = store.get("catTargets", {});
    const terms = [...new Set(rows.map((r) => r.term))].sort((a, b) => termOrder(b) - termOrder(a));
    const st = p ? standing(p, cur) : null;

    $("#cv").innerHTML = `
      <section class="card"><h2>내 프로필 <button class="chip" id="pedit" style="margin-left:auto">${p ? "고치기" : "넣기"}</button></h2>
        ${p ? `<div>${p.year}학년도 입학 · ${esc(p.major)}${p.seconds.map((s) => ` · ${s.kind === "DOUBLE" ? "복수전공" : "부전공"} ${esc(s.dept)}`).join("")}</div>
          <div class="sub">${termLabel(cur)}: <b>${st || "계절학기"}</b>${p.entryGrade > 1 ? ` · ${p.entryGrade}학년 편입` : ""}${p.years === 5 ? " · 5년제" : ""}</div>`
          : '<p class="sub">입학연도·전공을 넣으면 졸업 요건을 학과 표대로 계산하고 몇 학년 몇 학기인지 보여줘요.</p>'}
      </section>
      <section class="card"><h2>이수 학점</h2>
        <div class="stats"><div><b>${fmtNum(done)}</b><span>지난 학기까지</span></div><div><b>${fmtNum(now)}</b><span>이번 학기</span></div><div><b>${fmtNum(planned)}</b><span>다음 학기 이후</span></div></div>
        ${graduation ? `<p>졸업 ${graduation}학점 중 <b>${fmtNum(taken)}</b>학점 (이번 학기 포함)</p>${bar(taken, graduation)}`
          : `<p class="sub">졸업 학점: <input type="number" id="gt" min="0" max="250" style="width:90px;display:inline-block;margin:0" placeholder="예: 130"> (프로필을 넣으면 자동)</p>`}
        ${unknown ? `<p class="note">학점을 모르는 과목 ${unknown}개 — 아래 목록에서 눌러 적어 주세요.</p>` : ""}
      </section>
      <section class="card"><h2>평점</h2>
        ${all.gpa != null ? `<div class="stats"><div><b>${all.gpa.toFixed(2)}</b><span>전체 (${percent(all.gpa)}점)</span></div>${major.gpa != null ? `<div><b>${major.gpa.toFixed(2)}</b><span>전공</span></div>` : ""}<div><b>${fmtNum(all.credits)}</b><span>성적 넣은 학점</span></div></div>`
          : '<p class="sub">아래 과목을 눌러 성적을 넣으면 평점을 계산해요 (P는 빠지고 F는 0점으로 들어가요).</p>'}
        <p class="sub">목표 평점 <input type="number" id="tgpa" step="0.01" min="0" max="4.5" value="${tg || ""}" style="width:90px;display:inline-block;margin:0" placeholder="예: 4.0"></p>
        ${tg ? (need == null ? '<p class="sub">남은 학점이 없어서 계산할 수 없어요 (졸업 학점을 넣어 주세요)</p>'
          : need > 4.5 ? `<p style="color:var(--red)">남은 ${fmtNum(remaining)}학점을 모두 A+를 받아도 ${tg}에 못 미쳐요</p>`
            : `<p>남은 <b>${fmtNum(remaining)}</b>학점에서 평균 <b>${Math.max(0, need).toFixed(2)}</b> 이상 받으면 돼요</p>`) : ""}
      </section>
      ${req.length ? `<section class="card"><h2>졸업 요건 <span class="sub">${p.year}학년도 표</span></h2>
        ${req.map((r) => `<div class="req ${r.sub ? "subrow" : ""}"><div class="row" style="border:0;padding:4px 0"><div class="grow">${esc(r.label)}</div>
          <b style="color:${r.need && r.earned >= r.need ? "var(--green)" : "inherit"}">${fmtNum(r.earned)} / ${r.text || (r.need ?? "—")}</b></div>${bar(r.earned, r.need)}</div>`).join("")}
        ${Object.entries(others).map(([dept, n]) => `<div class="note">• ${esc(dept)} 전공 과목 ${fmtNum(n)}학점은 자유선택으로 셌어요.
          <button class="chip" data-alias="${esc(dept)}|main">주전공으로 치기</button>${p.seconds.map((s) => `<button class="chip" data-alias="${esc(dept)}|${esc(s.dept)}">${esc(s.dept)}로 치기</button>`).join("")}</div>`).join("")}
        <p class="note">${esc(gd?.source || "")} 기준이에요. 정확한 판정은 이루미 졸업사정을 확인해 주세요.</p></section>`
        : p && !main ? `<section class="card"><p class="sub">${p.year}학년도 표에서 "${esc(p.major)}"를 못 찾았어요. 프로필에서 학과를 다시 골라 주세요.</p></section>` : ""}
      <section class="card"><h2>이수구분별</h2>
        ${[...new Set([...Object.keys(byCat), ...Object.keys(targets)])].map((k) => `<div class="row" style="padding:4px 0"><div class="grow">${esc(k)}</div><b>${fmtNum(byCat[k] || 0)}${targets[k] ? " / " + targets[k] : ""}</b></div>${bar(byCat[k] || 0, targets[k])}`).join("") || '<div class="empty">아직 없어요</div>'}
        ${p ? "" : `<details><summary>구분별 목표 학점 적기</summary>${CATEGORIES.map((k) => `<div class="row"><div class="grow">${k}</div><input type="number" data-ct="${k}" value="${targets[k] || ""}" style="width:80px;margin:0"></div>`).join("")}</details>`}
      </section>
      ${terms.map((t) => `<section class="card"><h2>${termLabel(t)}${p && standing(p, t) ? ` <span class="sub">${standing(p, t)}</span>` : ""}</h2>
        ${rows.filter((r) => r.term === t).map((r) => `<div class="row" data-cr="${esc(r.key)}" style="${r.excluded ? "opacity:.45" : ""}"><div class="grow">${esc(r.name)}
          <div class="sub">${r.credit == null ? '<span style="color:var(--red)">학점?</span>' : fmtNum(r.credit) + "학점"} · ${esc(r.cat || "구분?")}${r.excluded ? " · 빠짐" : ""}</div></div>
          <span class="badge ${r.grade === "F" ? "red" : r.grade ? "green" : ""}">${r.grade || "성적"}</span></div>`).join("")}</section>`).join("")
        || '<section class="card"><div class="empty">시간표에 담은 과목이 여기 모여요. 지난 학기 과목도 시간표에서 학기를 넘겨 담아 주세요.</div></section>'}`;

    $("#pedit").onclick = () => profileDialog(gd);
    $("#gt") && ($("#gt").onchange = (e) => { store.set("gradTarget", +e.target.value || 0); render(); });
    $("#tgpa").onchange = (e) => { store.set("targetGpa", Math.min(4.5, +e.target.value || 0)); render(); };
    view.querySelectorAll("[data-ct]").forEach((i) => (i.onchange = () => {
      const t2 = store.get("catTargets", {});
      if (+i.value > 0) t2[i.dataset.ct] = +i.value; else delete t2[i.dataset.ct];
      store.set("catTargets", t2); render();
    }));
    view.querySelectorAll("[data-alias]").forEach((b) => (b.onclick = () => {
      const [dept, to] = b.dataset.alias.split("|"), pp = profile();
      if (to === "main") pp.mainAlias = [...(pp.mainAlias || []), dept]; else pp.secondAlias = { ...(pp.secondAlias || {}), [dept]: to };
      store.set("profile", pp); render();
    }));
    view.querySelectorAll("[data-cr]").forEach((el) => (el.onclick = () => creditDialog(rows.find((r) => r.key === el.dataset.cr))));
  },
};

function creditDialog(r) {
  const d = document.createElement("div");
  d.className = "dialog";
  d.innerHTML = `<div><h3>${esc(r.name)}</h3><p class="sub">${termLabel(r.term)}</p>
    <div class="grid2"><div><label>학점</label><input type="number" id="xc" step="0.5" min="0" max="20" value="${r.credit ?? ""}"></div>
      <div><label>성적</label><select id="xg"><option value="">아직 없음</option>${Object.keys(GRADES).map((g) => `<option ${g === r.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div></div>
    <label>이수구분</label><select id="xk"><option value="">모름</option>${[...new Set([...CATEGORIES, r.cat].filter(Boolean))].map((k) => `<option ${k === r.cat ? "selected" : ""}>${k}</option>`).join("")}</select>
    <label class="check"><input type="checkbox" id="xe" ${r.excluded ? "checked" : ""}> 학점 계산에서 빼기 (재수강 전 과목·철회 등)</label>
    <div class="btns"><button class="btn" id="ok">저장</button><button class="btn ghost" id="no">취소</button></div></div>`;
  document.body.append(d);
  d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
  $("#no", d).onclick = () => d.remove();
  $("#ok", d).onclick = () => {
    const all = store.get("credits", {}), v = $("#xc", d).value;
    all[r.key] = { credit: v === "" ? null : +v, cat: $("#xk", d).value, excluded: $("#xe", d).checked, grade: $("#xg", d).value };
    store.set("credits", all); d.remove(); render();
  };
}

function profileDialog(gd) {
  if (!gd) return toast("졸업 요건 표를 받지 못했어요");
  const p = profile() || { year: Math.max(...Object.keys(gd.years).map(Number)), major: "", seconds: [], mainAlias: [], secondAlias: {}, entryGrade: 1, leaves: [], years: 4, deferrals: [] };
  const years = Object.keys(gd.years).map(Number).sort((a, b) => b - a);
  const d = document.createElement("div");
  d.className = "dialog";
  const draw = () => {
    const rows = gd.years[p.year] || [];
    // 단과대학별로 묶어 보여준다(앱 1.9.4와 같게). 학부 아래 전공은 "학부 › 전공"으로.
    const grouped = (sel) => {
      const by = {};
      rows.forEach((x) => (by[x.college || "기타"] = by[x.college || "기타"] || []).push(x));
      return Object.entries(by).map(([c, xs]) => `<optgroup label="${esc(c)}">${xs.map((x) => {
        const label = x.group && x.name.startsWith(x.group) ? x.name : x.group ? `${x.group} › ${x.name}` : x.name;
        return `<option value="${esc(x.name)}" ${x.name === sel ? "selected" : ""}>${esc(label)}</option>`;
      }).join("")}</optgroup>`).join("");
    };
    const regTerms = [];
    for (let y = p.year; y <= +termKey().slice(0, 4); y++) ["1", "2"].forEach((t) => { if (termOrder(`${y}-${t}`) <= termOrder(termKey())) regTerms.push(`${y}-${t}`); });
    d.innerHTML = `<div style="max-height:85vh;overflow:auto"><h3>내 프로필</h3>
      <div class="grid2"><div><label>입학연도</label><select id="py">${years.map((y) => `<option ${y === p.year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
        <div><label>입학 학년</label><select id="pe">${[1, 2, 3, 4].map((g) => `<option value="${g}" ${g === p.entryGrade ? "selected" : ""}>${g === 1 ? "1학년 (신입)" : g + "학년 편입"}</option>`).join("")}</select></div></div>
      <label>주전공 (${p.year}학년도 학과 이름)</label><select id="pm"><option value="">고르세요</option>${grouped(p.major)}</select>
      <label>수업연한</label><select id="pyr"><option value="4" ${p.years === 4 ? "selected" : ""}>4년</option><option value="5" ${p.years === 5 ? "selected" : ""}>5년 (건축학 등)</option></select>
      <label>다전공</label>${p.seconds.map((s, i) => `<div class="row" style="padding:4px 0"><div class="grow">${s.kind === "DOUBLE" ? "복수전공" : "부전공"} ${esc(s.dept)}</div><button class="chip" data-sdel="${i}">✕</button></div>`).join("")}
      <div class="grid2"><select id="sk"><option value="DOUBLE">복수전공</option><option value="MINOR">부전공</option></select>
        <select id="sd"><option value="">학과 고르기</option>${grouped("")}</select></div>
      <label>휴학·졸업유예한 학기 (눌러서 바꾸기: 재학 → 휴학 → 졸업유예)</label>
      <div class="chips" style="flex-wrap:wrap">${regTerms.map((k) => {
        const s = p.leaves.includes(k) ? "휴학" : p.deferrals.includes(k) ? "졸업유예" : "";
        return `<button class="chip ${s ? "on" : ""}" data-lv="${k}">${k.replace("-", ".")}${s ? " " + s : ""}</button>`;
      }).join("")}</div>
      <div class="btns"><button class="btn" id="ok">저장</button>${profile() ? '<button class="btn danger" id="pdel">지우기</button>' : ""}<button class="btn ghost" id="no">취소</button></div></div>`;
    $("#py", d).onchange = (e) => { p.year = +e.target.value; draw(); };
    $("#pe", d).onchange = (e) => { p.entryGrade = +e.target.value; };
    $("#pm", d).onchange = (e) => { p.major = e.target.value; const row = deptRow(gd, p.year, p.major); if (row) p.years = row.total >= 160 ? 5 : 4; draw(); };
    $("#pyr", d).onchange = (e) => { p.years = +e.target.value; };
    $("#sd", d).onchange = (e) => { if (e.target.value) { p.seconds.push({ kind: $("#sk", d).value, dept: e.target.value }); draw(); } };
    d.querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = () => { p.seconds.splice(+b.dataset.sdel, 1); draw(); }));
    d.querySelectorAll("[data-lv]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.lv;
      if (p.leaves.includes(k)) { p.leaves = p.leaves.filter((x) => x !== k); p.deferrals.push(k); }
      else if (p.deferrals.includes(k)) p.deferrals = p.deferrals.filter((x) => x !== k);
      else p.leaves.push(k);
      draw();
    }));
    $("#no", d).onclick = () => d.remove();
    $("#pdel", d) && ($("#pdel", d).onclick = () => { store.set("profile", null); d.remove(); render(); });
    $("#ok", d).onclick = () => {
      if (!p.major) return toast("주전공을 골라 주세요");
      store.set("profile", p); d.remove(); render();
    };
  };
  document.body.append(d);
  d.addEventListener("click", (e) => { if (e.target === d) d.remove(); });
  draw();
}

// ================= 교육과정 (앱 CurriculumCard·CurriculumYears·PastCurriculum) =================
// 2026 교육과정은 curriculum_index, 2026 로드맵과 2021~2025 문서는 curriculum_years. 학과 이름이 해마다 바뀌어
// 앱과 같은 순서로 짝짓는다: 같은 이름 → "(…이전 입학자)" 뗀 이름 → 학부 → 어간 → 개편표 → 같은 학부 첫 전공.
const RENAMED = {"고분자·화학소재공학부 - 에너지화학소재공학전공": ["공업화학·고분자공학부 - 공업화학전공", "공업화학·고분자공학부", "공업화학과"], "행정복지학부 - 사회복지학전공": ["행정학과"], "전기공학부 - 디스플레이반도체공학전공": ["융합디스플레이공학과"], "시스템경영·안전공학부 - 기술·데이터공학전공": ["시스템경영공학부 - 기술·서비스공학전공"], "지구환경시스템과학부 - 환경지질과학전공": ["지구환경과학과"], "지구환경시스템과학부 - 위성정보융합공학전공": ["공간정보시스템공학과"], "미디어커뮤니케이션학부 - 언론정보전공": ["신문방송학과"], "데이터정보과학부 - 통계·데이터사이언스전공": ["통계학과"], "경제학부 - 자원환경경제학전공 (2021학년도 이전 입학자)": ["해양수산경영경제학부 - 자원환경경제학전공", "해양수산경영경제학부"], "미래융합학부 - 평생교육·상담학전공": ["융합인재개발학부 - 평생교육·상담학전공", "융합인재개발학부", "평생교육·상담학과"], "미래융합학부 - 경찰범죄심리학전공": ["융합인재개발학부 - 경찰범죄심리학전공", "융합인재개발학부", "공공안전경찰학과"], "미래융합학부 - 사회복지서비스학전공": ["융합인재개발학부 - 사회복지서비스학전공", "융합인재개발학부"], "미래융합학부 - 기계조선공조공학전공": ["스마트융합공학부 - 스마트기계모빌리티전공", "스마트융합공학부", "융합공학부", "기계조선융합공학과"], "미래융합학부 - 전기전자SW공학전공": ["스마트융합공학부 - 스마트전기전자공학전공", "스마트융합공학부", "융합공학부", "전기전자소프트웨어공학과"], "글로벌비즈니스트랙": ["글로벌자율전공학부(글로벌비즈니스트랙)", "글로벌자율전공학부"], "글로벌매니지먼트·거버넌스트랙": ["글로벌자율전공학부(글로벌매니지먼트·거버넌스트랙)", "글로벌자율전공학부"]};
const PAST_DOCS = [[2025, "전공교육과정 편성 안내서", "https://www.pknu.ac.kr/upload/media/2025/03/11/ac1a35e9-ca09-43aa-ba23-bae4f9a5f91f.pdf"], [2025, "교양교육과정 편성 안내서", "https://www.pknu.ac.kr/upload/media/2025/03/11/a87ab7ab-dfff-4799-a1c4-914a62f6f93f.pdf"], [2025, "다전공(융합·학생설계·마이크로전공) 교육과정 안내", "https://www.pknu.ac.kr/upload/media/2025/03/11/0b01a2b7-164b-4620-b642-b7a84519b932.pdf"], [2025, "전공 능력 강화 로드맵 및 모듈형 교육과정 안내서", "https://www.pknu.ac.kr/upload/media/2025/03/11/0ebc6714-a467-4d5c-aa1c-378c7b24c8b9.pdf"], [2024, "전공교육과정", "https://www.pknu.ac.kr/upload/media/2024/03/07/3013e4eb-229b-457b-bacd-70144da006f4.pdf"], [2024, "교양교육과정", "https://www.pknu.ac.kr/upload/media/2024/03/07/947cc149-e076-4595-8674-1af2db85da98.pdf"], [2024, "교육과정 편성 및 운영 지침", "https://www.pknu.ac.kr/upload/media/2024/03/07/0233ff34-12d7-4f2e-8fce-9c404845b90e.pdf"], [2024, "전공 능력 강화 로드맵 및 모듈형 교육과정 안내서", "https://www.pknu.ac.kr/upload/media/2024/03/07/2397f0df-28b9-426f-ab5a-464071670be8.pdf"], [2023, "교양교육과정", "https://www.pknu.ac.kr/upload/media/2023/02/27/976cd3f5-a7cb-479c-9dc1-b099488b6583.pdf"], [2023, "교육과정 편성 및 운영 지침", "https://www.pknu.ac.kr/upload/media/2023/02/27/f2164870-7086-4c05-aa7e-a38d4616bda6.pdf"], [2023, "전공 능력 강화 로드맵 및 모듈형 교육과정 안내서", "https://www.pknu.ac.kr/upload/media/2023/02/27/2ca6917a-927c-47f9-b2ca-0b7e2987f4a1.pdf"], [2022, "교양교육과정", "https://www.pknu.ac.kr/upload/media/2022/03/02/e1af7f50-9329-441c-8d9b-bdfd540a48b8.pdf"], [2022, "교육과정 편성 및 운영 지침", "https://www.pknu.ac.kr/upload/media/2021/10/22/6a7c063f-e1ad-4a8d-8126-561c0b0d8839.pdf"], [2022, "전공 능력 강화 로드맵 및 모듈형 교육과정 안내서", "https://www.pknu.ac.kr/upload/media/2022/03/02/9b415dee-4655-4775-953f-d2064e085c81.pdf"], [2021, "교양교육과정", "https://www.pknu.ac.kr/upload/media/2021/03/17/ec7bc82a-818e-407e-b0d1-453e7c29ed4a.pdf"], [2021, "교육과정 편성 및 운영 지침", "https://www.pknu.ac.kr/upload/media/2021/04/16/df76a2d5-4c32-4057-b080-89e470f1bad0.pdf"], [2021, "전공 능력 강화 로드맵 및 모듈형 교육과정 안내서", "https://www.pknu.ac.kr/upload/media/2021/04/16/eae84eda-58bc-4acb-b05e-34123408fb23.pdf"]];
const GRAD_GUIDE = "https://www.pknu.ac.kr/main/238";
function matchEntry(entries, picked) {
  const by = (n) => entries.find((e) => e.name === n);
  if (by(picked)) return by(picked);
  const base = picked.replace(/\s*\(\d{4}학년도 이전 입학자\)/, "").trim();
  if (by(base)) return by(base);
  const fac = base.split(" - ")[0].trim(), major = base.includes(" - ") ? base.split(" - ").slice(1).join(" - ").trim() : base;
  if (fac !== base && by(fac)) return by(fac);
  const st = entries.find((e) => sameDept(e.name.includes(" - ") ? e.name.split(" - ").slice(1).join(" - ").trim() : e.name, major));
  if (st) return st;
  for (const old of RENAMED[picked] || []) if (by(old)) return by(old);
  return entries.find((e) => e.name.startsWith(fac + " - ")) || null;
}
const pageLabel = (e) => (e.start === e.end ? `${e.start}쪽` : `${e.start}~${e.end}쪽`);
function gradLine(d) {
  const out = [`졸업 ${d.total}`];
  if (d.gyo != null) out.push(`교양 ${d.gyo}${d.gyoMax > d.gyo ? `~${d.gyoMax}` : ""}`);
  if (d.major != null) out.push(`전공 ${d.major}${d.majorReq != null ? `(필수 ${d.majorReq})` : ""}`);
  if (d.free != null) out.push(`자유선택 ${d.free}`);
  if (d.first != null || d.double != null) out.push(`복수전공 시 제1전공 ${d.first ?? "-"} / 복수 ${d.double ?? "-"}`);
  return out.join(" · ");
}

routes.curriculum = {
  title: "교육과정", sub: true, tab: "more",
  html() { return '<div id="cuv"><div class="empty">불러오는 중…</div></div>'; },
  async after() {
    let ci, cy = { docs: [] }, gd = null;
    try { ci = await load("static/curriculum_index"); } catch { return; }
    try { cy = await load("static/curriculum_years"); } catch {}
    try { gd = await load("static/grad_requirements"); } catch {}
    if (current !== "curriculum") return;
    const p = profile();
    const years = [...new Set([2026, ...cy.docs.map((d) => d.year)])].sort((a, b) => b - a);
    const gyears = gd ? Object.keys(gd.years).map(Number).sort((a, b) => b - a) : [];
    let year = years.includes(p?.year) ? p.year : years[0];
    let gyear = gyears.includes(p?.year) ? p.year : gyears[0];
    const link = (url, page, label) => `<a class="btn small ghost" href="${esc(url)}#page=${page}" target="_blank" rel="noopener">${label}</a>`;
    const draw = () => {
      const picked = new Set(store.get("curriculum", []));
      const curDoc = cy.docs.find((d) => d.year === year && d.kind === "curriculum"), roadDoc = cy.docs.find((d) => d.year === year && d.kind === "roadmap");
      const mine = ci.entries.filter((e) => picked.has(e.name)).map((e) => {
        const cur = year === 2026 ? e : curDoc && matchEntry(curDoc.entries, e.name);
        const road = roadDoc && matchEntry(roadDoc.entries, e.name);
        // 2026 로드맵 장은 2026 안내서 안에 있다. 2021~2023은 로드맵 문서가 교육과정도 겸한다
        const roadUrl = year === 2026 ? ci.pdfUrl : roadDoc?.pdfUrl;
        return `<div class="row"><div class="grow"><div>${esc(e.name)}</div><div class="btns" style="margin-top:4px">
          ${cur ? link(year === 2026 ? ci.pdfUrl : curDoc.pdfUrl, cur.start, `교육과정 ${pageLabel(cur)}`) : ""}
          ${road ? link(roadUrl, road.start, `${cur ? "로드맵" : "교육과정·로드맵"} ${pageLabel(road)}`) : ""}
          ${!cur && !road ? `<span class="sub">${year}학년도 문서에서 못 찾았어요 — 아래 지난 교육과정에서 전체를 보세요</span>` : ""}</div></div>
          <button class="star on" data-cu="${esc(e.name)}">★</button></div>`;
      }).join("");
      const q = ($("#cuq")?.value || "").trim();
      const groups = {};
      ci.entries.filter((e) => !q || e.name.includes(q) || e.college.includes(q)).forEach((e) => (groups[e.college || "기타"] ||= []).push(e));
      const gq = ($("#gq")?.value || "").trim();
      const grows = gd ? (gd.years[gyear] || []).filter((d) => !gq || d.name.includes(gq)) : [];
      const ggroups = {};
      grows.forEach((d) => (ggroups[d.college || "기타"] ||= []).push(d));
      const sel = (id, list, cur, fmt) => `<select id="${id}" style="width:auto;margin:0">${list.map((y) => `<option value="${y}" ${y === cur ? "selected" : ""}>${fmt(y)}</option>`).join("")}</select>`;
      $("#cuv").innerHTML = `<section class="card"><h2>내 학과 ${sel("cuy", years, year, (y) => `${y}학년도${y === 2026 ? " (올해)" : ""}`)}</h2>
          ${mine || '<div class="empty">아래 목록에서 ☆를 눌러 학과를 담으면 학년도별 교육과정·로드맵 쪽이 바로 열려요</div>'}
          <p class="note">입학한 해의 교육과정을 보려면 학년도를 바꿔요. 아이폰은 쪽 번호를 직접 넘겨야 할 수 있어요.</p></section>
        <section class="card"><h2>입학연도별 졸업소요학점 ${gd ? sel("gy", gyears, gyear, (y) => `${y}학년도 입학`) : ""}</h2>
          <input type="search" id="gq" placeholder="학과 이름으로 찾기" value="${esc(gq)}">
          ${Object.entries(ggroups).map(([col, list]) => `<div class="sub" style="margin-top:8px"><b>${esc(col)}</b></div>` + list.map((d) => `<div class="row"><div class="grow">${esc(d.name)}<div class="sub">${gradLine(d)}</div></div></div>`).join("")).join("") || '<div class="empty">없어요</div>'}
          <p class="note">2009학년도 이전 입학자 — 1998 이전: 졸업 140 · 교양 40 이상(구 공업대학교 34) · 전공 55 이상 / 1999~2000: 졸업 140 · 교양 35~70 · 전공 60 이상 / 2001~2009: 학부(과)별로 달라요.
            원문: <a href="${GRAD_GUIDE}" target="_blank" rel="noopener">졸업요건 안내자료 (2026. 2.)</a></p></section>
        <section class="card"><h2>지난 교육과정 문서</h2>${PAST_DOCS.map(([y, t, u]) => `<a class="row" href="${esc(u)}" target="_blank" rel="noopener" style="color:inherit"><div class="grow">${y}학년도 ${esc(t)}</div><span class="sub">PDF ›</span></a>`).join("")}
          <a class="row" href="https://www.pknu.ac.kr/main/106" target="_blank" rel="noopener" style="color:inherit"><div class="grow">학교 교육과정 페이지 (2026 전자책·전체 PDF)</div><span class="sub">›</span></a></section>
        <details class="card" ${!picked.size || q ? "open" : ""}><summary><b>학과 목록 (2026)</b> — ☆로 내 학과 담기</summary>
        <input type="search" id="cuq" placeholder="학과 이름 검색" value="${esc(q)}">
        <section>${Object.entries(groups).map(([col, list]) => `<h2>${esc(col)}</h2>` + list.map((e) => `<div class="row">
          <a class="grow" href="${esc(ci.pdfUrl)}#page=${e.start}" target="_blank" rel="noopener" style="color:inherit">${esc(e.name)}<div class="sub">2026 · ${pageLabel(e)}</div></a>
          <button class="star ${picked.has(e.name) ? "on" : ""}" data-cu="${esc(e.name)}">${picked.has(e.name) ? "★" : "☆"}</button></div>`).join("")).join("") || '<div class="empty">없어요</div>'}</section></details>`;
      $("#cuy").onchange = (e) => { year = +e.target.value; draw(); };
      $("#gy") && ($("#gy").onchange = (e) => { gyear = +e.target.value; draw(); });
      const keep = (id) => { const el = $(id); el.oninput = () => { draw(); const n = $(id); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }; };
      keep("#cuq"); keep("#gq");
    };
    $("#cuv").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cu]");
      if (!b) return;
      const s = new Set(store.get("curriculum", []));
      if (!s.delete(b.dataset.cu)) s.add(b.dataset.cu);
      store.set("curriculum", [...s]); draw();
    });
    draw();
  },
};
