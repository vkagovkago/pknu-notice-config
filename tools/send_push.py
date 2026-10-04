# 새 공지 푸시(FCM). 지난번 notices.json과 방금 만든 것을 비교해 새로 올라온 글이 있는 게시판에만 보낸다.
#  - 안드로이드 앱: 게시판마다 토픽(board_topic)을 구독해 둔다. 앱은 메시지를 받으면 그 게시판을 직접
#    다시 확인해 키워드·알림 설정대로 알린다(앱의 기존 알림 규칙을 그대로 쓴다).
#  - 웹앱: Firestore webPush/{토큰}에 고른 게시판이 저장돼 있다. 그 게시판의 토큰에만 보낸다.
#
#   FIREBASE_SA='<서비스 계정 JSON>' python tools/send_push.py <지난번 notices.json> <새 notices.json>
# FIREBASE_SA가 없으면 아무것도 안 하고 끝난다(설정 전에도 워크플로가 깨지지 않게).
import datetime as dt
import hashlib
import json
import os
import sys

import requests

MAX_PER_BOARD = 3          # 한 번에 글이 몰려도 게시판당 이만큼만 알린다
RECENT_DAYS = 3            # 날짜가 이보다 오래된 글은 "새 글"로 치지 않는다(게시판이 되살아날 때 옛 글 폭탄 방지)


def board_topic(board_id):
    # FCM 토픽 이름은 영문·숫자만 된다. 앱(PushTopics.kt)과 같은 규칙.
    return "board_" + hashlib.sha1(board_id.encode("utf-8")).hexdigest()[:16]


def new_items(prev, cur):
    cutoff = (dt.date.today() - dt.timedelta(days=RECENT_DAYS)).isoformat()
    out = {}
    for bid, b in cur.items():
        old = prev.get(bid)
        if not old or not old.get("items") or not b.get("items"):
            continue  # 처음 보는 게시판·받기 실패한 게시판은 비교하지 않는다
        seen = {i["no"] for i in old["items"]}
        fresh = [i for i in b["items"] if i["no"] not in seen and not i.get("pinned") and (i.get("date") or "9") >= cutoff]
        if fresh:
            out[bid] = (b["name"], fresh[:MAX_PER_BOARD], len(fresh))
    return out


def message_for(name, items, total):
    if total == 1:
        return f"{name} 새 공지", items[0]["title"], items[0]["url"]
    return f"{name} 새 공지 {total}개", "\n".join("· " + i["title"] for i in items), None


def access_token(sa):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    cred = service_account.Credentials.from_service_account_info(
        sa, scopes=["https://www.googleapis.com/auth/firebase.messaging", "https://www.googleapis.com/auth/datastore"])
    cred.refresh(Request())
    return cred.token


def web_tokens(project, token):
    # Firestore REST로 webPush 컬렉션을 읽는다: [(토큰, {게시판 id})]
    url = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/webPush"
    out, page = [], None
    while True:
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params={"pageSize": 300, "pageToken": page} if page else {"pageSize": 300}, timeout=30)
        if r.status_code == 404:
            return out  # 데이터베이스를 아직 안 만들었으면 웹 구독자 없음
        r.raise_for_status()
        j = r.json()
        for d in j.get("documents", []):
            f = d.get("fields", {})
            boards = {v.get("stringValue") for v in f.get("boards", {}).get("arrayValue", {}).get("values", [])}
            tok = f.get("token", {}).get("stringValue")
            if tok:
                out.append((tok, boards, d["name"]))
        page = j.get("nextPageToken")
        if not page:
            return out


def send(project, token, message):
    r = requests.post(f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
                      headers={"Authorization": f"Bearer {token}"}, json={"message": message}, timeout=30)
    return r.status_code, r.text


def main():
    sa_text = os.environ.get("FIREBASE_SA", "").strip()
    if not sa_text:
        print("FIREBASE_SA 없음 — 푸시 건너뜀")
        return
    prev_path, cur_path = sys.argv[1], sys.argv[2]
    if not os.path.exists(prev_path):
        print("지난번 목록 없음 — 이번에는 비교하지 않음")
        return
    prev = json.load(open(prev_path, encoding="utf-8"))["boards"]
    cur = json.load(open(cur_path, encoding="utf-8"))["boards"]
    fresh = new_items(prev, cur)
    print(f"새 글 있는 게시판 {len(fresh)}곳: " + ", ".join(f"{n}({t})" for n, _, t in fresh.values()))
    if not fresh:
        return

    sa = json.loads(sa_text)
    project, token = sa["project_id"], access_token(sa)

    for bid, (name, items, total) in fresh.items():
        title, body, url = message_for(name, items, total)
        # 안드로이드: 데이터 메시지(앱이 직접 확인하고 알린다)
        code, text = send(project, token, {
            "topic": board_topic(bid),
            "data": {"type": "notice", "board": bid, "count": str(total)},
            "android": {"priority": "high", "ttl": "3600s"},
        })
        print("android", name, code, text[:120] if code != 200 else "")

    subs = web_tokens(project, token)
    dead = []
    for tok, boards, doc_name in subs:
        hits = [(bid, v) for bid, v in fresh.items() if bid in boards]
        if not hits:
            continue
        if len(hits) == 1:
            title, body, url = message_for(*hits[0][1])
        else:
            title, body, url = f"새 공지 {sum(v[2] for _, v in hits)}개", "\n".join(f"· {v[0]}: {v[1][0]['title']}" for _, v in hits[:4]), None
        code, text = send(project, token, {
            "token": tok,
            "data": {"title": title, "body": body[:300], "url": url or "./#notices", "tag": "notice"},
            "webpush": {"headers": {"Urgency": "high", "TTL": "3600"}},
        })
        if code in (404, 400) and ("UNREGISTERED" in text or "INVALID_ARGUMENT" in text):
            dead.append(doc_name)
    for name in dead:  # 앱을 지웠거나 알림을 끈 브라우저 정리
        requests.delete(f"https://firestore.googleapis.com/v1/{name}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    print(f"웹 구독 {len(subs)}개, 정리 {len(dead)}개")


if __name__ == "__main__":
    main()
