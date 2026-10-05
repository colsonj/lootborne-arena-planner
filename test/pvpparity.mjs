// Checks the PvP duel port against tools/pvpsim.c (web/test/pvpcases.json).
import fs from 'node:fs';
import { load } from './load.mjs';
const LB = load();
const ref = JSON.parse(fs.readFileSync(new URL('./pvpcases.json', import.meta.url), 'utf8'));
let bad = 0;
ref.forEach((c, n) => {
  const y = Object.assign({}, c.y); if (!y.stats) delete y.stats; else delete y.alloc;
  const r = LB.duel(LB.fighter(c.x), LB.fighter(y), 200, c.seed, c.first);
  for (const k in c.r) if (k in r && Math.abs(r[k] - c.r[k]) > 1e-9 * Math.max(1, Math.abs(c.r[k]))) { bad++; if (bad < 20) console.log('DIFF case', n, k, r[k], c.r[k]); }
});
console.log(ref.length, 'duels compared; mismatching fields:', bad);
process.exit(bad ? 1 : 0);
