// Checks web/src/engine.js against the Python / C reference (web/test/cases.json, written by dump.py).
import fs from 'node:fs';
import path from 'node:path';
import { load } from './load.mjs';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const LB = load();
const ref = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8'));
let bad = 0;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
function cmp(tag, a, b) {
  if (typeof b === 'number') { if (!close(a, b)) { bad++; if (bad < 40) console.log('DIFF', tag, a, b); } return; }
  if (Array.isArray(b)) { if (!a || a.length !== b.length) { bad++; if (bad < 40) console.log('LEN', tag, JSON.stringify(a), JSON.stringify(b)); return; } b.forEach((x, i) => cmp(tag + '[' + i + ']', a[i], x)); return; }
  for (const k in b) cmp(tag + '.' + k, a[k], b[k]);
}
for (const [name, g] of Object.entries(ref.single)) cmp('single ' + name, LB.gear([LB.BYNAME[name]]), g);
console.log('single-item gear parse:', Object.keys(ref.single).length, 'items, mismatches so far', bad);
ref.cases.forEach((c, n) => {
  cmp('case' + n + ' gear', LB.gear(c.names.map(x => LB.BYNAME[x])), c.g);
  const r = LB.simulate({ names: c.names, perks: c.K, alloc: c.alloc, pots: c.pots }, { plvl: c.plvl, budgetH: 40, seed: c.seed, startWave: c.sw, bossmask: c.bm });
  cmp('case' + n + ' sim', r, c.r);
});
console.log(ref.cases.length, 'simulated builds compared; mismatching fields:', bad);
const t0 = Date.now(); let sw = 0;
for (let s = 1; s <= 5; s++) sw += LB.simulate({ names: ref.cases[0].names, perks: ref.cases[0].K, alloc: ref.cases[0].alloc, pots: [] }, { budgetH: 150, seed: s, startWave: 60, bossmask: 15 }).swings;
console.log('speed:', (sw / (Date.now() - t0) / 1000).toFixed(0), 'k swings/ms-ish ->', ((Date.now() - t0) / 5).toFixed(0), 'ms per 150 h tank sim');
process.exit(bad ? 1 : 0);
