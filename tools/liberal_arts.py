# 강의편람의 균형교양 영역·역량표(교양교육과정 안내). 과목마다 공식 영역(인간문화·사회역사·자연과학기술)과
# 역량(주도적 사고 등 6개 중 하나)이 정해져 있고, 졸업요건(영역별·역량별 1과목 이상)이 이 분류를 따른다.
# 과목 목록(courses/<학기>.json)의 area·comp 칸을 이걸로 채운다 — 앱·웹 과목 검색의 영역·역량 필터.
#   python liberal_arts.py courses     이미 만든 학기 파일들의 area·comp만 다시 채운다(강의계획서는 다시 안 받는다)
import io, json, os, re, sys
import pdfplumber, requests

UA = {"User-Agent": "Mozilla/5.0 (pknu-notice liberal-arts)"}
PAGE = "https://www.pknu.ac.kr/main/28"  # 강의편람 — 최신 학기 PDF 하나가 걸려 있다


def key(name):  # 편람과 이루미가 띄어쓰기·괄호를 다르게 적는다("사회봉사(Ⅱ)", "취업프로그램I")
    return re.sub(r"[\s()（）·]", "", name).replace("I", "Ⅰ") if name else ""


def fetch_pdf():
    h = requests.get(PAGE, headers=UA, timeout=30).text
    no = re.search(r'class="[^"]*uploadPdf[^"]*"[^>]*data-id="(\d+)"|data-id="(\d+)"[^>]*class="[^"]*uploadPdf[^"]*"', h)
    no = no.group(1) or no.group(2)
    path = requests.post("https://www.pknu.ac.kr/common/getMdaId.do", data={"no": no}, headers=UA, timeout=30).json()["response"].strip()
    return requests.get("https://www.pknu.ac.kr/upload/" + path, headers=UA, timeout=120).content


# {과목 키: (영역, 역량)}. 표는 영역·역량 칸이 위 칸과 합쳐져 있어 빈 칸이면 앞 줄 값을 이어 쓴다(쪽을 넘어가도).
def parse(pdf_bytes):
    out, area, comp = {}, "", ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or [c or "" for c in table[0]][:4] != ["구분", "영역", "역량", "과목명"]:
                    continue
                for row in table[1:]:
                    cells = [(c or "").strip() for c in row] + [""] * 5
                    if cells[1]:
                        area = cells[1].replace("\n", "").replace(" ", "").replace("-", "")  # 필수교양은 영역 없이 역량만
                    if cells[2]:
                        comp = cells[2].replace("\n", " ")
                    # 과목명은 ", "로 나뉘고, 줄바꿈은 이름 중간에도 생긴다("대학생을위한\n생활습관의학")
                    names = cells[3].replace(",\n", ", ").replace("\n", "")
                    for n in re.split(r",\s+", names):
                        n = n.strip().strip(",").strip()  # 쪽 끝 칸은 "해양과민속,"처럼 쉼표로 끝난다
                        if n and comp:
                            out[key(n)] = (area, comp)
    return out


def label(table, name):
    return table.get(key(name), ("", ""))


_table = None


# 수집기(make_rooms_json.py)가 쓴다. 편람을 못 받으면 빈 표 — 그 학기 파일은 영역·역량 없이 나간다.
def table_once():
    global _table
    if _table is None:
        try:
            _table = parse(fetch_pdf())
            print(f"강의편람 균형·필수교양 {len(_table)}과목", flush=True)
        except Exception as e:
            print("강의편람 못 받음:", e, flush=True)
            _table = {}
    return _table


def relabel(out_dir):
    import glob
    table = parse(fetch_pdf())
    print(f"강의편람 균형교양 {len(table)}과목", flush=True)
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        d = json.load(open(path, encoding="utf-8"))
        f = d["fields"]
        name_i = f.index("name")
        rows = [r[:len(f)] for r in d["rows"]]
        # comp(1.14.0 첫 수집 때는 강의계획서 값) → 편람 값으로, area는 새로
        f = [x for x in f if x not in ("comp", "area")]
        rows = [r[:len(f)] for r in rows]
        hit = 0
        for r in rows:
            a, c = label(table, r[name_i])
            hit += bool(a)
            r += [a, c]
        d["fields"], d["rows"] = f + ["area", "comp"], rows
        json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{d['term']}: 영역·역량 {hit}과목", flush=True)


if __name__ == "__main__":
    relabel(sys.argv[1] if len(sys.argv) > 1 else "courses")
