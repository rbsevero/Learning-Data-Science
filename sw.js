/* Service worker for Learning Data Science.
   Safe by design: the page itself is network-first (updates arrive as soon as you are online),
   small libraries are cached, and the large Python/R runtimes are cached only when the learner opts in. */
const V = "v1", SHELL = "lds-shell-" + V, LIB = "lds-lib-" + V, RT = "lds-rt-" + V;
const FLAG = () => new Request(self.registration.scope + "__lds_runtime_flag");
const ours = k => /^lds-/.test(k);

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"].map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (ours(k) && ![SHELL, LIB, RT].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", e => {
  const d = e.data || {};
  e.waitUntil((async () => {
    if (d.t === "runtimes") {
      const c = await caches.open(SHELL);
      if (d.on) await c.put(FLAG(), new Response("1")); else { await c.delete(FLAG()); await caches.delete(RT); }
    } else if (d.t === "reset") {
      for (const k of await caches.keys()) if (ours(k)) await caches.delete(k);
    }
  })());
});
const rtOn = async () => !!(await (await caches.open(SHELL)).match(FLAG()));

async function netFirst(req, name) {
  const c = await caches.open(name);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 4000))]);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (_) {
    return (await c.match(req)) || (await c.match("./")) || (await c.match("./index.html")) || Response.error();
  }
}
async function swr(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type !== "opaque") c.put(req, res.clone());   // never store opaque responses: they count as several MB each
  return res;
}
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || r.headers.has("range")) return;
  const u = new URL(r.url);
  if (u.origin === location.origin) { e.respondWith(r.mode === "navigate" ? netFirst(r, SHELL) : swr(r, SHELL)); return; }
  if (/mathjax|codemirror|prism/i.test(u.href)) { e.respondWith(cacheFirst(r, LIB)); return; }
  if (/\/pyodide\/|webr\.r-wasm\.org|repo\.r-wasm\.org/i.test(u.href)) {
    e.respondWith((async () => (await rtOn()) ? cacheFirst(r, RT) : fetch(r))());
  }
});
