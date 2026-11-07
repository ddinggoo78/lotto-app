/* 로또 분석기 — 두 사람 전용 계정 (전화번호 + 비밀번호 4자리)
 * - 내 번호·설정을 Firebase(Firestore)에 보관해 핸드폰·PC 어디서나 같은 번호를 봄
 * - 저장(확인)할 때 각자 핸드폰으로 알림 (ntfy 앱)
 * - 문자 인증은 하지 않음. 전화번호+비밀번호로 만든 열쇠(해시)로만 내 칸을 읽고 씀
 * window.LOTTO_FB = { apiKey, projectId } 가 있어야 켜짐 (account-config.js)
 */
(function () {
  'use strict';
  const CFG = window.LOTTO_FB;
  const STORE = 'lotto645-analyzer-v1', SESS = 'lotto-account', SYNC = 'lotto-sync-ts';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { origSet.call(localStorage, k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  const origSet = Storage.prototype.setItem;
  const api = { ready: false, user: null, notify: async () => false };
  window.LottoAccount = api;
  if (!CFG || !CFG.apiKey || !CFG.projectId) return; // 설정 전에는 꺼 둠

  const BASE = `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents/users/`;
  const digits = s => String(s || '').replace(/\D/g, '');
  async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  const sv = v => ({ stringValue: String(v) }), iv = v => ({ integerValue: String(v) });
  async function getDoc(id) {
    const r = await fetch(BASE + id + '?key=' + CFG.apiKey, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('서버 응답 ' + r.status);
    const f = (await r.json()).fields || {};
    return { name: f.name?.stringValue || '', tail: f.tail?.stringValue || '', topic: f.topic?.stringValue || '', state: f.state?.stringValue || '', ts: +(f.ts?.integerValue || 0) };
  }
  async function putDoc(id, d) {
    const fields = { name: sv(d.name), tail: sv(d.tail), topic: sv(d.topic), state: sv(d.state || ''), ts: iv(d.ts || Date.now()) };
    const mask = ['name', 'tail', 'topic', 'state', 'ts'].map(f => 'updateMask.fieldPaths=' + f).join('&');
    const r = await fetch(BASE + id + '?key=' + CFG.apiKey + '&' + mask, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (!r.ok) throw new Error('저장 실패 ' + r.status);
  }

  /* ---------- 저장할 때마다 서버에도 올림 ---------- */
  let timer = null, pushing = false;
  function schedulePush() {
    if (!api.user) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (pushing) return schedulePush(); pushing = true;
      const ts = Date.now();
      try { await putDoc(api.user.id, { ...api.user, state: ls.get(STORE) || '', ts }); ls.set(SYNC, String(ts)); setBadge('저장됨'); }
      catch (e) { setBadge('오프라인 · 나중에 다시 올림'); }
      finally { pushing = false; }
    }, 800);
  }
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === localStorage && k === STORE) schedulePush(); };

  /* ---------- 알림 (ntfy) ---------- */
  api.notify = async (title, body) => {
    if (!api.user || !api.user.topic) return false;
    try {
      const r = await fetch(`https://ntfy.sh/${api.user.topic}?title=${encodeURIComponent(title)}&tags=four_leaf_clover`, { method: 'POST', body });
      return r.ok;
    } catch (e) { return false; }
  };
  const notifyKo = (title, lines) => api.notify(title, lines.join('\n'));
  api.notifyKo = notifyKo;

  /* ---------- 화면 ---------- */
  const css = document.createElement('style');
  css.textContent = `.acct-ov{position:fixed;inset:0;z-index:90;background:var(--paper,#f3f4f7);display:grid;place-items:center;padding:16px;overflow:auto}
  .acct-box{background:var(--surface,#fff);border:1px solid var(--line,#dbe0e8);border-radius:16px;max-width:400px;width:100%;padding:22px;display:grid;gap:12px}
  .acct-box h2{color:var(--slip,#cf2f55)} .acct-box label{display:grid;gap:4px;font-size:13.5px;color:var(--ink-2,#444e62)}
  .acct-box input{font-size:17px;padding:10px 12px} .acct-err{color:var(--bad,#b4233f);font-size:13px;min-height:1em}
  .acct-chip{margin-left:8px;flex:none;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 10px;font-size:12.5px;font-weight:600;color:var(--ink-2)}
  .acct-topic{font-family:var(--f-mono,monospace);background:var(--surface-2,#eceff4);border-radius:8px;padding:8px 10px;word-break:break-all;font-size:14px}`;
  document.head.appendChild(css);
  function setBadge(t) { const b = document.getElementById('acctChip'); if (b && api.user) b.title = t; }

  function loginScreen(msg) {
    const ov = document.createElement('div'); ov.className = 'acct-ov'; ov.id = 'acctOv';
    ov.innerHTML = `<form class="acct-box" id="acctForm">
      <h2>로또 분석기</h2>
      <p class="hint">전화번호와 비밀번호 4자리로 들어가요. 처음이면 이름을 넣으면 자동으로 만들어져요. 다음부터는 같은 번호·비밀번호로 핸드폰·PC 어디서나 내 번호가 보여요.</p>
      <label>전화번호<input id="acPhone" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" required></label>
      <label>비밀번호 4자리<input id="acPin" inputmode="numeric" type="password" maxlength="4" autocomplete="current-password" placeholder="숫자 4자리" required></label>
      <label>이름 (처음 한 번만)<input id="acName" maxlength="10" placeholder="예: 홍길동"></label>
      <div class="acct-err" id="acErr">${msg || ''}</div>
      <button class="btn primary" type="submit" id="acGo">시작하기</button>
      <p class="hint">비밀번호를 잊으면 같은 번호로 새로 만들어야 하고 저장한 번호는 볼 수 없어요. 꼭 기억해 두세요.</p></form>`;
    document.body.appendChild(ov);
    ov.querySelector('#acctForm').addEventListener('submit', async e => {
      e.preventDefault();
      const phone = digits(ov.querySelector('#acPhone').value), pin = digits(ov.querySelector('#acPin').value), name = ov.querySelector('#acName').value.trim();
      const err = ov.querySelector('#acErr'), go = ov.querySelector('#acGo');
      if (phone.length < 10 || phone.length > 11) { err.textContent = '전화번호를 확인해 주세요'; return; }
      if (pin.length !== 4) { err.textContent = '비밀번호는 숫자 4자리예요'; return; }
      go.disabled = true; go.textContent = '확인 중…'; err.textContent = '';
      try {
        const id = await sha(`lotto-duo|${phone}|${pin}`);
        let doc = await getDoc(id);
        if (!doc) {
          if (!name) { err.textContent = '처음이시면 이름을 넣어 주세요. (이미 만들었다면 비밀번호를 다시 확인해 주세요)'; go.disabled = false; go.textContent = '시작하기'; return; }
          doc = { name, tail: phone.slice(-4), topic: 'lotto-' + id.slice(0, 20), state: ls.get(STORE) || '', ts: Date.now() };
          await putDoc(id, doc);
        }
        ls.set(SESS, JSON.stringify({ id, name: doc.name, tail: doc.tail, topic: doc.topic }));
        if (doc.state) { ls.set(STORE, doc.state); ls.set(SYNC, String(doc.ts)); }
        sessionStorage.setItem('lotto-justlogin', '1');
        location.reload();
      } catch (ex) { err.textContent = '연결이 안 돼요. 인터넷을 확인해 주세요 (' + ex.message + ')'; go.disabled = false; go.textContent = '시작하기'; }
    });
  }

  function accountPanel() {
    const u = api.user;
    const ov = document.createElement('div'); ov.className = 'acct-ov'; ov.style.background = 'rgba(0,0,0,.45)';
    ov.innerHTML = `<div class="acct-box"><h2>${u.name}님</h2><p class="hint">전화번호 끝자리 ${u.tail}</p>
      <h3>핸드폰 알림 받기</h3>
      <ol class="hint" style="margin:0;padding-left:1.2em;display:grid;gap:4px">
        <li>플레이스토어에서 <b>ntfy</b> 앱 설치 (아이폰은 앱스토어)</li>
        <li>ntfy 앱에서 <b>＋</b> → 「Topic name」에 아래 이름 붙여넣기 → Subscribe</li>
        <li>아래 「시험 알림」을 눌러 알림이 오는지 확인</li></ol>
      <div class="acct-topic" id="acTopic">${u.topic}</div>
      <div class="toolbar"><button class="btn" id="acCopy">이름 복사</button><button class="btn" id="acTest">시험 알림</button></div>
      <div class="toolbar"><button class="btn" id="acOut">로그아웃</button><button class="btn primary" id="acClose">닫기</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#acClose').onclick = () => ov.remove();
    ov.querySelector('#acCopy').onclick = async () => { try { await navigator.clipboard.writeText(u.topic); ov.querySelector('#acCopy').textContent = '복사됨'; } catch (e) {} };
    ov.querySelector('#acTest').onclick = async () => { const ok = await notifyKo('로또 분석기 시험 알림', [`${u.name}님 핸드폰으로 알림이 잘 와요.`]); ov.querySelector('#acTest').textContent = ok ? '보냈어요 — 핸드폰 확인' : '못 보냈어요'; };
    ov.querySelector('#acOut').onclick = () => { ls.del(SESS); ls.del(STORE); ls.del(SYNC); location.reload(); };
  }

  /* ---------- 시작 ---------- */
  let sess = null; try { sess = JSON.parse(ls.get(SESS) || 'null'); } catch (e) {}
  if (!sess) { document.addEventListener('DOMContentLoaded', () => loginScreen()); if (document.readyState !== 'loading') loginScreen(); return; }
  api.user = sess; api.ready = true;
  window.LOTTO_STATE = undefined; // PC 프로그램: 파일 대신 계정에 저장된 번호를 씀
  window.addEventListener('load', async () => {
    const brand = document.querySelector('.brand');
    if (brand) { const b = document.createElement('button'); b.className = 'acct-chip'; b.id = 'acctChip'; b.textContent = sess.name + '님'; b.onclick = accountPanel; brand.appendChild(b); }
    if (sessionStorage.getItem('lotto-justlogin')) { sessionStorage.removeItem('lotto-justlogin'); if (!ls.get(STORE)) return; }
    // 다른 기기에서 더 최근에 저장했으면 받아 오기
    try {
      const doc = await getDoc(sess.id);
      if (!doc) return;
      const local = +(ls.get(SYNC) || 0);
      if (doc.ts > local && doc.state && doc.state !== ls.get(STORE)) { ls.set(STORE, doc.state); ls.set(SYNC, String(doc.ts)); location.reload(); }
      else if (local > doc.ts) schedulePush();
    } catch (e) {}
  });
})();
