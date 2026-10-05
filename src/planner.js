/* Save parsing, item / perk pools from the user's restrictions, and the deterministic build search
   (coordinate ascent over gear, perks, stat points and potions, as tools/analysis32.py does).
   The search only talks to the simulator through evalJobs(jobs) -> Promise<results>, so it runs the same
   on a worker pool, on the main thread and in node. */
var LBP = (function (LB) {
'use strict';
const { BYNAME, BYID, ALL, PERKS, PERK_IDS, ORDER, GOALS, POTIONS, POTION_NAMES, POTION_BY_ID } = LB;
const SAVE_SLOTS = ['Testa', 'Corpo', 'Cintura', 'Arma 1', 'Arma 2', 'Anello 1', 'Trinket'];

/* ------------------------------------------------------------------ save file */
function parseSave(text) {
  let outer;
  try { outer = JSON.parse(text); } catch (e) { throw new Error('That file is not JSON. Pick save_<steamid>_game.json from the Lootborne save folder.'); }
  let payload = outer && outer.payload !== undefined ? outer.payload : text;
  if (typeof payload !== 'string') payload = JSON.stringify(payload);
  // Steam item ids are 18-digit integers: keep them as strings so they survive JSON.parse
  payload = payload.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
  let p;
  try { p = JSON.parse(payload); } catch (e) { throw new Error('The save payload could not be read.'); }
  if (!p || !Array.isArray(p.inventory) || p.level === undefined) throw new Error('This JSON does not look like a Lootborne save (no level / inventory).');
  const nameOf = it => (BYID[it.templateId] ? BYID[it.templateId].itemName : (BYNAME[it.itemName] ? it.itemName : null));
  const owned = {}, byUid = {}, bySteam = {}, unknown = [];
  for (const it of p.inventory) { const n = nameOf(it); if (n) { owned[n] = (owned[n] || 0) + 1; byUid[it.uid] = n; } else unknown.push(it.itemName); }
  for (const a of (p.lockedSteamAnchors || []).concat(p.tradableSeenAnchors || [])) {
    const t = BYID[a.templateId]; if (!t) continue;
    if (bySteam[a.steamItemId]) continue;
    bySteam[a.steamItemId] = t.itemName; owned[t.itemName] = (owned[t.itemName] || 0) + 1;
  }
  const resolve = (slots, uids, steamSlots, steamIds, aligned) => {
    const out = [null, null, null, null, null, null, null];
    (slots || []).forEach((s, i) => {
      const pos = SAVE_SLOTS.indexOf(s); if (pos < 0) return;
      let n = null;
      if (aligned) { const sid = steamIds && steamIds[i]; if (sid && sid !== '0' && bySteam[sid]) n = bySteam[sid]; }
      if (!n && uids && byUid[uids[i]]) n = byUid[uids[i]];
      out[pos] = n;
    });
    if (!aligned) (steamSlots || []).forEach((s, i) => { const pos = SAVE_SLOTS.indexOf(s); if (pos >= 0 && !out[pos] && bySteam[steamIds[i]]) out[pos] = bySteam[steamIds[i]]; });
    return out;
  };
  const equipped = resolve(p.equippedSlots, p.equippedUids, p.equippedSteamSlots, p.equippedSteamItemIds, false);
  const presets = (p.equipPresets || []).map(q => ({ name: q.name || ('Preset ' + q.number), names: resolve(q.slots, q.uids, null, q.steamIds, true) }))
    .filter(q => q.names.some(Boolean));
  const ownedPots = {};
  (p.ownedConsumableIds || []).forEach((id, i) => { const n = POTION_BY_ID[id]; if (n) ownedPots[n] = (p.ownedConsumableCounts || [])[i] || 1; });
  const level = p.level | 0;
  const alloc = [p.allocatedHp | 0, p.allocatedAtk | 0, p.allocatedDef | 0, p.allocatedCrit | 0, p.allocatedParry | 0];
  return {
    example: false, name: p.name || 'Character', level, wave: (p.waveIndex | 0) || 1, record: (p.maxWaveRecord | 0) || 1, bossmask: p.arenaBossDefeatedMask | 0,
    inArena: !!p.endlessMode, alloc, unspent: p.unspentStatPoints | 0, ownedPerks: (p.ownedPerkIds || []).slice(), equippedPerks: (p.equippedPerkIds || []).slice(),
    perkSlots: Math.max((p.equippedPerkIds || []).length, LB.SLOT_UNLOCK.filter(l => l <= level).length), owned, equipped, presets, ownedPots,
    bloodmarks: p.pvpCurrency | 0, deaths: p.arenaDeathsPersistent | 0, unknownItems: unknown, build: p.savedByBuild,
  };
}
function exampleProfile() {
  const names = ["Crown of the Undying", "Remains of Sbard the Ugly", "Mawfire Cummerbund", "Sword of Divine Justice", "Frirekr Toto's Aegis", "Ring of Final Ascension", "Dawnguard Pendant"];
  const extra = ["Frog Mouth Helm of Ire", "Fire Titan Cuirass", "The World's Serpent", "Bern the Bear's Scythe", "Mace of the Avalanche", "Essence of the Abyss",
    "Supreme Assassin's Hood", "Hollow Night Vestments", "The Hollow Coil", "Grieffang", "Grieffang", "Eoo Genie's Signet", "Frozen Core Ring", "Void Essence",
    "Mourning Cowl", "Gloombind Belt", "Drowned Moon Seal", "Arcane Devastator", "Frost Colossus Shield", "Hallowed Icon", "Horns of Death's Assistant"];
  const owned = {}; names.concat(extra).forEach(n => { if (BYNAME[n]) owned[n] = (owned[n] || 0) + 1; });
  return { example: true, name: 'Example character', level: 60, wave: 58, record: 60, bossmask: 15, inArena: true, alloc: [106, 0, 175, 0, 14], unspent: 0,
    ownedPerks: [10, 11, 29, 9, 28, 22, 17, 4, 30, 6, 24, 18], equippedPerks: [10, 28, 17, 29, 30], perkSlots: 5, owned, equipped: names.map(n => BYNAME[n] ? n : null),
    presets: [], ownedPots: { Bastion: 2, Immolation: 1 }, bloodmarks: 1500, deaths: 0, unknownItems: [] };
}

/* ------------------------------------------------------------------ pools */
const marketable = it => it.rarity <= 4 && !it.isBossExclusive;
function sourceOf(it, profile) {
  if (profile.owned[it.itemName]) return 'owned';
  if (it.isBossExclusive) return 'PvP boss drop (account-bound)';
  if (it.rarity === 5) return 'Ascended drop: arena milestone, wave-40 boss or reclear roll (1 in 15 per Ascended)';
  if (it.rarity === 4) return 'Marketplace, arena drop (wave 11+) or forge (25 legendaries)';
  return 'Marketplace or arena drop';
}
function makePools(profile, cfg) {
  const ban = new Set(cfg.bannedItems || []), src = cfg.itemSource, lvl = profile.level;
  const avail = it => {
    if (ban.has(it.itemName) || it.req > lvl) return false;
    if (profile.owned[it.itemName]) return true;
    if (src === 'owned') return false;
    if (src === 'market') return marketable(it);
    return true;
  };
  const copies = n => {
    const it = BYNAME[n], own = profile.owned[n] || 0;
    if (src === 'owned') return own;
    if (marketable(it)) return 2;
    return src === 'all' ? Math.max(1, own) : own;
  };
  const minR = cfg.minRarity !== undefined ? cfg.minRarity : (lvl >= 60 ? 3 : lvl >= 42 ? 2 : 1);
  const pool = [];
  for (let s = 0; s < 6; s++) {
    let c = ALL.filter(it => it.slot === s && avail(it));
    let top = c.filter(it => it.rarity >= minR);
    if (top.length < 4) top = c.slice().sort((a, b) => b.rarity - a.rarity || b.power - a.power).slice(0, 12);
    pool.push(top.map(it => it.itemName).sort());
  }
  const banP = new Set(cfg.bannedPerks || []);
  const perks = (cfg.perkSource === 'owned' ? profile.ownedPerks.filter(k => PERKS[k]) : PERK_IDS).filter(k => !banP.has(k)).slice().sort((a, b) => a - b);
  const nslots = Math.max(1, Math.min(5, cfg.perkSlots || profile.perkSlots || 5));
  let pots = [];
  if (cfg.potMode === 'owned') pots = POTION_NAMES.filter(n => profile.ownedPots[n]);
  else if (cfg.potMode === 'any') pots = POTION_NAMES.slice();
  return { pool, copies, perks, nslots, pots, points: (lvl - 1) * 5 };
}
const itemValue = n => { const it = BYNAME[n]; return it.rarity * 1000 + it.power; };

/* Make any build legal under the pools: unavailable items / perks are replaced, locks applied. */
function adapt(build, P, cfg, profile) {
  const names = build.names.slice(), lock = cfg.lock || {};
  const used = {};
  for (let pos = 0; pos < 7; pos++) {
    if (lock[pos]) { names[pos] = lock[pos]; used[lock[pos]] = (used[lock[pos]] || 0) + 1; }
  }
  for (let pos = 0; pos < 7; pos++) {
    if (lock[pos]) continue;
    const pl = P.pool[ORDER[pos]]; let n = names[pos];
    const ok = x => x && pl.indexOf(x) >= 0 && (used[x] || 0) < P.copies(x);
    if (!ok(n)) n = pl.filter(ok).sort((a, b) => itemValue(b) - itemValue(a) || (a < b ? -1 : 1))[0] || null;
    names[pos] = n; if (n) used[n] = (used[n] || 0) + 1;
  }
  const lockedPerks = (cfg.lockedPerks || []).filter(k => PERKS[k]);
  let K = lockedPerks.slice();
  for (const k of build.perks || []) if (K.length < P.nslots && K.indexOf(k) < 0 && P.perks.indexOf(k) >= 0) K.push(k);
  for (const k of (profile.equippedPerks || []).concat(P.perks)) if (K.length < P.nslots && K.indexOf(k) < 0 && P.perks.indexOf(k) >= 0) K.push(k);
  K = K.slice(0, Math.max(P.nslots, lockedPerks.length)).sort((a, b) => a - b);
  let alloc = cfg.alloc === 'save' ? profile.alloc.slice() : (build.alloc || profile.alloc).slice();
  const sum = alloc.reduce((a, b) => a + b, 0);
  if (cfg.alloc !== 'save' && sum !== P.points) {                       // rescale to the points this level has
    if (sum <= 0) alloc = [0, 0, P.points, 0, 0];
    else { alloc = alloc.map(a => Math.floor(a * P.points / sum)); alloc[2] += P.points - alloc.reduce((a, b) => a + b, 0); }
  }
  let pots = [];
  if (cfg.potMode === 'fixed') pots = (cfg.pots || []).slice(0, 2);
  else if (cfg.potMode === 'owned' || cfg.potMode === 'any') pots = (build.pots || []).filter(n => P.pots.indexOf(n) >= 0).slice(0, 2);
  return { names, perks: K, alloc, pots };
}
const keyOf = b => b.names.join('|') + '#' + b.perks.join(',') + '#' + b.alloc.join(',') + '#' + b.pots.join('+');

/* Archetypes found by the earlier offline searches (notes/formulas.md); used as extra starting points. */
const PRESETS = {
  tank: [
    { names: ["Haughtiness of the Gods", "Remains of Sbard the Ugly", "Sash of Death Sentence", "Frirekr Toto's Aegis", "Sword of Divine Justice", "Oathkeeper's Circle", "Tears of Lumi the Angel"], perks: [10, 28, 17, 29, 30], alloc: [145, 0, 150, 0, 0] },
    { names: ["Crown of the Undying", "Remains of Sbard the Ugly", "Mawfire Cummerbund", "Sword of Divine Justice", "Frirekr Toto's Aegis", "Ring of Final Ascension", "Dawnguard Pendant"], perks: [10, 28, 17, 29, 30], alloc: [106, 0, 175, 0, 14] },
    { names: ["Supreme Assassin's Hood", "Hollow Night Vestments", "The Hollow Coil", "Grieffang", "Grieffang", "Frozen Core Ring", "Hallowed Icon"], perks: [10, 29, 28, 17, 11], alloc: [0, 0, 295, 0, 0] },
  ],
  glass: [
    { names: ["Frog Mouth Helm of Ire", "Simon of Vineyards' Vest", "Sash of Death Sentence", "Bern the Bear's Scythe", "Sword of Divine Justice", "Farn Ahb'Ahzz's Trial", "Essence of the Abyss"], perks: [22, 21, 6, 29, 11], alloc: [150, 0, 120, 0, 25] },
    { names: ["Frog Mouth Helm of Ire", "Fire Titan Cuirass", "The World's Serpent", "Bern the Bear's Scythe", "Mace of the Avalanche", "Ring of Final Ascension", "Essence of the Abyss"], perks: [22, 11, 28, 4, 6], alloc: [31, 0, 250, 0, 14] },
    { names: ["Horns of Death's Assistant", "Ice Feathers of Lapis Lazuli", "Bern the Bear's Hug", "Grieffang", "Mace of the Avalanche", "Ring of Eternal Oblivion", "Essence of the Abyss"], perks: [6, 28, 4, 22, 11], alloc: [31, 0, 250, 0, 14] },
    { names: ["Supreme Assassin's Hood", "Cape of Oblivion", "Sash of Death Sentence", "Grieffang", "Grieffang", "Ring of Eternal Oblivion", "Essence of the Abyss"], perks: [22, 24, 6, 4, 28], alloc: [25, 0, 270, 0, 0] },
  ],
};
const DEPTH = {
  quick: { h: 30, starts: 2, passes: 2, pairLimit: 120, top: 5, label: 'Quick' },
  standard: { h: 80, starts: 3, passes: 3, pairLimit: 420, top: 6, label: 'Standard' },
  thorough: { h: 160, starts: 5, passes: 4, pairLimit: 5000, top: 8, label: 'Thorough' },
};
const SCREEN_SEEDS = [3], CONFIRM_SEEDS = [3, 5], FINAL_SEEDS = [11, 12, 13, 14];

function simOpts(profile, cfg, h, seed) {
  return { plvl: profile.level, budgetH: h, seed, startWave: Math.max(1, cfg.startWave || profile.record), bossmask: cfg.bossmask === undefined ? profile.bossmask : cfg.bossmask,
           pace: cfg.pace || 1, pvpWin: cfg.pvpWin === undefined ? 0.5 : cfg.pvpWin, pvpEveryMin: cfg.pvpEveryMin || 7 };
}
const goalHours = (cfg, h) => cfg.goal === 'push' ? h * 2 : h;

class Cancelled extends Error {}

/* ------------------------------------------------------------------ search */
async function optimise(profile, cfg, evalJobs, onProgress, isCancelled) {
  const P = makePools(profile, cfg), D = DEPTH[cfg.depth] || DEPTH.standard, goal = cfg.goal, lock = cfg.lock || {};
  const H = goalHours(cfg, D.h), HF = H * 3;
  const cache = new Map(); let done = 0; const log = [];
  const prog = (stage) => { if (onProgress) onProgress({ stage, done }); };
  async function ev(builds, seeds, h, detail) {
    const jobs = [], slots = [];
    builds.forEach((b, bi) => seeds.forEach(s => {
      const ck = keyOf(b) + '@' + s + '@' + h + (detail ? 'd' : '');
      if (!cache.has(ck)) { jobs.push({ build: b, o: simOpts(profile, cfg, h, s), goal, detail: !!detail }); slots.push(ck); }
    }));
    for (let i = 0; i < jobs.length; i += 256) {
      if (isCancelled && isCancelled()) throw new Cancelled();
      const part = await evalJobs(jobs.slice(i, i + 256));
      part.forEach((r, j) => cache.set(slots[i + j], r)); done += part.length; prog();
    }
    return builds.map(b => {
      const rs = seeds.map(s => cache.get(keyOf(b) + '@' + s + '@' + h + (detail ? 'd' : '')));
      return { score: rs.reduce((a, r) => a + r.score, 0) / rs.length, build: b, rs };
    });
  }
  const better = (a, b) => b.score - a.score;                 // stable sort keeps generation order on ties
  function neighbours(b, pos) {
    const out = [];
    if (pos === 'w') {
      if (lock[3] && lock[4]) return out;
      const pl = P.pool[3], np = pl.length;
      if (!lock[3] && !lock[4] && np * (np + 1) / 2 <= D.pairLimit) {
        for (let i = 0; i < np; i++) for (let j = i; j < np; j++) {
          if (i === j && P.copies(pl[i]) < 2) continue;
          const n = b.names.slice(); n[3] = pl[i]; n[4] = pl[j]; out.push({ names: n, perks: b.perks, alloc: b.alloc, pots: b.pots });
        }
      } else {
        for (const wp of [3, 4]) {
          if (lock[wp]) continue; const other = b.names[wp === 3 ? 4 : 3];
          for (const x of pl) {
            if (x === b.names[wp] || (x === other && P.copies(x) < 2)) continue;
            const n = b.names.slice(); n[wp] = x; out.push({ names: n, perks: b.perks, alloc: b.alloc, pots: b.pots });
          }
        }
      }
      return out;
    }
    if (pos === 'k') {
      const fixed = new Set(cfg.lockedPerks || []);
      for (let i = 0; i < b.perks.length; i++) {
        if (fixed.has(b.perks[i])) continue;
        for (const k of P.perks) if (b.perks.indexOf(k) < 0) { const K = b.perks.slice(); K[i] = k; K.sort((x, y) => x - y); out.push({ names: b.names, perks: K, alloc: b.alloc, pots: b.pots }); }
      }
      return out;
    }
    if (pos === 'a') {
      if (cfg.alloc === 'save') return out;
      const a = b.alloc;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        if (i === j) continue;
        const steps = new Set([25, 75].filter(st => a[i] >= st)); if (a[i] > 0 && a[i] < 25) steps.add(a[i]);
        for (const st of steps) { const c = a.slice(); c[i] -= st; c[j] += st; out.push({ names: b.names, perks: b.perks, alloc: c, pots: b.pots }); }
      }
      return out;
    }
    if (pos === 'p') {
      if (!P.pots.length) return out;
      const cur = b.pots, seen = new Set([cur.slice().sort().join('+')]);
      const tryp = arr => { const k = arr.slice().sort().join('+'); if (!seen.has(k)) { seen.add(k); out.push({ names: b.names, perks: b.perks, alloc: b.alloc, pots: arr }); } };
      for (let i = 0; i < 2; i++) for (const x of [null].concat(P.pots)) {
        const arr = [cur[0] || null, cur[1] || null]; arr[i] = x;
        const f = arr.filter(Boolean); if (f.length === 2 && f[0] === f[1]) continue; tryp(f);
      }
      return out;
    }
    if (lock[pos]) return out;
    for (const x of P.pool[ORDER[pos]]) if (x !== b.names[pos]) { const n = b.names.slice(); n[pos] = x; out.push({ names: n, perks: b.perks, alloc: b.alloc, pots: b.pots }); }
    return out;
  }
  const POSITIONS = [0, 1, 2, 'w', 5, 6, 'k', 'a', 'p'];
  const posLabel = pos => pos === 'w' ? 'Weapons' : pos === 'k' ? 'Perks' : pos === 'a' ? 'Stat points' : pos === 'p' ? 'Potions' : LB.POS_NAME[pos];
  async function ascend(start, tag) {
    let cur = (await ev([start], CONFIRM_SEEDS, H))[0]; const alts = {}; let converged = false;
    const steps = [{ what: 'start', score: cur.score }];
    for (let pass = 0; pass < D.passes; pass++) {
      let changed = false;
      for (const pos of POSITIONS) {
        const cand = neighbours(cur.build, pos); if (!cand.length) continue;
        prog(tag + ', pass ' + (pass + 1) + ': ' + posLabel(pos) + ' (' + cand.length + ' options)');
        const screened = (await ev(cand, SCREEN_SEEDS, H)).sort(better).slice(0, D.top);
        const conf = (await ev(screened.map(x => x.build), CONFIRM_SEEDS, H)).sort(better);
        alts[pos] = { tested: cand.length, top: conf.slice(0, 4).map(x => ({ build: x.build, score: x.score })), ref: cur.score };
        const best = conf[0];
        if (best && best.score > cur.score * 1.015 + 1e-9) {
          steps.push({ what: posLabel(pos), from: cur.build, to: best.build, before: cur.score, score: best.score, pass: pass + 1 });
          cur = best; changed = true;
        }
      }
      if (!changed) { converged = true; break; }
    }
    return { cur, alts, steps, converged };
  }

  /* starting points: what is equipped now, then the known archetypes for the goal, adapted to the restrictions */
  const equippedBuild = adapt({ names: profile.equipped, perks: profile.equippedPerks, alloc: profile.alloc, pots: cfg.potMode === 'fixed' ? cfg.pots : [] }, P, cfg, profile);
  const arche = goal === 'push' ? PRESETS.tank.concat(PRESETS.glass.slice(0, 1)) : PRESETS.glass.concat(PRESETS.tank.slice(1, 2));
  const starts = []; const seenStart = new Set();
  const addStart = (b, label) => { const a = adapt(b, P, cfg, profile); const k = keyOf(a); if (!seenStart.has(k) && a.names.some(Boolean)) { seenStart.add(k); starts.push({ build: a, label }); } };
  addStart(equippedBuild, 'your equipped build');
  // rank the archetypes by a short simulation so the limited number of starts goes to the promising ones
  const archeAd = arche.map((b, i) => ({ b: adapt(Object.assign({ pots: [] }, b), P, cfg, profile), i })).filter(x => !seenStart.has(keyOf(x.b)));
  prog('Ranking starting points');
  const ranked = (await ev(archeAd.map(x => x.b), SCREEN_SEEDS, H)).map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score || a.i - b.i);
  for (const x of ranked) if (starts.length < D.starts) addStart(x.r.build, 'archetype ' + (archeAd[x.i].i + 1));

  const optima = []; let stopped = false;
  try {
    for (let i = 0; i < starts.length; i++) {
      const res = await ascend(starts[i].build, 'Start ' + (i + 1) + '/' + starts.length);
      res.label = starts[i].label; optima.push(res);
      log.push({ start: starts[i].label, steps: res.steps, converged: res.converged, final: res.cur.build });
    }
  } catch (e) { if (!(e instanceof Cancelled)) throw e; stopped = true; if (!optima.length) throw new Error('Stopped before the first search pass finished.'); }

  /* final ranking on fresh seeds and a longer budget, with full detail */
  const uniq = new Map();
  for (const o of optima) if (!uniq.has(keyOf(o.cur.build))) uniq.set(keyOf(o.cur.build), o);
  const finalists = Array.from(uniq.values()).map(o => o.cur.build);
  const baseKey = keyOf(equippedBuild);
  if (!uniq.has(baseKey)) finalists.push(equippedBuild);
  prog('Final check of ' + finalists.length + ' builds on fresh seeds');
  const cancelSave = isCancelled; isCancelled = null;        // the remaining stages are short; let them finish
  const fin = (await ev(finalists, FINAL_SEEDS, HF, true)).sort(better);
  const winner = fin[0], baseline = fin.find(f => keyOf(f.build) === baseKey);
  const wOpt = uniq.get(keyOf(winner.build));

  /* why: undo each change against the equipped build, one at a time */
  const revert = [];
  if (keyOf(winner.build) !== baseKey) {
    const variants = [];
    for (let pos = 0; pos < 7; pos++) if (winner.build.names[pos] !== equippedBuild.names[pos]) {
      const n = winner.build.names.slice(); n[pos] = equippedBuild.names[pos];
      variants.push({ label: LB.POS_NAME[pos], from: equippedBuild.names[pos], to: winner.build.names[pos], build: Object.assign({}, winner.build, { names: n }) });
    }
    const wp = winner.build.perks, ep = equippedBuild.perks;
    const added = wp.filter(k => ep.indexOf(k) < 0), removed = ep.filter(k => wp.indexOf(k) < 0);
    added.forEach((k, i) => {
      const K = wp.slice(); const back = removed[i]; if (back !== undefined) K[K.indexOf(k)] = back; else K.splice(K.indexOf(k), 1); K.sort((x, y) => x - y);
      variants.push({ label: 'Perk', from: back !== undefined ? PERKS[back].name : '(empty slot)', to: PERKS[k].name, build: Object.assign({}, winner.build, { perks: K }) });
    });
    if (winner.build.alloc.join() !== equippedBuild.alloc.join())
      variants.push({ label: 'Stat points', from: equippedBuild.alloc.join(' / '), to: winner.build.alloc.join(' / '), build: Object.assign({}, winner.build, { alloc: equippedBuild.alloc }) });
    if (winner.build.pots.slice().sort().join() !== equippedBuild.pots.slice().sort().join())
      variants.push({ label: 'Potions', from: equippedBuild.pots.join(' + ') || 'none', to: winner.build.pots.join(' + ') || 'none', build: Object.assign({}, winner.build, { pots: equippedBuild.pots }) });
    prog('Explaining each change');
    const rs = await ev(variants.map(v => v.build), FINAL_SEEDS, HF);
    variants.forEach((v, i) => revert.push({ label: v.label, from: v.from, to: v.to, without: rs[i].score }));
  }
  /* what each perk is worth: the build with that slot empty */
  prog('Measuring each perk');
  const perkVars = winner.build.perks.map(k => Object.assign({}, winner.build, { perks: winner.build.perks.filter(x => x !== k) }));
  const perkWorth = (await ev(perkVars, FINAL_SEEDS, HF)).map((r, i) => ({ perk: winner.build.perks[i], without: r.score }));

  /* what to chase: single swaps from outside the allowed pools */
  const targets = { items: [], perks: [] };
  if (!stopped && cfg.targets !== false) {
    const wide = makePools(profile, Object.assign({}, cfg, { itemSource: 'all', perkSource: 'all', bannedItems: cfg.bannedItems, potMode: 'none' }));
    const cands = [];
    for (let pos = 0; pos < 7; pos++) {
      if (lock[pos]) continue;
      for (const x of wide.pool[ORDER[pos]]) {
        if (P.pool[ORDER[pos]].indexOf(x) >= 0 && P.copies(x) > 0) continue;       // already allowed: the search has seen it
        if (x === winner.build.names[pos]) continue;
        if ((pos === 3 || pos === 4) && x === winner.build.names[pos === 3 ? 4 : 3] && wide.copies(x) < 2) continue;
        const n = winner.build.names.slice(); n[pos] = x; cands.push({ kind: 'item', pos, item: x, build: Object.assign({}, winner.build, { names: n }) });
      }
    }
    for (const k of PERK_IDS) {
      if (P.perks.indexOf(k) >= 0 || (cfg.bannedPerks || []).indexOf(k) >= 0) continue;
      for (let i = 0; i < winner.build.perks.length; i++) {
        const K = winner.build.perks.slice(); const out = K[i]; K[i] = k; K.sort((x, y) => x - y);
        cands.push({ kind: 'perk', perk: k, replaces: out, build: Object.assign({}, winner.build, { perks: K }) });
      }
      if (winner.build.perks.length < P.nslots) cands.push({ kind: 'perk', perk: k, replaces: null, build: Object.assign({}, winner.build, { perks: winner.build.perks.concat([k]).sort((x, y) => x - y) }) });
    }
    if (cands.length) {
      prog('Looking for upgrades outside your restrictions (' + cands.length + ' swaps)');
      const refH = (await ev([winner.build], CONFIRM_SEEDS, H))[0].score;
      const scr = await ev(cands.map(c => c.build), SCREEN_SEEDS, H);
      const order = scr.map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score || a.i - b.i);
      const bestOf = new Map();                                   // best swap per item / perk
      for (const x of order) { const c = cands[x.i], id = c.kind + ':' + (c.item || c.perk); if (!bestOf.has(id)) bestOf.set(id, c); }
      const short = Array.from(bestOf.values()).slice(0, 16);
      const conf = await ev(short.map(c => c.build), FINAL_SEEDS, HF);
      short.forEach((c, i) => {
        const gain = conf[i].score / (winner.score || 1e-12) - 1; if (!(conf[i].score > winner.score)) return;
        if (c.kind === 'item') targets.items.push({ item: c.item, pos: c.pos, replaces: winner.build.names[c.pos], score: conf[i].score, gain, source: sourceOf(BYNAME[c.item], profile) });
        else targets.perks.push({ perk: c.perk, replaces: c.replaces, score: conf[i].score, gain, cost: PERKS[c.perk].cost });
      });
      targets.items.sort((a, b) => b.score - a.score); targets.perks.sort((a, b) => b.score - a.score);
      targets.refScreen = refH;
    }
  }
  isCancelled = cancelSave;
  return { goal, cfg, profileName: profile.name, depth: D, H, HF, sims: done, stopped, winner, baseline, baselineIsWinner: keyOf(winner.build) === baseKey,
           finalists: fin, alts: wOpt ? wOpt.alts : {}, converged: wOpt ? wOpt.converged : false, revert, perkWorth, targets, log,
           poolSizes: P.pool.map(p => p.length), perkPool: P.perks, nslots: P.nslots, start: simOpts(profile, cfg, HF, 0) };
}

/* Plain comparison of hand-made builds: every goal metric for each. */
async function compare(profile, builds, cfg, evalJobs) {
  const jobs = [];
  builds.forEach(b => FINAL_SEEDS.forEach(s => jobs.push({ build: b, o: simOpts(profile, cfg, cfg.hours || 150, s), goal: 'push', detail: true })));
  const rs = await evalJobs(jobs);
  return builds.map((b, i) => ({ build: b, rs: rs.slice(i * FINAL_SEEDS.length, (i + 1) * FINAL_SEEDS.length) }));
}

return { parseSave, exampleProfile, makePools, adapt, optimise, compare, keyOf, sourceOf, marketable, DEPTH, FINAL_SEEDS, PRESETS, simOpts, goalHours };
})(LB);
if (typeof module !== 'undefined') module.exports = LBP;
