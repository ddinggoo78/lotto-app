/* 로또 분석기 — 개인용 간단 화면
 * 화면은 '번호 생성기'와 '내 번호 조회' 두 개만 보이고,
 * 통계·필터·확률 계산은 뒤에서 자동으로 한다.
 *
 * 흐름: 고정·제외 정하기 → 방식 고르기 → 10개 만들기(점수 분석) → 마음에 드는 조합 고르기
 *       → 다시 돌리기(반복) → 최종 10개 확정 → 정밀 추천 5개 → 날짜별 보관
 *       내 번호 조회: 날짜 하나/여러 개/전체 선택 → 모아서 다시 5개로 추리기, 추첨 뒤 맞은 개수 확인
 */
window.LottoSimple = function (A) {
  'use strict';
  const { S, DRAWS, LAST, metrics, enumerate, persist, toast, balls, copyText, checkCombo, $, $$, FILTERS, recent, fmt, esc, TOTAL, RENDER, TABS } = A;
  const P5 = window.LottoPick5;
  const NEXT = LAST.r + 1;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayLabel = ds => { const d = new Date(ds + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  const key = n => n.join(',');
  const line = n => n.map(v => String(v).padStart(2, '0')).join(' ');
  const BYR = new Map(DRAWS.map(d => [d.r, d]));

  /* ---------- 1) 필터 자동 조정: 최근 300회 1등 조합의 가운데 90% 범위 ---------- */
  const CORE = ['sum', 'odd', 'low', 'ac', 'endSum', 'consec', 'sameEnd', 'sameGroup', 'prime'];
  function autoFilters() {
    const base = DRAWS.slice(-300);
    for (const f of FILTERS) {
      const st = S.filters[f.k];
      if (!CORE.includes(f.k)) { st.on = false; continue; }
      const v = base.map(d => d.m[f.k]).filter(x => x != null).sort((a, b) => a - b);
      st.on = true;
      st.min = Math.max(f.lo, v[Math.floor(v.length * 0.05)]);
      st.max = Math.min(f.hi, v[Math.ceil(v.length * 0.95) - 1]);
    }
    S.excludePast = true;
    const pass = DRAWS.filter(d => CORE.every(k => d.m[k] >= S.filters[k].min && d.m[k] <= S.filters[k].max)).length;
    return pass / DRAWS.length;
  }
  const autoPass = autoFilters();
  S.count = 10;
  S.results = S.results || { count: 1, list: [], ms: 0, weight: S.weight, fx: 0, ex: 0, histPass: null }; // 원래 화면 자동 생성 막기
  persist();

  /* ---------- 2) 탭: 번호 생성기 · 내 번호 조회만 ---------- */
  document.body.classList.add('simple');
  $$('#tabs button').forEach(b => { if (b.dataset.tab === 'check') b.textContent = '내 번호 조회'; });
  const h = (location.hash || '').replace('#', '');
  if (h !== 'generator' && h !== 'check') { try { history.replaceState(null, '', '#generator'); } catch (e) { location.hash = 'generator'; } }

  /* ---------- 3) 번호 생성기 화면 ---------- */
  const gen = $('#tab-generator');
  const orig = document.createElement('div'); orig.hidden = true; orig.id = 'origGen';
  while (gen.firstChild) orig.appendChild(gen.firstChild);
  gen.appendChild(orig);
  const ui = document.createElement('div'); ui.className = 'sg'; gen.prepend(ui);
  ui.innerHTML = `
    <div class="sec-head"><h2>번호 생성기 · 제${NEXT}회용</h2>
      <p>통계·필터는 자동으로 맞춰져 있어요. (최근 300회 1등 조합 기준, 역대 1등 조합의 ${(autoPass * 100).toFixed(0)}%가 통과하는 범위)</p></div>
    <div class="card">
      <header><h3>① 고정수 · 제외수</h3><button class="btn small" id="sgClear">모두 비우기</button></header>
      <p class="hint">번호를 <b>한 번</b> 누르면 고정(빨강), <b>두 번</b> 누르면 제외(X), <b>세 번</b> 누르면 해제돼요. 고정은 최대 5개.</p>
      <div class="board" id="sgBoard"></div>
      <div class="picked" id="sgPicked"></div>
    </div>
    <div class="card">
      <header><h3>② 방식 고르고 10개 만들기</h3></header>
      <div class="seg sg-seg" id="sgWeight" role="group" aria-label="방식">
        <button data-w="uniform">균등 무작위</button><button data-w="hot">최근 50회 핫넘버</button><button data-w="cold">최근 50회 콜드넘버</button>
      </div>
      <div class="toolbar"><button class="btn primary" id="sgRun">10개 만들기</button><span class="hint" id="sgInfo"></span></div>
      <div class="progress" id="sgProg" hidden><i></i></div>
      <div id="sgList"></div>
    </div>
    <div class="card" id="sgTrayCard">
      <header><h3>③ 고른 조합 <span id="sgTrayN"></span></h3><button class="btn small" id="sgTrayClear">비우기</button></header>
      <p class="hint">마음에 드는 조합에 체크하면 여기에 모여요. 다시 돌려서 더 골라도 돼요. 10개가 되면 확정하세요.</p>
      <div id="sgTray"></div>
      <div class="toolbar"><button class="btn" id="sgAutoFill">점수 높은 순으로 채우기</button><button class="btn primary" id="sgConfirm">최종 확정 → 정밀 추천 5개</button></div>
    </div>
    <div id="sgFinal"></div>`;
  let cur = null;   // 지금 만든 10개 {list, rows}
  const tray = [];  // 고른 조합 [{n, score, w}]

  function drawBoard() {
    $('#sgBoard').innerHTML = Array.from({ length: 45 }, (_, i) => i + 1).map(v =>
      `<button class="cell${S.fixed.has(v) ? ' fix' : S.excl.has(v) ? ' excl' : ''}" data-v="${v}" aria-label="${v}번${S.fixed.has(v) ? ' 고정' : S.excl.has(v) ? ' 제외' : ''}">${v}</button>`).join('');
    const fx = [...S.fixed].sort((a, b) => a - b), ex = [...S.excl].sort((a, b) => a - b);
    $('#sgPicked').innerHTML = `<div class="picked-row"><span class="lbl">고정수 ${fx.length}/5</span>${fx.length ? balls(fx, 'sm') : '<span class="empty">없음</span>'}</div>
      <div class="picked-row"><span class="lbl">제외수 ${ex.length}</span>${ex.length ? balls(ex, 'sm strike') : '<span class="empty">없음</span>'}</div>`;
  }
  $('#sgBoard').addEventListener('click', e => {
    const b = e.target.closest('.cell'); if (!b) return; const v = +b.dataset.v;
    if (S.fixed.has(v)) { S.fixed.delete(v); if (45 - S.excl.size - 1 >= 6) S.excl.add(v); else toast('최소 6개 번호는 남겨야 해요'); }
    else if (S.excl.has(v)) S.excl.delete(v);
    else { if (S.fixed.size >= 5) { toast('고정수는 최대 5개예요. 이 번호는 제외로 넣었어요'); if (45 - S.excl.size - 1 >= 6) S.excl.add(v); } else S.fixed.add(v); }
    persist(); drawBoard();
  });
  $('#sgClear').onclick = () => { S.fixed.clear(); S.excl.clear(); persist(); drawBoard(); };

  function drawWeight() { $$('#sgWeight button').forEach(b => b.setAttribute('aria-pressed', b.dataset.w === S.weight ? 'true' : 'false')); }
  $('#sgWeight').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (b) { S.weight = b.dataset.w; persist(); drawWeight(); } });

  const WL = { uniform: '균등 무작위', hot: '핫넘버', cold: '콜드넘버' };
  async function run() {
    if (S.busy) return;
    if (45 - S.excl.size < 6) { toast('제외수가 너무 많아요'); return; }
    S.busy = true; const btn = $('#sgRun'), prog = $('#sgProg'), bar = prog.querySelector('i');
    btn.disabled = true; btn.textContent = '계산 중…'; prog.hidden = false; bar.style.width = '0%';
    try {
      const r = await enumerate(10, S.weight, p => { bar.style.width = (p * 100).toFixed(1) + '%'; });
      if (!r.count) { cur = null; $('#sgList').innerHTML = '<p class="callout">조건을 만족하는 조합이 없어요. 고정수·제외수를 줄여 보세요.</p>'; return; }
      const list = r.list.map(n => n.slice().sort((a, b) => a - b));
      const an = list.length > 5 ? P5.analyze(list, DRAWS, metrics) : { rows: list.map((n, idx) => ({ idx, n, total: 0, notes: [], warns: [] })), picked: [] };
      const rank = new Map(an.picked.map(p => [p.idx, p.rank]));
      cur = { list, rows: an.rows.slice().sort((a, b) => b.total - a.total), rank, count: r.count, w: S.weight };
      $('#sgInfo').textContent = `조건 통과 ${fmt(r.count)}개 중 ${{ uniform: '균등 무작위로', hot: '핫넘버 가중으로', cold: '콜드넘버 가중으로' }[S.weight]} 10개`;
      btn.textContent = '다시 돌리기';
      drawList();
    } finally { S.busy = false; btn.disabled = false; prog.hidden = true; if (btn.textContent === '계산 중…') btn.textContent = '10개 만들기'; }
  }
  $('#sgRun').onclick = run;

  function inTray(n) { return tray.findIndex(t => key(t.n) === key(n)); }
  function drawList() {
    if (!cur) { $('#sgList').innerHTML = '<p class="empty">방식을 고르고 「10개 만들기」를 누르세요.</p>'; return; }
    $('#sgList').innerHTML = `<p class="hint">점수 높은 순 · 점수 = 역대 패턴 40% + 번호 흐름 25% + 인기 조합 피하기 35%</p>` +
      cur.rows.map(r => {
        const on = inTray(r.n) >= 0, rk = cur.rank.get(r.idx);
        return `<label class="sg-row${on ? ' on' : ''}"><input type="checkbox" data-k="${key(r.n)}" ${on ? 'checked' : ''}>
          <span class="balls">${balls(r.n, 'sm', v => S.fixed.has(v) ? 'ring' : '')}</span>
          <span class="sg-score">${r.total.toFixed(1)}<small>점${rk ? ` · 추천 ${rk}위` : ''}</small></span>
          <span class="sg-why">${r.notes.slice(0, 1).map(s => `<span class="plus-n">+ ${esc(s)}</span>`).join('')}${r.warns.slice(0, 1).map(s => `<span class="minus-n">− ${esc(s)}</span>`).join('')}</span></label>`;
      }).join('') +
      `<div class="toolbar"><button class="btn small" id="sgPickTop">추천 5개 모두 고르기</button><button class="btn small" id="sgPickAll">10개 모두 고르기</button></div>`;
  }
  function addTray(r) {
    if (inTray(r.n) >= 0) return true;
    if (tray.length >= 10) { toast('고른 조합은 10개까지예요. 확정하거나 몇 개 빼 주세요'); return false; }
    tray.push({ n: r.n, score: r.total, w: cur ? cur.w : S.weight }); return true;
  }
  $('#sgList').addEventListener('change', e => {
    const c = e.target.closest('input[type=checkbox]'); if (!c || !cur) return;
    const r = cur.rows.find(x => key(x.n) === c.dataset.k);
    if (c.checked) { if (!addTray(r)) c.checked = false; } else { const i = inTray(r.n); if (i >= 0) tray.splice(i, 1); }
    drawList(); drawTray();
  });
  $('#sgList').addEventListener('click', e => {
    if (!cur) return;
    if (e.target.id === 'sgPickTop') { cur.rows.filter(r => cur.rank.has(r.idx)).forEach(addTray); drawList(); drawTray(); }
    if (e.target.id === 'sgPickAll') { cur.rows.forEach(addTray); drawList(); drawTray(); }
  });
  function drawTray() {
    $('#sgTrayN').textContent = `(${tray.length}/10)`;
    $('#sgTray').innerHTML = tray.length ? tray.map((t, i) => `<div class="sg-trow"><span class="balls">${balls(t.n, 'sm')}</span><span class="hint">${t.score.toFixed(1)}점 · ${WL[t.w]}</span><button class="btn small" data-rm="${i}">빼기</button></div>`).join('')
      : '<p class="empty">아직 고른 조합이 없어요.</p>';
    $('#sgConfirm').disabled = tray.length < 1;
  }
  $('#sgTray').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) { tray.splice(+b.dataset.rm, 1); drawList(); drawTray(); } });
  $('#sgTrayClear').onclick = () => { tray.length = 0; drawList(); drawTray(); };
  $('#sgAutoFill').onclick = () => { if (!cur) { toast('먼저 10개를 만들어 주세요'); return; } for (const r of cur.rows) { if (tray.length >= 10) break; addTray(r); } drawList(); drawTray(); };

  /* 5개 추리기: 6개 이상이면 정밀 분석, 5개 이하면 그대로 */
  function pick5(list) {
    const uniq = []; const seen = new Set();
    for (const n of list) { const k = key(n); if (!seen.has(k)) { seen.add(k); uniq.push(n); } }
    if (uniq.length <= 5) return uniq.map((n, i) => ({ rank: i + 1, n, total: null, notes: [], warns: [] }));
    return P5.analyze(uniq, DRAWS, metrics).picked;
  }
  function picksHTML(picks, title, id) {
    return `<section class="p5"><header><h3>${title}</h3><span class="hint">어떤 조합이든 1등 확률은 1/${fmt(TOTAL)}로 같아요</span></header>
      ${picks.map(r => `<div class="p5-row"><span class="p5-rank">${r.rank}위</span><span class="balls">${balls(r.n, 'sm')}</span><span class="p5-total">${r.total != null ? r.total.toFixed(1) : '-'}<small>점</small></span>
        <span class="p5-why">${(r.notes || []).slice(0, 2).map(s => `<span class="plus-n">+ ${esc(s)}</span>`).join('')}${(r.warns || []).slice(0, 2).map(s => `<span class="minus-n">− ${esc(s)}</span>`).join('')}</span></div>`).join('')}
      <div class="toolbar"><button class="btn primary" data-copy5="${id}">5개 복사</button></div></section>`;
  }
  let lastPicks = {};
  document.addEventListener('click', e => { const b = e.target.closest('button[data-copy5]'); if (b && lastPicks[b.dataset.copy5]) copyText(`${NEXT}회 추천 5개\n` + lastPicks[b.dataset.copy5].map(r => `${r.rank}위: ${line(r.n)}`).join('\n')); });

  $('#sgConfirm').onclick = () => {
    if (!tray.length) return;
    const ds = today(), picks = pick5(tray.map(t => t.n));
    let rec = S.days.find(d => d.date === ds && d.round === NEXT);
    if (!rec) { rec = { date: ds, round: NEXT, sets: [] }; S.days.push(rec); }
    rec.sets.push({ t: new Date().toTimeString().slice(0, 5), combos: tray.map(t => t.n), picks: picks.map(p => p.n) });
    persist();
    lastPicks.gen = picks;
    $('#sgFinal').innerHTML = picksHTML(picks, `정밀 추천 5개 · ${dayLabel(ds)} 저장됨`, 'gen') +
      `<p class="hint">「내 번호 조회」에서 날짜별로 다시 보고, 여러 날을 모아 다시 5개로 추릴 수 있어요.</p>`;
    tray.length = 0; drawTray(); drawList();
    $('#sgFinal').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('최종 조합과 추천 5개를 저장했어요');
  };

  RENDER.generator = function () {
    $('#genTitle') && ($('#genTitle').textContent = `번호 생성기 · 제${NEXT}회용`);
    drawBoard(); drawWeight(); drawList(); drawTray();
  };

  /* ---------- 4) 내 번호 조회: 날짜별 보관함 ---------- */
  const chk = $('#tab-check');
  const box = document.createElement('div'); box.className = 'sc';
  box.innerHTML = `
    <div class="sec-head"><h2>내 번호 조회</h2><p>날짜를 하나 또는 여러 개 고르면 그날 확정한 번호를 보여 줘요. 모아서 다시 5개로 추릴 수 있어요.</p></div>
    <div class="card">
      <header><h3>회차 · 날짜 고르기</h3><div class="toolbar"><select id="scRound"></select><button class="btn small" id="scAll">전체 선택</button><button class="btn small" id="scNone">선택 해제</button></div></header>
      <div class="chips sc-days" id="scDays"></div>
    </div>
    <div id="scList"></div>
    <div class="card"><header><h3>고른 날짜의 번호를 모아 다시 5개로</h3></header>
      <div class="toolbar"><label class="hint"><input type="radio" name="scSrc" value="all" checked> 확정한 조합 전부</label><label class="hint"><input type="radio" name="scSrc" value="picks"> 그날 추천 5개만</label>
      <button class="btn primary" id="scRe5">5개로 다시 추리기</button></div>
      <div id="scRe"></div>
    </div>
    <details class="card"><summary><b>번호 직접 넣어 역대 당첨 이력 보기</b></summary><div id="scOrig"></div></details>`;
  const kids = [...chk.children];
  chk.prepend(box);
  const holder = box.querySelector('#scOrig');
  kids.forEach(k => { if (k.querySelector && k.querySelector('#svList')) k.hidden = true; else if (!k.classList.contains('sec-head')) holder.appendChild(k); else k.hidden = true; });
  let selRound = null; const selDays = new Set();

  function rounds() { return [...new Set(S.days.map(d => d.round))].sort((a, b) => b - a); }
  function drawCheck() {
    const rs = rounds();
    if (selRound == null || !rs.includes(selRound)) selRound = rs[0] || NEXT;
    $('#scRound').innerHTML = (rs.length ? rs : [NEXT]).map(r => `<option value="${r}" ${r === selRound ? 'selected' : ''}>제${r}회${BYR.has(r) ? ' (추첨 끝)' : r === NEXT ? ' (이번 주)' : ''}</option>`).join('');
    const days = S.days.filter(d => d.round === selRound).sort((a, b) => a.date.localeCompare(b.date));
    for (const d of [...selDays]) if (!days.some(x => x.date === d)) selDays.delete(d);
    $('#scDays').innerHTML = days.length ? days.map(d => `<button class="chip sc-day${selDays.has(d.date) ? ' on' : ''}" data-d="${d.date}">${dayLabel(d.date)} · ${d.sets.reduce((a, s) => a + s.combos.length, 0)}개</button>`).join('')
      : '<span class="empty">아직 저장한 날이 없어요. 번호 생성기에서 「최종 확정」을 누르면 날짜별로 쌓여요.</span>';
    drawDayList();
  }
  function resultBadge(n, round) {
    const d = BYR.get(round); if (!d) return '';
    const set = new Set(d.n), m = n.filter(v => set.has(v)).length, b = n.includes(d.b);
    const rk = m === 6 ? 1 : m === 5 && b ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
    return `<span class="pill ${rk ? 'bad' : 'neutral'}">${m}개 일치${rk ? ` · ${rk}등` : ''}</span>`;
  }
  function drawDayList() {
    const days = S.days.filter(d => d.round === selRound && selDays.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
    const draw = BYR.get(selRound);
    $('#scList').innerHTML = (draw ? `<div class="card"><header><h3>제${selRound}회 당첨번호</h3></header><span class="balls">${balls(draw.n, 'sm')}<span class="plus">+</span>${A.ball(draw.b, 'sm')}</span></div>` : '') +
      (days.length ? days.map(d => `<div class="card"><header><h3>${dayLabel(d.date)}</h3><button class="btn small" data-del="${d.date}">이 날 삭제</button></header>
        ${d.sets.map((s, si) => `<div class="sc-set"><p class="hint">${s.t} 확정 · 조합 ${s.combos.length}개</p>
          ${s.combos.map(n => `<div class="sg-trow${s.picks.some(p => key(p) === key(n)) ? ' star' : ''}"><span class="balls">${balls(n, 'sm', v => draw && (draw.n.includes(v)) ? 'ring' : '')}</span>${s.picks.some(p => key(p) === key(n)) ? '<span class="pill warn">추천 5</span>' : ''}${resultBadge(n, selRound)}</div>`).join('')}</div>`).join('')}</div>`).join('')
        : (S.days.some(d => d.round === selRound) ? '<p class="empty">위에서 날짜를 골라 주세요.</p>' : ''));
  }
  box.addEventListener('click', e => {
    const c = e.target.closest('.sc-day'); if (c) { selDays.has(c.dataset.d) ? selDays.delete(c.dataset.d) : selDays.add(c.dataset.d); drawCheck(); return; }
    const del = e.target.closest('button[data-del]');
    if (del) { if (del.dataset.armed) { S.days = S.days.filter(d => !(d.date === del.dataset.del && d.round === selRound)); persist(); drawCheck(); } else { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '이 날 삭제'; } }, 3000); } }
  });
  $('#scRound').onchange = e => { selRound = +e.target.value; selDays.clear(); drawCheck(); };
  $('#scAll').onclick = () => { S.days.filter(d => d.round === selRound).forEach(d => selDays.add(d.date)); drawCheck(); };
  $('#scNone').onclick = () => { selDays.clear(); drawCheck(); };
  $('#scRe5').onclick = () => {
    const src = (box.querySelector('input[name=scSrc]:checked') || {}).value;
    const days = S.days.filter(d => d.round === selRound && selDays.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) { toast('날짜를 먼저 골라 주세요'); return; }
    const pool = days.flatMap(d => d.sets.flatMap(s => src === 'picks' ? s.picks : s.combos));
    const picks = pick5(pool);
    lastPicks.re = picks;
    S.finals.unshift({ round: selRound, from: days.map(d => d.date), t: new Date().toISOString().slice(0, 16).replace('T', ' '), picks: picks.map(p => p.n) });
    S.finals = S.finals.slice(0, 30); persist();
    $('#scRe').innerHTML = picksHTML(picks, `${days.map(d => dayLabel(d.date)).join(' + ')} 모은 ${new Set(pool.map(key)).size}개 → 5개`, 're') +
      (BYR.has(selRound) ? `<div class="chips">${picks.map(p => resultBadge(p.n, selRound)).join('')}</div>` : '');
  };

  const origCheck = RENDER.check;
  RENDER.check = function () { origCheck(); drawCheck(); };
};
