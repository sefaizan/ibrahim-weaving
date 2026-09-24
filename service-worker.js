/* Ibrahim Weaving — Power Loom Ledger: service worker.
 *
 * Purpose: let the installed app open and work with no signal. It only caches the app's own
 * files (jsPDF is bundled with the app) plus the Roboto fonts the page loads from Google. It
 * never touches your ledger data — that lives in the browser's localStorage/IndexedDB and is not
 * read, cached, or sent anywhere by this file.
 *
 * The app's code is split across the files in js/. Every one of them must be listed in APP_FILES
 * below (tests/app-files.test.js checks this), and CACHE_VERSION should change on every release so
 * phones fetch the whole set together.
 *
 * Updating the app: replace the hosted files. The next launch still opens the previous copy
 * (instant, works offline) while the new one downloads in the background; the launch after that
 * uses the new copy. While the app is open it also checks whether a newer build is live (the
 * app-build meta tag in index.html) and offers a "Reload" bar — so change that tag on every release.
 * If you add new files to APP_FILES below, bump CACHE_VERSION too.
 */
const CACHE_VERSION = 'v75';
const CACHE = 'powerlooms-' + CACHE_VERSION;

// Must match the <link> in index.html character-for-character so the cached copy is found.
const FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Condensed:wght@700&display=swap';
const CROSS_ORIGIN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './js/calc.js',
  './js/core.js',
  './js/shell.js',
  './js/panels-daily.js',
  './js/panels-wages-receipts.js',
  './js/overview.js',
  './js/wiring.js',
  './js/encryption.js',
  './js/autobackup.js',
  './js/lock-init.js',
  './jspdf.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

// A response that came through a redirect can't be used to answer a page navigation, so store a
// clean copy instead (some hosts redirect /index.html to /).
async function clean(res){
  if(!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, {status: res.status, statusText: res.statusText, headers: res.headers});
}

async function fetchWithCorsFallback(url){
  try{ const r = await fetch(url, {mode:'cors'}); if(r && r.ok) return r; }catch(e){ /* fall through */ }
  return fetch(url, {mode:'no-cors'});
}

// Downloads the fonts stylesheet and every font file it points at, so text looks right offline.
// Best effort — a failure here must never stop the app itself from installing.
async function cacheFonts(cache){
  try{
    const cssRes = await fetch(FONTS_CSS_URL, {mode:'cors'});
    if(!cssRes.ok) return;
    const css = await cssRes.clone().text();
    await cache.put(FONTS_CSS_URL, cssRes);
    const urls = Array.from(new Set((css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])));
    await Promise.all(urls.map(async (u)=>{
      try{ const r = await fetch(u, {mode:'cors'}); if(r.ok) await cache.put(u, r); }catch(e){ /* skip this file */ }
    }));
  }catch(e){ /* offline at install time — fonts will be cached the first time they load online */ }
}

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    // The app's own files must all arrive, or the install is retried next time.
    await Promise.all(APP_FILES.map(async (path)=>{
      const res = await fetch(new Request(scopeUrl(path), {cache:'reload'}));
      if(!res.ok) throw new Error('Could not cache ' + path + ' (' + res.status + ')');
      await cache.put(scopeUrl(path), await clean(res));
    }));
    // The internet-hosted extras (fonts) are best effort.
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const names = await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith('powerlooms-') && n !== CACHE).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

// Answer from the cache immediately if we have it, and refresh the cached copy in the background.
async function staleWhileRevalidate(event, cacheKey){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey);
  const refresh = fetch(event.request.mode === 'navigate' ? cacheKey : event.request)
    .then(async (res)=>{ if(res && res.ok) await cache.put(cacheKey, await clean(res)); return res; })
    .catch(()=>null);
  event.waitUntil(refresh);
  if(cached) return cached;
  const fresh = await refresh;
  return fresh || Response.error();
}

// Cross-origin helpers (jsPDF, fonts): the cached copy wins; otherwise fetch it and keep it.
async function cacheFirst(event){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, {ignoreVary:true}); // Google Fonts CSS varies by browser
  if(cached) return cached;
  try{
    const res = await fetch(event.request);
    if(res && (res.ok || res.type === 'opaque')) await cache.put(event.request, res.clone());
    return res;
  }catch(e){
    return Response.error();
  }
}

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === self.location.origin){
    // The app's "is a newer version live?" check asks the network directly — never answer it from the cache.
    if(url.searchParams.has('__ck')) return;
    // Opening the app (any URL inside the scope) → the cached app shell.
    if(req.mode === 'navigate'){
      event.respondWith(staleWhileRevalidate(event, scopeUrl('./index.html')));
      return;
    }
    if(url.href.startsWith(self.registration.scope)){
      event.respondWith(staleWhileRevalidate(event, req.url));
    }
    return;
  }

  if(CROSS_ORIGIN_HOSTS.includes(url.hostname)){
    event.respondWith(cacheFirst(event));
  }
  // Anything else (there shouldn't be any) goes straight to the network.
});
