(function () {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { BYNAME, PERKS, PERK_IDS, GOALS, POS_NAME, ORDER, RARITY, POTIONS, POTION_NAMES } = LB;
const STAT = ['HP', 'ATK', 'DEF', 'CRIT', 'PARRY'];
const state = { opps: [], profile: null, result: null, running: false, cancel: false, bans: [], perkRule: {}, cmp: [], cmpRes: null };

/* ------------------------------------------------------------------ worker pool */
const Pool = (function () {
  let workers = [], idle = [], tasks = [], seq = 0; const waiting = new Map(); let useMain = false;
  try {
    const src = $('engineSrc').textContent + '\nonmessage=function(e){var d=e.data,out=[];for(var i=0;i<d.jobs.length;i++)out.push(LB.runJob(d.jobs[i]));postMessage({id:d.id,res:out});};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      w.onmessage = e => { const t = waiting.get(e.data.id); waiting.delete(e.data.id); idle.push(w); if (t) t.done(e.data.res); pump(); };
      w.onerror = e => { useMain = true; for (const t of waiting.values()) t.fail(new Error('Simulation worker failed: ' + (e.message || 'unknown error'))); waiting.clear(); };
      workers.push(w); idle.push(w);
    }
  } catch (e) { useMain = true; }
  function pump() {
    while (idle.length && tasks.length) { const w = idle.pop(), t = tasks.shift(); t.id = ++seq; waiting.set(t.id, t); w.postMessage({ id: t.id, jobs: t.jobs }); }
  }
  async function onMain(jobs) {
    const out = []; let t0 = performance.now();
    for (const j of jobs) { out.push(LB.runJob(j)); if (performance.now() - t0 > 40) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } }
    return out;
  }
  function evalJobs(jobs) {
    if (useMain || !workers.length) return onMain(jobs);
    return new Promise((resolve, reject) => {
      const size = Math.max(1, Math.min(16, Math.ceil(jobs.length / (workers.length * 3)))), out = new Array(jobs.length); let left = 0;
      for (let i = 0; i < jobs.length; i += size) {
        left++; const off = i;
        tasks.push({ jobs: jobs.slice(i, i + size), done: res => { for (let k = 0; k < res.length; k++) out[off + k] = res[k]; if (--left === 0) resolve(out); }, fail: reject });
      }
      if (!left) resolve(out);
      pump();
    });
  }
  return { evalJobs, threads: () => (useMain ? 1 : workers.length) };
})();

/* ------------------------------------------------------------------ small formatters */
const mean = (rs, f) => rs.reduce((a, x) => a + f(x.r), 0) / rs.length;
const f1 = v => v.toFixed(1), f0 = v => Math.round(v).toLocaleString('en-US');
const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '%';
const hrs = h => h < 1 ? Math.round(h * 60) + ' min' : h < 20 ? h.toFixed(1) + ' h' : Math.round(h) + ' h';
const itemHtml = n => { if (!n) return '<span class="muted">(empty)</span>'; const it = BYNAME[n]; return '<span class="it r' + it.rarity + '"><i class="dot"></i>' + esc(n) + '</span>'; };
const statLine = it => [['HP', it.hp], ['ATK', it.atk], ['DEF', it.def], ['CRIT', it.crit], ['PARRY', it.parry]].filter(x => x[1]).map(x => x[0] + ' ' + (+x[1].toFixed(1))).join(' · ');
function diffBuild(a, b) {            // what b changes relative to a
  const out = [];
  for (let p = 0; p < 7; p++) if (a.names[p] !== b.names[p]) out.push(POS_NAME[p] + ': ' + itemHtml(b.names[p]) + ' <span class="muted">instead of ' + esc(a.names[p] || 'nothing') + '</span>');
  const add = b.perks.filter(k => a.perks.indexOf(k) < 0), rem = a.perks.filter(k => b.perks.indexOf(k) < 0);
  if (add.length || rem.length) out.push('Perks: ' + add.map(k => '+' + esc(PERKS[k].name)).concat(rem.map(k => '&minus;' + esc(PERKS[k].name))).join(', '));
  if (a.alloc.join() !== b.alloc.join()) out.push('Points: ' + allocText(b.alloc));
  if (a.pots.slice().sort().join() !== b.pots.slice().sort().join()) out.push('Potions: ' + (b.pots.map(potLabel).join(' + ') || 'none'));
  return out;
}
const allocText = a => a.map((v, i) => v ? STAT[i] + ' ' + v : null).filter(Boolean).join(' / ') || 'none';
const potLabel = n => POTIONS[n] && POTIONS[n].label || n;

/* ------------------------------------------------------------------ profile */
function setProfile(p, msg) {
  state.profile = p; state.result = null; state.cmpRes = null;
  $('charName').innerHTML = esc(p.name) + (p.example ? ' <span class="pill ex">example data, not your save</span>' : '');
  const nOwn = Object.values(p.owned).reduce((a, b) => a + b, 0);
  $('charLine').textContent = 'Level ' + p.level + ' · wave ' + p.wave + ' · record ' + p.record + ' · ' + nOwn + ' items · ' + p.ownedPerks.filter(k => PERKS[k]).length + ' perks · ' + p.bloodmarks + ' Bloodmarks';
  $('btnExample').hidden = p.example;
  $('loadMsg').textContent = msg || (p.inArena ? '' : 'This character has not unlocked the Eternal Arena yet; results show what the arena would look like.');
  $('perkSlots').value = String(Math.max(1, Math.min(5, p.perkSlots)));
  $('startWave').value = p.record; $('cmpStart').value = p.record;
  $('bosses').innerHTML = [10, 20, 30, 40].map((w, i) => '<label class="row small"><input type="checkbox" id="boss' + i + '"' + ((p.bossmask >> i) & 1 ? ' checked' : '') + '> wave ' + w + '</label>').join('');
  $('locks').innerHTML = p.equipped.map((n, i) => '<label class="row small"><input type="checkbox" id="lock' + i + '"' + (n ? '' : ' disabled') + '> <span class="muted">' + POS_NAME[i] + '</span> ' + itemHtml(n) + '</label>').join('');
  state.perkRule = {}; renderPerkChips();
  const potOpts = '<option value="">(none)</option>' + POTION_NAMES.map(n => '<option value="' + esc(n) + '">' + esc(potLabel(n)) + (p.ownedPots[n] ? ' (own ' + p.ownedPots[n] + ')' : '') + '</option>').join('');
  $('pot1').innerHTML = potOpts; $('pot2').innerHTML = potOpts;
  $('cmpPreset').innerHTML = '<option value="">Add a saved preset…</option>' + p.presets.map((q, i) => '<option value="' + i + '">' + esc(q.name) + '</option>').join('');
  $('cmpPreset').hidden = !p.presets.length;
  state.cmp = [equippedBuild('Equipped')];
  state.opps = defaultOpps(); renderOpps(); $('pvpOut').innerHTML = ''; $('pvpMsg').textContent = '';
  renderOut(); renderCmpCards(); $('cmpOut').innerHTML = ''; $('cmpAddBest').disabled = true;
}
const equippedBuild = label => ({ label, names: state.profile.equipped.slice(), perks: pad5(state.profile.equippedPerks.filter(k => PERKS[k])), alloc: state.profile.alloc.slice(), pots: [null, null] });
const pad5 = a => { const o = a.slice(0, 5); while (o.length < 5) o.push(null); return o; };
function renderPerkChips() {
  const own = new Set(state.profile.ownedPerks);
  $('perkChips').innerHTML = PERK_IDS.map(k => {
    const s = state.perkRule[k] || (own.has(k) ? 'ok' : 'na');
    return '<button type="button" class="chip" data-k="' + k + '" data-s="' + s + '" title="' + esc(PERKS[k].text) + '">' + esc(PERKS[k].name) + (s === 'lock' ? ' · must use' : s === 'ban' ? ' · never' : '') + '</button>';
  }).join('');
}
function renderBans() { $('banChips').innerHTML = state.bans.map((n, i) => '<button type="button" class="chip" data-i="' + i + '" title="Click to allow again">' + esc(n) + ' ×</button>').join(''); }
function readSaveText(text) {
  try { const p = LBP.parseSave(text); setProfile(p, p.unknownItems.length ? p.unknownItems.length + ' items in the save are newer than this planner and were skipped.' : ''); try { localStorage.setItem('lb.profile', JSON.stringify(p)); } catch (e) { /* storage is optional */ } }
  catch (e) { $('loadMsg').textContent = e.message; }
}

/* ------------------------------------------------------------------ settings -> search */
function cfgFromForm() {
  const p = state.profile, lock = {};
  for (let i = 0; i < 7; i++) if ($('lock' + i) && $('lock' + i).checked && p.equipped[i]) lock[i] = p.equipped[i];
  let bm = 0; for (let i = 0; i < 4; i++) if ($('boss' + i).checked) bm |= 1 << i;
  const rule = s => PERK_IDS.filter(k => state.perkRule[k] === s);
  return {
    goal: (document.querySelector('input[name="goal"]:checked') || {}).value || 'push',
    itemSource: (document.querySelector('input[name="itemSource"]:checked') || {}).value || 'market',
    perkSource: $('perkSource').value, perkSlots: +$('perkSlots').value, alloc: $('alloc').value, potMode: $('potMode').value,
    pots: [$('pot1').value, $('pot2').value].filter((x, i, a) => x && a.indexOf(x) === i), depth: $('depth').value,
    startWave: Math.max(1, Math.min(399, +$('startWave').value || p.record)), bossmask: bm, lock, bannedItems: state.bans.slice(),
    lockedPerks: rule('lock'), bannedPerks: rule('ban'), pvpWin: Math.max(0, Math.min(1, (+$('pvpWin').value || 0) / 100)), pvpEveryMin: +$('pvpEvery').value || 7,
    pace: Math.max(1, +$('pace').value || 1),
  };
}
async function run() {
  if (state.running) return;
  const cfg = cfgFromForm(), p = state.profile;
  const P = LBP.makePools(p, cfg), D = LBP.DEPTH[cfg.depth];
  const np = P.pool[3].length, perPass = P.pool[0].length + P.pool[1].length + P.pool[2].length + P.pool[4].length + P.pool[5].length +
    (np * (np + 1) / 2 <= D.pairLimit ? np * (np + 1) / 2 : 2 * np) + P.nslots * P.perks.length + (cfg.alloc === 'free' ? 40 : 0) + P.pots.length * 2;
  const est = D.starts * perPass * 1.8 + 250;
  state.running = true; state.cancel = false; $('btnRun').disabled = true; $('btnStop').hidden = false; $('progress').hidden = false;
  const t0 = performance.now(); let stage = 'Starting';
  const tick = pr => {
    if (pr.stage) stage = pr.stage;
    $('progBar').style.width = Math.min(98, pr.done / est * 100).toFixed(1) + '%';
    $('progText').textContent = stage + ' · ' + pr.done.toLocaleString('en-US') + ' simulations · ' + Math.round((performance.now() - t0) / 1000) + ' s · ' + Pool.threads() + ' threads';
  };
  try {
    const res = await LBP.optimise(p, cfg, Pool.evalJobs, tick, () => state.cancel);
    res.seconds = (performance.now() - t0) / 1000; state.result = res; $('cmpAddBest').disabled = false;
  } catch (e) { state.result = { error: e.message }; }
  state.running = false; $('btnRun').disabled = false; $('btnStop').hidden = true; $('progress').hidden = true; $('progBar').style.width = '0';
  renderOut();
}

/* ------------------------------------------------------------------ results */
function buildTable(b, profile) {
  const need = {}; let rows = '';
  b.names.forEach((n, pos) => {
    if (!n) { rows += '<tr><td class="muted">' + POS_NAME[pos] + '</td><td class="muted">(empty)</td><td></td></tr>'; return; }
    const it = BYNAME[n]; need[n] = (need[n] || 0) + 1; const own = (profile.owned[n] || 0) >= need[n];
    rows += '<tr><td class="muted">' + POS_NAME[pos] + '</td><td>' + itemHtml(n) + ' <span class="small muted">' + RARITY[it.rarity] + (it.category ? ' · ' + LB.ELEM_NAME[it.category] : '') + ' · ' + statLine(it) + '</span>' +
      '<ul class="fx">' + it.effects.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></td><td>' +
      (own ? '<span class="tag own">owned</span>' : '<span class="tag need" title="' + esc(LBP.sourceOf(it, { owned: {} })) + '">' + (LBP.marketable(it) ? 'buy or farm' : it.rarity === 5 ? 'Ascended drop' : 'boss drop') + '</span>') + '</td></tr>';
  });
  return '<div class="tw"><table><thead><tr><th>Slot</th><th>Item</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function statSheet(st) {
  return '<div class="stats">' + [['HP', st.hp], ['ATK', st.atk], ['DEF', st.dfn], ['CRIT %', Math.min(st.crit, st.cap || 60)], ['PARRY %', st.par]].map(x => '<div><span class="eyebrow">' + x[0] + '</span><b>' + (+x[1].toFixed(1)) + '</b></div>').join('') + '</div>';
}
function colChart(vals, labels, tipFn) {
  const mx = Math.max.apply(null, vals.concat([1e-12]));
  return '<div class="cols">' + vals.map((v, i) => '<div style="height:' + (v / mx * 100).toFixed(1) + '%" data-tip="' + esc(tipFn(i)) + '"></div>').join('') + '</div>' +
    '<div class="axis"><span>wave ' + labels[0] + '</span><span>wave ' + labels[labels.length - 1] + '</span></div>';
}
function waveCharts(rs) {
  const n = Math.max.apply(null, rs.map(x => x.r.timeAt.length)), time = new Array(n).fill(0), deaths = new Array(n).fill(0); let tot = 0, realTot = 0;
  rs.forEach(x => { x.r.timeAt.forEach((v, i) => { time[i] += v; tot += v; }); x.r.deathsAt.forEach((v, i) => { deaths[i] += v; }); realTot += x.r.real_h; });
  let lo = time.findIndex(v => v > tot * 0.002), hi = n - 1; while (hi > 0 && time[hi] <= tot * 0.002) hi--; if (lo < 0) lo = 0;
  const step = Math.max(1, Math.ceil((hi - lo + 1) / 36)), tv = [], dv = [], lab = [];
  for (let a = lo; a <= hi; a += step) { let t = 0, d = 0; for (let i = a; i < a + step && i < n; i++) { t += time[i]; d += deaths[i]; } tv.push(t / tot); dv.push(d / realTot); lab.push(step > 1 ? a + '-' + Math.min(hi, a + step - 1) : '' + a); }
  const ends = [lab[0].split('-')[0], lab[lab.length - 1].split('-').pop()];
  return '<div class="grid2"><div><h3>Share of fighting time by wave</h3>' + colChart(tv, ends, i => 'wave ' + lab[i] + ': ' + (tv[i] * 100).toFixed(1) + '% of time') + '</div>' +
    '<div><h3>Deaths per real hour by wave</h3>' + (dv.some(v => v > 0) ? colChart(dv, ends, i => 'wave ' + lab[i] + ': ' + dv[i].toFixed(2) + ' deaths/h') : '<p class="muted small">No deaths in any run.</p>') + '</div></div>' +
    '<p class="small muted">Hover a column for its value. Four runs combined.</p>';
}
function fightStory(rs, goal) {
  const s = k => mean(rs, r => r.stats[k]), fights = mean(rs, r => r.fights), hp = rs[0].r.st.hp;
  const hit = s('dealt') / Math.max(1, s('attacks')), eParry = 1 - s('attacks') / Math.max(1, s('pswings')), crit = s('crits') / Math.max(1, s('attacks'));
  const landed = s('eswings') - s('pparry'), takenHit = s('taken') / Math.max(1, landed), parry = s('pparry') / Math.max(1, s('eswings'));
  const swings = (s('pswings') + s('eswings')) / fights, lost = s('taken') / fights / hp, healed = s('healed') / fights / hp;
  const kills = mean(rs, r => r.kills_h), deaths = mean(rs, r => r.deaths_rh), up = mean(rs, r => r.up), mw = mean(rs, r => r.meanwave);
  const mx = [Math.min.apply(null, rs.map(x => x.r.maxwave)), Math.max.apply(null, rs.map(x => x.r.maxwave))], sw = rs[0].r.startWave;
  const lines = [];
  lines.push('It spends its time around <b>wave ' + f1(mw) + '</b> (' + (mx[1] <= sw ? 'started at wave ' + sw + ' and never passed it' : 'highest reached ' + (mx[0] === mx[1] ? mx[0] : mx[0] + ' to ' + mx[1])) + '), killing <b>' + f0(kills) + ' enemies</b> and dying <b>' + (deaths < 0.05 ? 'almost never' : f1(deaths) + ' times') + '</b> per real hour.');
  lines.push('A fight lasts about ' + f0(swings) + ' swings (' + f0(swings * 0.5 / 1.25) + ' s). Your hits land for ' + f0(hit) + ' on average, ' + (crit * 100).toFixed(0) + '% are crits, and the enemy parries ' + (eParry * 100).toFixed(0) + '% of swings.');
  lines.push('Enemy hits that land deal ' + f0(takenHit) + ' (' + (takenHit / hp * 100).toFixed(1) + '% of your ' + hp + ' HP); you parry ' + (parry * 100).toFixed(0) + '%. Per fight you lose ' + (lost * 100).toFixed(0) + '% of max HP and heal ' + (healed * 100).toFixed(0) + '% in combat, plus 6% after each win.');
  if (lost - healed > 0.08) lines.push('<span class="warn">Each fight costs more HP than you get back, so this build wins by killing fast and accepts deaths as part of the cycle.</span>');
  else lines.push('In-combat healing and post-fight regen cover the damage at this wave, so deaths come from bad streaks, not attrition.');
  lines.push('Stamina rests take ' + ((1 - up) * 100).toFixed(0) + '% of real time.' + (s('immo') > 0 ? ' Immolation does ' + (s('immo') / (s('immo') + s('dealt')) * 100).toFixed(0) + '% of your damage.' : ''));
  if (s('lastBreath') > 0) lines.push('Last Breath saves you ' + f1(s('lastBreath') / mean(rs, r => r.real_h)) + ' times per real hour.');
  return '<ul>' + lines.map(l => '<li>' + l + '</li>').join('') + '</ul>';
}
function lootTable(rs) {
  const d = [0, 1, 2, 3, 4].map(i => mean(rs, r => r.dropsBy[i]));
  return '<div class="tw"><table><thead><tr><th>Per real hour</th>' + RARITY.slice(0, 5).map(x => '<th class="n">' + x + '</th>').join('') + '<th class="n">Ascended</th></tr></thead><tbody>' +
    '<tr><td>Drops</td>' + d.map(v => '<td class="n">' + v.toFixed(v < 10 ? 2 : 1) + '</td>').join('') + '<td class="n">' + mean(rs, r => r.asc).toFixed(3) + '</td></tr></tbody></table></div>' +
    '<p class="small muted">Mythic-equivalents ' + mean(rs, r => r.me).toFixed(2) + '/h · item chance +' + (rs[0].r.ib * 100).toFixed(0) + '% · rarity upgrade +' + (rs[0].r.rb * 100).toFixed(0) + '% · Bloodmarks ' +
    f0(mean(rs, r => r.bm)) + '/h (' + f0(mean(rs, r => r.bmDismantle)) + ' if every drop is dismantled + ' + f0(mean(rs, r => r.bmPvp)) + ' from PvP, gear bonus +' + (rs[0].r.bmBonus * 100).toFixed(0) + '%) · XP ' + (mean(rs, r => r.xp_rh) / 1e6).toFixed(2) + 'M/h</p>';
}
function pushTable(rs, res) {
  const start = res.start.startWave, top = Math.max.apply(null, rs.map(x => x.r.maxwave)); if (top <= start) return '<p class="note">None of the four runs got past wave ' + start + ' in ' + hrs(mean(rs, r => r.real_h)) + ' of real time. The wall is survival, not speed; see the deaths chart.</p>';
  const waves = []; for (let w = start + 1; w <= top; w++) if (w % 5 === 0 || w === top) waves.push(w);
  const rows = waves.slice(-12).map(w => {
    const hit = rs.filter(x => x.r.firstReach[w] >= 0), h = hit.length ? hit.reduce((a, x) => a + x.r.firstReach[w] / x.r.t * x.r.real_h, 0) / hit.length : 0;
    return '<tr><td class="n">' + w + '</td><td class="n">' + hit.length + ' of ' + rs.length + '</td><td class="n">' + (hit.length ? hrs(h) : 'never') + '</td></tr>';
  }).join('');
  return '<div class="tw"><table><thead><tr><th class="n">Wave reached</th><th class="n">Runs that got there</th><th class="n">Real time from wave ' + start + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="small muted">Each new record on a multiple of 5 rolls a milestone drop: 10% Ascended on waves 40-55, 20% from wave 60.</p>';
}
function hbars(rows, fmt) {
  const mx = Math.max.apply(null, rows.map(r => Math.abs(r.v)).concat([1e-12]));
  return '<div class="hbar">' + rows.map(r => '<span>' + r.label + '</span><span class="track" title="' + esc(r.tip || '') + '"><i style="width:' + (Math.max(0, r.v) / mx * 100).toFixed(1) + '%"></i></span><span class="num">' + fmt(r.v) + '</span>').join('') + '</div>';
}
function renderOut() {
  const res = state.result, p = state.profile, out = $('out');
  if (!res) {
    out.innerHTML = '<section class="blk"><h2>Your equipped build</h2>' + buildTable({ names: p.equipped }, p) +
      '<p><span class="eyebrow">Perks</span><br>' + (p.equippedPerks.map(k => esc(PERKS[k] ? PERKS[k].name : (LB.UNMODELLED_PERKS[k] || 'Perk ' + k) + ' (not modelled)')).join(' + ') || 'none') + '</p>' +
      '<p><span class="eyebrow">Stat points</span><br>' + allocText(p.alloc) + (p.unspent ? ' · ' + p.unspent + ' unspent' : '') + '</p>' +
      '<p class="note">Choose a goal on the left and press <b>Find the best build</b>. The result lists the build, how it compares with this one, what each change is worth, and which items or perks outside your restrictions would help most.</p></section>';
    return;
  }
  out.innerHTML = resultHtml(res);
}
function resultHtml(res) {
  if (res.error) return '<p class="note err">' + esc(res.error) + '</p>';
  const p = state.profile, isPvp = res.goal === 'pvp';
  const G = GOALS[res.goal], W = res.winner, B = res.baseline, gain = B && B.score > 0 ? W.score / B.score - 1 : null;
  const spread = W.rs.map(x => x.score), noise = (Math.max.apply(null, spread) - Math.min.apply(null, spread)) / (W.score || 1);
  const same = res.baselineIsWinner, small = !same && gain !== null && gain < Math.max(0.03, noise / 2);
  let h = '';
  h += '<section class="blk"><div class="verdict"><div class="k"><span class="eyebrow">' + esc(G.label) + ' · best found</span><span class="big num">' + G.fmt(W.score) + '</span><span class="small muted">' + esc(G.unit) + (isPvp ? '; worst matchup ' + G.fmt(W.rs[0].r.min) + ', defending ' + G.fmt(W.rs[0].r.defMean) : ', four runs from ' +
    G.fmt(Math.min.apply(null, spread)) + ' to ' + G.fmt(Math.max.apply(null, spread))) + '</span></div>' +
    (B ? '<div class="k"><span class="eyebrow">Your equipped build</span><span class="big num">' + G.fmt(B.score) + '</span><span class="small ' + (same || small ? 'muted' : 'good') + '">' +
      (same ? 'already the best found' : small ? pct(gain) + ', inside run-to-run noise' : pct(gain) + ' with the changes below') + '</span></div>' : '') +
    '<div class="k small muted"><span>' + res.sims.toLocaleString('en-US') + ' simulations in ' + Math.round(res.seconds) + ' s</span>' + (isPvp ? '<span>finalists: 1,500 fights against each of ' + res.cfg.opps.length + ' opponents</span>' : '<span>finalists: 4 seeds × ' + res.HF + ' game-hours from wave ' + res.start.startWave + '</span>') + '<span>' + esc(res.depth.label) + ' depth' + (res.stopped ? ', stopped early' : res.converged ? ', search converged' : ', pass limit reached') + '</span></div></div>';
  if (same) h += '<p class="note">Nothing allowed by your restrictions beat what you are wearing by more than 1.5%. Loosen a restriction, or look at the upgrade list below.</p>';
  else if (small) h += '<p class="note">The best build found is within noise of your equipped one. Swapping is optional.</p>';
  h += '</section>';

  h += '<section class="blk"><h2>Recommended build</h2>' + buildTable(W.build, p) +
    '<div class="grid2"><div><p class="eyebrow">Perks</p><ul class="fx" style="font-size:.9rem">' + W.build.perks.map(k => '<li><b style="color:var(--fg)">' + esc(PERKS[k].name) + '</b>' + (p.ownedPerks.indexOf(k) < 0 ? ' <span class="tag need">' + PERKS[k].cost + ' Bloodmarks</span>' : '') + ' · ' + esc(PERKS[k].text) + '</li>').join('') + '</ul></div>' +
    '<div><p class="eyebrow">Stat points</p><p>' + allocText(W.build.alloc) + '</p><p class="eyebrow" style="margin-top:8px">Potions</p><p>' + (W.build.pots.map(n => esc(potLabel(n)) + ' <span class="small muted">' + esc(POTIONS[n].text) + '</span>').join('<br>') || 'none') + '</p>' +
    '<p class="eyebrow" style="margin-top:8px">Resulting stats</p>' + statSheet(W.rs[0].r.st) + '</div></div></section>';

  /* why */
  h += '<section class="blk"><h2>Why this build</h2>';
  if (res.revert.length) {
    h += '<h3>What each change from your equipped build is worth</h3><div class="tw"><table><thead><tr><th>Change</th><th>Was</th><th>Now</th><th class="n">Score if you undo it</th><th class="n">Share of result</th></tr></thead><tbody>' +
      res.revert.map(r => '<tr><td>' + esc(r.label) + '</td><td>' + (BYNAME[r.from] ? itemHtml(r.from) : esc(r.from || 'nothing')) + '</td><td>' + (BYNAME[r.to] ? itemHtml(r.to) : esc(r.to)) + '</td><td class="n">' + G.fmt(r.without) + '</td><td class="n ' + (r.without < W.score ? 'good' : 'muted') + '">' + pct(1 - r.without / (W.score || 1)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="small muted">Each row re-runs the recommended build with only that change undone. Shares do not add to 100% because items and perks work together.</p>';
  }
  h += '<div class="grid2"><div><h3>What each perk contributes</h3>' + hbars(res.perkWorth.map(x => ({ label: esc(PERKS[x.perk].name), v: 1 - x.without / (W.score || 1), tip: 'Without it: ' + G.fmt(x.without) })), v => pct(v).replace('+', '')) +
    '<p class="small muted">Share of the score lost when that slot is left empty.</p></div>' +
    (isPvp ? '' : '<div><h3>How it fights</h3>' + fightStory(W.rs, res.goal) + '</div>') + '</div>';
  if (!isPvp) h += waveCharts(W.rs);
  if (res.goal === 'push') h += '<h3>How far and how fast</h3>' + pushTable(W.rs, res);
  if (res.goal === 'ascended') { const a = mean(W.rs, r => r.asc); h += '<p class="note">' + (a > 0 ? 'One Ascended every <b>' + hrs(1 / a) + '</b> of real time on average (' + f1(mean(W.rs, r => r.waves_h16)) + ' waves/h on 16-39 at 0.4%, ' + f1(mean(W.rs, r => r.waves_h40)) + ' waves/h on 40+ at 1%). A specific Ascended is 1 in 15, so expect about ' + hrs(15 / a) + ' for one named item.' : 'This build finishes no waves between 16 and your record, so it earns no reclear rolls.') + '</p>'; }
  if (isPvp) h += matchupTable(res); else h += '<h3>Loot and income</h3>' + lootTable(W.rs);
  const altRows = [];
  for (const pos of [0, 1, 2, 'w', 5, 6, 'k', 'a', 'p']) {
    const a = res.alts[pos]; if (!a) continue;
    const tops = a.top.filter(t => LBP.keyOf(t.build) !== LBP.keyOf(W.build)).slice(0, 3);
    tops.forEach((t, i) => { const d = diffBuild(W.build, t.build); altRows.push('<tr><td class="muted">' + (i ? '' : (typeof pos === 'number' ? POS_NAME[pos] : pos === 'w' ? 'Weapons' : pos === 'k' ? 'Perks' : pos === 'a' ? 'Stat points' : 'Potions') + ' <span class="small">(' + a.tested + ' tried)</span>') + '</td><td>' + (d.join('<br>') || 'same') + '</td><td class="n">' + pct(t.score / (a.ref || 1) - 1) + '</td></tr>'); });
  }
  if (altRows.length) h += '<details><summary><b>Runner-ups in each slot</b> <span class="small muted">the closest alternatives the search rejected</span></summary><div class="tw" style="margin-top:8px"><table><thead><tr><th>Slot</th><th>Alternative</th><th class="n">vs the build at that step</th></tr></thead><tbody>' + altRows.join('') + '</tbody></table></div><p class="small muted">Search-stage scores (' + (isPvp ? '300 fights per opponent' : 'two seeds, ' + res.H + ' game-hours') + '), so differences under about 3% are noise.</p></details>';
  h += '</section>';

  /* what to chase */
  const T = res.targets;
  if (T.items.length || T.perks.length) {
    h += '<section class="blk"><h2>What to farm or buy next</h2><p class="muted" style="max-width:70ch">Single swaps from outside your restrictions, tested in the recommended build. Gains are for one swap on its own.</p>';
    if (T.items.length) h += '<div class="tw"><table><thead><tr><th>Item</th><th>Replaces</th><th class="n">Score</th><th class="n">Gain</th><th>Where it comes from</th></tr></thead><tbody>' +
      T.items.slice(0, 10).map(t => '<tr><td>' + itemHtml(t.item) + '<ul class="fx">' + BYNAME[t.item].effects.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></td><td>' + itemHtml(t.replaces) + '</td><td class="n">' + G.fmt(t.score) + '</td><td class="n good">' + pct(t.gain) + '</td><td class="small">' + esc(t.source) + '</td></tr>').join('') + '</tbody></table></div>';
    if (T.perks.length) h += '<div class="tw"><table><thead><tr><th>Perk</th><th>Replaces</th><th class="n">Score</th><th class="n">Gain</th><th class="n">Shop price</th></tr></thead><tbody>' +
      T.perks.slice(0, 8).map(t => '<tr><td><b>' + esc(PERKS[t.perk].name) + '</b><div class="small muted">' + esc(PERKS[t.perk].text) + '</div></td><td>' + (t.replaces ? esc(PERKS[t.replaces].name) : 'empty slot') + '</td><td class="n">' + G.fmt(t.score) + '</td><td class="n good">' + pct(t.gain) + '</td><td class="n">' + t.cost + ' BM</td></tr>').join('') + '</tbody></table></div>';
    h += '</section>';
  } else if (!res.stopped) h += '<section class="blk"><h2>What to farm or buy next</h2><p class="note">No single item or perk from outside your restrictions improves this build. ' + (res.cfg.itemSource === 'all' && res.cfg.perkSource === 'all' ? 'You searched with everything allowed.' : 'Try the search with "Everything in the game" to see whether a multi-item change does.') + '</p></section>';

  /* other finalists */
  if (res.finalists.length > 1) h += '<section class="blk"><h2>Other builds the search ended on</h2><div class="tw"><table><thead><tr><th class="n">Score</th><th>Differences from the recommended build</th>' + (isPvp ? '<th class="n">Worst matchup</th><th class="n">Defending</th>' : '<th class="n">Mean wave</th><th class="n">Kills/h</th><th class="n">Deaths/h</th>') + '</tr></thead><tbody>' +
    res.finalists.map(f => '<tr><td class="n">' + G.fmt(f.score) + '</td><td>' + (f === W ? '<b>Recommended</b>' : (f === B ? '<span class="pill">equipped now</span> ' : '') + (diffBuild(W.build, f.build).join('<br>') || 'same')) + '</td>' + (isPvp ? '<td class="n">' + G.fmt(f.rs[0].r.min) + '</td><td class="n">' + G.fmt(f.rs[0].r.defMean) + '</td>' : '<td class="n">' + f1(mean(f.rs, r => r.meanwave)) + '</td><td class="n">' + f0(mean(f.rs, r => r.kills_h)) + '</td><td class="n">' + f1(mean(f.rs, r => r.deaths_rh)) + '</td>') + '</tr>').join('') + '</tbody></table></div></section>';

  /* log + caveats */
  h += '<section class="blk"><details><summary><b>Search log</b> <span class="small muted">every swap the search accepted</span></summary>' + res.log.map(l => '<p style="margin-top:8px"><b>From ' + esc(l.start) + '</b> (' + G.fmt(l.steps[0].score) + ')' + (l.converged ? '' : ' <span class="small muted">pass limit reached</span>') + '</p><ol class="small" style="margin:4px 0">' +
    (l.steps.slice(1).map(s => '<li>Pass ' + s.pass + ', ' + esc(s.what) + ': ' + diffBuild(s.from, s.to).join('; ') + ' → ' + G.fmt(s.score) + ' (' + pct(s.score / (s.before || 1e-12) - 1) + ')</li>').join('') || '<li>No swap improved it.</li>') + '</ol>').join('') + '</details>';
  const cav = [];
  const unp = W.rs[0].r.unparsed || []; if (unp.length) cav.push('Item effects the model ignores in this build: ' + unp.map(esc).join('; ') + '.');
  if (p.ownedPerks.some(k => LB.UNMODELLED_PERKS[k])) cav.push('You own ' + p.ownedPerks.filter(k => LB.UNMODELLED_PERKS[k]).map(k => LB.UNMODELLED_PERKS[k]).join(' and ') + ', which the model does not cover.');
  if (isPvp) { cav.push('PvP win rates from this model are too high, especially for Mythic and Ascended builds. Use them to rank builds and spot bad matchups, not as a forecast.');
    cav.push('Opponent perks and stat points are guesses fitted to one replay each; opponents change gear, and matchmaking can pair you with players who are not in this pool.'); }
  else cav.push('Per-hour figures assume the pace correction you set (' + res.cfg.pace + 'x). The raw model runs faster than the game, so real rates are lower; rankings hold.');
  if (res.goal === 'push') cav.push('Push ceilings from this model have been a few waves pessimistic at the wall with Immolation and optimistic at the very top end.');
  if (res.goal === 'bloodmarks') cav.push('The Bloodmark figure counts every drop as dismantled and uses your stated PvP win rate (' + Math.round(res.cfg.pvpWin * 100) + '%); PvP fights are not simulated.');
  h += '<p class="eyebrow" style="margin-top:10px">Limits of this result</p><ul class="small muted" style="margin:0;padding-left:20px">' + cav.map(c => '<li>' + c + '</li>').join('') + '</ul></section>';
  return h;
}

/* ------------------------------------------------------------------ compare */
function itemOptions(slot, sel) {
  const p = state.profile, its = LB.ALL.filter(i => i.slot === slot).sort((a, b) => b.rarity - a.rarity || (a.itemName < b.itemName ? -1 : 1));
  const o = i => '<option value="' + esc(i.itemName) + '"' + (i.itemName === sel ? ' selected' : '') + '>' + esc(i.itemName) + (p.owned[i.itemName] ? ' ✓' : '') + '</option>';
  let h = '<option value="">(empty)</option><optgroup label="Owned">' + its.filter(i => p.owned[i.itemName]).map(o).join('') + '</optgroup>';
  for (let r = 5; r >= 0; r--) { const g = its.filter(i => i.rarity === r && !p.owned[i.itemName]); if (g.length) h += '<optgroup label="' + RARITY[r] + ', not owned">' + g.map(o).join('') + '</optgroup>'; }
  return h;
}
function renderCmpCards() {
  const p = state.profile, pts = (p.level - 1) * 5;
  $('cmpCards').innerHTML = state.cmp.map((b, bi) => {
    const used = b.alloc.reduce((a, x) => a + x, 0);
    return '<div class="card" data-b="' + bi + '"><div class="row"><input type="text" id="cmp' + bi + 'label" data-f="label" value="' + esc(b.label) + '" style="flex:1" aria-label="Build name">' +
      '<button class="btn" type="button" data-act="dup">Copy</button><button class="btn" type="button" data-act="del"' + (state.cmp.length < 2 ? ' disabled' : '') + '>Remove</button></div>' +
      b.names.map((n, pos) => '<label class="small muted">' + POS_NAME[pos] + '<select id="cmp' + bi + 'i' + pos + '" data-f="item" data-pos="' + pos + '">' + itemOptions(ORDER[pos], n) + '</select>' +
        (n ? '<span class="small">' + esc(statLine(BYNAME[n])) + (BYNAME[n].effects.length ? ' · ' + BYNAME[n].effects.map(esc).join(' · ') : '') + '</span>' : '') + '</label>').join('') +
      '<div class="eyebrow">Perks</div>' + b.perks.map((k, i) => '<select id="cmp' + bi + 'k' + i + '" data-f="perk" data-pos="' + i + '" aria-label="Perk ' + (i + 1) + '"><option value="">(empty)</option>' +
        PERK_IDS.map(x => '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + esc(PERKS[x].name) + (p.ownedPerks.indexOf(x) >= 0 ? ' ✓' : '') + '</option>').join('') + '</select>').join('') +
      '<div class="eyebrow">Stat points <span class="' + (used > pts ? 'bad' : 'muted') + '" style="letter-spacing:0;text-transform:none">' + used + ' of ' + pts + ' used</span></div><div class="row">' +
      b.alloc.map((v, i) => '<label>' + STAT[i] + '<input type="number" id="cmp' + bi + 'a' + i + '" data-f="alloc" data-pos="' + i + '" min="0" max="' + pts + '" step="1" value="' + v + '"></label>').join('') + '</div>' +
      '<div class="eyebrow">Potions</div><div class="row">' + [0, 1].map(i => '<select id="cmp' + bi + 'p' + i + '" data-f="pot" data-pos="' + i + '" aria-label="Potion ' + (i + 1) + '"><option value="">(none)</option>' +
        POTION_NAMES.map(n => '<option value="' + esc(n) + '"' + (b.pots[i] === n ? ' selected' : '') + '>' + esc(potLabel(n)) + '</option>').join('') + '</select>').join('') + '</div></div>';
  }).join('');
}
const cmpClean = b => ({ names: b.names.slice(), perks: b.perks.filter((k, i, a) => k && a.indexOf(k) === i).sort((x, y) => x - y), alloc: b.alloc.slice(), pots: b.pots.filter((x, i, a) => x && a.indexOf(x) === i) });
async function runCompare() {
  if (state.running) return;
  const p = state.profile, cfg = cfgFromForm(); cfg.startWave = Math.max(1, +$('cmpStart').value || p.record); cfg.hours = Math.max(10, Math.min(1000, +$('cmpHours').value || 150));
  state.running = true; $('cmpRun').disabled = true; $('cmpMsg').textContent = 'Simulating…';
  try { const t0 = performance.now(); const rs = await LBP.compare(p, state.cmp.map(cmpClean), cfg, Pool.evalJobs); state.cmpRes = { rs, labels: state.cmp.map(b => b.label), cfg }; $('cmpMsg').textContent = 'Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }
  catch (e) { $('cmpMsg').textContent = e.message; }
  state.running = false; $('cmpRun').disabled = false; renderCmpOut();
}
function renderCmpOut() {
  const c = state.cmpRes; if (!c) { $('cmpOut').innerHTML = ''; return; }
  const M = [
    ['Highest wave reached', r => r.maxwave, f0, 1], ['Mean wave', r => r.meanwave, f1, 1], ['Kills / real h', r => r.kills_h, f0, 1], ['Deaths / real h', r => r.deaths_rh, f1, -1],
    ['Fighting time (rests excluded)', r => r.up * 100, v => f0(v) + '%', 1], ['Mythic drops / h', r => r.myth, v => v.toFixed(2), 1], ['Legendary drops / h', r => r.leg, v => v.toFixed(1), 1],
    ['Mythic-equivalents / h', r => r.me, v => v.toFixed(2), 1], ['Ascended / h (reclears)', r => r.asc, v => v.toFixed(3), 1], ['Bloodmarks / h', r => r.bm, f0, 1], ['XP / h', r => r.xp_rh, v => (v / 1e6).toFixed(2) + 'M', 1],
  ];
  const S = [['HP', s => s.hp], ['ATK', s => s.atk], ['DEF', s => s.dfn], ['CRIT %', s => Math.min(s.crit, s.cap || 60)], ['PARRY %', s => s.par]];
  let h = '<section class="blk"><h2>Results</h2><div class="tw"><table><thead><tr><th>Per build, mean of four runs</th>' + c.labels.map(l => '<th class="n">' + esc(l) + '</th>').join('') + '</tr></thead><tbody>';
  for (const m of M) {
    const v = c.rs.map(x => mean(x.rs, m[1])), best = m[3] > 0 ? Math.max.apply(null, v) : Math.min.apply(null, v);
    h += '<tr><td>' + m[0] + '</td>' + v.map(x => '<td class="n">' + (x === best && v.length > 1 ? '<b>' + m[2](x) + '</b>' : m[2](x)) + '</td>').join('') + '</tr>';
  }
  for (const s of S) h += '<tr><td class="muted">' + s[0] + '</td>' + c.rs.map(x => '<td class="n muted">' + (+s[1](x.rs[0].r.st).toFixed(1)) + '</td>').join('') + '</tr>';
  h += '</tbody></table></div><p class="small muted">Started at wave ' + c.cfg.startWave + ', ' + c.cfg.hours + ' game-hours per run, seeds 11 to 14. Bold marks the best value in a row. Ascended counts reclears below the starting wave, so start at your record.</p></section>';
  c.rs.forEach((x, i) => { h += '<section class="blk"><h3>' + esc(c.labels[i]) + '</h3>' + fightStory(x.rs) + waveCharts(x.rs) + '</section>'; });
  $('cmpOut').innerHTML = h;
}

/* ------------------------------------------------------------------ PvP */
const oppSt = o => o.st ? 'HP ' + f0(o.st.hp) + ' · ATK ' + f0(o.st.atk) + ' · DEF ' + f0(o.st.dfn) + ' · CRIT ' + f0(Math.min(o.st.crit, 75)) + ' · PARRY ' + f0(o.st.par) : '';
function matchupTable(res) {
  const W = res.winner.rs[0].r, B = res.baseline ? res.baseline.rs[0].r : null, info = res.cfg.oppInfo, pc = v => (v * 100).toFixed(0) + '%';
  const order = info.map((o, i) => i).sort((a, b) => W.wins[a] - W.wins[b]);
  const cls = v => v < 0.4 ? 'bad' : v < 0.6 ? 'warn' : '';
  return '<h3>Matchups, worst first</h3><div class="tw"><table><thead><tr><th>Opponent</th><th>Their build as modelled</th>' + (B && !res.baselineIsWinner ? '<th class="n">Equipped, attacking</th>' : '') +
    '<th class="n">Recommended, attacking</th><th class="n">Recommended, defending</th><th class="n">Fight length</th></tr></thead><tbody>' +
    order.map(i => '<tr><td><b>' + esc(info[i].name) + '</b><div class="small muted">' + esc(info[i].src) + '</div></td><td class="small">' + esc(oppSt(info[i])) + '<div class="muted">' + esc(info[i].perkText) + '</div></td>' +
      (B && !res.baselineIsWinner ? '<td class="n ' + cls(B.wins[i]) + '">' + pc(B.wins[i]) + '</td>' : '') + '<td class="n ' + cls(W.wins[i]) + '">' + pc(W.wins[i]) + '</td><td class="n ' + cls(W.def[i]) + '">' + pc(W.def[i]) + '</td><td class="n">' + f0(W.duels[i].turns) + ' swings</td></tr>').join('') +
    '</tbody></table></div><p class="small muted">Attacking = you swing first with half your on-kill damage stacks, as when your auto-PvP fires. Defending = they swing first and you have no stacks, as when others challenge your snapshot.</p>';
}
function renderOpps() {
  const rows = state.opps.map((o, i) => '<tr><td><input type="checkbox" id="opp' + i + '" data-i="' + i + '"' + (o.on ? ' checked' : '') + ' aria-label="Include ' + esc(o.name) + '"></td><td><b>' + esc(o.name) + '</b><div class="small muted">' + esc(o.src) + '</div></td>' +
    '<td class="small">' + o.spec.names.map(n => n ? esc(n) : '(unknown item)').join(' · ') + '</td><td class="small">' + esc(oppSt(o)) + '<div class="muted">' + esc(o.perkText) + '</div></td></tr>').join('');
  $('pvpOpps').innerHTML = '<table><thead><tr><th>Use</th><th>Opponent</th><th>Gear</th><th>Stats and perks as modelled</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function defaultOpps() {
  return LBP.ARCHETYPES.map(a => ({ name: a.name, src: 'Generic archetype: ' + a.note, on: true, spec: { names: a.names, perks: a.perks, stats: a.stats }, st: a.stats,
    perkText: 'Assumed perks: ' + a.perks.map(k => PERKS[k].name).join(' + ') }));
}
async function loadReplays(files) {
  if (state.running) return; const p = state.profile, reps = []; let badN = 0;
  for (const f of files) { try { const r = LBP.parseReplay(await f.text()); if (!r.friendly && r.names.filter(Boolean).length >= 5) reps.push(r); else badN++; } catch (e) { badN++; } }
  if (!reps.length) { $('pvpMsg').textContent = 'None of those files were PvP replays.'; return; }
  const latest = new Map(); reps.sort((a, b) => (a.ticks < b.ticks ? -1 : 1)).forEach(r => latest.set(r.name, r));
  const list = Array.from(latest.values());
  state.running = true; $('pvpMsg').textContent = 'Fitting ' + list.length + ' opponents from their replays…';
  try {
    const fits = await Pool.evalJobs(list.map(r => LBP.fitJob(p, r)));
    state.opps = state.opps.filter(o => !o.replay);
    list.forEach((r, i) => { const f = fits[i]; if (!f || f.failed) return;
      state.opps.push({ name: r.name, replay: true, on: true, src: 'Replay: you ' + (r.won ? 'won' : 'lost') + ' in ' + r.turns + ' swings (model gives your replay build ' + Math.round(f.simWin * 100) + '%)',
        spec: { names: r.names, perks: f.perks, alloc: f.alloc }, st: f.st, perkText: 'Guessed perks: ' + (f.perks.map(k => PERKS[k].name).join(' + ') || 'none found') + ' · points ' + allocText(f.alloc) }); });
    const n = state.opps.filter(o => o.replay).length, exp = fits.reduce((a, f) => a + (f && f.simWin || 0), 0);
    $('pvpMsg').textContent = n + ' opponents added' + (badN ? ', ' + badN + ' files skipped' : '') + '. Check on the fit: the model expects ' + exp.toFixed(1) + ' wins from these fights, you had ' + list.filter(r => r.won).length + '.';
  } catch (e) { $('pvpMsg').textContent = e.message; }
  state.running = false; renderOpps();
}
async function runPvp() {
  if (state.running) return;
  const p = state.profile, cfg = cfgFromForm(), on = state.opps.filter(o => o.on);
  if (!on.length) { $('pvpMsg').textContent = 'Tick at least one opponent.'; return; }
  Object.assign(cfg, { goal: 'pvp', potMode: 'none', pots: [], opps: on.map(o => o.spec), robust: $('pvpScore').value === 'robust', depth: $('pvpDepth').value,
    oppInfo: on.map(o => ({ name: o.name, src: o.src, st: o.st, perkText: o.perkText })) });
  const P = LBP.makePools(p, cfg), D = LBP.DEPTH[cfg.depth], np = P.pool[3].length;
  const est = D.starts * (P.pool[0].length + P.pool[1].length + P.pool[2].length + P.pool[4].length + P.pool[5].length + (np * (np + 1) / 2 <= D.pairLimit ? np * (np + 1) / 2 : 2 * np) + P.nslots * P.perks.length + (cfg.alloc === 'free' ? 40 : 0)) * 1.8 + 250;
  state.running = true; state.cancel = false; $('pvpRun').disabled = true; $('pvpStop').hidden = false; $('pvpProgress').hidden = false;
  const t0 = performance.now(); let stage = 'Starting';
  const tick = pr => { if (pr.stage) stage = pr.stage; $('pvpBar').style.width = Math.min(98, pr.done / est * 100).toFixed(1) + '%';
    $('pvpText').textContent = stage + ' · ' + pr.done.toLocaleString('en-US') + ' builds tested · ' + Math.round((performance.now() - t0) / 1000) + ' s'; };
  let res;
  try { res = await LBP.optimise(p, cfg, Pool.evalJobs, tick, () => state.cancel); res.seconds = (performance.now() - t0) / 1000; } catch (e) { res = { error: e.message }; }
  state.running = false; $('pvpRun').disabled = false; $('pvpStop').hidden = true; $('pvpProgress').hidden = true; $('pvpBar').style.width = '0';
  $('pvpOut').innerHTML = resultHtml(res);
}
function pvpRestr() {
  const c = cfgFromForm();
  $('pvpRestr').textContent = 'Using the restrictions from the first tab: ' + ({ owned: 'only gear you own', market: 'owned + marketplace gear', all: 'every item in the game' })[c.itemSource] + ', ' +
    (c.perkSource === 'owned' ? 'perks you own' : 'all perks') + ', ' + c.perkSlots + ' perk slots, ' + (c.alloc === 'save' ? 'current stat points' : 'free respec') +
    (Object.keys(c.lock).length ? ', ' + Object.keys(c.lock).length + ' locked slots' : '') + (c.bannedItems.length ? ', ' + c.bannedItems.length + ' excluded items' : '') + '. Potions do not work in PvP.';
}

/* ------------------------------------------------------------------ wiring */
$('pvpLoad').addEventListener('click', () => $('fileReplays').click());
$('fileReplays').addEventListener('change', e => { const fl = Array.from(e.target.files); e.target.value = ''; if (fl.length) loadReplays(fl); });
$('pvpOpps').addEventListener('change', e => { const i = e.target.dataset.i; if (i !== undefined) state.opps[+i].on = e.target.checked; });
$('pvpRun').addEventListener('click', runPvp);
$('pvpStop').addEventListener('click', () => { state.cancel = true; });

$('goals').innerHTML = Object.keys(GOALS).map((g, i) => '<label class="opt"><input type="radio" name="goal" id="goal-' + g + '" value="' + g + '"' + (i ? '' : ' checked') + '><span>' + esc(GOALS[g].label) + '<span class="d">Scored by ' + esc(GOALS[g].unit) + '</span></span></label>').join('');
$('itemList').innerHTML = LB.ALL.filter(i => i.rarity >= 2).map(i => '<option value="' + esc(i.itemName) + '">').join('');
$('form').addEventListener('submit', e => { e.preventDefault(); run(); });
$('btnStop').addEventListener('click', () => { state.cancel = true; $('progText').textContent = 'Stopping after the current batch…'; });
$('potMode').addEventListener('change', () => { $('potPick').hidden = $('potMode').value !== 'fixed'; });
$('btnLoad').addEventListener('click', () => $('fileSave').click());
$('fileSave').addEventListener('change', e => { const f = e.target.files[0]; if (f) f.text().then(readSaveText); e.target.value = ''; });
$('btnExample').addEventListener('click', () => { try { localStorage.removeItem('lb.profile'); } catch (e) { /* optional */ } setProfile(LBP.exampleProfile()); });
const ch = $('char');
['dragenter', 'dragover'].forEach(ev => ch.addEventListener(ev, e => { e.preventDefault(); ch.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => ch.addEventListener(ev, e => { e.preventDefault(); ch.classList.remove('drag'); }));
ch.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) f.text().then(readSaveText); });
$('perkChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; const k = +b.dataset.k, cur = state.perkRule[k];
  state.perkRule[k] = cur === 'lock' ? 'ban' : cur === 'ban' ? undefined : 'lock'; renderPerkChips();
});
$('banAdd').addEventListener('click', () => { const v = $('banInput').value.trim(); if (BYNAME[v] && state.bans.indexOf(v) < 0) { state.bans.push(v); renderBans(); } $('banInput').value = ''; });
$('banChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { state.bans.splice(+b.dataset.i, 1); renderBans(); } });
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(t) {
  if (['optimise', 'compare', 'pvp', 'model'].indexOf(t) < 0) t = 'optimise';
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  ['optimise', 'compare', 'pvp', 'model'].forEach(x => { $('pane-' + x).hidden = x !== t; });
  if (t === 'pvp') pvpRestr();
  try { history.replaceState(null, '', '#' + t); } catch (e) { /* not essential */ }
}
$('cmpAddEq').addEventListener('click', () => { state.cmp.push(equippedBuild('Equipped ' + (state.cmp.length + 1))); renderCmpCards(); });
$('cmpAddBest').addEventListener('click', () => {
  const r = state.result; if (!r || !r.winner) return; const b = r.winner.build;
  state.cmp.push({ label: 'Best for ' + GOALS[r.goal].short.toLowerCase(), names: b.names.slice(), perks: pad5(b.perks), alloc: b.alloc.slice(), pots: [b.pots[0] || null, b.pots[1] || null] }); renderCmpCards();
});
$('cmpPreset').addEventListener('change', e => {
  const q = state.profile.presets[+e.target.value]; if (e.target.value === '' || !q) return;
  const eq = equippedBuild(q.name); eq.names = q.names.slice(); state.cmp.push(eq); e.target.value = ''; renderCmpCards();
});
$('cmpCards').addEventListener('change', e => {
  const card = e.target.closest('.card'); if (!card) return; const b = state.cmp[+card.dataset.b], f = e.target.dataset.f, pos = +e.target.dataset.pos, v = e.target.value;
  if (f === 'label') { b.label = v || 'Build'; return; }
  if (f === 'item') b.names[pos] = v || null; else if (f === 'perk') b.perks[pos] = v ? +v : null; else if (f === 'alloc') b.alloc[pos] = Math.max(0, Math.round(+v || 0)); else if (f === 'pot') b.pots[pos] = v || null;
  renderCmpCards();
});
$('cmpCards').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return; const i = +e.target.closest('.card').dataset.b;
  if (act === 'dup') { const b = state.cmp[i]; state.cmp.splice(i + 1, 0, { label: b.label + ' copy', names: b.names.slice(), perks: b.perks.slice(), alloc: b.alloc.slice(), pots: b.pots.slice() }); }
  else if (state.cmp.length > 1) state.cmp.splice(i, 1);
  renderCmpCards();
});
$('cmpRun').addEventListener('click', runCompare);

let stored = null;
try { stored = JSON.parse(localStorage.getItem('lb.profile') || 'null'); } catch (e) { stored = null; }
setProfile(stored && stored.owned && stored.equipped ? stored : LBP.exampleProfile());
showTab((location.hash || '').replace('#', ''));
})();
