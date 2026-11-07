/* 로또 분석기 앱 — 오프라인 실행 + 최신 당첨번호
 * 화면 파일: 저장해 두고 바로 띄움 (새 버전이 있으면 다음 실행 때 반영)
 * 당첨번호(data/lotto_data.js): 인터넷이 되면 항상 최신을 받고, 안 되면 저장본 사용
 */
const VER = 'lotto-app-v9';
const SHELL = ['./', 'index.html', 'pick5.js', 'simple.js', 'simple.css', 'account.js', 'account-config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'data/lotto_data.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter(k => k !== VER && k !== 'lotto-fonts');
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    if (old.length) (await self.clients.matchAll({ type: 'window' })).forEach(c => c.postMessage({ type: 'data-updated' })); // 새 버전이면 화면을 한 번 새로 그림
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 글꼴: 한 번 받으면 저장
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('lotto-fonts').then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request); c.put(e.request, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // 당첨번호: 네트워크 우선(최대 5초) → 실패하면 저장본
  if (url.pathname.endsWith('/data/lotto_data.js')) {
    e.respondWith((async () => {
      const c = await caches.open(VER);
      try {
        const res = await Promise.race([fetch(e.request, { cache: 'no-store' }), timeout(5000)]);
        if (res.ok) { c.put('data/lotto_data.js', res.clone()); return res; }
      } catch (_) {}
      return (await c.match('data/lotto_data.js')) || fetch(e.request);
    })());
    return;
  }
  // 화면 파일: 저장본 먼저, 뒤에서 새 버전 받아 두기
  e.respondWith((async () => {
    const c = await caches.open(VER);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || c.match('index.html');
  })());
});
