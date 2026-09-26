// Экспонометр Зоркого — работа без сети.
// Страница: сначала сеть (чтобы видеть обновления), без сети — из памяти.
// Шрифты, библиотека и модели распознавания: сначала из памяти, иначе из сети с сохранением.
const PAGE_CACHE = "zorki-page-v4";
const ASSET_CACHE = "zorki-assets-v1";
const PAGE_FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGE_CACHE).then((c) => c.addAll(PAGE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== PAGE_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function pageFirstNetwork(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    // no-cache: всегда сверяемся с сайтом, чтобы обновления приходили сразу, а не через 10 минут кэша
    const res = await fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" });
    if (res.ok) cache.put(req.mode === "navigate" ? "./index.html" : req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" && (await cache.match("./index.html")));
    if (hit) return hit;
    throw err;
  }
}

async function assetFirstCache(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req.url);
  // Непрозрачный ответ нельзя отдать на CORS-запрос: тогда идём в сеть.
  if (hit && (hit.type !== "opaque" || req.mode === "no-cors")) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req.url, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(pageFirstNetwork(req));
  } else if (/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$|storage\.googleapis\.com$/.test(url.hostname)) {
    e.respondWith(assetFirstCache(req));
  }
});

// Предзагрузка по кнопке «Сохранить для работы без сети».
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type !== "precache") return;
  const port = e.ports && e.ports[0];
  const say = (m) => { try { port && port.postMessage(m); } catch (_) {} };
  e.waitUntil((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const page = await caches.open(PAGE_CACHE);
    const urls = [...(d.urls || [])];
    let done = 0, failed = [];
    // Шрифты: CSS, затем файлы шрифтов из него.
    if (d.fontCss) {
      try {
        const r = await fetch(d.fontCss, { mode: "cors" });
        if (r.ok) {
          const css = await r.clone().text();
          await cache.put(d.fontCss, r);
          (css.match(/url\((https:[^)]+)\)/g) || []).forEach((m) => urls.push(m.slice(4, -1)));
        } else failed.push(d.fontCss);
      } catch (_) { failed.push(d.fontCss); }
    }
    const total = urls.length + 1;
    for (const u of urls) {
      try {
        const r = await fetch(u, { mode: "cors" });
        if (!r.ok) throw new Error(r.status);
        await cache.put(u, r);
      } catch (_) { failed.push(u); }
      done++;
      say({ type: "progress", done, total });
    }
    try { await page.addAll(PAGE_FILES); } catch (_) { failed.push("page"); }
    say({ type: "done", failed });
  })());
});
