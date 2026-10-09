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
 * app-build meta tag in index.html) and reloads the app automatically (waiting while you type) — so change that tag on every release.
 * If you add new files to APP_FILES below, bump CACHE_VERSION too.
 */
const CACHE_VERSION = 'v291';
const CACHE = 'powerlooms-' + CACHE_VERSION;

// Must match the <link> in index.html character-for-character so the cached copy is found.
const FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Condensed:wght@700&display=swap';
const CROSS_ORIGIN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// The Firebase scripts Cloud Sync loads (versioned files, so they never change): kept after the first
// load so a phone that is already signed in can start sync again on a weak or missing connection.
const FIREBASE_SDK_HOST = 'www.gstatic.com';

const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './js/errorlog.js',
  './js/calc.js',
  './js/ledger-store.js',
  './js/core.js',
  './js/shell.js',
  './js/panels-daily.js',
  './js/panels-wages-receipts.js',
  './js/wages-ui.js',
  './js/overview.js',
  './js/costing.js',
  './js/orders.js',
  './js/wiring.js',
  './js/encryption.js',
  './js/cloud-sync.js',
  './js/section-keys.js',
  './js/view-only.js',
  './js/write-access.js',
  './js/audit.js',
  './js/i18n.js',
  './js/ux-enhance.js',
  './js/proposals.js',
  './js/fiscal.js',
  './js/autobackup.js',
  './js/alert-share.js',
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

// The app's files are one versioned set, filled only at install time, so a phone can never hold a mix of old and
// new files. A new version arrives by bumping CACHE_VERSION (a new service worker installs a whole new set).
async function staleWhileRevalidate(event, cacheKey){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey);
  if(cached) return cached;
  try{
    const res = await fetch(event.request.mode === 'navigate' ? cacheKey : event.request);
    if(res && res.ok) await cache.put(cacheKey, await clean(res.clone()));
    return res;
  }catch(e){ return Response.error(); }
}

// Cross-origin helpers (fonts, the Firebase scripts): the cached copy wins; otherwise fetch it and keep it.
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

// v3.17.72 — shown instead of a broken page when the app cannot be loaded at all (offline and nothing cached yet).
// Self-contained (no files), so it works even when every other file is missing.
function offlinePage(){
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#163B3D"><title>No internet</title>'
    + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EDEFF1;color:#1B2126;font-family:Roboto,Arial,sans-serif;padding:24px;box-sizing:border-box}'
    + '.c{max-width:360px;text-align:center;background:#fff;border-radius:20px;padding:28px 22px;box-shadow:0 2px 12px rgba(0,0,0,.12)}h1{font-size:20px;margin:10px 0 8px;color:#163B3D}p{margin:6px 0;font-size:14.5px;line-height:1.5;color:#626B72}'
    + 'button{margin-top:16px;min-height:48px;padding:0 28px;border:0;border-radius:24px;background:#204E52;color:#fff;font-size:16px;font-weight:700}.u{direction:rtl;font-size:16px;color:#1B2126}</style></head>'
    + '<body><div class="c"><div style="font-size:44px">\u{1F4F5}</div><h1>Please connect to the internet to open this app.</h1><p class="u">براہ کرم ایپ کھولنے کے لیے انٹرنیٹ سے جڑیں۔</p><p>The app could not be loaded because there is no internet connection. Your ledger data is safe on this phone. Once you are connected, reopen the app. After it has loaded once, it works without internet.</p><button onclick="location.reload()">Try again</button></div></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
      event.respondWith(staleWhileRevalidate(event, scopeUrl('./index.html')).then(r=> (r && r.type !== 'error' && r.status !== 0) ? r : offlinePage(), ()=> offlinePage()));
      return;
    }
    if(url.href.startsWith(self.registration.scope)){
      event.respondWith(staleWhileRevalidate(event, req.url));
    }
    return;
  }

  if(url.hostname === FIREBASE_SDK_HOST && url.pathname.startsWith('/firebasejs/')){
    event.respondWith(cacheFirst(event));
    return;
  }

  if(CROSS_ORIGIN_HOSTS.includes(url.hostname)){
    event.respondWith(cacheFirst(event));
  }
  // Anything else (there shouldn't be any) goes straight to the network.
});

