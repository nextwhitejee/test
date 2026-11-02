/* NEXT WHITE — service worker (GitHub Pages friendly: all paths are relative) */
const VERSION = 'nw-v2';                       // bump this to force-refresh every cache
const SHELL   = VERSION + '-shell';            // index.html, manifest, icons
const IMAGES  = VERSION + '-diagrams';         // question diagrams (cached as you view them)
const CDN     = VERSION + '-cdn';              // KaTeX + Google Fonts
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const CORE = [
  './',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];
const CDN_CORE = [
  'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap'
];

// A redirected response can't be served to a navigation, so strip that flag.
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.allSettled(CORE.map(async (u) => {
      const res = await fetch(u, { cache: 'reload' });
      if (res.ok) await shell.put(u, await clean(res));
    }));
    const cdn = await caches.open(CDN);
    await Promise.allSettled(CDN_CORE.map(async (u) => {
      const res = await fetch(new Request(u, { mode: 'cors', credentials: 'omit' }));
      if (res.ok) await cdn.put(u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, IMAGES, CDN];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Open the app: network first (always the newest version), cache if offline/slow.
async function handleNavigation(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match('./');
  const net = fetch(event.request).then(async (res) => {
    if (res && res.ok) {
      const copy = await clean(res.clone());
      try { event.waitUntil(cache.put('./', copy)); } catch (_) { cache.put('./', copy); }
      return res;
    }
    return cached || res;
  });
  if (!cached) return net;                       // first ever visit
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 4000));
  return Promise.race([net, slow]).catch(() => cached);
}

// Show cache instantly, refresh it in the background.
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const net = fetch(event.request).then((res) => {
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

// CDN files never change at a pinned version: cache first.
async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;              // HEAD (your update checker) goes straight to network
  if (req.headers.has('range')) return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    if (url.origin === location.origin) event.respondWith(handleNavigation(event));
    return;
  }
  if (url.origin === location.origin) {
    if (url.pathname.includes('/diagrams/')) {
      event.respondWith(staleWhileRevalidate(event, IMAGES));
    } else if (/\/(icons\/|manifest\.webmanifest$)/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(event, SHELL));
    }
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event, CDN));
  }
});
