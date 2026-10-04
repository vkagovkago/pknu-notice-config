# 웹앱(아이폰 등)이 읽을 자료를 모은다. 브라우저는 학교 사이트를 직접 못 읽어서(CORS) GitHub Actions가
# 대신 받아 JSON으로 만들어 웹앱과 같이 올린다. 파서는 안드로이드 앱(NoticeRepository·MenuRepository·
# ScheduleRepository)을 그대로 옮겼다 — 학교가 사이트를 바꾸면 양쪽을 같이 고친다.
#
#   python tools/build_web_data.py <출력 폴더>
#
# 출력: notices.json, schedule.json, menu.json (+ 이 저장소의 shuttle.json·faq.json을 복사)
import datetime as dt
import json
import os
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(__file__))
import make_rooms_json as rooms  # 옛 암호 방식만 받는 학교 서버용 연결(LegacyTls)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PknuNoticeApp-web (unofficial student-made app)"
TIMEOUT = 25
HTTP = requests.Session()
HTTP.mount("https://", rooms.LegacyTls())
# Accept가 없으면 막는 서버가 있다(행복기숙사 식단 — 404를 돌려준다)
HTTP.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                     "Accept-Language": "ko-KR,ko;q=0.9"})
KST = dt.timezone(dt.timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ACADEMIC = {"id": "academic", "college": "본부", "name": "학사공지", "url": "https://www.pknu.ac.kr/main/163"}


def get_doc(url, data=None):
    for attempt in range(3):
        try:
            r = HTTP.post(url, data=data, timeout=TIMEOUT) if data else HTTP.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            if not r.encoding or r.encoding.lower() == "iso-8859-1":
                r.encoding = r.apparent_encoding
            return BeautifulSoup(r.text, "html.parser"), r.url
        except requests.RequestException:
            if attempt == 2:
                raise


# ---------------- 공지 ----------------
DATE = re.compile(r"\d{4}[.\-]\d{2}[.\-]\d{2}")


def norm_date(s):
    return s.strip().replace(".", "-")


def date_in_row(row):
    for td in row.find_all("td"):
        m = DATE.search(td.get_text(" ", strip=True))
        if m:
            return norm_date(m.group())
    return ""


def is_pinned(row):
    cls = row.get("class") or []
    if "noti" in cls or "notice" in cls:
        return True
    td = row.find("td")
    if not td:
        return False
    t = td.get_text(strip=True)
    return t in ("NOTICE", "공지") or (t == "" and td.find("img") is not None)


def text_of(el, drop=()):
    el = BeautifulSoup(str(el), "html.parser")
    for sel in drop:
        for x in el.select(sel):
            x.decompose()
    return el.get_text(" ", strip=True)


def p_action_view(doc, b, base):
    out = []
    for a in doc.select("td.bdlTitle a[href*='action=view']"):
        no = a["href"].split("no=")[-1].split("&")[0]
        row = a.find_parent("tr")
        if not no.isdigit() or row is None:
            continue
        d = row.select_one("td.bdlDate")
        out.append(dict(no=int(no), title=a.get_text(" ", strip=True), date=norm_date(d.get_text() if d else ""),
                        url=b["url"].split("?")[0] + f"?action=view&no={no}", pinned=is_pinned(row)))
    return out


def p_card_list(doc, b, base):
    out = []
    for li in doc.select("li"):
        a = li.find("a", recursive=False, href=re.compile("action=view"))
        if not a:
            continue
        no = a["href"].split("no=")[-1].split("&")[0]
        if not no.isdigit():
            continue
        p = a.find("p")
        title = (p.get_text(" ", strip=True) if p else a.get_text(" ", strip=True))
        if not title:
            continue
        m = DATE.search(li.get_text(" ", strip=True))
        out.append(dict(no=int(no), title=title, date=norm_date(m.group()) if m else "",
                        url=b["url"].split("?")[0] + f"?action=view&no={no}", pinned=False))
    return out


def p_href_param(param, drop=()):
    rx = re.compile(rf"[?&]{param}=(\d+)" if param == "pid" else rf"{param}=(\d+)")

    def parse(doc, b, base):
        out = []
        for a in doc.select(f"a[href*='{param}=']"):
            m = rx.search(a["href"])
            row = a.find_parent("tr")
            if not m or row is None:
                continue
            title = text_of(a, drop)
            if title:
                out.append(dict(no=int(m.group(1)), title=title, date=date_in_row(row),
                                url=urljoin(base, a["href"]), pinned=is_pinned(row)))
        return out
    return parse


def p_move_view(doc, b, base):
    out = []
    for a in doc.select("a[onclick*='moveView']"):
        m = re.search(r"moveView\('(\d+)'\)", a["onclick"])
        row = a.find_parent("tr")
        title = a.get_text(" ", strip=True)
        if m and row is not None and title:
            out.append(dict(no=int(m.group(1)), title=title, date=date_in_row(row),
                            url=b["url"] + f"&pgMode=View&idx={m.group(1)}", pinned=is_pinned(row)))
    return out


def p_go_content(doc, b, base):
    out = []
    for a in doc.select("a[href*='goContentPage']"):
        m = re.search(r"goContentPage\('BOAD_(\d+)", a["href"])
        row = a.find_parent("tr")
        title = text_of(a, ("b.btn_Type",))
        if not m or row is None or not title:
            continue
        cid = a["href"].split("goContentPage('")[1].split("'")[0]
        d = re.search(r"\b(\d{2})[.\-](\d{2})[.\-](\d{2})\b", row.get_text(" "))
        out.append(dict(no=int(m.group(1)), title=title, date=f"20{d.group(1)}-{d.group(2)}-{d.group(3)}" if d else "",
                        url=b["url"].replace("cmd=viewBoardList", "cmd=viewBoardContent") + f"&boardContentsId={cid}",
                        pinned=is_pinned(row)))
    return out


def p_open_window(doc, b, base):
    out = []
    for a in doc.select("a[href*='View_OpenWindow']"):
        m = re.search(r"View_OpenWindow\('(\d+)'\)", a["href"])
        li = a.find_parent("li")
        title = re.sub(r"\s*\.\.\.$", "", a.get_text(" ", strip=True))
        if not m or li is None or not title:
            continue
        d = DATE.search(li.get_text(" "))
        out.append(dict(no=int(m.group(1)), title=title, date=norm_date(d.group()) if d else "",
                        url=f"https://www.kcucon.or.kr/viewAnnounce.asp?seqNo={m.group(1)}", pinned=False))
    return out


def p_mode2(doc, b, base):
    # 공과대학(coe) CMS: ?menucode=...&mode=2&no=N
    out = []
    for a in doc.select("a[href*='mode=2'][href*='no=']"):
        m = re.search(r"[?&]no=(\d+)", a["href"])
        row = a.find_parent("tr")
        title = a.get_text(" ", strip=True)
        if m and row is not None and title:
            out.append(dict(no=int(m.group(1)), title=title, date=date_in_row(row),
                            url=urljoin(base, a["href"]), pinned=is_pinned(row)))
    return out


PARSERS = [p_action_view, p_card_list, p_href_param("idx"), p_move_view,
           p_href_param("pid", ("label", "span.new")), p_go_content, p_open_window, p_mode2]
CUTOFF = f"{dt.date.today().year - 2}-01-01"


def finalize(items):
    items = [i for i in items if i["pinned"] or not i["date"] or i["date"] >= CUTOFF]
    by_no = {}
    for i in items:
        if i["no"] not in by_no or i["pinned"]:
            by_no[i["no"]] = i
    return sorted(by_no.values(), key=lambda i: (i["pinned"], i["date"], i["no"]), reverse=True)


def fetch_board(b):
    try:
        doc, base = get_doc(b["url"])
        for parse in PARSERS:
            items = parse(doc, b, base)
            if items:
                return b, finalize(items)[:30], None
        return b, [], "목록을 읽지 못했어요"
    except Exception as e:  # 한 게시판이 죽어도 나머지는 만든다
        return b, None, type(e).__name__


def build_notices(prev):
    boards = [ACADEMIC] + json.load(open(os.path.join(ROOT, "boards.json"), encoding="utf-8"))["boards"]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(fetch_board, boards))
    out = {}
    for b, items, err in results:
        old = prev.get(b["id"], {})
        # 받기에 실패하면 지난번 목록을 그대로 둔다(빈 목록으로 덮으면 웹앱에서 공지가 사라진다)
        out[b["id"]] = dict(name=b["name"], college=b["college"], url=b["url"],
                            items=items if items is not None else old.get("items", []),
                            error=err)
    ok = sum(1 for _, items, _ in results if items)
    return out, ok, len(boards)


# ---------------- 학사일정 ----------------
def build_schedule():
    today = dt.date.today()
    events, seen = [], set()
    for off in range(-3, 6):
        y, m = today.year + (today.month - 1 + off) // 12, (today.month - 1 + off) % 12 + 1
        try:
            r = HTTP.post("https://www.pknu.ac.kr/getScheduleList.do", timeout=TIMEOUT,
                          data={"year": str(y), "month": f"{m:02d}", "day": "01", "action": "month", "steId": "IEav5ISH"})
            for o in r.json().get("list", []):
                s, t = (o.get("strDt") or "").strip(), re.sub(r"\s+", " ", (o.get("schNm") or "")).strip()
                if len(s) == 8 and t and (s, t) not in seen:
                    seen.add((s, t))
                    events.append(dict(start=s, end=(o.get("endDt") or "").strip() or s, title=t))
        except Exception as e:
            print("schedule", y, m, e)
    return sorted(events, key=lambda e: (e["start"], e["title"]))


# ---------------- 학식 ----------------
def monday_of_today():
    t = dt.datetime.now(KST).date()
    return t - dt.timedelta(days=t.weekday())


def match_in_week(monday, mo, d):
    for i in range(7):
        x = monday + dt.timedelta(days=i)
        if x.month == mo and x.day == d:
            return x.strftime("%Y%m%d")
    return None


MONTH_DAY = re.compile(r"(\d{1,2})\s*[월/]\s*(\d{1,2})")


def key_from_label(monday, label):
    m = MONTH_DAY.search(label)
    return match_in_week(monday, int(m.group(1)), int(m.group(2))) if m else None


GENERIC = {"레스토랑", "학생식당", "한식레스토랑", "양식레스토랑"}


def cafeteria_name(table):
    words = []
    for s in table.find_all_previous(string=True):
        t = s.strip()
        if len(t) > 1 and t not in GENERIC and not t.startswith(("*", "(", "■")):
            words.append(t)
        if len(words) == 2:
            break
    return " ".join(reversed(words)) or "교내 식당"


def menu_campus(monday):
    lst, _ = get_doc("https://www.pknu.ac.kr/main/399")
    posts = []
    for a in lst.select("td.bdlTitle a[href*='action=view']"):
        no = a["href"].split("no=")[-1].split("&")[0]
        m = re.search(r"(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})", a.get_text())
        if no.isdigit() and m:
            posts.append((no, dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
    target = next((p for p in posts if p[1] == monday), max(posts, key=lambda p: p[1], default=None))
    if not target:
        return []
    doc, _ = get_doc(f"https://www.pknu.ac.kr/main/399?action=view&no={target[0]}")
    body = doc.select_one("div.bdvTxt") or doc.select_one("td.bdvEdit")
    out = []
    for table in (body.find_all("table") if body else []):
        rows = table.find_all("tr")
        if len(rows) < 3 or not any("monday" in c.get_text().lower() for c in rows[0].find_all(["td", "th"])):
            continue
        dates = [c.get_text(" ", strip=True) for c in rows[1].find_all(["td", "th"])]
        meal = rows[2].find_all("td")
        if len(meal) < 2:
            continue
        name = meal[0].get_text().split("(")[0].strip() or "중식"
        labels = [dates[i - 1] if i - 1 < len(dates) else "" for i in range(1, min(6, len(meal)))]
        readable = any(MONTH_DAY.search(l) for l in labels)
        keys = [key_from_label(monday, l) for l in labels]
        if readable and all(k is None for k in keys):
            continue
        days = {}
        for i in range(1, min(6, len(meal))):
            dishes = [p.get_text(" ", strip=True) for p in meal[i].find_all("p") if p.get_text(strip=True)]
            key = keys[i - 1] or (None if readable else (monday + dt.timedelta(days=i - 1)).strftime("%Y%m%d"))
            if dishes and key:
                days[key] = [dict(name=name, dishes=dishes)]
        hours = meal[6].get_text(" ", strip=True) if len(meal) > 6 else ""
        out.append(dict(name=cafeteria_name(table), hours=hours, days=days))
    return out


def lines_of(td):
    return [x.strip() for x in td.get_text("\n").splitlines() if x.strip()]


def menu_dorm(monday):
    days = {}
    for week in (monday, monday + dt.timedelta(days=7)):
        vt = int(dt.datetime.combine(week, dt.time(), KST).timestamp())
        try:
            doc, _ = get_doc("https://dormitory.pknu.ac.kr/03_notice/req_getSchedule.php", data={"vt": str(vt), "bid": "foodE"})
        except Exception as e:
            print("dorm", e)
            continue
        rows = doc.select("table tr")
        if len(rows) < 2:
            continue
        headers = [c.get_text(" ", strip=True) for c in rows[0].find_all(["th", "td"])]
        n = len(headers) - 1
        for row in rows[1:]:
            cells = row.find_all("td")
            if n < 1 or len(cells) < n + 1:
                continue
            meal = cells[0].get_text(strip=True)
            first = len(cells) - n
            for i in range(n):
                key = key_from_label(monday, headers[i + 1])
                dishes = lines_of(cells[first + i])
                if key and meal and dishes:
                    days.setdefault(key, []).append(dict(name=meal, dishes=dishes))
    return [dict(name="세종 1,2관", hours="아침 07:30~09:00 · 점심 11:30~13:30 · 저녁 17:00~18:30", days=days)] if days else []


def menu_happy(monday):
    doc, _ = get_doc("https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/")
    week = {(monday + dt.timedelta(days=i)).strftime("%Y%m%d") for i in range(7)}
    days = {}
    for table in doc.select("table.table__week"):
        head = table.find("thead")
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", head.get_text() if head else "")
        if not m or (key := "".join(m.groups())) not in week:
            continue
        for row in table.select("tbody tr"):
            th = row.select_one("th.meal__PC")
            dishes = [x for td in row.select("td.meal__PC") for x in lines_of(td)]
            if dishes:
                days.setdefault(key, []).append(dict(name=(th.get_text(strip=True) if th else "") or "식사", dishes=dishes))
    return [dict(name="부경대행복기숙사", hours="조식 07:30~09:30 · 중식 11:30~14:00 · 석식 16:50~19:00", days=days)] if days else []


def build_menu():
    monday = monday_of_today()
    cafs = []
    for fn in (menu_campus, menu_dorm, menu_happy):
        try:
            cafs += fn(monday)
        except Exception as e:
            print("menu", fn.__name__, e)
    return dict(monday=monday.strftime("%Y%m%d"), cafeterias=[c for c in cafs if c["days"]])


# ---------------- 공휴일 (Google 공개 캘린더, 앱 Holidays.parseIcs와 같은 규칙) ----------------
HOLIDAY_ICS = "https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics"


def build_holidays():
    # ICS는 긴 줄을 "줄바꿈+공백"으로 접어 쓰므로 먼저 펼친다
    text = HTTP.get(HOLIDAY_ICS, timeout=TIMEOUT).text.replace("\r\n", "\n").replace("\n ", "")
    out = {}
    for ev in text.split("BEGIN:VEVENT")[1:]:
        def field(name):
            m = re.search(rf"(?m)^{name}[^:]*:(.*)$", ev)
            return m.group(1).strip() if m else None
        if not (field("DESCRIPTION") or "").startswith("공휴일"):
            continue
        start = dt.datetime.strptime(field("DTSTART")[:8], "%Y%m%d").date()
        end = dt.datetime.strptime(field("DTEND")[:8], "%Y%m%d").date() if field("DTEND") else start + dt.timedelta(days=1)
        d = start
        while d < end:
            out[d.strftime("%Y%m%d")] = field("SUMMARY") or "공휴일"
            d += dt.timedelta(days=1)
    return dict(sorted(out.items()))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "site/data"
    os.makedirs(out, exist_ok=True)
    prev_path = os.path.join(out, "notices.json")
    prev = json.load(open(prev_path, encoding="utf-8"))["boards"] if os.path.exists(prev_path) else {}
    now = dt.datetime.now(KST).isoformat(timespec="minutes")

    notices, ok, total = build_notices(prev)
    json.dump(dict(updated=now, boards=notices), open(prev_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(dict(updated=now, events=build_schedule()), open(os.path.join(out, "schedule.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    menu = build_menu()
    json.dump(dict(updated=now, **menu), open(os.path.join(out, "menu.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    try:
        json.dump(build_holidays(), open(os.path.join(out, "holidays.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    except Exception as e:  # 못 받으면 지난번 파일(있으면)을 그대로 쓴다
        print("holidays", e)
    for f in ("shuttle.json", "faq.json"):
        shutil.copy(os.path.join(ROOT, f), os.path.join(out, f))
    print(f"게시판 {ok}/{total}곳, 식당 {len(menu['cafeterias'])}곳")


if __name__ == "__main__":
    main()
