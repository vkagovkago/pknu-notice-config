# 자료실 PDF의 글자 색인(앱 PdfTextIndex, 문서 안 단어 찾기). 쪽마다 낱말과 위치(쪽 크기 비율)를 뽑아
# docindex/<파일이름>.idx.gz로 둔다. 휴대폰에서 882쪽짜리 PDF를 직접 읽으면 메모리가 모자라서 여기서 미리 한다.
# 글자가 거의 없는(그림뿐인) 쪽은 여기서 그림으로 그려 글자 인식(OCR, tesseract 한국어)을 한다 — 웹앱도 찾을 수 있게,
# 앱은 휴대폰에서 1분씩 읽지 않게. OCR을 못 하는 환경이면(tesseract 없음) 그 쪽은 비워 두고 앱이 기기에서 한다.
#   python make_doc_index.py docindex            자료실 문서 + 지난 교육과정·졸업요건 안내자료
# 이미 만든 색인은 PDF 크기가 같으면 건너뛴다(FORCE=1이면 다시).
import gzip, io, json, os, re, sys
import pdfplumber, requests
from bs4 import BeautifulSoup

try:
    import pytesseract
    pytesseract.get_tesseract_version()
except Exception:  # 내 PC처럼 tesseract가 없으면 OCR 없이(예전처럼) 만든다
    pytesseract = None

# 색인 둘째 줄의 표시. 이게 있어야 "그림 쪽까지 OCR한 색인"이다 — 없으면 PDF가 그대로여도 다시 만든다.
# 앱(PdfTextIndex)과 웹앱은 칸이 6개가 안 되는 줄을 건너뛰므로 이 줄을 무시한다.
OCR_MARK = "#ocr1"
# 앱 PdfTextIndex와 같은 기준: 쪽 글자가 이보다 적으면 그림으로 본다
MIN_TEXT = 20


# 쪽을 그림으로 그려(200dpi) 낱말과 위치를 읽는다. 앱의 ML Kit 결과와 같은 모양(쪽 크기 비율)으로.
def ocr_words(page, i):
    img = page.to_image(resolution=200).original
    width, height = img.size
    d = pytesseract.image_to_data(img, lang="kor+eng", output_type=pytesseract.Output.DICT)
    out = []
    for k, t in enumerate(d["text"]):
        t = re.sub(r"\s+", " ", t or "").strip()
        try:
            conf = float(d["conf"][k])
        except (TypeError, ValueError):
            conf = -1
        if not t or conf < 40:  # 알아보기 힘든 조각은 버린다(찾을 때 엉뚱한 쪽이 걸리지 않게)
            continue
        x, y, w, h = d["left"][k], d["top"][k], d["width"][k], d["height"][k]
        out.append(f"{i}\t{x / width:.4f}\t{y / height:.4f}\t{w / width:.4f}\t{h / height:.4f}\t{t}")
    return out

UA = {"User-Agent": "Mozilla/5.0 (pknu-notice docindex)"}
# (분류, 페이지, 최근 학년도만) — 앱 CampusDocRepository.SOURCES와 같다
SOURCES = [("교육과정", "https://www.pknu.ac.kr/main/27", False), ("대학생활 가이드", "https://www.pknu.ac.kr/main/434", True),
           ("강의편람", "https://www.pknu.ac.kr/main/28", False), ("비교과", "https://www.pknu.ac.kr/main/362", False)]
# 앱 PastCurriculum.kt의 문서들과 졸업요건 안내자료(main/238이 PDF를 바로 준다)
EXTRA = ["https://www.pknu.ac.kr/main/238"]


def file_name(url):  # 앱 CampusDoc.fileName과 같게
    return re.sub(r"[^A-Za-z0-9._-]", "_", url.rsplit("/", 1)[-1])[:120]


def media_url(data_id):
    r = requests.post("https://www.pknu.ac.kr/common/getMdaId.do", data={"no": data_id}, headers=UA, timeout=30).json().get("response", "").strip()
    return "https://www.pknu.ac.kr/upload/" + r if r.lower().endswith(".pdf") else None


def clean_title(text):  # "2026-1학기 강의편람(PDF) 보기" -> "2026-1학기 강의편람"
    t = re.sub(r"\s+", " ", text.replace("ebook 바로가기", "").replace("PDF 다운로드", "").replace("(PDF)", "")).strip()
    return t[:-2].strip() if t.endswith("보기") else t


# 자료실 문서 목록(제목·분류) — 앱 CampusDocRepository.fetch를 옮긴 것. 웹앱 자료실이 docs.json으로 쓴다.
def titled_docs():
    docs = []
    for label, page, latest_only in SOURCES:
        try:
            soup = BeautifulSoup(requests.get(page, headers=UA, timeout=30).text, "html.parser")
        except requests.RequestException as e:
            print("목록 실패", page, e, flush=True)
            continue
        body = soup.select_one(".content_wrap") or soup.body
        section, pending, found = "", [], []
        for el in body.select("h4, li, div.uploadPdf[data-id]"):
            if el.name == "h4":
                section, pending = el.get_text(" ", strip=True), []
            elif el.name == "li":
                if el.find(["ul", "ol"]):  # 목록 안 목록(비교과) — 바깥 li는 안내문 전체다
                    continue
                title = clean_title(el.get_text(" ", strip=True))
                if not title:
                    continue
                direct = next((a["href"] for a in el.select("a[href]") if ".pdf" in a["href"].lower()), None)
                if direct:
                    found.append((section, title, requests.compat.urljoin(page, direct)))
                elif "보기" in el.get_text():
                    pending.append(title)
            elif pending:
                title = pending.pop(0)
                try:
                    url = media_url(el["data-id"])
                except Exception:
                    url = None
                if url:
                    found.append((section, title, url))
        if latest_only:  # 대학생활 가이드는 지난 학년도 문서도 다 있다 — 가장 최근 학년도만
            years = [int(m.group(1)) for sec, _, _ in found if (m := re.search(r"(\d{4})학년도", sec))]
            if years:
                found = [f for f in found if (m := re.search(r"(\d{4})학년도", f[0])) and int(m.group(1)) == max(years)]
        docs += [{"title": t, "desc": label, "url": u, "file": file_name(u)} for _, t, u in found if u.startswith("https://www.pknu.ac.kr/")]
    return list({d["url"]: d for d in docs}.values())


def doc_urls(docs):
    urls = [d["url"] for d in docs]
    kt = os.path.join(os.path.dirname(__file__), "past_curriculum.txt")
    if os.path.exists(kt):
        urls += [l.strip() for l in open(kt, encoding="utf-8") if l.strip().startswith("http")]
    return list(dict.fromkeys(urls + EXTRA))


def rows_of(pdf_bytes):
    out = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            w, h = float(page.width), float(page.height)
            try:
                # 낱말 단위로 둔다 — 줄 단위면 표처럼 칸이 벌어진 줄에서 찾은 글자 위치를 못 잡는다(앱이 같은 줄 낱말을 다시 잇는다)
                lines = page.extract_words(keep_blank_chars=False, use_text_flow=False)
            except Exception as e:  # 깨진 쪽은 비워 둔다(앱이 OCR)
                print(f"  {i + 1}쪽 실패: {e}", flush=True)
                lines = []
            words = []
            for l in lines:
                t = re.sub(r"\s+", " ", l["text"]).strip()
                if not t:
                    continue
                words.append(f"{i}\t{l['x0'] / w:.4f}\t{l['top'] / h:.4f}\t{(l['x1'] - l['x0']) / w:.4f}\t{(l['bottom'] - l['top']) / h:.4f}\t{t}")
            if pytesseract and sum(len(x.rsplit("\t", 1)[-1]) for x in words) < MIN_TEXT:
                try:
                    got = ocr_words(page, i)
                    if got:
                        words = got
                        print(f"  {i + 1}쪽 OCR 낱말 {len(got)}", flush=True)
                except Exception as e:
                    print(f"  {i + 1}쪽 OCR 실패: {e}", flush=True)
            out += words
            page.flush_cache()
    return out


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    docs = titled_docs()
    for url in doc_urls(docs):
        path = os.path.join(out_dir, file_name(url) + ".idx.gz")
        try:
            r = requests.get(url, headers=UA, timeout=600)
            r.raise_for_status()
        except requests.RequestException as e:
            print("받기 실패", url, e, flush=True)
            continue
        size = str(len(r.content))
        if os.path.exists(path) and os.environ.get("FORCE") != "1":
            with gzip.open(path, "rt", encoding="utf-8") as f:
                same = f.readline().strip() == size
                marked = f.readline().strip() == OCR_MARK
            # OCR을 못 하는 환경에서는 표시 없이도 그대로 둔다(OCR 색인을 OCR 없는 색인으로 덮지 않게)
            if same and (marked or not pytesseract):
                print("그대로", url, flush=True)
                continue
        rows = rows_of(r.content)
        # 첫 줄은 PDF 크기 — 앱이 받아둔 파일과 크기가 다르면(학교가 바꿈) 이 색인을 안 쓴다
        with gzip.open(path, "wt", encoding="utf-8", newline="\n", compresslevel=9) as f:
            f.write(size + "\n" + (OCR_MARK + "\n" if pytesseract else "") + "\n".join(rows) + "\n")
        print(f"{url} → {path} 줄 {len(rows)}, {os.path.getsize(path) // 1024}KB", flush=True)


    # 웹앱 자료실 목록: 쪽 수는 색인의 마지막 쪽 번호로(색인이 없으면 0)
    for d in docs:
        path = os.path.join(out_dir, d["file"] + ".idx.gz")
        pages = 0
        if os.path.exists(path):
            with gzip.open(path, "rt", encoding="utf-8") as f:
                next(f, None)
                pages = 1 + max((int(l.split("\t", 1)[0]) for l in f if l[:1].isdigit()), default=-1)
        d["pages"] = pages
    with open(os.path.join(out_dir, "docs.json"), "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=1)
    print(f"docs.json 문서 {len(docs)}개", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docindex")
