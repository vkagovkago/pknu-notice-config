// 오프라인에서도 열리게 화면 파일을 담아두고, 자료(data/)는 네트워크 우선(실패하면 담아둔 것).
// 새 공지 알림(FCM 웹 푸시)도 여기서 받는다.
const CACHE = "pknu-web-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "study.js", "campus.js", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".apk")) return;
  // 화면 파일도 네트워크 우선 — 고친 버전이 바로 보이게. 오프라인일 때만 담아둔 것.
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

// 서버는 data 메시지로 보낸다: { title, body, url }
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json().data || e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "부경대 공지알리미", {
    body: d.body || "새 공지가 올라왔어요", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    data: { url: d.url || "./#notices" }, tag: d.tag || undefined,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./#notices";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    const open = list.find((c) => "focus" in c);
    return open && url.startsWith("./") ? open.navigate(url).then((c) => c.focus()) : self.clients.openWindow(url);
  }));
});
