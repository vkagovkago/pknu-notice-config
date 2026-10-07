# 자료실 PDF의 글자 색인(앱 PdfTextIndex, 문서 안 단어 찾기). 쪽마다 글자 줄과 위치(쪽 크기 비율)를 뽑아
# docindex/<파일이름>.idx.gz로 둔다. 휴대폰에서 882쪽짜리 PDF를 직접 읽으면 메모리가 모자라서 여기서 미리 한다.
# 글자가 없는(그림뿐인) 쪽은 비워 두고, 앱이 그 쪽만 기기에서 글자 인식(OCR)한다.
#   python make_doc_index.py docindex            자료실 문서 + 지난 교육과정·졸업요건 안내자료
# 이미 만든 색인은 PDF 크기가 같으면 건너뛴다(FORCE=1이면 다시).
import gzip, io, json, os, re, sys
import pdfplumber, requests

UA = {"User-Agent": "Mozilla/5.0 (pknu-notice docindex)"}
SOURCES = ["https://www.pknu.ac.kr/main/27", "https://www.pknu.ac.kr/main/434", "https://www.pknu.ac.kr/main/28", "https://www.pknu.ac.kr/main/362"]
# 앱 PastCurriculum.kt의 문서들과 졸업요건 안내자료(main/238이 PDF를 바로 준다)
EXTRA = ["https://www.pknu.ac.kr/main/238"]


def file_name(url):  # 앱 CampusDoc.fileName과 같게
    return re.sub(r"[^A-Za-z0-9._-]", "_", url.rsplit("/", 1)[-1])[:120]


def doc_urls():
    urls = []
    for page in SOURCES:
        try:
            h = requests.get(page, headers=UA, timeout=30).text
        except requests.RequestException as e:
            print("목록 실패", page, e, flush=True)
            continue
        for a, b in re.findall(r'class="uploadPdf"[^>]*data-id="(\d+)"|data-id="(\d+)"[^>]*class="uploadPdf"', h):
            r = requests.post("https://www.pknu.ac.kr/common/getMdaId.do", data={"no": a or b}, headers=UA, timeout=30).json().get("response", "").strip()
            if r.lower().endswith(".pdf"):
                urls.append("https://www.pknu.ac.kr/upload/" + r)
        urls += [requests.compat.urljoin(page, p) for p in re.findall(r'href="([^"]+\.pdf)"', h)]
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
                lines = page.extract_text_lines(return_chars=False)
            except Exception as e:  # 깨진 쪽은 비워 둔다(앱이 OCR)
                print(f"  {i + 1}쪽 실패: {e}", flush=True)
                lines = []
            for l in lines:
                t = re.sub(r"\s+", " ", l["text"]).strip()
                if not t:
                    continue
                out.append(f"{i}\t{l['x0'] / w:.4f}\t{l['top'] / h:.4f}\t{(l['x1'] - l['x0']) / w:.4f}\t{(l['bottom'] - l['top']) / h:.4f}\t{t}")
            page.flush_cache()
    return out


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for url in doc_urls():
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
                if f.readline().strip() == size:
                    print("그대로", url, flush=True)
                    continue
        rows = rows_of(r.content)
        # 첫 줄은 PDF 크기 — 앱이 받아둔 파일과 크기가 다르면(학교가 바꿈) 이 색인을 안 쓴다
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
            f.write(size + "\n" + "\n".join(rows) + "\n")
        print(f"{url} → {path} 줄 {len(rows)}, {os.path.getsize(path) // 1024}KB", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docindex")
