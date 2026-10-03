# 앱이 기대는 학교·외부 데이터가 지금도 예전 모양으로 오는지 매일 확인한다(GitHub Actions).
#
# 학교가 홈페이지를 바꾸면 앱 기능이 조용히 깨진다 — 사용자가 "안 돼요"라고 해야 알았다. 여기서
# 하나라도 깨지면 실패로 끝나고, GitHub가 저장소 주인에게 메일을 보낸다. 결과 표는 Actions 실행
# 화면의 Summary에 남는다.
#
#   python tools/health_check.py boards.json
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

sys.path.insert(0, os.path.dirname(__file__))
import make_rooms_json as rooms  # 이루미·리포트 서버 부르는 코드를 같이 쓴다

UA = "PknuNoticeApp-healthcheck"
TIMEOUT = 30
# 학교 서버 몇 곳(도서관·일부 학과)은 옛 암호 방식만 받아 파이썬 기본 설정으로는 끊긴다(앱은 열린다).
# 리포트 서버와 같은 완화 연결을 모든 요청에 쓴다.
HTTP = requests.Session()
HTTP.mount("https://", rooms.LegacyTls())


def get(url, **kw):
    return HTTP.get(url, timeout=TIMEOUT, headers={"User-Agent": UA}, **kw)


def check_irumi():
    year, term = rooms.terms_by_date(__import__("datetime").date.today())[-1]
    cs = rooms.list_courses(year, term, "U0001001")
    assert len(cs) > 500, f"과목 {len(cs)}개"
    return f"{year} {term} 과목 {len(cs)}개", (year, term, cs)


def check_report(ctx):
    year, term, cs = ctx
    for c in cs[:20]:
        info = rooms.plan_info(year, term, c)
        if info and info[0]:
            return f"{c['name']}: {info[0]} / {info[1] or '강의실 없음'}"
    raise AssertionError("강의계획서 20개에서 강의시간을 못 읽음")


def check_schedule():
    r = HTTP.post("https://www.pknu.ac.kr/getScheduleList.do", timeout=TIMEOUT, headers={"User-Agent": UA},
                      data={"year": "2026", "month": "03", "day": "01", "action": "month", "steId": "IEav5ISH"})
    n = len(r.json().get("list", []))
    assert n > 0, "일정 0건"
    return f"3월 일정 {n}건"


def check_notice():
    t = get("https://www.pknu.ac.kr/main/163").text
    n = len(set(re.findall(r"action=view[^\"']*no=(\d+)", t)))
    assert n >= 5, f"글 링크 {n}개"
    return f"학사공지 글 {n}개"


def check_menu():
    t = get("https://www.pknu.ac.kr/main/399").text
    assert "<table" in t, "식단표 표 없음"
    return "식단표 있음"


def check_campus_map():
    r = HTTP.post("https://www.pknu.ac.kr/buildingInfoAjax.do", timeout=TIMEOUT,
                      headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": "https://www.pknu.ac.kr/main/133"},
                      data={"code": "B0000001", "stat": "D"})
    n = len(r.json()["response"]["deps1"])
    assert n > 20, f"건물 {n}곳"
    return f"대연 건물 {n}곳"


def check_kcu():
    t = get("https://www.kcucon.or.kr/openlecture/openlecture_1.asp").content.decode("cp949", "ignore")
    n = len(re.findall(r"Coursecode=", t))
    assert n >= 10, f"과목 {n}개"
    return f"KCU 과목 링크 {n}개"


def check_ocu():
    t = get("https://cons.ocu.ac.kr/home/mainHome/Form/main").text
    assert re.search(r"creLectForm\?termCd=TERM_", t), "개설과목 링크 없음"
    return "OCU 개설과목 링크 있음"


def check_holidays():
    t = get("https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics").text
    n = t.count("DESCRIPTION:공휴일")
    assert n >= 10, f"공휴일 {n}개"
    return f"공휴일 {n}개"


def check_boards(path):
    boards = json.load(open(path, encoding="utf-8"))["boards"]

    def one(b):
        try:
            r = get(b["url"])
            return b, r.status_code == 200 and len(r.text) > 2000, r.status_code
        except requests.RequestException as e:
            return b, False, type(e).__name__
    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(one, boards))
    bad = [(b["name"], code) for b, ok, code in results if not ok]
    # 학과 서버 한두 곳이 잠깐 안 되는 일은 흔하다 — 5곳 넘게 안 될 때만 실패로 본다
    assert len(bad) <= 5, f"{len(bad)}곳 안 열림: " + ", ".join(f"{n}({c})" for n, c in bad[:10])
    return f"{len(boards) - len(bad)}/{len(boards)}곳 열림" + (" · 안 열림: " + ", ".join(n for n, _ in bad) if bad else "")


def main():
    results, ctx = [], None
    checks = [
        ("이루미 강의계획서 조회", lambda: check_irumi()),
        ("리포트 서버(강의시간·강의실)", None),
        ("학사일정", check_schedule),
        ("학사공지 게시판", check_notice),
        ("학식", check_menu),
        ("캠퍼스맵", check_campus_map),
        ("KCU 공동과목", check_kcu),
        ("OCU 컨소시엄", check_ocu),
        ("공휴일(Google)", check_holidays),
        ("학과 게시판", lambda: check_boards(sys.argv[1] if len(sys.argv) > 1 else "boards.json")),
    ]
    for name, fn in checks:
        try:
            if name.startswith("이루미"):
                msg, ctx = fn()
            elif name.startswith("리포트"):
                assert ctx, "이루미 조회가 실패해 확인 못 함"
                msg = check_report(ctx)
            else:
                msg = fn()
            results.append((name, True, msg))
        except Exception as e:  # 어느 하나가 깨져도 나머지는 계속 본다
            results.append((name, False, f"{type(e).__name__}: {e}"))

    lines = ["| 확인 | 결과 | 내용 |", "|---|---|---|"] + [f"| {n} | {'✅' if ok else '❌'} | {m} |" for n, ok, m in results]
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## 부경대 공지알리미 데이터 확인\n\n" + "\n".join(lines) + "\n")
    sys.exit(0 if all(ok for _, ok, _ in results) else 1)


if __name__ == "__main__":
    main()
