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
  $$('#tabs button').forEach(b => { if (b.dataset.tab === 'check') b.textContent = '내 번호 조회'; if (b.dataset.tab === 'generator') b.textContent = '자동번호 생성기'; });
  const h = (location.hash || '').replace('#', '');
  if (h !== 'generator' && h !== 'check' && h !== 'manual') { try { history.replaceState(null, '', '#generator'); } catch (e) { location.hash = 'generator'; } }

  /* ---------- 3) 번호 생성기 화면 ---------- */
  const gen = $('#tab-generator');
  const orig = document.createElement('div'); orig.hidden = true; orig.id = 'origGen';
  while (gen.firstChild) orig.appendChild(gen.firstChild);
  gen.appendChild(orig);
  const ui = document.createElement('div'); ui.className = 'sg'; gen.prepend(ui);
  ui.innerHTML = `
    <div class="sec-head"><h2>자동번호 생성기 · 제${NEXT}회용</h2>
      <p>통계·필터는 자동으로 맞춰져 있어요. (최근 300회 1등 조합 기준, 역대 1등 조합의 ${(autoPass * 100).toFixed(0)}%가 통과하는 범위)</p></div>
    <div class="card">
      <header><h3>① 고정수 · 제외수 정하기</h3><button class="btn small" id="sgClear">모두 비우기</button></header>
      <p class="hint">번호를 누르면 아래에 버튼이 떠요. <b>「고정」</b>(꼭 넣을 번호, 최대 5개) · <b>「제외」</b>(빼고 싶은 번호) · <b>「해제」</b> 중에서 골라 주세요.</p>
      <div class="board" id="sgBoard"></div>
      <div class="sg-act" id="sgAct" hidden></div>
      <div class="picked" id="sgPicked"></div>
    </div>
    <div class="card">
      <header><h3>② 방식 고르면 바로 초정밀 5개</h3></header>
      <p class="hint" id="sgApply"></p>
      <div class="seg sg-seg sg-seg4" id="sgWeight" role="group" aria-label="방식">
        <button data-w="uniform">균등 무작위<small>① 고정·제외 넣어서</small></button><button data-w="uniformAll">균등 무작위<small>① 무시 · 45개 전체</small></button><button data-w="hot">핫넘버 가중<small>최근 50회 · ① 넣어서</small></button><button data-w="cold">콜드넘버 가중<small>최근 50회 · ① 넣어서</small></button><button data-w="rec" class="sg-rec">추천 고정·제외 (분석)<small>남들이 많이 사는 번호는 자동 제외 · 덜 사는 번호 우선 · ①도 함께</small></button>
      </div>
      <p class="hint">버튼을 누르면 조합 100개를 만들고 → 정밀 분석으로 15개 → 이번 회차에 저장해 둔 번호까지 함께 다시 분석해서 → <b>최종 5개</b>만 보여 줘요.</p>
      <div class="toolbar" hidden><button class="btn primary" id="sgRun">10개 만들기</button></div><span class="hint" id="sgInfo"></span>
      <div class="progress" id="sgProg" hidden><i></i></div>
    </div>
    <div id="fastOut"></div>
    <div class="card sg-old" hidden>
      <header><h3>③ 만든 조합 <span class="hint" id="sgRunsN"></span></h3><button class="btn small" id="sgRunsClear">기록 지우기</button></header>
      <p class="hint">②를 누를 때마다 「1번째, 2번째…」로 10개씩 쌓여요. 새로 만든 묶음은 자동으로 <b>선택</b>돼요. 빼고 싶은 묶음만 체크를 풀어 주세요. 묶음을 누르면 안의 10개가 보여요.</p>
      <div class="toolbar"><button class="btn small" id="sgSelAll">모두 선택</button><button class="btn small" id="sgSelNone">모두 해제</button></div>
      <div id="sgList"></div>
    </div>
    <div class="card sg-old" id="sgTrayCard" hidden>
      <header><h3>④ 정밀 추천 5개 뽑기</h3></header>
      <p class="hint" id="sgSelInfo"></p>
      <div class="toolbar"><button class="btn primary" id="sgConfirm">정밀 추천 5개 뽑기</button></div>
    </div>
    <div id="sgFinal" hidden></div>`;
  let cur = null;   // 가장 최근에 만든 10개
  const runs = [];  // 만든 기록 [{no, w, rows, rank, count}]
  let mode = S.weight || 'uniform';
  const manual = []; // 수동번호 생성기에서 담은 조합 [{n, score}]
  let manualOn = true;
  let actNum = 0;   // ①에서 버튼을 띄운 번호

  function drawBoard() {
    $('#sgBoard').innerHTML = Array.from({ length: 45 }, (_, i) => i + 1).map(v =>
      `<button class="cell${S.fixed.has(v) ? ' fix' : S.excl.has(v) ? ' excl' : ''}${actNum === v ? ' act' : ''}" data-v="${v}" aria-label="${v}번${S.fixed.has(v) ? ' 고정' : S.excl.has(v) ? ' 제외' : ''}">${v}</button>`).join('');
    const fx = [...S.fixed].sort((a, b) => a - b), ex = [...S.excl].sort((a, b) => a - b);
    $('#sgPicked').innerHTML = `<div class="picked-row"><span class="lbl">고정수 ${fx.length}/5</span>${fx.length ? balls(fx, 'sm') : '<span class="empty">없음</span>'}</div>
      <div class="picked-row"><span class="lbl">제외수 ${ex.length}</span>${ex.length ? balls(ex, 'sm strike') : '<span class="empty">없음</span>'}</div>`;
    const ap = $('#sgApply'); if (ap) ap.innerHTML = (fx.length || ex.length)
      ? `①에서 정한 <b>고정 ${fx.length ? fx.join('·') : '없음'}</b> / <b>제외 ${ex.length ? ex.join('·') : '없음'}</b> 이 그대로 들어가요. (「① 무시」만 빼고)`
      : '①에서 고정·제외를 안 정했으면 45개 번호 전체에서 만들어요.';
  }
  function drawAct() {
    const box = $('#sgAct'); if (!actNum) { box.hidden = true; box.innerHTML = ''; return; }
    const v = actNum, st = S.fixed.has(v) ? '지금 고정' : S.excl.has(v) ? '지금 제외' : '아직 선택 안 함';
    box.hidden = false;
    box.innerHTML = `<div class="sg-act-head"><b>${v}번</b> <span class="hint">${st}</span></div>
      <div class="sg-act-btns"><button class="btn fix" data-a="fix"${S.fixed.has(v) ? ' aria-pressed="true"' : ''}>고정</button><button class="btn excl" data-a="excl"${S.excl.has(v) ? ' aria-pressed="true"' : ''}>제외</button><button class="btn" data-a="none">해제</button><button class="btn" data-a="close">닫기</button></div>`;
  }
  $('#sgBoard').addEventListener('click', e => {
    const b = e.target.closest('.cell'); if (!b) return;
    actNum = +b.dataset.v; drawBoard(); drawAct();
  });
  $('#sgAct').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b || !actNum) return; const v = actNum, a = b.dataset.a;
    if (a === 'fix') {
      if (!S.fixed.has(v)) { if (S.fixed.size >= 5) { toast('고정수는 최대 5개예요'); return; } S.excl.delete(v); S.fixed.add(v); }
    } else if (a === 'excl') {
      if (!S.excl.has(v)) { if (45 - S.excl.size - 1 < 6) { toast('최소 6개 번호는 남겨야 해요'); return; } S.fixed.delete(v); S.excl.add(v); }
    } else if (a === 'none') { S.fixed.delete(v); S.excl.delete(v); }
    actNum = 0; persist(); drawBoard(); drawAct();
  });
  $('#sgClear').onclick = () => { S.fixed.clear(); S.excl.clear(); actNum = 0; persist(); drawBoard(); drawAct(); };

  function drawWeight() { $$('#sgWeight button').forEach(b => b.setAttribute('aria-pressed', b.dataset.w === mode ? 'true' : 'false')); }
  $('#sgWeight').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (b) { mode = b.dataset.w; if (mode !== 'uniformAll' && mode !== 'rec') { S.weight = mode; persist(); } drawWeight(); fastRun(); } });

  const WL = { uniform: '균등(고정·제외)', uniformAll: '균등(전체)', hot: '핫넘버', cold: '콜드넘버', manual: '수동', rec: '추천 고정·제외' };
  async function run() {
    if (S.busy) return;
    if (mode !== 'uniformAll' && 45 - S.excl.size < 6) { toast('제외수가 너무 많아요'); return; }
    S.busy = true; const btn = $('#sgRun'), prog = $('#sgProg'), bar = prog.querySelector('i');
    btn.disabled = true; btn.textContent = '계산 중…'; prog.hidden = false; bar.style.width = '0%';
    try {
      const onP = p => { bar.style.width = (p * 100).toFixed(1) + '%'; };
      let pr;
      let recNote = '';
      if (mode === 'uniformAll') { const f = S.fixed, x = S.excl; S.fixed = new Set(); S.excl = new Set(); try { pr = enumerate(10, 'uniform', onP); } finally { S.fixed = f; S.excl = x; } }
      else if (mode === 'rec') {
        // 역대 실제 당첨자 수로 계산한 번호 인기도: 많이 사는 번호 6개는 제외, 덜 사는 번호 중 1개는 고정 (① 선택이 우선)
        const beta = P5.numberPopularity ? P5.numberPopularity(DRAWS) : null;
        const f = S.fixed, x = S.excl, nf = new Set(f), nx = new Set(x);
        if (beta) {
          const order = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => beta[b] - beta[a]);
          const pop = order.filter(v => !f.has(v)).slice(0, 6);
          pop.forEach(v => { if (45 - nx.size - 1 >= 6) nx.add(v); });
          const low = order.slice(-8).filter(v => !nx.has(v) && !nf.has(v));
          if (nf.size < 5 && low.length) nf.add(low[Math.floor(Math.random() * low.length)]);
          const addF = [...nf].filter(v => !f.has(v)), addX = [...nx].filter(v => !x.has(v));
          recNote = ` (추천 고정 ${addF.join('·') || '없음'} · 추천 제외 ${addX.join('·') || '없음'})`;
        }
        S.fixed = nf; S.excl = nx; try { pr = enumerate(10, 'uniform', onP); } finally { S.fixed = f; S.excl = x; }
      }
      else pr = enumerate(10, mode, onP);
      const r = await pr;
      if (!r.count) { toast('조건을 만족하는 조합이 없어요. 고정수·제외수를 줄여 보세요'); return; }
      const list = r.list.map(n => n.slice().sort((a, b) => a - b));
      const an = list.length > 5 ? P5.analyze(list, DRAWS, metrics) : { rows: list.map((n, idx) => ({ idx, n, total: 0, notes: [], warns: [] })), picked: [] };
      const rank = new Map(an.picked.map(p => [p.idx, p.rank]));
      cur = { note: recNote, on: true, no: runs.length ? runs[0].no + 1 : 1, list, rows: an.rows.slice().sort((a, b) => b.total - a.total), rank, count: r.count, w: mode };
      runs.unshift(cur); if (runs.length > 30) runs.pop();
      $('#sgInfo').textContent = `조건 통과 ${fmt(r.count)}개 중 ${WL[mode]} 방식으로 10개 → ③에 추가(선택됨)${recNote}`;
      btn.textContent = '10개 더 만들기';
      drawList(); drawSel();
    } finally { S.busy = false; btn.disabled = false; prog.hidden = true; if (btn.textContent === '계산 중…') btn.textContent = runs.length ? '10개 더 만들기' : '10개 만들기'; }
  }
  $('#sgRun').onclick = run;

  /* ---------- ② 버튼 하나로: 100개 → 정밀 15개 → (이번 회차 저장 번호 포함) 초정밀 5개 → 저장하기 ---------- */
  let fast = null; // {picks, mode, note, pool}
  async function fastRun() {
    if (S.busy) return;
    if (mode !== 'uniformAll' && 45 - S.excl.size < 6) { toast('제외수가 너무 많아요'); return; }
    S.busy = true; const prog = $('#sgProg'), bar = prog.querySelector('i'); prog.hidden = false; bar.style.width = '0%';
    $$('#sgWeight button').forEach(b => b.disabled = true);
    $('#fastOut').innerHTML = '<div class="card"><p class="hint">분석 중이에요… (몇 초 걸려요)</p></div>';
    try {
      const onP = p => { bar.style.width = (p * 85).toFixed(1) + '%'; };
      const f0 = S.fixed, x0 = S.excl; let note = '';
      if (mode === 'uniformAll') { S.fixed = new Set(); S.excl = new Set(); }
      else if (mode === 'rec') {
        const beta = P5.numberPopularity ? P5.numberPopularity(DRAWS) : null, nf = new Set(f0), nx = new Set(x0);
        if (beta) {
          const order = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => beta[b] - beta[a]);
          order.filter(v => !f0.has(v)).slice(0, 6).forEach(v => { if (45 - nx.size - 1 >= 6) nx.add(v); });
          // 고정은 강제로 넣지 않음(5장이 모두 같은 번호를 갖게 되므로). 덜 사는 번호는 정밀 분석 점수(60%)가 알아서 고름
          note = `추천 제외(남들이 많이 사는 번호) ${[...nx].filter(v => !x0.has(v)).join('·') || '없음'} · 덜 사는 번호는 점수로 우선`;
        }
        S.fixed = nf; S.excl = nx;
      }
      let r; try { r = await enumerate(100, mode === 'hot' || mode === 'cold' ? mode : 'uniform', onP); } finally { S.fixed = f0; S.excl = x0; }
      if (!r.count) { $('#fastOut').innerHTML = ''; toast('조건을 만족하는 조합이 없어요. 고정수·제외수를 줄여 보세요'); return; }
      const list = r.list.map(n => n.slice().sort((a, b) => a - b));
      // 1단계 정밀: 100개 → 점수 상위 15개
      const top15 = P5.analyze(list, DRAWS, metrics).rows.slice().sort((a, b) => b.total - a.total).slice(0, 15).map(x => x.n);
      bar.style.width = '92%';
      // 2단계 초정밀: 15개 + 이번 회차에 저장해 둔 번호 → 5개
      const saved = S.days.filter(d => d.round === NEXT).flatMap(d => d.sets.flatMap(st => st.combos));
      const savedKeys = new Set(saved.map(key));
      const pool = []; const seen = new Set();
      for (const n of top15.concat(saved)) { const k = key(n); if (!seen.has(k)) { seen.add(k); pool.push(n); } }
      const picks = pick5(pool).map(p => ({ ...p, old: savedKeys.has(key(p.n)) }));
      bar.style.width = '100%';
      fast = { picks, mode, note, count: r.count, savedN: savedKeys.size, off: new Set() };
      drawFast();
    } finally { S.busy = false; prog.hidden = true; $$('#sgWeight button').forEach(b => b.disabled = false); }
  }
  function drawFast() {
    if (!fast) { $('#fastOut').innerHTML = ''; return; }
    const keep = fast.picks.filter(p => !fast.off.has(key(p.n)));
    $('#fastOut').innerHTML = `<div class="card sg-done"><header><h3>초정밀 추천 5개</h3><span class="pill neutral">${WL[fast.mode]}</span></header>
      <p class="hint">조건 통과 ${fmt(fast.count)}개 중 100개 → 정밀 15개${fast.savedN ? ` + 이번 회차 저장 번호 ${fast.savedN}개` : ''} → 5개${fast.note ? ` · ${esc(fast.note)}` : ''}</p>
      ${(() => { const b = P5.numberPopularity && P5.numberPopularity(DRAWS), i = b && b.info; return i ? `<p class="hint">남들이 덜 사는 번호 분석: 1~${i.last}회 실제 <b>${i.basis} 당첨자 수</b> 기준 (여러 기준 중 최근 150회 검증에서 가장 잘 맞은 것을 자동 선택${i.check != null ? `, 검증 ${i.check}` : ''})</p>` : ''; })()}
      ${fast.picks.map(p => `<label class="p5-row fast-row"><input type="checkbox" data-fk="${key(p.n)}" ${fast.off.has(key(p.n)) ? '' : 'checked'}><span class="p5-rank">${p.rank}위</span><span class="balls">${balls(p.n, 'sm')}</span><span class="p5-total">${p.total != null ? p.total.toFixed(1) : '-'}<small>점</small></span>
        <span class="p5-why">${p.old ? '<span class="pill good">이미 저장한 번호</span> ' : ''}${(p.notes || []).slice(0, 1).map(x => `<span class="plus-n">+ ${esc(x)}</span>`).join('')}${(p.warns || []).slice(0, 1).map(x => `<span class="minus-n">− ${esc(x)}</span>`).join('')}</span></label>`).join('')}
      <div class="toolbar"><button class="btn primary mn-save" id="fastSave" ${keep.length ? '' : 'disabled'}>저장하기 (${keep.length}개)</button></div>
      <div class="toolbar"><button class="btn small" id="fastAgain">같은 방식으로 다시 뽑기</button><button class="btn small" id="fastCopy">복사</button></div>
      <p class="hint">빼고 싶은 번호는 체크를 풀어 주세요. 이미 저장한 번호는 다시 저장하지 않아요. 어떤 조합이든 1등 확률은 1/${fmt(TOTAL)}로 같아요.</p></div>`;
  }
  $('#fastOut').addEventListener('change', e => { const c = e.target.closest('input[data-fk]'); if (!c || !fast) return; c.checked ? fast.off.delete(c.dataset.fk) : fast.off.add(c.dataset.fk); drawFast(); });
  $('#fastOut').addEventListener('click', e => {
    const g = e.target.closest('[data-tab-go]'); if (g) { A.showTab(g.dataset.tabGo); return; }
    if (!fast) return;
    if (e.target.id === 'fastAgain') { fastRun(); return; }
    if (e.target.id === 'fastCopy') { copyText(`${NEXT}회 추천 5개\n` + fast.picks.map(r => `${r.rank}위: ${line(r.n)}`).join('\n')); return; }
    if (e.target.id === 'fastSave') {
      const ds = today(), already = new Set(S.days.filter(d => d.round === NEXT).flatMap(d => d.sets.flatMap(st => st.combos)).map(key));
      const items = fast.picks.filter(p => !fast.off.has(key(p.n)) && !already.has(key(p.n)));
      if (!items.length) { toast('새로 저장할 번호가 없어요 (모두 이미 저장됨)'); return; }
      let rec = S.days.find(d => d.date === ds && d.round === NEXT);
      if (!rec) { rec = { date: ds, round: NEXT, sets: [] }; S.days.push(rec); }
      rec.sets.push({ t: new Date().toTimeString().slice(0, 5), combos: items.map(x => x.n), src: items.map(() => 'a'), picks: items.map(x => x.n) });
      persist(); sendSaved(items.map(x => ({ n: x.n, tag: '★자동' })), ds);
      fast = null; drawFast();
      $('#fastOut').innerHTML = `<div class="card"><p class="callout">${items.length}개를 ${dayLabel(ds)} 내 번호 조회에 저장했어요. <button class="btn small" data-tab-go="check">내 번호 조회 보기</button></p></div>`;
      toast('내 번호 조회에 저장했어요');
      return;
    }
  });

  function rowHTML(run, r) {
    const rk = run.rank.get(r.idx);
    return `<div class="sg-row"><span class="balls">${balls(r.n, 'sm', v => S.fixed.has(v) ? 'ring' : '')}</span>
      <span class="sg-score">${r.total.toFixed(1)}<small>점${rk ? ` · 묶음 추천 ${rk}위` : ''}</small></span>
      <span class="sg-why">${r.notes.slice(0, 1).map(x => `<span class="plus-n">+ ${esc(x)}</span>`).join('')}${r.warns.slice(0, 1).map(x => `<span class="minus-n">− ${esc(x)}</span>`).join('')}</span></div>`;
  }
  function drawList() {
    const onN = runs.filter(r => r.on).length;
    $('#sgRunsN').textContent = runs.length ? `${runs.length}묶음 · 선택 ${onN}묶음` : '';
    const man = manual.length ? `<div class="sg-run sg-runsel${manualOn ? ' on' : ''}"><div class="sg-runhead"><label class="sg-chk"><input type="checkbox" data-man ${manualOn ? 'checked' : ''}><b>수동으로 담은 조합</b></label><span class="hint">${manual.length}개</span></div>
        ${manual.map((m, i) => `<div class="sg-trow"><span class="balls">${balls(m.n, 'sm')}</span><span class="hint">${m.score.toFixed(1)}점</span><button class="btn small" data-mrm="${i}">빼기</button></div>`).join('')}</div>` : '';
    if (!runs.length) { $('#sgList').innerHTML = man + '<p class="empty">②에서 방식을 고르고 「10개 만들기」를 누르세요.</p>'; return; }
    $('#sgList').innerHTML = man + runs.slice().reverse().map(run => `<details class="sg-run sg-runsel${run.on ? ' on' : ''}"><summary><label class="sg-chk" onclick="event.stopPropagation()"><input type="checkbox" data-run="${run.no}" ${run.on ? 'checked' : ''}><b>${run.no}번째</b></label> <span class="pill neutral">${WL[run.w]}</span> <span class="hint">10개 · 펼쳐 보기${run.note ? esc(run.note) : ''}</span></summary>
        ${run.rows.map(r => rowHTML(run, r)).join('')}</details>`).join('');
  }
  const findRun = no => runs.find(r => r.no === +no);
  function selectedCombos() {
    const out = [], seen = new Set();
    const add = (n, src) => { const k = key(n); if (!seen.has(k)) { seen.add(k); out.push({ n, src }); } };
    if (manualOn) manual.forEach(m => add(m.n, 'm'));
    runs.filter(r => r.on).forEach(r => r.rows.forEach(x => add(x.n, 'a')));
    return out;
  }
  function drawSel() {
    const sel = selectedCombos(), runN = runs.filter(r => r.on).length, manN = manualOn ? manual.length : 0;
    $('#sgSelInfo').innerHTML = sel.length
      ? `③에서 선택한 <b>${runN}묶음${manN ? ` + 수동 ${manN}개` : ''}</b>, 모두 <b>${sel.length}개 조합</b>을 정밀 분석해서 가장 좋은 5개만 골라요.`
      : '③에서 묶음을 하나 이상 선택해 주세요.';
    $('#sgConfirm').disabled = !sel.length;
    if (typeof drawDone === 'function' && document.getElementById('doneCard')) drawDone();
  }
  const drawTray = drawSel; // 예전 이름 호환
  $('#sgList').addEventListener('change', e => {
    const c = e.target.closest('input[type=checkbox]'); if (!c) return;
    if (c.hasAttribute('data-man')) manualOn = c.checked;
    else { const run = findRun(c.dataset.run); if (run) run.on = c.checked; }
    drawList(); drawSel();
  });
  $('#sgList').addEventListener('click', e => {
    const b = e.target.closest('button[data-mrm]'); if (!b) return;
    manual.splice(+b.dataset.mrm, 1); drawList(); drawSel(); if (typeof drawMList === 'function') drawMList();
  });
  $('#sgSelAll').onclick = () => { runs.forEach(r => r.on = true); manualOn = true; drawList(); drawSel(); };
  $('#sgSelNone').onclick = () => { runs.forEach(r => r.on = false); manualOn = false; drawList(); drawSel(); };
  $('#sgRunsClear').onclick = () => { runs.length = 0; cur = null; drawList(); drawSel(); };

  /* 저장할 때 핸드폰 알림 (계정이 켜져 있을 때) */
  function sendSaved(items, ds) {
    const acc = window.LottoAccount; if (!acc || !acc.user || !acc.notifyKo) return;
    const circ = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
    const lines = [`${dayLabel(ds)} ${new Date().toTimeString().slice(0, 5)} 저장 · ${items.length}개`].concat(items.slice(0, 15).map((it, i) => `${circ[i] || '·'} ${line(it.n)}  ${it.tag}`));
    if (items.length > 15) lines.push(`외 ${items.length - 15}개`);
    acc.notifyKo(`🎱 제${NEXT}회 내 번호 저장`, lines).then(ok => { if (ok) toast('핸드폰으로 알림을 보냈어요'); });
  }
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
    const sel = selectedCombos(); if (!sel.length) return;
    const picks = pick5(sel.map(t => t.n));
    lastPicks.gen = picks; doneTouch('gen');
    $('#sgFinal').innerHTML = picksHTML(picks, '정밀 추천 5개', 'gen') + '<p class="hint">맨 아래 ⑥에서 적용할 것을 고르고 「확인」을 누르면 내 번호 조회에 저장돼요.</p>';
    drawDone();
    $('#sgFinal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };


  /* ---------- 3-2) 수동 선택 ---------- */
  const tabBtn = document.createElement('button'); tabBtn.setAttribute('role', 'tab'); tabBtn.dataset.tab = 'manual'; tabBtn.textContent = '수동번호 생성기';
  $('#tabs button[data-tab="generator"]').after(tabBtn);
  TABS.push('manual');
  const msec = document.createElement('section'); msec.className = 'tab'; msec.id = 'tab-manual'; msec.hidden = true;
  gen.after(msec);
  msec.innerHTML = `<div class="sg">
    <div class="sec-head"><h2>수동번호 생성기 · 제${NEXT}회용</h2><p>번호 6개를 직접 고르고 「저장하기」를 누르면 내 번호 조회에 들어가요. 6개를 다 고르면 점수와 역대 이력도 아래에 보여 줘요.</p></div>
    <div class="card">
      <header><h3>번호 6개 고르기 <span id="mnN"></span></h3><div class="toolbar"><button class="btn small" id="mnFill">남은 칸 자동</button><button class="btn small" id="mnClear">지우기</button></div></header>
      <div class="mn-wrap">
        <div class="board mn-board" id="mnBoard"></div>
        <div class="mn-side">
          <div class="lbl">고른 번호</div>
          <div class="balls" id="mnPicked"></div>
          <button class="btn primary mn-save" id="mnSave" disabled>저장하기</button>
          <p class="hint" id="mnSaveHint">6개를 고르면 저장할 수 있어요. 저장하면 내 번호 조회에 들어가요.</p>
          <div id="mnSaved"></div>
        </div>
      </div>
    </div>
    <div id="mnOut"></div>
  </div>`;
  const mpick = [];
  function drawManual() {
    $('#mnBoard').innerHTML = Array.from({ length: 45 }, (_, i) => i + 1).map(v => `<button class="cell${mpick.includes(v) ? ' fix' : ''}" data-v="${v}">${v}</button>`).join('');
    const n = mpick.slice().sort((a, b) => a - b);
    $('#mnN').textContent = `(${n.length}/6)`;
    $('#mnPicked').innerHTML = n.length ? balls(n, 'sm') : '<span class="empty">번호판에서 눌러 고르세요</span>';
    $('#mnSave').disabled = n.length !== 6;
    $('#mnSave').textContent = n.length === 6 ? '저장하기' : `저장하기 (${6 - n.length}개 더)`;
    if (n.length < 6) { $('#mnOut').innerHTML = ''; } else {
      const r = P5.analyze([n], DRAWS, metrics).rows[0], h = checkCombo(n), m = metrics(n, LAST.n);
      $('#mnOut').innerHTML = `<div class="card"><header><h3>분석 결과</h3><span class="sg-score">${r.total.toFixed(1)}<small>점</small></span></header>
        <div class="chips"><span class="chip">역대 패턴 <b>${r.pattern.toFixed(0)}</b></span><span class="chip">번호 흐름 <b>${r.flow.toFixed(0)}</b></span><span class="chip">남들이 덜 사는 번호 <b>${r.pop.toFixed(0)}</b></span>
          <span class="chip">합 <b>${m.sum}</b></span><span class="chip">홀짝 <b>${m.odd}:${6 - m.odd}</b></span><span class="chip">AC <b>${m.ac}</b></span></div>
        <div class="mn-why">${r.notes.map(x => `<span class="plus-n">+ ${esc(x)}</span>`).join('')}${r.warns.map(x => `<span class="minus-n">− ${esc(x)}</span>`).join('')}</div>
        <p class="hint">역대 ${fmt(DRAWS.length)}회에 매주 이 번호였다면: ${h.best ? `최고 ${h.best}등, ` : '4등 이상 없음, '}5등 ${h.ranks[5]}번${h.ranks[4] ? ` · 4등 ${h.ranks[4]}번` : ''}${A.WIN_KEYS.has(A.keyOf(n)) ? ' · <b>역대 1등 조합과 똑같아요</b>' : ''}</p>
        <div class="toolbar"><button class="btn" id="mnCopy">복사</button></div></div>`;
      $('#mnCopy').onclick = () => copyText(line(n));
    }
    drawMList();
  }
  function drawMList() {
    const ds = today(), rec = S.days.find(d => d.date === ds && d.round === NEXT);
    const mine = rec ? rec.sets.flatMap(st => st.combos.filter((c, i) => (st.src || [])[i] === 'm')) : [];
    $('#mnSaved').innerHTML = mine.length ? `<div class="lbl" style="margin-top:6px">오늘 저장한 수동 번호 ${mine.length}개</div>${mine.slice(-5).map(c => `<div class="balls">${balls(c, 'sm')}</div>`).join('')}<button class="btn small" data-tab-go="check">내 번호 조회 보기</button>` : '';
  }
  $('#mnSave').onclick = () => {
    const n = mpick.slice().sort((a, b) => a - b); if (n.length !== 6) return;
    const ds = today(); let rec = S.days.find(d => d.date === ds && d.round === NEXT);
    if (!rec) { rec = { date: ds, round: NEXT, sets: [] }; S.days.push(rec); }
    rec.sets.push({ t: new Date().toTimeString().slice(0, 5), combos: [n], src: ['m'], picks: [] }); persist();
    sendSaved([{ n, tag: '수동' }], ds);
    toast(`${dayLabel(ds)} 내 번호 조회에 저장했어요`);
    mpick.length = 0; drawManual();
  };
  $('#mnBoard').addEventListener('click', e => {
    const b = e.target.closest('.cell'); if (!b) return; const v = +b.dataset.v, i = mpick.indexOf(v);
    if (i >= 0) mpick.splice(i, 1); else if (mpick.length < 6) mpick.push(v); else { toast('6개까지 고를 수 있어요'); return; }
    drawManual();
  });
  $('#mnClear').onclick = () => { mpick.length = 0; drawManual(); };
  $('#mnFill').onclick = () => { while (mpick.length < 6) { const v = 1 + Math.floor(Math.random() * 45); if (!mpick.includes(v)) mpick.push(v); } drawManual(); };
  msec.addEventListener('click', e => { const g = e.target.closest('[data-tab-go]'); if (g) A.showTab(g.dataset.tabGo); });
  RENDER.manual = drawManual;

  RENDER.generator = function () {
    $('#genTitle') && ($('#genTitle').textContent = `번호 생성기 · 제${NEXT}회용`);
    drawBoard(); drawWeight(); drawList(); drawTray();
  };

  /* ---------- 3-3) 자동번호 생성기 안: 저장한 날짜 모아 다시 5개로 ---------- */
  const reCard = document.createElement('div'); reCard.className = 'card'; reCard.id = 'reCard';
  reCard.innerHTML = `<header><h3>⑤ 저장한 날짜 모아 다시 5개로</h3><div class="toolbar"><button class="btn small" id="reAll">전체 선택</button><button class="btn small" id="reNone">선택 해제</button></div></header>
    <p class="hint">제${NEXT}회용으로 저장한 날짜를 하나·여러 개·전체 골라, 그 번호들을 모아 다시 정밀 추천 5개로 추려요.</p>
    <div class="chips sc-days" id="reDays"></div>
    <div class="toolbar"><label class="hint"><input type="radio" name="reSrc" value="all" checked> 확정한 조합 전부</label><label class="hint"><input type="radio" name="reSrc" value="picks"> 그날 추천 5개만</label>
      <button class="btn primary" id="reRun">5개로 다시 추리기</button></div>
    <div id="reOut"></div>`;
  $('#sgFinal').after(reCard); reCard.hidden = true;
  const reSel = new Set(); let reTouched = false;
  function drawRe() {
    const days = S.days.filter(d => d.round === NEXT && d.sets.some(x => !x.re)).sort((a, b) => a.date.localeCompare(b.date));
    for (const d of [...reSel]) if (!days.some(x => x.date === d)) reSel.delete(d);
    if (!reSel.size && !reTouched) days.forEach(d => reSel.add(d.date));
    $('#reDays').innerHTML = days.length ? days.map(d => `<button class="chip sc-day${reSel.has(d.date) ? ' on' : ''}" data-d="${d.date}">${dayLabel(d.date)} · ${d.sets.filter(x => !x.re).reduce((a, x) => a + x.combos.length, 0)}개</button>`).join('')
      : '<span class="empty">아직 저장한 날이 없어요. ⑥에서 「확인」을 하면 날짜가 생겨요.</span>';
  }
  reCard.addEventListener('click', e => { const c = e.target.closest('.sc-day'); if (c) { reTouched = true; reSel.has(c.dataset.d) ? reSel.delete(c.dataset.d) : reSel.add(c.dataset.d); drawRe(); } });
  $('#reAll').onclick = () => { S.days.filter(d => d.round === NEXT).forEach(d => reSel.add(d.date)); drawRe(); };
  $('#reNone').onclick = () => { reTouched = true; reSel.clear(); drawRe(); };
  $('#reRun').onclick = () => {
    const src = (reCard.querySelector('input[name=reSrc]:checked') || {}).value;
    const days = S.days.filter(d => d.round === NEXT && reSel.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) { toast('날짜를 먼저 골라 주세요'); return; }
    const pool = days.flatMap(d => d.sets.filter(x => !x.re).flatMap(x => src === 'picks' ? x.picks : x.combos));
    if (!pool.length) { toast('고른 날짜에 추천 5개가 없어요. 「확정한 조합 전부」로 해 보세요'); return; }
    const picks = pick5(pool);
    lastPicks.re = picks; doneTouch('re');
    $('#reOut').innerHTML = picksHTML(picks, `${days.map(d => dayLabel(d.date)).join(' + ')} 모은 ${new Set(pool.map(key)).size}개 → 5개`, 're') + '<p class="hint">⑥에서 「확인」을 눌러야 저장돼요.</p>';
    drawDone();
  };
  const genRender = RENDER.generator;
  RENDER.generator = function () { genRender(); drawRe(); };
  


  /* ---------- 3-4) ⑥ 최종 선택 → 확인 → 내 번호 조회 ---------- */
  const doneCard = document.createElement('div'); doneCard.className = 'card sg-done'; doneCard.id = 'doneCard';
  reCard.after(doneCard); doneCard.hidden = true;
  const offG = new Set(), offI = new Set(), seenSel = new Set(); // ③ 전부 묶음은 처음엔 '빼기'
  function doneTouch(g) { offG.delete(g); [...offI].filter(k => k.startsWith(g + '|')).forEach(k => offI.delete(k)); }
  function groups() {
    const srcOf = n => manual.some(x => key(x.n) === key(n)) ? 'm' : 'a';
    const g = [];
    const sel = selectedCombos();
    if (sel.length) { if (!seenSel.has('sel')) { seenSel.add('sel'); offG.add('sel'); } g.push({ id: 'sel', title: `③에서 선택한 조합 전부 (${sel.length}개)`, items: sel }); }
    if (lastPicks.gen && lastPicks.gen.length) g.push({ id: 'gen', title: '정밀 추천 5개', items: lastPicks.gen.map(p => ({ n: p.n, src: srcOf(p.n), pick: true })) });
    if (lastPicks.re && lastPicks.re.length) g.push({ id: 're', title: '⑤ 다시 추린 5개', items: lastPicks.re.map(p => ({ n: p.n, src: 'r', pick: true })) });
    return g;
  }
  function chosen() {
    const out = new Map();
    for (const g of groups()) { if (offG.has(g.id)) continue; for (const it of g.items) { if (offI.has(g.id + '|' + key(it.n))) continue; const k = key(it.n); const o = out.get(k); out.set(k, { n: it.n, src: o && o.src !== 'r' ? o.src : it.src, pick: (o && o.pick) || !!it.pick }); } }
    return [...out.values()];
  }
  const SRCL = { a: '자동', m: '수동', r: '다시 5' };
  function drawDone() {
    const gs = groups(), ch = chosen();
    doneCard.innerHTML = `<header><h3>⑥ 최종 선택</h3><span class="hint">저장할 번호 ${ch.length}개</span></header>
      <p class="hint">위에서 나온 것들을 묶음마다 <b>적용</b> 또는 <b>빼기</b>로 고르고, 번호 하나씩도 뺄 수 있어요. 「확인」을 누르면 내 번호 조회에 저장돼요.</p>
      ${gs.length ? gs.map(g => { const off = offG.has(g.id); return `<div class="sg-dgroup${off ? ' off' : ''}"><div class="sg-dhead"><b>${g.title}</b> <span class="hint">${g.items.length}개</span>
          <div class="seg"><button data-g="${g.id}" data-on="1" aria-pressed="${!off}">적용</button><button data-g="${g.id}" data-on="0" aria-pressed="${off}">빼기</button></div></div>
          ${g.items.map(it => `<label class="sg-trow"><input type="checkbox" data-gi="${g.id}|${key(it.n)}" ${off ? 'disabled' : ''} ${!off && !offI.has(g.id + '|' + key(it.n)) ? 'checked' : ''}><span class="pill ${it.src === 'm' ? 'warn' : it.src === 'r' ? 'good' : 'neutral'}">${SRCL[it.src]}</span><span class="balls">${balls(it.n, 'sm')}</span></label>`).join('')}</div>`; }).join('')
        : '<p class="empty">④에서 정밀 추천 5개를 뽑으면 여기에 모여요.</p>'}
      <div class="toolbar"><button class="btn primary" id="doneOk" ${ch.length ? '' : 'disabled'}>확인 — 내 번호 조회에 저장 (${ch.length}개)</button></div>`;
  }
  doneCard.addEventListener('click', e => {
    const b = e.target.closest('button[data-g]');
    if (b) { b.dataset.on === '1' ? offG.delete(b.dataset.g) : offG.add(b.dataset.g); drawDone(); return; }
    if (e.target.id === 'doneOk') {
      const ch = chosen(); if (!ch.length) return;
      const ds = today(); let rec = S.days.find(d => d.date === ds && d.round === NEXT);
      if (!rec) { rec = { date: ds, round: NEXT, sets: [] }; S.days.push(rec); }
      rec.sets.push({ t: new Date().toTimeString().slice(0, 5), combos: ch.map(x => x.n), src: ch.map(x => x.src), picks: ch.filter(x => x.pick).map(x => x.n) });
      persist();
      sendSaved(ch.map(x => ({ n: x.n, tag: (x.pick ? '★' : '') + SRCL[x.src] })), ds);
      manual.length = 0; runs.forEach(r => r.on = false); lastPicks.gen = null; lastPicks.re = null; offG.clear(); offI.clear(); seenSel.clear();
      $('#sgFinal').innerHTML = ''; $('#reOut').innerHTML = '';
      drawTray(); drawList(); drawRe(); drawDone();
      doneCard.insertAdjacentHTML('beforeend', `<p class="callout">${ch.length}개를 ${dayLabel(ds)}에 저장했어요. <button class="btn small" data-tab-go="check">내 번호 조회 보기</button></p>`);
      toast('내 번호 조회에 저장했어요');
    }
    const g = e.target.closest('[data-tab-go]'); if (g) A.showTab(g.dataset.tabGo);
  });
  doneCard.addEventListener('change', e => { const c = e.target.closest('input[data-gi]'); if (!c) return; c.checked ? offI.delete(c.dataset.gi) : offI.add(c.dataset.gi); drawDone(); });
  const genRender2 = RENDER.generator;
  RENDER.generator = function () { genRender2(); drawDone(); };

  /* ---------- 4) 내 번호 조회: 선택(확정)한 번호 전부 ---------- */
  const chk = $('#tab-check');
  const box = document.createElement('div'); box.className = 'sc';
  box.innerHTML = `
    <div class="sec-head"><h2>내 번호 조회</h2><p>자동·수동으로 확정한 번호와 다시 추린 5개를 모두 보여 줘요. 추첨이 끝나면 맞은 개수가 표시돼요.</p></div>
    <div id="scList"></div>
    <div id="scOrig" hidden></div>`;
  const kids = [...chk.children];
  chk.prepend(box);
  const holder = box.querySelector('#scOrig');
  kids.forEach(k => holder.appendChild(k));

  function resultBadge(n, round) {
    const d = BYR.get(round); if (!d) return '';
    const set = new Set(d.n), m = n.filter(v => set.has(v)).length, b = n.includes(d.b);
    const rk = m === 6 ? 1 : m === 5 && b ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
    return `<span class="pill ${rk ? 'bad' : 'neutral'}">${m}개 일치${rk ? ` · ${rk}등` : ''}</span>`;
  }
  const SRC = { a: ['자동', 'neutral'], m: ['수동', 'warn'], r: ['다시 5', 'good'] };
  function drawCheck() {
    const rs = [...new Set(S.days.map(d => d.round))].sort((a, b) => b - a);
    if (!rs.length) { $('#scList').innerHTML = '<p class="empty">아직 확정한 번호가 없어요. 자동번호 생성기에서 「최종 확정」, 수동번호 생성기에서 「오늘 날짜로 바로 저장」을 누르면 여기에 쌓여요.</p>'; return; }
    $('#scList').innerHTML = rs.map(r => {
      const draw = BYR.get(r), days = S.days.filter(d => d.round === r).sort((a, b) => b.date.localeCompare(a.date));
      const total = days.reduce((a, d) => a + d.sets.reduce((x, s) => x + s.combos.length, 0), 0);
      return `<div class="card"><header><h3>제${r}회 ${r === NEXT ? '<span class="pill neutral">이번 주</span>' : ''}</h3><span class="hint">번호 ${total}개</span></header>
        ${draw ? `<div class="picked-row"><span class="lbl">당첨번호</span><span class="balls">${balls(draw.n, 'sm')}<span class="plus">+</span>${A.ball(draw.b, 'sm')}</span></div>` : ''}
        ${days.map(d => `<div class="sc-set"><div class="sc-dayhead"><b>${dayLabel(d.date)}</b><button class="btn small" data-del="${r}|${d.date}">이 날 삭제</button></div>
          ${d.sets.map(s => s.combos.map((n, ci) => { const sc = SRC[(s.src || [])[ci]] || (/ 수동$/.test(s.t) ? SRC.m : SRC.a); const star = !s.re && s.picks.some(p => key(p) === key(n));
            return `<div class="sg-trow${star ? ' star' : ''}"><span class="pill ${sc[1]}">${sc[0]}</span><span class="balls">${balls(n, 'sm', v => draw && draw.n.includes(v) ? 'ring' : '')}</span>${star ? '<span class="pill bad">추천 5</span>' : ''}${resultBadge(n, r)}</div>`; }).join('')).join('')}
        </div>`).join('')}</div>`;
    }).join('');
  }
  box.addEventListener('click', e => {
    const del = e.target.closest('button[data-del]'); if (!del) return;
    if (del.dataset.armed) { const [r, ds] = del.dataset.del.split('|'); S.days = S.days.filter(d => !(d.date === ds && d.round === +r)); persist(); drawCheck(); }
    else { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '이 날 삭제'; } }, 3000); }
  });

  const origCheck = RENDER.check;
  RENDER.check = function () { origCheck(); drawCheck(); };
};
