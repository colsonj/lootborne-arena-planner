// PvP end to end in node: fit opponents from a replay folder, then search.  usage: pvpsearch.mjs <save> <replay dir> [owned|market|all]
import fs from 'node:fs';
import { load } from './load.mjs';
const { LB, LBP } = load(['planner.js'], '{LB, LBP}');
const profile = LBP.parseSave(fs.readFileSync(process.argv[2], 'utf8')), dir = process.argv[3], src = process.argv[4] || 'owned';
const evalJobs = async jobs => jobs.map(j => LB.runJob(j));
let t0 = Date.now();
const reps = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => LBP.parseReplay(fs.readFileSync(dir + '/' + f, 'utf8')));
const fits = await evalJobs(reps.map(r => LBP.fitJob(profile, r)));
console.log('fit', reps.length, 'replays in', (Date.now() - t0) / 1000, 's; expected wins', fits.reduce((a, f) => a + (f.simWin || 0), 0).toFixed(1), 'observed', reps.filter(r => r.won).length);
reps.forEach((r, i) => console.log(' ', r.won ? 'W' : 'L', 'opp#' + i, 'sim', (fits[i].simWin * 100).toFixed(0) + '%', fits[i].perks.map(k => LB.PERKS[k].name).join('+'), fits[i].alloc.join('/')));
const opps = reps.map((r, i) => ({ names: r.names, perks: fits[i].perks, alloc: fits[i].alloc })).concat(LBP.ARCHETYPES.map(a => ({ names: a.names, perks: a.perks, stats: a.stats })));
t0 = Date.now();
const res = await LBP.optimise(profile, { goal: 'pvp', depth: 'quick', itemSource: src, perkSource: src === 'owned' ? 'owned' : 'all', alloc: 'save', potMode: 'none', opps }, evalJobs, () => {});
console.log((Date.now() - t0) / 1000, 's', res.sims, 'sims');
for (const f of res.finalists) console.log((f.score * 100).toFixed(0) + '%', f === res.baseline ? '[equipped]' : '', 'worst', (f.rs[0].r.min * 100).toFixed(0) + '%', 'def', (f.rs[0].r.defMean * 100).toFixed(0) + '%', f.build.names.join(' | '), '//', f.build.perks.map(k => LB.PERKS[k].name).join(' + '));
console.log('targets', res.targets.items.slice(0, 4).map(t => t.item + ' +' + (t.gain * 100).toFixed(0) + '%'), res.targets.perks.slice(0, 3).map(t => LB.PERKS[t.perk].name));
