#!/usr/bin/env node
/* 로또 6/45 분석기 — 채팅 명령용 번호 생성기
 * 화면의 "번호 생성기 → 조합 만들기"와 같은 방식(분석 사이트 추천 필터 + 역대 1등 조합 제외)으로
 * 조건을 통과하는 조합 전체를 센 뒤 무작위로 N개(기본 10개)를 고르고,
 * pick5.js 로 그중 정밀 추천 5개를 다시 고릅니다.
 *
 * 사용법
 *   node tools/lotto_cli.js [--count 10] [--weight uniform|hot|cold] [--fix "7 13"] [--excl "1 4 9"]
 *                           [--top 5] [--seed 1234] [--json] [--data data/lotto_data.js]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

/* ---------- 인자 ---------- */
const args = process.argv.slice(2), opt = { count: 10, weight: 'uniform', fix: '', excl: '', top: 5, json: false, seed: null, data: path.join(ROOT, 'data/lotto_data.js'), noFilter: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i], nx = () => args[++i];
  if (a === '--count') opt.count = Math.max(1, Math.min(50, +nx()));
  else if (a === '--weight') opt.weight = nx();
  else if (a === '--fix') opt.fix = nx();
  else if (a === '--excl') opt.excl = nx();
  else if (a === '--top') opt.top = +nx();
  else if (a === '--seed') opt.seed = +nx();
  else if (a === '--data') opt.data = path.resolve(nx());
  else if (a === '--json') opt.json = true;
  else if (a === '--no-filter') opt.noFilter = true;
}
if (!['uniform', 'hot', 'cold'].includes(opt.weight)) { console.error('weight는 uniform, hot, cold 중 하나'); process.exit(1); }
let rand = Math.random;
if (opt.seed != null && isFinite(opt.seed)) { let s = opt.seed >>> 0 || 1; rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* ---------- 데이터 ---------- */
const sandbox = { window: {} }; vm.runInNewContext(fs.readFileSync(opt.data, 'utf8'), sandbox);
const RAW = sandbox.window.LOTTO_DATA;
const { analyze } = require(path.join(ROOT, 'pick5.js'));

const PRIME = new Set([2,3,5,7,11,13,17,19,23,29,31,37,41,43]);
const SQUARE = new Set([1,4,9,16,25,36]);
const DOUBLE = new Set([11,22,33,44]);
const CORNER = new Set([1,2,8,9,6,7,13,14,29,30,36,37,34,35,41,42]);
const isComp = v => v > 1 && !PRIME.has(v) && v % 3 !== 0;
const grp = v => v <= 10 ? 0 : v <= 20 ? 1 : v <= 30 ? 2 : v <= 40 ? 3 : 4;
function comb(n, k){ if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
const TOTAL = comb(45, 6);
const keyOf = n => ((((n[0]*64 + n[1])*64 + n[2])*64 + n[3])*64 + n[4])*64 + n[5];
function metrics(n, prev){
  const ps = prev ? new Set(prev) : null;
  let sum=0, odd=0, low=0, prime=0, m3=0, m5=0, comp=0, sq=0, dbl=0, corner=0, endSum=0, consec=0, carry=0, neighbor=0;
  const ends = new Array(10).fill(0), groups = [0,0,0,0,0], diffs = new Set();
  for (let i = 0; i < 6; i++){
    const v = n[i];
    sum += v; if (v & 1) odd++; if (v <= 22) low++; if (PRIME.has(v)) prime++; if (v % 3 === 0) m3++; if (v % 5 === 0) m5++;
    if (isComp(v)) comp++; if (SQUARE.has(v)) sq++; if (DOUBLE.has(v)) dbl++; if (CORNER.has(v)) corner++;
    endSum += v % 10; ends[v % 10]++; groups[grp(v)]++;
    if (i && v - n[i-1] === 1) consec++;
    for (let j = 0; j < i; j++) diffs.add(v - n[j]);
    if (ps){ if (ps.has(v)) carry++; else if (ps.has(v-1) || ps.has(v+1)) neighbor++; }
  }
  return { sum, odd, low, ac: diffs.size - 5, endSum, consec, sameEnd: Math.max(...ends), sameGroup: Math.max(...groups),
    prime, m3, m5, comp, sq, dbl, corner, first: n[0], last: n[5], carry: ps ? carry : null, neighbor: ps ? neighbor : null };
}
const DRAWS = RAW.rows.map(r => ({ r:r[0], d:r[1], n:r.slice(2,8).sort((a,b)=>a-b), b:r[8] }));
DRAWS.forEach((d, i) => { d.m = metrics(d.n, i ? DRAWS[i-1].n : null); });
const LAST = DRAWS[DRAWS.length - 1];
const WIN_KEYS = new Set(DRAWS.map(d => keyOf(d.n)));

/* ---------- 필터 (화면의 "분석 사이트 추천값"과 동일) ---------- */
const FILTERS = {
  sum:[1,100,175], odd:[1,1,5], low:[1,1,5], ac:[1,7,10], endSum:[1,15,38], consec:[1,0,2], sameEnd:[1,1,3], sameGroup:[1,2,3], prime:[1,0,3],
  m3:[0,0,3], m5:[0,0,2], comp:[0,0,3], sq:[0,0,2], dbl:[0,0,2], corner:[0,1,4], first:[0,1,14], last:[0,31,45], carry:[0,0,2], neighbor:[0,0,3],
};
if (opt.noFilter) for (const k in FILTERS) FILTERS[k][0] = 0;
const parseNums = s => { const o = []; (String(s).match(/\d+/g) || []).forEach(x => { const v = +x; if (v >= 1 && v <= 45 && !o.includes(v)) o.push(v); }); return o; };
const FIXED = new Set(parseNums(opt.fix).slice(0, 5)), EXCL = new Set(parseNums(opt.excl).filter(v => !FIXED.has(v)));
if (45 - EXCL.size < 6) { console.error('제외수가 너무 많습니다'); process.exit(1); }

/* ---------- 조건 통과 조합 전체 열거 + 저장소 샘플링 (화면과 같은 알고리즘) ---------- */
function enumerate(K, weightMode){
  const pool = []; for (let v = 1; v <= 45; v++) if (!EXCL.has(v)) pool.push(v);
  const L = pool.length, FX = new Uint8Array(L); pool.forEach((v, i) => { if (FIXED.has(v)) FX[i] = 1; });
  const rg = k => FILTERS[k][0] ? [FILTERS[k][1], FILTERS[k][2]] : [-99, 999];
  const [sMin, sMax] = rg('sum'), [eMin, eMax] = rg('endSum'), [oMin, oMax] = rg('odd'), [lMin, lMax] = rg('low'), [pMin, pMax] = rg('prime'),
    [m3Min, m3Max] = rg('m3'), [m5Min, m5Max] = rg('m5'), [cpMin, cpMax] = rg('comp'), [sqMin, sqMax] = rg('sq'), [dbMin, dbMax] = rg('dbl'),
    [coMin, coMax] = rg('corner'), [caMin, caMax] = rg('carry'), [nbMin, nbMax] = rg('neighbor'), [gMin, gMax] = rg('sameGroup'),
    [seMin, seMax] = rg('sameEnd'), [csMin, csMax] = rg('consec'), [fMin, fMax] = rg('first'), [laMin, laMax] = rg('last'), [acMin, acMax] = rg('ac');
  const acOn = !!FILTERS.ac[0], prev = new Set(LAST.n);
  const PA = new Int32Array(46), PB = new Int32Array(46), PE = new Int32Array(46), EN = new Int32Array(46);
  for (let v = 1; v <= 45; v++){
    PA[v] = (v & 1) | ((v <= 22 ? 1 : 0) << 3) | ((PRIME.has(v) ? 1 : 0) << 6) | ((v % 3 === 0 ? 1 : 0) << 9) | ((v % 5 === 0 ? 1 : 0) << 12) | ((isComp(v) ? 1 : 0) << 15) | ((SQUARE.has(v) ? 1 : 0) << 18) | ((DOUBLE.has(v) ? 1 : 0) << 21);
    const nbv = !prev.has(v) && (prev.has(v - 1) || prev.has(v + 1));
    PB[v] = (CORNER.has(v) ? 1 : 0) | ((prev.has(v) ? 1 : 0) << 3) | ((nbv ? 1 : 0) << 6) | (1 << (9 + 3 * grp(v)));
    PE[v] = 1 << (3 * (v % 10)); EN[v] = v % 10;
  }
  let W = null;
  if (weightMode !== 'uniform'){
    const f = new Array(46).fill(0); for (const d of DRAWS.slice(-50)) for (const v of d.n) f[v]++;
    const mx = Math.max(...f.slice(1)); W = new Float64Array(46);
    for (let v = 1; v <= 45; v++) W[v] = weightMode === 'hot' ? f[v] + 1 : mx - f[v] + 1;
  }
  const pc = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; };
  function leaf(v0, v1, v2, v3, v4, v5, e, A, B, C){
    if (e < eMin || e > eMax) return false;
    let x = A & 7; if (x < oMin || x > oMax) return false;
    x = (A >>> 3) & 7; if (x < lMin || x > lMax) return false;
    x = (A >>> 6) & 7; if (x < pMin || x > pMax) return false;
    x = (A >>> 9) & 7; if (x < m3Min || x > m3Max) return false;
    x = (A >>> 12) & 7; if (x < m5Min || x > m5Max) return false;
    x = (A >>> 15) & 7; if (x < cpMin || x > cpMax) return false;
    x = (A >>> 18) & 7; if (x < sqMin || x > sqMax) return false;
    x = (A >>> 21) & 7; if (x < dbMin || x > dbMax) return false;
    x = B & 7; if (x < coMin || x > coMax) return false;
    x = (B >>> 3) & 7; if (x < caMin || x > caMax) return false;
    x = (B >>> 6) & 7; if (x < nbMin || x > nbMax) return false;
    let g = 0; for (let s = 9; s <= 21; s += 3){ x = (B >>> s) & 7; if (x > g) g = x; } if (g < gMin || g > gMax) return false;
    g = 0; for (let s = 0; s <= 27; s += 3){ x = (C >>> s) & 7; if (x > g) g = x; } if (g < seMin || g > seMax) return false;
    x = (v1 - v0 === 1) + (v2 - v1 === 1) + (v3 - v2 === 1) + (v4 - v3 === 1) + (v5 - v4 === 1); if (x < csMin || x > csMax) return false;
    if (acOn){
      let lo = 0, hi = 0;
      const ds = [v1-v0, v2-v0, v3-v0, v4-v0, v5-v0, v2-v1, v3-v1, v4-v1, v5-v1, v3-v2, v4-v2, v5-v2, v4-v3, v5-v3, v5-v4];
      for (let i = 0; i < 15; i++){ const d = ds[i]; if (d < 32) lo |= 1 << d; else hi |= 1 << (d - 32); }
      x = pc(lo) + pc(hi) - 5; if (x < acMin || x > acMax) return false;
    }
    if (WIN_KEYS.has(((((v0*64 + v1)*64 + v2)*64 + v3)*64 + v4)*64 + v5)) return false;
    return true;
  }
  const res = [], keys = []; let count = 0, minI = 0;
  function accept(v0, v1, v2, v3, v4, v5){
    count++;
    if (!W){
      if (res.length < K) res.push([v0, v1, v2, v3, v4, v5]);
      else { const j = Math.floor(rand() * count); if (j < K) res[j] = [v0, v1, v2, v3, v4, v5]; }
      return;
    }
    const key = Math.log(rand()) / (W[v0] * W[v1] * W[v2] * W[v3] * W[v4] * W[v5]);
    if (res.length < K){ res.push([v0, v1, v2, v3, v4, v5]); keys.push(key); if (res.length === K){ minI = 0; for (let i = 1; i < K; i++) if (keys[i] < keys[minI]) minI = i; } return; }
    if (key > keys[minI]){ res[minI] = [v0, v1, v2, v3, v4, v5]; keys[minI] = key; minI = 0; for (let i = 1; i < K; i++) if (keys[i] < keys[minI]) minI = i; }
  }
  for (let i0 = 0; i0 <= L - 6; i0++){
    const v0 = pool[i0]; if (v0 > fMax) break;
    const a0 = PA[v0], b0 = PB[v0], c0 = PE[v0], e0 = EN[v0];
    if (v0 >= fMin) for (let i1 = i0 + 1; i1 <= L - 5; i1++){
      const v1 = pool[i1], s1 = v0 + v1; if (s1 + 4 * v1 + 10 > sMax) break;
      const a1 = a0 + PA[v1], b1 = b0 + PB[v1], c1 = c0 + PE[v1], e1 = e0 + EN[v1];
      for (let i2 = i1 + 1; i2 <= L - 4; i2++){
        const v2 = pool[i2], s2 = s1 + v2; if (s2 + 3 * v2 + 6 > sMax) break;
        const a2 = a1 + PA[v2], b2 = b1 + PB[v2], c2 = c1 + PE[v2], e2 = e1 + EN[v2];
        for (let i3 = i2 + 1; i3 <= L - 3; i3++){
          const v3 = pool[i3], s3 = s2 + v3; if (s3 + 2 * v3 + 3 > sMax) break;
          const a3 = a2 + PA[v3], b3 = b2 + PB[v3], c3 = c2 + PE[v3], e3 = e2 + EN[v3];
          for (let i4 = i3 + 1; i4 <= L - 2; i4++){
            const v4 = pool[i4], s4 = s3 + v4; if (s4 + v4 + 1 > sMax) break;
            const a4 = a3 + PA[v4], b4 = b3 + PB[v4], c4 = c3 + PE[v4], e4 = e3 + EN[v4];
            for (let i5 = i4 + 1; i5 < L; i5++){
              const v5 = pool[i5], s = s4 + v5; if (s > sMax) break;
              if (s >= sMin && v5 >= laMin && v5 <= laMax && leaf(v0, v1, v2, v3, v4, v5, e4 + EN[v5], a4 + PA[v5], b4 + PB[v5], c4 + PE[v5])) accept(v0, v1, v2, v3, v4, v5);
              if (FX[i5]) break;
            }
            if (FX[i4]) break;
          }
          if (FX[i3]) break;
        }
        if (FX[i2]) break;
      }
      if (FX[i1]) break;
    }
    if (FX[i0]) break;
  }
  return { count, list: res.map(n => n.sort((a, b) => a - b)) };
}

/* ---------- 실행 ---------- */
const t0 = Date.now();
const gen = enumerate(opt.count, opt.weight);
// 원래 화면처럼 무작위 순서 그대로 A, B, C … 로 붙인다
const nextRound = LAST.r + 1;
const nd = new Date(LAST.d + 'T00:00:00'); nd.setDate(nd.getDate() + 7);
const nextDate = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
const label = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
const A = gen.list.length ? analyze(gen.list, DRAWS, metrics) : { rows: [], picked: [], covered: 0 };
const top = A.picked.slice(0, Math.max(0, Math.min(opt.top, A.picked.length)));

const out = {
  nextRound, nextDate, lastRound: LAST.r, lastDate: LAST.d, lastNumbers: LAST.n, lastBonus: LAST.b, dataUpdated: RAW.updated,
  weight: opt.weight, fixed: [...FIXED].sort((a, b) => a - b), excluded: [...EXCL].sort((a, b) => a - b),
  passCount: gen.count, totalCombos: TOTAL, ms: Date.now() - t0,
  combos: A.rows.map(r => ({ label: label(r.idx), numbers: r.n, sum: r.m.sum, oddEven: `${r.m.odd}:${6 - r.m.odd}`, lowHigh: `${r.m.low}:${6 - r.m.low}`, ac: r.m.ac, endSum: r.m.endSum, carry: r.m.carry,
    score: +r.total.toFixed(1), pattern: +r.pattern.toFixed(1), flow: +r.flow.toFixed(1), popularity: +r.pop.toFixed(1) })),
  top5: top.map(r => ({ rank: r.rank, label: label(r.idx), numbers: r.n, score: +r.total.toFixed(1), adjusted: +r.adj.toFixed(1), pattern: +r.pattern.toFixed(1), flow: +r.flow.toFixed(1), popularity: +r.pop.toFixed(1), notes: r.notes, warns: r.warns })),
  coveredNumbers: A.covered,
};
if (opt.json) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const p2 = v => String(v).padStart(2, ' ');
const line = n => n.map(p2).join('  ');
const wl = { uniform: '균등 무작위', hot: '최근 50회 핫넘버 가중', cold: '최근 50회 콜드넘버 가중' }[opt.weight];
console.log(`■ 제${nextRound}회 (${nextDate} 추첨) 번호 생성 — ${wl}`);
console.log(`  기준 데이터: 1~${LAST.r}회 (${LAST.d} 추첨, 직전 당첨 ${LAST.n.join(' ')} + ${LAST.b})`);
if (out.fixed.length || out.excluded.length) console.log(`  고정수 ${out.fixed.join(' ') || '없음'} / 제외수 ${out.excluded.join(' ') || '없음'}`);
console.log(`  조건 통과 조합 ${gen.count.toLocaleString('ko-KR')}개 (전체 ${TOTAL.toLocaleString('ko-KR')}개 중 ${(gen.count / TOTAL * 100).toFixed(2)}%)\n`);
if (!gen.count) { console.log('조건을 모두 만족하는 조합이 없습니다.'); process.exit(0); }
console.log(`[${out.combos.length}개 조합]`);
for (const c of out.combos) console.log(`  ${c.label}: ${line(c.numbers)}   합${c.sum} 홀짝${c.oddEven} AC${c.ac} | 점수 ${c.score}`);
console.log(`\n[정밀 추천 ${top.length}개]  (패턴 40% + 번호 흐름 25% + 인기 조합 회피 35%, 겹치는 번호 감점)`);
for (const t of out.top5) {
  console.log(`  ${t.rank}위 (${t.label}) ${line(t.numbers)}   점수 ${t.score}${t.adjusted !== t.score ? ` (겹침 감점 후 ${t.adjusted})` : ''}  [패턴 ${t.pattern} · 흐름 ${t.flow} · 회피 ${t.popularity}]`);
  for (const s of t.notes) console.log(`        + ${s}`);
  for (const s of t.warns) console.log(`        - ${s}`);
}
console.log(`\n  추천 5개가 쓰는 서로 다른 번호: ${out.coveredNumbers}개`);
console.log('  ※ 어떤 조합이든 1등 확률은 1/8,145,060로 같습니다. 점수는 고르는 기준일 뿐 확률을 높이지 않습니다.');
