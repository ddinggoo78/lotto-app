// 번호 인기도 기준 자동 선택 결과를 JSON으로 출력 (health_check.py가 사용)
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'pick5.js'));
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', 'lotto_data.js'), 'utf8'), ctx);
const D = ctx.window.LOTTO_DATA.rows.map(r => ({ r: r[0], n: r.slice(2, 8).sort((a, b) => a - b), w1c: r[9], w2c: r[11], w3c: r[13], w4c: r[15], w5c: r[17], sales: r[19] }));
const b = P.numberPopularity(D);
const order = []; for (let v = 1; v <= 45; v++) order.push(v); order.sort((x, y) => b[y] - b[x]);
console.log(JSON.stringify({ ...(b ? b.info : {}), most: order.slice(0, 8), least: order.slice(-8).reverse() }));
