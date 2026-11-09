// Wildy: la app se guarda en el móvil para abrir al instante aunque la web no responda
// (p. ej. bloqueos de IPs de Cloudflare durante el fútbol). Los datos van aparte, por Supabase.
const C = "wildy-v31";
const SHELL = ["./", "index.html", "./?app=1", "manifest.json", "icon-192.png", "icon-512.png", "icon-180.png", "wildy-logo.png", "wildy-logo-dark.png"];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const WAIT = 3500; // ms antes de usar la copia guardada

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => Promise.all(
    SHELL.concat(LIBS).map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {}))
  )));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

function save(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const cp = res.clone();
    caches.open(C).then(c => c.put(req, cp)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return; // vídeos por trozos: directos
  const u = new URL(req.url);

  // Librerías con versión fija: primero la copia guardada
  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => save(req, r))));
    return;
  }
  if (u.origin !== location.origin) return; // Supabase, mapas, IA: nunca se guardan

  const isPage = req.mode === "navigate" || req.destination === "document";
  if (isPage) {
    // Red primero, pero si tarda más de 3,5 s abrimos la copia guardada y la red la actualiza por detrás
    e.respondWith(new Promise(resolve => {
      let done = false;
      const fallback = () => caches.match(req, { ignoreSearch: true })
        .then(m => m || caches.match("index.html"))
        .then(m => { if (m && !done) { done = true; resolve(m); } return m; });
      const timer = setTimeout(fallback, WAIT);
      fetch(req).then(r => {
        save(new Request(u.origin + u.pathname), r.clone());
        if (!done) { done = true; clearTimeout(timer); resolve(r); }
      }).catch(() => {
        clearTimeout(timer);
        fallback().then(m => { if (!done) { done = true; resolve(m || Response.error()); } });
      });
    }));
    return;
  }
  // Iconos y demás: copia guardada al instante y se actualiza por detrás
  e.respondWith(caches.match(req).then(m => {
    const net = fetch(req).then(r => save(req, r)).catch(() => m);
    return m || net;
  }));
});

// Notificaciones push (vacunas, citas, cumpleaños y mensajes de Wildy)
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Wildy", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Wildy", {
    body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || "./?app=1" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./?app=1", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && "focus" in c) { if (c.navigate) c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return clients.openWindow(url);
  }));
});
