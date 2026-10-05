// Runs the search in node against the real save (or the example character) to check it end to end.
import fs from 'node:fs';
import { load } from './load.mjs';
const { LB, LBP } = load(['planner.js'], '{LB, LBP}');
const savePath = process.argv[2], goal = process.argv[3] || 'ascended', depth = process.argv[4] || 'quick', src = process.argv[5] || 'owned';
const profile = savePath && savePath !== '-' ? LBP.parseSave(fs.readFileSync(savePath, 'utf8')) : LBP.exampleProfile();
console.log(profile.name, 'lvl', profile.level, 'wave', profile.wave, 'record', profile.record, 'equipped', profile.equipped, 'perks', profile.equippedPerks, 'alloc', profile.alloc,
  'owned', Object.keys(profile.owned).length, 'presets', profile.presets.map(p => p.name), 'pots', profile.ownedPots, 'unknown', profile.unknownItems);
const evalJobs = async jobs => jobs.map(j => LB.runJob(j));
const t0 = Date.now(); let last = '';
const res = await LBP.optimise(profile, { goal, depth, itemSource: src, perkSource: src === 'owned' ? 'owned' : 'all', alloc: process.argv[6] || 'save', potMode: 'none' }, evalJobs,
  p => { if (p.stage && p.stage !== last) { last = p.stage; console.log('  ..', p.stage, p.done); } });
const f = LB.GOALS[goal].fmt;
console.log('\n', ((Date.now() - t0) / 1000).toFixed(1), 's,', res.sims, 'sims; pools', res.poolSizes, 'converged', res.converged);
for (const x of res.finalists) console.log(f(x.score), x === res.baseline ? '[equipped]' : '', x.build.names.join(' | '), '//', x.build.perks.map(k => LB.PERKS[k].name).join(' + '), '//', x.build.alloc.join('/'), x.build.pots.join('+'));
console.log('revert', res.revert.map(r => `${r.label}: ${r.from} -> ${r.to}: without ${f(r.without)}`));
console.log('perk worth', res.perkWorth.map(r => LB.PERKS[r.perk].name + ' ' + f(r.without)));
console.log('targets', res.targets.items.slice(0, 6).map(t => `${t.item} (+${(t.gain * 100).toFixed(0)}%) for ${t.replaces}`), res.targets.perks.slice(0, 5).map(t => `${LB.PERKS[t.perk].name} +${(t.gain * 100).toFixed(0)}%`));
for (const l of res.log) console.log(l.start, l.steps.map(s => s.what + ' ' + f(s.score)).join(' > '));
