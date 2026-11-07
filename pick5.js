/* 로또 6/45 분석기 — 생성된 조합 중에서 정밀 추천 5개를 고르는 엔진
 * 화면(index.html)과 채팅 명령(tools/lotto_cli.js)이 같은 이 파일을 씁니다.
 *
 * 점수 구성 (각 0~100점)
 *  1) 패턴 적합도 40% : 합계·홀짝·저고·AC·끝수합·연번·동끝수·번호대·소수·이월·이웃 값이
 *                       역대 1등 조합에서 얼마나 흔했는지
 *  2) 번호 흐름    5% : 최근 100회 출현 빈도 + 궁합 (2026-11-07 백테스트에서 효과 없음 → 25%→5%)
 *  3) 인기 조합 회피 60% : ① 실제 당첨자 수로 계산한 번호 인기도 70% (262회~최신, 매번 자동 재계산,
 *                          앞 절반으로 배워 뒷 절반 예측 상관 0.48로 검증)
 *                       ② 생일번호만·용지 한 줄 몰림·등차·직전 회차 다수 등 극단적 모양 감점 30%
 *                       남들이 많이 사는 번호일수록 감점 (당첨 시 나눠 갖는 사람 수를 줄임)
 *  선택 단계에서 이미 고른 조합과 번호가 겹치면 겹친 개수만큼 감점해 5개가 서로 다른 번호를 쓰게 합니다.
 *
 * 어떤 조합이든 1등 확률은 1/8,145,060 으로 같습니다. 이 점수는 확률을 바꾸지 않습니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LottoPick5 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W_PATTERN = 0.35, W_FLOW = 0.05, W_POP = 0.60, OVERLAP_PENALTY = 6;
  const P3 = 228 / 8145060; // 3등(5개 일치) 확률
  /* 번호 인기도: 회차별 3등 당첨자 수가 무작위 기대보다 많으면 그 번호들을 많은 사람이 산 것.
     log(실제/기대) ≈ 6개 번호 인기도의 평균 → 릿지 회귀(λ=0.5)로 번호별 값(로그 배수)을 구함 */
  const POP_CACHE = new WeakMap();
  function numberPopularity(draws) {
    if (POP_CACHE.has(draws)) return POP_CACHE.get(draws);
    const use = draws.filter(d => d.r >= 262 && d.sales > 0 && d.w3c != null);
    let beta = null;
    if (use.length >= 200) {
      const ys = use.map(d => Math.log(Math.max(d.w3c / (d.sales / 1000 * P3), 0.05)));
      const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
      const A = Array.from({ length: 45 }, () => new Float64Array(46)); // [X'X+λI | X'y]
      use.forEach((d, i) => {
        const y = ys[i] - ym;
        for (const a of d.n) { A[a - 1][45] += y / 6; for (const b of d.n) A[a - 1][b - 1] += 1 / 36; }
      });
      for (let i = 0; i < 45; i++) A[i][i] += 0.5;
      for (let c = 0; c < 45; c++) { // 가우스 소거
        let p = c; for (let r = c + 1; r < 45; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        for (let r = 0; r < 45; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; if (f) for (let k = c; k <= 45; k++) A[r][k] -= f * A[c][k]; }
      }
      beta = new Float64Array(46); for (let i = 0; i < 45; i++) beta[i + 1] = A[i][45] / A[i][i];
    }
    POP_CACHE.set(draws, beta);
    return beta;
  }
  const PATTERN_KEYS = [
    ['sum', '합계', 10], ['odd', '홀수', 1], ['low', '저번호', 1], ['ac', 'AC', 1], ['endSum', '끝수합', 4],
    ['consec', '연번', 1], ['sameEnd', '동끝수', 1], ['sameGroup', '번호대 몰림', 1], ['prime', '소수', 1],
    ['carry', '이월수', 1], ['neighbor', '이웃수', 1],
  ];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* draws: [{r, n:[6개 정렬], m:metrics}] (오래된 회차 → 최신 순), metrics(n, prevN) */
  function analyze(list, draws, metrics) {
    const LAST = draws[draws.length - 1];
    // 1) 패턴 분포표
    const dist = {};
    for (const [k, , w] of PATTERN_KEYS) {
      const c = new Map(); let t = 0;
      for (const d of draws) { const x = d.m[k]; if (x == null) continue; t++; const b = Math.floor(x / w); c.set(b, (c.get(b) || 0) + 1); }
      dist[k] = { c, t, max: Math.max(...c.values()) };
    }
    // 2) 최근 100회 빈도 → 번호별 백분위
    const R = draws.slice(-100), f100 = new Array(46).fill(0);
    for (const d of R) for (const v of d.n) f100[v]++;
    const order = []; for (let v = 1; v <= 45; v++) order.push(v);
    order.sort((a, b) => f100[a] - f100[b]);
    const pctl = new Array(46).fill(0);
    order.forEach((v, i) => { pctl[v] = i / 44 * 100; });
    // 궁합: 두 번호가 같은 회차에 나온 횟수
    const pair = Array.from({ length: 46 }, () => new Uint16Array(46));
    for (const d of draws) for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { pair[d.n[i]][d.n[j]]++; pair[d.n[j]][d.n[i]]++; }
    const pairExp = draws.length * 15 / 990; // 무작위일 때 한 쌍의 기대 동반 횟수
    const winKeys = new Set(draws.map(d => d.n.join(',')));
    const prevSet = new Set(LAST.n);
    const beta = numberPopularity(draws);

    const rows = list.map((n0, idx) => {
      const n = n0.slice().sort((a, b) => a - b), m = metrics(n, LAST.n), notes = [], warns = [];
      // 1) 패턴
      let ps = 0; const rare = [];
      for (const [k, label, w] of PATTERN_KEYS) {
        const D = dist[k], x = m[k]; if (x == null) continue;
        const share = (D.c.get(Math.floor(x / w)) || 0) / D.max; ps += share;
        if (share < 0.25) rare.push(label);
      }
      const pattern = ps / PATTERN_KEYS.length * 100;
      if (rare.length) warns.push(`드문 패턴: ${rare.join('·')}`);
      else notes.push(`합 ${m.sum}·홀짝 ${m.odd}:${6 - m.odd}·AC ${m.ac} 모두 역대에 흔한 모양`);
      // 2) 흐름
      const freqScore = n.reduce((a, v) => a + pctl[v], 0) / 6;
      let pc = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) pc += pair[n[i]][n[j]];
      const pairRatio = pc / 15 / pairExp, pairScore = clamp((pairRatio - 0.75) / 0.5, 0, 1) * 100;
      const flow = freqScore * 0.6 + pairScore * 0.4;
      const hot = n.filter(v => pctl[v] >= 70);
      if (hot.length >= 2) notes.push(`최근 100회 자주 나온 번호 ${hot.join('·')}`);
      if (pairRatio >= 1.08) notes.push(`번호끼리 궁합 평균의 ${(pairRatio * 100).toFixed(0)}%`);
      // 3) 인기 조합 회피 — ① 실제 데이터 번호 인기도
      let dataPop = null;
      if (beta) {
        const lp = n.reduce((a, v) => a + beta[v], 0) / 6, mult = Math.exp(lp);
        dataPop = clamp(50 - lp / 0.13 * 50, 0, 100);
        const many = n.filter(v => beta[v] >= 0.1), few = n.filter(v => beta[v] <= -0.1);
        if (mult <= 0.95) notes.push(`남들이 덜 사는 번호 위주 — 당첨자 예상 ${mult.toFixed(2)}배${few.length ? ` (${few.join('·')})` : ''}`);
        else if (mult >= 1.05) warns.push(`남들이 많이 사는 번호 위주 — 당첨자 예상 ${mult.toFixed(2)}배${many.length ? ` (${many.join('·')})` : ''}`);
      }
      // ② 극단적 모양 감점
      let pop = 100; const pen = (p, msg) => { pop -= p; warns.push(msg); };
      if (n[5] <= 31) pen(30, '생일번호(1~31)로만 구성 — 많이 고르는 모양');
      else if (n.filter(v => v <= 12).length >= 4) pen(10, '1~12 번호 4개 이상');
      const cols = new Array(7).fill(0), rws = new Array(7).fill(0);
      for (const v of n) { cols[(v - 1) % 7]++; rws[Math.floor((v - 1) / 7)]++; }
      if (Math.max(...cols) >= 3) pen(12, '용지 같은 세로줄에 3개 이상');
      if (Math.max(...rws) >= 3) pen(12, '용지 같은 가로줄에 3개 이상');
      const diffs = []; for (let i = 1; i < 6; i++) diffs.push(n[i] - n[i - 1]);
      let run = 1, best = 1; for (let i = 1; i < 5; i++) { run = diffs[i] === diffs[i - 1] ? run + 1 : 1; best = Math.max(best, run); }
      if (best >= 3) pen(20, '일정한 간격(등차) 번호 4개 이상');
      const carried = n.filter(v => prevSet.has(v)).length;
      if (carried >= 3) pen(20, `직전 회차 번호 ${carried}개 포함`);
      if (n.filter(v => v % 5 === 0).length >= 3 || n.filter(v => v % 7 === 0).length >= 3) pen(10, '5·7의 배수 몰림');
      if (m.consec >= 2) pen(8, '연번 2쌍 이상');
      if (winKeys.has(n.join(','))) pen(40, '역대 1등 조합과 동일');
      pop = clamp(pop, 0, 100);
      if (dataPop != null) pop = dataPop * 0.7 + pop * 0.3;
      const total = pattern * W_PATTERN + flow * W_FLOW + pop * W_POP;
      return { idx, n, m, pattern, flow, pop, total, notes, warns };
    });

    // 다양성 고려 탐욕 선택
    const picked = [], left = rows.slice(), K = Math.min(5, rows.length);
    while (picked.length < K) {
      let bi = 0, bs = -1e9;
      left.forEach((r, i) => {
        let ov = 0; for (const p of picked) for (const v of r.n) if (p.n.includes(v)) ov++;
        const s = r.total - ov * OVERLAP_PENALTY;
        if (s > bs) { bs = s; bi = i; }
      });
      const r = left.splice(bi, 1)[0]; r.adj = bs; r.rank = picked.length + 1; picked.push(r);
    }
    const covered = new Set(); picked.forEach(p => p.n.forEach(v => covered.add(v)));
    return { rows, picked, covered: covered.size, weights: { pattern: W_PATTERN, flow: W_FLOW, pop: W_POP, overlap: OVERLAP_PENALTY } };
  }
  return { analyze, PATTERN_KEYS, numberPopularity };
});
