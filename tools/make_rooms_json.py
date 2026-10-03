# 빈 강의실 찾기(앱의 EmptyRoom)가 읽는 rooms.json을 만든다.
#
# 이루미 조회 API에는 강의실·요일·교시가 없고 강의계획서 원문에만 있다. 앱에서 과목마다
# 원문을 받으면 학기당 2,800번을 불러야 해서, 학기에 한 번 여기서 받아 공개 config 저장소
# (pknu-notice-config/rooms.json)에 올린다. 앱은 그 파일 하나만 받는다.
#
# 규칙은 앱과 같다:
#   강의시간 "화1 목1" / "수6,7,8"   → SyllabusTime.parse + runsOf
#   50분/75분 체계                   → Period.gridFor (주당시간/교시수 >= 1.25면 75분)
# 앱 코드(Timetable.kt)를 고치면 여기도 같이 고친다.
#
#   python tools/make_rooms_json.py 2026 U0003002 rooms.json
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import ssl

import requests
from requests.adapters import HTTPAdapter

IRUMI = "https://irumi.pknu.ac.kr/ezworks/noSessionController"
SERVICE = "https://reporting.pknu.ac.kr/ReportingServer/service"
EMBED = "https://reporting.pknu.ac.kr/ReportingServer/embed"
MRD_URL = "https://irumi.pknu.ac.kr/mrd/uni/cour/open/LtPdocMngtPrn.mrd"
DATA_SERVER = "https://reporting.pknu.ac.kr/DataServer/rdagent.jsp"
UA = "PknuNoticeApp-tools (rooms.json builder)"
SEASON_TAG = {"U0003001": "1", "U0003002": "2", "U0003003": "S", "U0003004": "W"}
DAYS = {"월": "MON", "화": "TUE", "수": "WED", "목": "THU", "금": "FRI", "토": "SAT", "일": "SUN"}
TOKEN = re.compile(r"([월화수목금토일])\s*((?:\d{1,2})(?:\s*,\s*\d{1,2})*)")
ROOM = re.compile(r"[A-Z]\d{1,2}-[A-Z]?\d{2,4}[A-Za-z]?")
TL = re.compile(r"<TL[^>]*>([^<]*)</TL>")
LABELS = {"강의시간", "강의실", "강의형태", "담당교수", "연구실", "상담시간", "연락처", "이메일", "학점-이론-실습"}


# 리포트 서버는 오래된 암호 방식만 받아서 파이썬 기본 설정(SECLEVEL 2)으로는 연결이 끊긴다.
# 이 서버에만 보안 수준을 한 단계 낮춘 연결을 쓴다(앱의 OkHttp는 그대로 붙는다).
class LegacyTls(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


REPORT = requests.Session()
REPORT.mount("https://reporting.pknu.ac.kr", LegacyTls())


def list_courses(year, term, grsc):
    params = {
        "_sqlId": "LtPdocInq.findLtPdocInq", "_method": "getList", "YY": str(year), "SHTM_CD": term,
        "UNIV_GRSC_CLSF": grsc, "COLG_CD": "", "OPEN_SUST_MJ_CD": "", "SBJT_NM": "", "STAFF_NM": "", "SBJ_FG": "",
    }
    ps = "\n".join(f'<Parameter id="{k}">{v}</Parameter>' if v else f'<Parameter id="{k}" />' for k, v in params.items())
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters>{ps}</Parameters>
<Dataset id="__DS_TRANS_INFO__"><ColumnInfo><Column id="strAction" type="string" size="256" /><Column id="strSvcID" type="string" size="256" /><Column id="strURL" type="string" size="256" /></ColumnInfo>
<Rows><Row><Col id="strAction">uni</Col><Col id="strSvcID">fn_search</Col><Col id="strURL">x</Col></Row></Rows></Dataset></Root>"""
    r = requests.post(IRUMI, data=body.encode(), timeout=60, headers={
        "Content-Type": "text/xml", "ezclienttype": "nexacro17", "X-Requested-With": "XMLHttpRequest", "User-Agent": UA})
    out = []
    for row in re.findall(r"<Row>(.*?)</Row>", r.text, re.S):
        col = lambda i: (re.search(r'<Col id="%s">([^<]*)' % i, row) or [0, ""])[1]
        if not col("STAFF_NO") or not col("COLG_NM"):  # 학점교류(KCU·OCU)는 강의실이 없다
            continue
        out.append({"no": col("COURSE_NO"), "cls": col("DCLSS_NO"), "staff": col("STAFF_NO"),
                    "credit": col("PNT_THEO_PRAC"), "name": col("SBJT_KOR_NM")})
    return out


def plan_info(year, term, c):
    in_param = f"('{c['no']}','{c['cls']}','{c['staff']}','U0253001')"
    mrd_param = (f"/rcontype [Data Server] /rf [{DATA_SERVER}] /rsn [jdbc/UniDS]\n"
                 f"/rv P_YY[{year}] P_SHTM_CD[{term}] P_IN_PARAM[{in_param}]\n"
                 f"/rp [{year}] [{term}] [{in_param}]")
    for attempt in range(3):
        try:
            r = REPORT.post(SERVICE, timeout=40, headers={"Referer": EMBED, "User-Agent": UA}, data={
                "opcode": "700", "mrd_path": MRD_URL, "mrd_param": mrd_param, "mrd_plain_param": "",
                "mrd_data": "", "runtime_param": "", "mmlVersion": "0", "protocol": "sync"})
            if len(r.text) < 300:
                return None
            cells = [t.strip() for t in TL.findall(r.text)]

            def after(label):
                if label not in cells:
                    return ""
                value = next((x for x in cells[cells.index(label) + 1:] if x), "")
                # 값이 비면 다음 칸이 곧바로 다음 라벨이다(원격수업은 강의실이 없다) — 앱과 같은 규칙
                return "" if value in LABELS else value
            return after("강의시간"), after("강의실")
        except requests.RequestException:
            time.sleep(2 * (attempt + 1))
    return None


def parse_blocks(text):
    blocks = []
    for m in TOKEN.finditer(text or ""):
        ps = sorted({int(p) for p in re.split(r"\s*,\s*", m.group(2)) if 1 <= int(p) <= 14})
        if ps:
            blocks.append((DAYS[m.group(1)], ps))
    return blocks


def runs(ps):
    out, start, prev = [], ps[0], ps[0]
    for p in ps[1:]:
        if p != prev + 1:
            out.append((start, prev))
            start = p
        prev = p
    out.append((start, prev))
    return out


def weekly_hours(credit):
    parts = [int(x) for x in credit.split("-") if x.strip().isdigit()]
    return parts[1] + parts[2] if len(parts) >= 3 else 0


def slots(blocks, credit):
    count = sum(len(ps) for _, ps in blocks)
    hours = weekly_hours(credit)
    seventy_five = hours > 0 and count > 0 and hours / count >= 1.25
    slot, lesson = (90, 75) if seventy_five else (60, 50)
    out = []
    for day, ps in blocks:
        for a, b in runs(ps):
            out.append((day, 540 + (a - 1) * slot, 540 + (b - 1) * slot + lesson))
    return out


# 날짜로 본 학기(앱의 Term.at과 같은 경계). 계절학기면 그다음 정규 학기도 후보로 준다 —
# 계절학기는 과목이 수십 개라 빈 강의실 자료로는 거의 쓸모가 없다.
def terms_by_date(today):
    y, md = today.year, today.month * 100 + today.day
    if md >= 1221:
        return [(y, "U0003004"), (y + 1, "U0003001")]
    if md >= 901:
        return [(y, "U0003002")]
    if md >= 621:
        return [(y, "U0003003"), (y, "U0003002")]
    if md >= 301:
        return [(y, "U0003001")]
    return [(y - 1, "U0003004"), (y, "U0003001")]


def build(year, term):
    courses = list_courses(year, term, "U0001001") + list_courses(year, term, "U0001002")
    print(f"{year} {term} 과목 {len(courses)}개", flush=True)
    rooms, done, used = {}, 0, 0

    def work(c):
        return c, plan_info(year, term, c)

    # 학교 서버에 몰아치지 않게 4개씩만 동시에 부른다
    with ThreadPoolExecutor(4) as pool:
        for c, info in pool.map(work, courses):
            done += 1
            if done % 200 == 0:
                print(f"{done}/{len(courses)}", flush=True)
            if not info:
                continue
            blocks = parse_blocks(info[0])
            names = ROOM.findall(info[1])
            if not blocks or not names:
                continue
            used += 1
            times = slots(blocks, c["credit"])
            # 강의실이 요일 수만큼 적혀 있으면 요일마다 짝짓고, 아니면 모든 시간에 모든 강의실을
            # 쓰는 것으로 본다 — 비어 있다고 잘못 알려주는 것보다 덜 알려주는 게 낫다
            for i, (day, start, end) in enumerate(times):
                targets = [names[i]] if len(names) == len(times) else names
                for room in targets:
                    rooms.setdefault(room, set()).add((day, start, end))
    return rooms, used


def main():
    # python make_rooms_json.py 2026 U0003002 rooms.json   (학기를 직접 고름)
    # python make_rooms_json.py auto rooms.json            (날짜로 학기를 고름 — GitHub Actions용)
    if sys.argv[1] == "auto":
        dst = sys.argv[2]
        from datetime import datetime, timedelta, timezone
        today = datetime.now(timezone(timedelta(hours=9))).date()
        for year, term in terms_by_date(today):
            rooms, used = build(year, term)
            if len(rooms) >= 50:
                break
            print(f"{year} {term}: 강의실 {len(rooms)}곳뿐이라 다음 후보로", flush=True)
    else:
        year, term, dst = int(sys.argv[1]), sys.argv[2], sys.argv[3]
        rooms, used = build(year, term)
    # 앱은 50곳 미만이면 수집 실패로 보고 버린다 — 그런 파일로 멀쩡한 걸 덮지 않는다
    if len(rooms) < 50:
        print(f"강의실 {len(rooms)}곳뿐이라 저장하지 않음")
        sys.exit(1)
    data = {
        "version": 1,
        "term": f"{year}-{SEASON_TAG[term]}",
        "generated": date.today().isoformat(),
        "courses": used,
        "rooms": {k: sorted([list(t) for t in v]) for k, v in sorted(rooms.items())},
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"강의실 {len(rooms)}곳, 시간 읽은 과목 {used}개 → {dst}")


if __name__ == "__main__":
    main()
