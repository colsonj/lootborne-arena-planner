/* Lootborne arena engine: JavaScript port of tools/lb2.py (gear parsing, totals, loot) and tools/fastsim2p.c
   (combat + Eternal Arena loop). Same xorshift64 stream as the C version, so equal inputs give equal results.
   Runs in the page, in a Web Worker and in node (web/test/parity.mjs checks it against the Python / C reference). */
var LB = (function (DATA) {
'use strict';
const IDX = ('HP ATK DFN CRIT PAR CAP ECM ECC PARRY_IGN DEF_IGN LIFESTEAL CRIT_LS CRIT_HEAL CRIT_BONUS PARRY_HEAL ' +
  'PARRY_COUNTER PARRY_REFL REFLECT REFL_HEAL FH_ABSORB FH_COUNTER FH_HEAL FH_ATKPCT FIRSTN_ABSORB ' +
  'HITN1_N HITN1_KIND HITN2_N HITN2_KIND HITN_HEAL CRIT_HALVE IMM_THR IMM_SEC KILL_HEAL KILL_DMG KILL_MAX ' +
  'OVERHEAL PARRY_DEF_REST PTD_AMT PTD_SEC DEBUFF_AMT DEBUFF_TURNS POISON_TOTAL POISON_TURNS ' +
  'NEA NEC NOC NOP NFA NLOW NTB NCOND ' +
  'PERKS DMULT TMULT MOMENTUM LUNGE ECHO RIPOSTE NOCRIT FLAT COUP ANGEL BULWARK BCURSE NOHEAL PLS ' +
  'PREFLECT CHUNT FURYM FIRST_CRIT TURN_SEC PAUSE_SEC FIGHT_REGEN').split(' ');
const I = {}; IDX.forEach((k, n) => { I[k] = n; });
const BASE = { hp: 400, atk: 8, dfn: 5, crit: 5, parry: 3 };
const HP_PT = 3.2, ATK_PT = 0.2, DEF_PT = 0.8, CRIT_PT = 0.3, PARRY_PT = 0.25, CRIT_CAP = 60, PARRY_CAP = 55;
const TURN_SEC = 0.5, PAUSE_SEC = 2.0;
const ELEM = { Arcane: 1, Flame: 2, Frost: 3, Holy: 4, Shadow: 5 };
const ELEM_NAME = ['Neutral', 'Arcane', 'Flame', 'Frost', 'Holy', 'Shadow'];
const RARITY = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Ascended'];
const SLOT = ['Head', 'Body', 'Belt', 'Weapon', 'Ring', 'Trinket'];
const ORDER = [0, 1, 2, 3, 3, 4, 5];                       // build positions -> item slot
const POS_NAME = ['Head', 'Body', 'Belt', 'Weapon 1', 'Weapon 2', 'Ring', 'Trinket'];
const INTENDED6 = 56;

/* Perks as modelled (V2 numbers from PerkCombat.ApplyPerk). bit: flags read inside the fight loop; x: simulator inputs. */
const PERKS = {
  1: { name: 'Pent-Up Wrath', bit: 1, cost: 100, text: 'Each non-crit adds +10% CRIT (max +50%), reset on a crit.' },
  2: { name: 'Innate Guard', cost: 100, text: 'PARRY is raised to at least 15%.' },
  3: { name: 'First Blood', cost: 70, x: { FIRST_CRIT: 1 }, text: 'First attack of each fight is a guaranteed crit.' },
  4: { name: "Brute's Temper", cost: 700, text: 'Adds 20% of DEF to ATK.' },
  5: { name: 'Rising Momentum', cost: 700, x: { MOMENTUM: 0.04 }, text: '+4% damage per landed attack, up to 10 stacks per fight.' },
  6: { name: 'Heavy Lunge', cost: 700, x: { LUNGE: 1.4 }, text: 'Every 3rd swing deals +140% damage and cannot be parried.' },
  7: { name: 'Lingering Venom', bit: 32, cost: 100, text: 'Crits poison for 28 damage over 4 s.' },
  8: { name: 'Aggressive Riposte', cost: 700, x: { RIPOSTE: 0.35 }, text: 'After a parry the next 2 attacks deal +35%.' },
  9: { name: 'Bottled Lightning', cost: 350, text: '+40% ATK, -15% max HP.' },
  10: { name: 'Dragonhide', cost: 100, text: '+35% DEF, +15% max HP, -12% ATK.' },
  11: { name: 'Dying Fury', bit: 2, cost: 350, text: 'Below 40% HP: ATK x1.8.' },
  12: { name: 'Crimson Vow', bit: 4, cost: 180, text: 'Heal 3 HP per landed attack.' },
  14: { name: "Rival's Calling", cost: 100, pvpOnly: true, pvp: { DMULT: 1.3 }, text: '+30% damage in PvP (its -5% in the arena is not modelled).' },
  13: { name: 'Reckless Abandon', cost: 350, x: { DMULT: 1.3, TMULT: 1.1 }, text: 'Deal x1.3 damage, take x1.1.' },
  15: { name: 'Aggression', cost: 100, text: '+6 ATK.' },
  16: { name: 'Guardian Angel', cost: 350, x: { ANGEL: 0.2 }, text: 'Entering a fight below 50% HP gives a shield of 20% max HP.' },
  17: { name: 'Colossus Hunter', cost: 400, x: { CHUNT: 0.015 }, text: 'Each hit adds 1.5% of enemy max HP before the DEF reduction.' },
  18: { name: 'Tenacity', cost: 700, x: { PLS: 0.05 }, text: '5% lifesteal.' },
  19: { name: 'Thorns', cost: 100, x: { PREFLECT: 0.5 }, text: 'Reflects damage taken back to the enemy.' },
  20: { name: 'Absolute Precision', cost: 350, x: { NOCRIT: 1, FLAT: 20 }, text: 'No crits; every hit gains +20 flat damage.' },
  21: { name: 'Burning Heart', cost: 350, x: { DMULT: 1.5, NOHEAL: 1 }, text: 'Deal x1.5 damage; in-combat healing is disabled.' },
  22: { name: "Duelist's Gamble", cost: 700, x: { DMULT: 2.0, TMULT: 1.25 }, text: 'Deal x2 damage, take x1.25.' },
  23: { name: 'Blood Curse', cost: 700, x: { BCURSE: 0.13 }, text: '13% lifesteal, but lose 11% of the damage you deal.' },
  24: { name: 'Coup de Grace', cost: 350, x: { COUP: 0.2 }, text: 'Executes enemies below 20% HP.' },
  25: { name: 'Voracious Echo', cost: 350, x: { ECHO: 1.2 }, text: 'Every 5th swing deals +120% and cannot be parried.' },
  27: { name: 'Critical Apex', cost: 350, text: '+15% CRIT and the CRIT cap rises to 75%.' },
  28: { name: 'Bulwark', bit: 0, cost: 700, x: { BULWARK: 0.42 }, text: 'Below 25% HP: take 42% less damage and heal 4 HP per round.' },
  29: { name: 'Last Breath', bit: 8, cost: 350, text: 'Once per fight, survive a killing blow at 25% HP.' },
  30: { name: 'Instinctive Guard', cost: 350, text: '+0.5% DEF per point of PARRY (up to +27.5%).' },
  31: { name: 'Armor Piercer', bit: 16, cost: 350, text: 'Attacks ignore 35% of enemy PARRY and 35% of enemy DEF.' },
};
const PERK_IDS = Object.keys(PERKS).map(Number).filter(k => !PERKS[k].pvpOnly).sort((a, b) => a - b);
const PVP_PERK_IDS = Object.keys(PERKS).map(Number).filter(k => k !== 16 && k !== 17 && k !== 24).sort((a, b) => a - b);
const UNMODELLED_PERKS = { 26: 'Mirror Echo' };
const SLOT_UNLOCK = [1, 10, 20, 40, 60];
/* Potions: id from the save (ownedConsumableIds). kind: combat | loot | other. */
const POTIONS = {
  Immolation: { id: 27, kind: 'combat', text: 'Enemy loses 0.5% of its max HP on every swing (yours and its own).' },
  Bastion: { id: 1, kind: 'combat', text: 'You take 20% less damage.' },
  Rampart: { id: 3, kind: 'combat', text: '+30% DEF.' },
  Vigor: { id: 4, kind: 'combat', text: '+20% max HP.' },
  Fury: { id: 2, kind: 'combat', text: '+25% ATK.' },
  Savagery: { id: 5, kind: 'combat', text: '+20% CRIT.' },
  Feline: { id: 6, kind: 'combat', label: 'Feline Reflexes', text: '+16% PARRY.' },
  Regeneration: { id: 7, kind: 'combat', text: 'Recover 18% max HP after each fight.' },
  Bloodthirst: { id: 8, kind: 'combat', text: '+5% lifesteal (total lifesteal still capped at 15%).' },
  Attrition: { id: 13, kind: 'combat', text: 'Enemies have 15% less HP.' },
  Tireless: { id: 11, kind: 'loot', text: 'No stamina use, so no rest breaks.' },
  "Seeker's Luck": { id: 14, kind: 'loot', text: 'Drop chance +8%.' },
  'Heavy Haul': { id: 19, kind: 'loot', text: 'Drop chance +10%.' },
  "Collector's Eye": { id: 16, kind: 'loot', text: '25% chance to raise a drop by one rarity tier.' },
  Wisdom: { id: 15, kind: 'loot', text: '+20% XP.' },
};
const POTION_NAMES = Object.keys(POTIONS);
const POTION_BY_ID = {}; POTION_NAMES.forEach(n => { POTION_BY_ID[POTIONS[n].id] = n; });

const pyRound = x => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
const cround = x => x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);

/* ------------------------------------------------------------------ catalogue */
const ALL = DATA.items, BYNAME = {}, BYID = {};
const power = i => i.hp * 0.8 + i.atk * 9 + i.def * 6 + i.crit * 6 + i.parry * 8;
const BANDS = { 0: [1, 1, 1], 1: [6, 8, 10], 2: [16, 18, 20], 3: [42, 44, 48], 4: [60, 60, 60], 5: [60, 60, 60] };
const T33 = [0, 42, 74, 120, 168, 206], T66 = [0, 53, 92, 136, 190, 216];
function reqLevel(i) {
  if (i.isBossExclusive || i.rarity < 1) return 1;
  const p = power(i), r = i.rarity; return BANDS[r][p < T33[r] ? 0 : (p < T66[r] ? 1 : 2)];
}
const isShield = name => name.toLowerCase().indexOf('shield') >= 0;
for (const i of ALL) { i.req = reqLevel(i); i.power = power(i); BYNAME[i.itemName] = i; BYID[i.id] = i; }

/* ------------------------------------------------------------------ gear parsing (lb2.gear) */
const NUM = '(\\d+(?:\\.\\d+)?)';
const R = (src, fl) => new RegExp(src, fl || 'i');
const KEY = { ATK: 'atk', HP: 'hp', DEF: 'dfn', CRIT: 'crit', PARRY: 'par' };
const RX = {
  flat: R('\\+' + NUM + '\\s*%?\\s*(HP|ATK|DEF|CRIT|PARRY)', 'g'),
  diffElem: R('^If equipped with an item of a different element:(.*)', ''),
  everyCat: R('^For every different element category equipped:(.*)', ''),
  withElem: R('^If equipped with an?\\s+(\\w+)\\s+item:(.*)', ''),
  everyOther: R('^For every other\\s+(\\w+)\\s+item:(.*)', ''),
  dual: R('^If dual wielding weapons:(.*)', ''),
  withNamed: R('^If equipped with ([^:]+):(.*)', ''),
  allPer: R('\\+(\\d+)\\s+to\\s+all\\s+stats\\s+for\\s+every\\s+other\\s+equipped\\s+item'),
  conv: R('Convert\\s+' + NUM + '%\\s+of\\s+max\\s+HP\\s+into\\s+ATK'),
  pctLead: R('^\\s*[+-]\\d', ''),
  pct: R('([+-])' + NUM + '%\\s*(ATK|DEF|HP|CRIT|PARRY)\\b', 'g'),
  lifesteal: R('^\\s*Lifesteal\\s+' + NUM + '%', ''),
  overheal: R('healing\\s+above\\s+max\\s+HP\\s+becomes\\s+a\\s+(?:temporary\\s+)?shield'),
  reflect: R('Reflects?\\s+' + NUM + '%\\s+of\\s+(?:the\\s+)?damage\\s+taken(\\s+as\\s+healing)?'),
  parIgn: R('ignore\\s+' + NUM + '%?\\s+of\\s+enemy\\s+parry|attacks\\s+ignore\\s+' + NUM + '%\\s+enemy\\s+parry'),
  defIgn: R('and\\s+' + NUM + '%\\s+enemy\\s+DEF'), atkIgnore: R('attacks\\s+ignore'),
  redCritPar: R('Reduces?\\s+enemy\\s+critic[a-z]*\\s+and\\s+parry\\s+by\\s+' + NUM + '%?'),
  redCrit: R('Reduces?\\s+enemy\\s+critic[a-z]*\\s+(?:damage\\s+)?by\\s+' + NUM + '%?'),
  cond: R('\\+' + NUM + '%\\s+damage\\s+to\\s+enemies\\s+(above|below)\\s+' + NUM + '%\\s+HP'),
  parRefl: R('On\\s+parry\\s*:\\s*reflect\\s+' + NUM + '%\\s+of\\s+the\\s+negated\\s+damage'),
  poison: R('appl(?:y|ies)\\s+a\\s+poison\\s+dealing\\s+(\\d+)\\s+damage\\s+over\\s+(\\d+)\\s+sec'),
  tbAll: R('Every\\s+(\\d+)\\s+sec(?:\\s+in\\s+combat)?\\s*:.*?\\+(\\d+)\\s+to\\s+all\\s+stats'),
  tbStat: R('Every\\s+(\\d+)\\s+sec(?:\\s+in\\s+combat)?\\s*:.*?\\+(\\d+)\\s+(?:permanent|temporary)\\s+(ATK|DEF|HP|CRIT|PARRY)(?:.*?\\(\\s*max\\s+(\\d+)\\s+stack\\s*\\))?'),
  tbHeal: R('Every\\s+(\\d+)\\s+sec(?:\\s+in\\s+combat)?[:\\s]+regenerates?\\s+(\\d+)\\s+HP'),
  everyAtk: R('Every\\s+(\\d+)\\s+attacks\\s*:\\s*(.+)$'),
  eaIgn: R('ignores?\\s+' + NUM + '%?\\s+(?:enemy\\s+)?DEF', ''), eaPct: R('\\+' + NUM + '%\\s+damage', ''),
  eaFlat: R('\\+(\\d+)\\s+(?:bonus\\s+)?damage(?!\\s*%)', ''), eaCrit: R('\\+' + NUM + '%\\s+CRIT', ''),
  eaHeal: R('regenerates?\\s+(\\d+)\\s+HP', ''), eaNopar: R('unparryable|ignores?\\s+parry', ''),
  everyCrit: R('Every\\s+(\\d+)\\s+critic\\w*\\s+(?:hits?|attacks)\\s*:\\s*next\\s+attack\\s+deals\\s+(double|triple|quadruple)\\s+damage(\\s+and\\s+ignores\\s+DEF)?'),
  nopar: R('unparryable|ignores?\\s+parry'),
  onCrit: R('On\\s+critic\\w*\\s+hit\\s*:'),
  ocBonus: R('(?:\\+(\\d+)\\s+bonus\\s+damage|deals\\s+\\+?(\\d+)\\s+(?:danni(?:\\s+bonus)?|bonus\\s+damage))'),
  nextCrit: R('next\\s+attack\\s+ha?\\s+' + NUM + '%\\s+CRIT'), nextIgnDef: R('next\\s+attack\\s+ignores\\s+DEF'),
  ocDebuff: R('reduces?\\s+enemy\\s+DEF\\s+by\\s+(\\d+)\\s+(?:per|for)\\s+(\\d+)\\s+sec'),
  regen: R('regenerates?\\s+(\\d+)\\s+HP'), absorbAsHp: R('absorb\\s+' + NUM + '%\\s+damage\\s+(?:come|as)\\s+HP'),
  halved: R('next\\s+hit\\s+taken\\s+is\\s+halved'),
  onParry: R('On\\s+parry\\s*:'),
  opNextN: R('next\\s+(\\d+)\\s+attacks?\\s+have\\s+\\+' + NUM + '%\\s+damage(?:\\s+and\\s+ignorano\\s+' + NUM + '%\\s+DEF)?'),
  opIgnPar: R('next\\s+(\\d+)\\s+attacks?\\s+ignore\\s+parry(?:\\s+and\\s+deals?\\s+\\+' + NUM + '%\\s+damage)?'),
  opNextPct: R('next\\s+attack\\s+\\+' + NUM + '%\\s+damage'),
  opCritBonus: R('(?:\\+' + NUM + '%\\s+CRIT\\s+(?:to\\s+)?next\\s+attack|next\\s+attack\\s+ha?\\s+\\+' + NUM + '%\\s+CRIT)'),
  opFlat: R('deals\\s+\\+?(\\d+)\\s+danni(?:\\s+bonus)?|\\+(\\d+)\\s+bonus\\s+damage'),
  opHeal: R('On\\s+parry\\s*:\\s*regenerates?\\s+(\\d+)\\s+HP'),
  counter: R('(?:counterattack|contrattacca\\s+con)\\s+(?:for\\s+)?(\\d+)'),
  defRest: R('\\+(\\d+)\\s+DEF\\s+(?:per\\s+il\\s+resto|for\\s+the\\s+rest(?:\\s+of\\s+(?:the\\s+)?combat)?)'),
  defSec: R('\\+(\\d+)\\s+DEF\\s+(?:per|for)\\s+(\\d+)\\s+sec'),
  firstHit: R('On\\s+first\\s+hit'), firstHitRed: R('First\\s+hit(?:\\s+taken)?\\s+damage\\s+reduced'),
  fhAbsorb: R('On\\s+first\\s+hit(?:\\s+taken)?\\s*:\\s*absorb\\s+' + NUM + '%'),
  fhReduced: R('First\\s+hit(?:\\s+taken)?\\s+damage\\s+reduced\\s+by\\s+' + NUM + '%'),
  fhCounter: R('On\\s+first\\s+hit(?:\\s+taken)?\\s*:.*?(?:counterattack|contrattacca\\s+con)\\s+(?:for\\s+)?(\\d+)'),
  fhAtk: R('\\+' + NUM + '%?\\s+ATK\\s+(?:per\\s+il\\s+resto|for\\s+the\\s+rest(?:\\s+of\\s+(?:the\\s+)?combat)?)'),
  firstN: R('First\\s+(\\d+)\\s+hits?\\s+taken\\s*:\\s*(?:completely\\s+)?absorb\\s+the\\s+damage'),
  hitN: R('Every\\s+(\\d+)\\s+hits?\\s+taken\\s*:\\s*(?:(?:completely\\s+)?absorb\\s+the\\s+next|(next\\s+hit\\s+taken\\s+has\\s+damage\\s+halved))'),
  onKill: R('On\\s+kill\\s*:'), killHeal: R('heal\\s+' + NUM + '%\\s+max\\s+HP'), killDmg: R('\\+' + NUM + '%\\s+damage'),
  killMax: R('up\\s+to\\s+(\\d+)\\s+stacks?'),
  firstAtk: R('First\\s+(?:(\\d+)\\s+)?attacks?\\s+of\\s+(?:the\\s+)?combat'), faPct: R('deals?\\s+\\+' + NUM + '%\\s+damage'),
  gcrit: R('guaranteed\\s+critical'),
  below: R('^Below\\s+' + NUM + '%?\\s+HP\\s*:(.*)', ''),
  ignored: R('Stamina|item chance|rarity drop|Bloodmarks|PvP currency', ''),
  // below-HP rows
  bAtkPct: R('\\+' + NUM + '%\\s*(?:permanent\\s+|temporary\\s+)?ATK'), bPermDef: R('\\+' + NUM + '%\\s+permanent\\s+DEF'),
  bDefPct: R('\\+' + NUM + '%\\s*(?:temporary\\s+)?DEF'), bCrit: R('\\+' + NUM + '%\\s*CRIT'), bAtkFlat: R('\\+(\\d+)\\s+ATK(?!\\s*%)'),
  bAll: R('\\+(\\d+)\\s+to\\s+all\\s+stats'), bLs: R('(?:lifesteal\\s+|life\\s*steal\\s+)\\+?' + NUM + '%'),
  bAbsorb: R('absorb\\s+' + NUM + '%\\s+damage'), bAtkLs: R('ogni\\s+attacco\\s+assorbe\\s+' + NUM + '%\\s+damage\\s+(?:come|as)\\s+HP'),
  bDmgPerAtk: R('ogni\\s+attacco\\s+deals\\s+\\+(\\d+)\\s+damage'), bGcrit: R('attacks?\\s+(?:are|is)\\s+guaranteed\\s+critical'),
  bImmCrit: R('immune\\s+a\\s+critici|immune\\s+to\\s+critical\\s+hits?'), bImmSec: R('immune\\s+per\\s+(\\d+)\\s+sec'),
  bPerAtkPost: R('^\\s+per\\s+attack', ''), bOgniAtk: R('ogni\\s+(?:attacco|colpo)\\b[^,]*$', ''), bOgniCrit: R('ogni\\s+critico\\b[^,]*$', ''),
  bOnce: R('^\\s*\\(\\s*(?:1\\s+volta|una\\s+volta|once)\\s*\\)', ''),
  bRest: R('regenerates?\\s+\\d+\\s+HP(?:\\s*/\\s*sec|\\s+per\\s+sec)?\\s+(?:per\\s+il\\s+resto|for\\s+the\\s+rest)'),
  bDur: R('regenerates?\\s+\\d+\\s+HP(?:\\s*/\\s*sec|\\s+per\\s+sec)?\\s+(?:per|for)\\s+(\\d+)\\s+sec'),
  // loot / economy effects
  itemChance: R('\\+(\\d+)% bonus item chance', ''), rarityUp: R('\\+(\\d+)% higher rarity drop chance', ''),
  stamCost: R('Reduces? Stamina consumption by (\\d+)', ''), stamRest: R('Regenerates \\+(\\d+)% Stamina in Rest', ''),
  bloodmarks: R('\\+(\\d+)% Bloodmarks', ''),
};
const LOWK = ('thr atkPct defPct crit regenTick ls absorb atkFlat all dmgPerAtk regenPerAtk regenPerCrit atkLs immuneCrit permDef gcrit ' +
  'regenDur regenOnce regenRest').split(' ');
function flat(txt, mult) {
  const d = {}; if (mult === undefined) mult = 1; RX.flat.lastIndex = 0; let m;
  while ((m = RX.flat.exec(txt))) d[KEY[m[2]]] = parseFloat(m[1]) * mult;
  return d;
}
const mod = o => { const q = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; return q; };
function below(thr, t, fx) {
  const r = {}; LOWK.forEach(k => { r[k] = 0; }); r.thr = thr / 100; let m;
  m = RX.bAtkPct.exec(t); r.atkPct = m ? parseFloat(m[1]) / 100 : 0;
  m = RX.bPermDef.exec(t);
  if (m) r.permDef = parseFloat(m[1]) / 100;
  else { m = RX.bDefPct.exec(t); r.defPct = m ? parseFloat(m[1]) / 100 : 0; }
  m = RX.bCrit.exec(t); r.crit = m ? parseFloat(m[1]) : 0;
  m = RX.bAtkFlat.exec(t); r.atkFlat = m ? parseFloat(m[1]) : 0;
  m = RX.bAll.exec(t); r.all = m ? parseFloat(m[1]) : 0;
  m = RX.bLs.exec(t); r.ls = m ? parseFloat(m[1]) / 100 : 0;
  m = RX.bAbsorb.exec(t); r.absorb = m ? parseFloat(m[1]) / 100 : 0;
  m = RX.bAtkLs.exec(t); r.atkLs = m ? parseFloat(m[1]) / 100 : 0;
  m = RX.bDmgPerAtk.exec(t); r.dmgPerAtk = m ? parseFloat(m[1]) : 0;
  if (RX.bGcrit.test(t)) r.gcrit = 1;
  if (RX.bImmCrit.test(t)) r.immuneCrit = 1;
  m = RX.bImmSec.exec(t);
  if (m && parseInt(m[1], 10) > fx.IMM_SEC) { fx.IMM_SEC = parseInt(m[1], 10); fx.IMM_THR = thr / 100; }
  m = RX.regen.exec(t);
  if (m) {
    const v = parseFloat(m[1]), pre = t.slice(0, m.index), post = t.slice(m.index + m[0].length);
    if (RX.bPerAtkPost.test(post) || RX.bOgniAtk.test(pre)) r.regenPerAtk = v;
    else if (RX.bOgniCrit.test(pre)) r.regenPerCrit = v;
    else {
      r.regenTick = v;
      if (RX.bOnce.test(post)) r.regenOnce = 1;
      else if (RX.bRest.test(t)) r.regenRest = 1;
      else { const k = RX.bDur.exec(t); if (k) r.regenDur = parseFloat(k[1]); }
    }
  }
  return LOWK.map(k => r[k]);
}

/* -> { s, pct, fx, ea, ec, oc, op, fa, low, tb, cond, conv, allper, welems, unparsed } */
function gear(items) {
  items = items.filter(Boolean);
  const s = { hp: 0, atk: 0, dfn: 0, crit: 0, par: 0 }, pct = { hp: 0, atk: 0, dfn: 0, crit: 0, par: 0 };
  const fx = {}; IDX.forEach(k => { fx[k] = 0; });
  const ea = [], ec = [], oc = [], op = [], fa = [], low = [], tb = [], cond = [], unparsed = [];
  const weapons = items.filter(i => i.slot === 3);
  const shield = weapons.some(w => isShield(w.itemName)), dual = weapons.length === 2 && !shield;
  const cats = new Set(); items.forEach(i => { if (i.category) cats.add(i.category); }); const ncat = cats.size;
  let ecmRed = 0, eccRed = 0, conv = 0, allper = 0; let hitn = [];
  const add = d => { for (const k in d) s[k] += d[k]; };
  items.forEach((it, n_) => {
    add({ hp: it.hp, atk: it.atk, dfn: it.def, crit: it.crit, par: it.parry });
    const others = items.filter((j, k_) => k_ !== n_);
    for (let e of it.effects) {
      e = e.trim(); let hit = false, m, k;
      // ---- stat synergies
      m = RX.diffElem.exec(e);
      if (m) { if (others.some(j => j.category !== 0 && j.category !== it.category)) add(flat(m[1])); continue; }
      m = RX.everyCat.exec(e);
      if (m) { add(flat(m[1], ncat)); continue; }
      m = RX.withElem.exec(e);
      if (m && ELEM[m[1]] !== undefined) { if (others.some(j => j.category === ELEM[m[1]])) add(flat(m[2])); continue; }
      m = RX.everyOther.exec(e);
      if (m) { add(flat(m[2], others.filter(j => j.category === ELEM[m[1]]).length)); continue; }
      m = RX.dual.exec(e);
      if (m) { if (dual) add(flat(m[1])); continue; }
      m = RX.withNamed.exec(e);
      if (m) {
        const names = m[1].split(' or ');
        if ((m[1].indexOf('a Shield') >= 0 && shield) || others.some(j => names.indexOf(j.itemName) >= 0)) add(flat(m[2]));
        continue;
      }
      m = RX.allPer.exec(e);
      if (m) { allper += parseFloat(m[1]) * others.length; continue; }
      m = RX.conv.exec(e);
      if (m) { conv += parseFloat(m[1]) / 100; continue; }
      if (RX.pctLead.test(e)) {
        RX.pct.lastIndex = 0; let any = false;
        while ((m = RX.pct.exec(e))) { any = true; pct[KEY[m[3]]] += (m[1] === '+' ? 1 : -1) * parseFloat(m[2]) / 100; }
        if (any) continue;
      }
      // ---- passive combat effects
      m = RX.lifesteal.exec(e);
      if (m) { fx.LIFESTEAL += parseFloat(m[1]) / 100; hit = true; }
      if (RX.overheal.test(e)) { fx.OVERHEAL = 1; hit = true; }
      m = RX.reflect.exec(e);
      if (m) { fx[m[2] ? 'REFL_HEAL' : 'REFLECT'] += parseFloat(m[1]) / 100; hit = true; }
      m = RX.parIgn.exec(e);
      if (m) { fx.PARRY_IGN += parseFloat(m[1] || m[2]) / 100; hit = true; }
      m = RX.defIgn.exec(e);
      if (m && RX.atkIgnore.test(e)) { fx.DEF_IGN += parseFloat(m[1]) / 100; hit = true; }
      m = RX.redCritPar.exec(e);
      if (m) { fx.PARRY_IGN += parseFloat(m[1]) / 100; eccRed += parseFloat(m[1]) / 100; hit = true; }
      m = RX.redCrit.exec(e);
      if (m) { ecmRed += parseFloat(m[1]) / 100; hit = true; }
      m = RX.cond.exec(e);
      if (m) { cond.push([parseFloat(m[3]) / 100, m[2].toLowerCase() === 'above' ? 1 : 0, parseFloat(m[1]) / 100]); hit = true; }
      m = RX.parRefl.exec(e);
      if (m) { fx.PARRY_REFL += parseFloat(m[1]) / 100; continue; }
      m = RX.poison.exec(e);
      if (m) { fx.POISON_TOTAL = Math.max(fx.POISON_TOTAL, parseFloat(m[1])); fx.POISON_TURNS = 2 * parseInt(m[2], 10); hit = true; }
      // ---- timed
      m = RX.tbAll.exec(e);
      if (m) { tb.push([parseFloat(m[1]), parseFloat(m[2]), 4, 12]); hit = true; }
      m = RX.tbStat.exec(e);
      if (m) {
        const st = { ATK: 0, DEF: 1, CRIT: 2, PARRY: 3 }[m[3].toUpperCase()];
        if (st !== undefined) tb.push([parseFloat(m[1]), parseFloat(m[2]), st, parseFloat(m[4] || 0)]);
        hit = true;
      }
      m = RX.tbHeal.exec(e);
      if (m) { tb.push([parseFloat(m[1]), parseFloat(m[2]), 5, 0]); hit = true; }
      // ---- every N attacks / crits
      m = RX.everyAtk.exec(e);
      if (m) {
        const t = m[2], q = mod(); q[0] = parseInt(m[1], 10);
        k = RX.eaIgn.exec(t); q[4] = k ? parseFloat(k[1]) / 100 : 0;
        k = RX.eaPct.exec(t); q[2] = k ? parseFloat(k[1]) / 100 : 0;
        k = RX.eaFlat.exec(t); q[3] = k ? parseFloat(k[1]) : 0;
        k = RX.eaCrit.exec(t); q[6] = k ? parseFloat(k[1]) / 100 : 0;
        k = RX.eaHeal.exec(t); q[10] = k ? parseFloat(k[1]) : 0;
        if (RX.eaNopar.test(t)) q[9] = 1;
        ea.push(q); continue;
      }
      m = RX.everyCrit.exec(e);
      if (m) {
        const q = mod(); q[0] = parseInt(m[1], 10); q[8] = { double: 2, triple: 3, quadruple: 4 }[m[2].toLowerCase()];
        q[7] = m[3] ? 1 : 0; q[9] = RX.nopar.test(e) ? 1 : 0; ec.push(q); continue;
      }
      // ---- on crit
      if (RX.onCrit.test(e)) {
        k = RX.ocBonus.exec(e); if (k) fx.CRIT_BONUS += parseFloat(k[1] || k[2]);
        const q = mod(); let use = false;
        k = RX.nextCrit.exec(e); if (k) { q[5] = parseFloat(k[1]) / 100; use = true; }
        if (RX.nextIgnDef.test(e)) { q[7] = 1; use = true; }
        if (use) oc.push(q);
        k = RX.ocDebuff.exec(e);
        if (k) { fx.DEBUFF_AMT += parseFloat(k[1]); fx.DEBUFF_TURNS = Math.max(fx.DEBUFF_TURNS, 2 * parseInt(k[2], 10)); }
        k = RX.regen.exec(e); if (k) fx.CRIT_HEAL += parseFloat(k[1]);
        k = RX.absorbAsHp.exec(e); if (k) fx.CRIT_LS += parseFloat(k[1]) / 100;
        if (RX.halved.test(e)) fx.CRIT_HALVE = 1;
        continue;
      }
      // ---- on parry
      if (RX.onParry.test(e)) {
        const q = mod(); let use = false;
        k = RX.opNextN.exec(e);
        if (k) { q[1] = parseInt(k[1], 10); q[2] = parseFloat(k[2]) / 100; q[4] = parseFloat(k[3] || 0) / 100; use = true; }
        k = RX.opIgnPar.exec(e);
        if (k) { q[1] = parseInt(k[1], 10); q[9] = 1; q[2] = parseFloat(k[2] || 0) / 100; use = true; }
        k = RX.opNextPct.exec(e); if (k) { q[2] = parseFloat(k[1]) / 100; use = true; }
        k = RX.nextCrit.exec(e); if (k) { q[5] = parseFloat(k[1]) / 100; use = true; }
        k = RX.opCritBonus.exec(e); if (k) { q[6] = parseFloat(k[1] || k[2]) / 100; use = true; }
        k = RX.opFlat.exec(e); if (k) { q[3] = parseFloat(k[1] || k[2]); use = true; }
        if (use) op.push(q);
        k = RX.opHeal.exec(e); if (k) fx.PARRY_HEAL += parseFloat(k[1]);
        k = RX.counter.exec(e); if (k) fx.PARRY_COUNTER += parseFloat(k[1]);
        k = RX.defRest.exec(e);
        if (k) fx.PARRY_DEF_REST += parseFloat(k[1]);
        else { k = RX.defSec.exec(e); if (k) { fx.PTD_AMT += parseFloat(k[1]); fx.PTD_SEC = Math.max(fx.PTD_SEC, parseFloat(k[2])); } }
        continue;
      }
      // ---- hits taken
      if (RX.firstHit.test(e) || RX.firstHitRed.test(e)) {
        k = RX.fhAbsorb.exec(e) || RX.fhReduced.exec(e);
        if (k) fx.FH_ABSORB = Math.min(1, fx.FH_ABSORB + parseFloat(k[1]) / 100);
        k = RX.fhCounter.exec(e); if (k) fx.FH_COUNTER += parseFloat(k[1]);
        k = RX.regen.exec(e); if (k) fx.FH_HEAL += parseFloat(k[1]);
        k = RX.fhAtk.exec(e); if (k) fx.FH_ATKPCT += parseFloat(k[1]) / 100;
        continue;
      }
      m = RX.firstN.exec(e);
      if (m) { fx.FIRSTN_ABSORB += parseInt(m[1], 10); continue; }
      m = RX.hitN.exec(e);
      if (m) {
        hitn.push([parseInt(m[1], 10), m[2] ? 0.5 : 1.0]);
        k = RX.regen.exec(e); if (k) fx.HITN_HEAL += parseFloat(k[1]);
        continue;
      }
      if (RX.onKill.test(e)) {
        k = RX.killHeal.exec(e); if (k) fx.KILL_HEAL += parseFloat(k[1]) / 100;
        k = RX.killDmg.exec(e);
        if (k) { fx.KILL_DMG += parseFloat(k[1]) / 100; k = RX.killMax.exec(e); if (k) fx.KILL_MAX = Math.max(fx.KILL_MAX, parseFloat(k[1])); }
        continue;
      }
      m = RX.firstAtk.exec(e);
      if (m) {
        k = RX.faPct.exec(e); const q = mod(); q[1] = parseInt(m[1] || 1, 10); q[2] = k ? parseFloat(k[1]) / 100 : 0;
        q[5] = RX.gcrit.test(e) ? 1.0 : 0; fa.push(q); continue;
      }
      m = RX.below.exec(e);
      if (m) { low.push(below(parseFloat(m[1]), m[2], fx)); continue; }
      if (!hit && !RX.ignored.test(e)) unparsed.push(e);
    }
  });
  hitn.sort((a, b) => a[0] - b[0] || a[1] - b[1]); hitn = hitn.slice(0, 2);
  hitn.forEach((h, n) => { fx['HITN' + (n + 1) + '_N'] = h[0]; fx['HITN' + (n + 1) + '_KIND'] = h[1]; });
  fx.PARRY_IGN = Math.min(1, fx.PARRY_IGN); fx.ECC = Math.max(0, 1 - eccRed); fx.ECM = Math.max(0, 1 - ecmRed);
  return { s, pct, fx, ea, ec, oc, op, fa, low, tb, cond, conv, allper, welems: weapons.map(w => w.category), unparsed };
}

/* Non-combat bonuses of a set: item chance, rarity upgrade, stamina cost multiplier, rest regen multiplier, Bloodmark bonus. */
function bonuses(items) {
  let ib = 0, rb = 0, c = 0, rr = 0, bm = 0;
  for (const it of items) if (it) for (const e of it.effects) {
    let m = RX.itemChance.exec(e); if (m) ib += parseInt(m[1], 10);
    m = RX.rarityUp.exec(e); if (m) rb += parseInt(m[1], 10);
    m = RX.stamCost.exec(e); if (m) c += parseInt(m[1], 10);
    m = RX.stamRest.exec(e); if (m) rr += parseInt(m[1], 10);
    m = RX.bloodmarks.exec(e); if (m) bm += parseInt(m[1], 10);
  }
  return { ib: Math.min(ib / 100, 0.28), rb: Math.min(rb / 100, 0.24), cm: Math.min(1, Math.max(0.1, 1 - c / 100)), rm: Math.max(1, 1 + rr / 100),
           bm: Math.min(bm / 100, 0.5), ibRaw: ib / 100, rbRaw: rb / 100, bmRaw: bm / 100 };
}

/* Final stat sheet (StatsCalculator.GetTotalStats order). K: array of perk ids, pots: array of potion names. */
function totals(g, alloc, K, pots) {
  const has = k => K.indexOf(k) >= 0, P = n => pots && pots.indexOf(n) >= 0;
  const s = g.s, pct = g.pct;
  let hp = BASE.hp + s.hp + alloc[0] * HP_PT, atk = BASE.atk + s.atk + alloc[1] * ATK_PT, dfn = BASE.dfn + s.dfn + alloc[2] * DEF_PT;
  let crit = BASE.crit + s.crit + alloc[3] * CRIT_PT, par = BASE.parry + s.par + alloc[4] * PARRY_PT;
  atk += g.conv * hp;
  const v = g.allper; hp += v; atk += v; dfn += v; crit += v; par += v;
  hp *= 1 + pct.hp; atk *= 1 + pct.atk; dfn *= 1 + pct.dfn; crit *= 1 + pct.crit; par *= 1 + pct.par;
  if (has(4)) atk += 0.2 * dfn;
  if (has(15)) atk += 6;
  if (has(2)) par = Math.max(15, par);
  const ap = (has(10) ? -0.12 : 0) + (has(9) ? 0.4 : 0);
  const dp = (has(10) ? 0.35 : 0) + (has(30) ? 0.005 * Math.min(55, par) : 0);
  const hpp = (has(10) ? 0.15 : 0) - (has(9) ? 0.15 : 0);
  atk *= 1 + ap; dfn *= 1 + dp; hp *= 1 + hpp;
  if (has(27)) crit += 15;
  const st = { hp: pyRound(hp), atk, dfn, crit, par: Math.min(PARRY_CAP, par), cap: has(27) ? 75 : CRIT_CAP };
  // potions (assumed to add to the perk percentage sums; see notes "Arena push past wave 55")
  if (P('Rampart')) { const d2 = (has(10) ? 0.35 : 0) + (has(30) ? 0.005 * Math.min(55, st.par) : 0); st.dfn *= (1 + d2 + 0.30) / (1 + d2); }
  if (P('Vigor')) st.hp = pyRound(st.hp * (1 + hpp + 0.20) / (1 + hpp));
  if (P('Fury')) st.atk *= (1 + ap + 0.25) / (1 + ap);
  if (P('Feline')) st.par = Math.min(55, st.par + 16);
  if (P('Savagery')) st.crit += 20;
  return st;
}

/* ------------------------------------------------------------------ arena enemy rows */
const xpWin = (xpBase, plvl, elvl) => Math.trunc(Math.max(0, 1 - 0.12 * Math.max(0, plvl - Math.max(elvl, INTENDED6) - 3)) * xpBase);
function elemMult(welems, resist, weak) {
  let nw = 0, nr = 0;
  for (const w of welems) { if (w && w === weak) nw++; if (w && resist.indexOf(w) >= 0) nr++; }
  return 1.0 + (nw >= 2 ? 0.40 : 0.15 * nw) - 0.15 * nr;
}
const ENW = 8;
function arenaRows(welems, plvl) {
  const aen = [];
  for (const sec of [4, 5, 6]) for (const c of DATA.sectors[sec]) {
    const em = elemMult(welems, c.resist, c.weak);
    for (const v of c.v.slice(1)) aen.push(v[2], v[3], v[4], v[5], v[6], xpWin(v[7], plvl, v[1]), pyRound(v[7] * 0.25), em);
  }
  return aen;
}

/* ------------------------------------------------------------------ RNG: xorshift64 on two uint32 halves */
let rh = 0, rl = 0;
function rnd() {
  let h = rh, l = rl;
  h ^= (h << 13) | (l >>> 19); l ^= l << 13;
  l ^= (l >>> 7) | (h << 25); h ^= h >>> 7;
  h ^= (h << 17) | (l >>> 15); l ^= l << 17;
  rh = h; rl = l;
  return ((h >>> 0) * 2097152 + (l >>> 11)) * 1.1102230246251565e-16;
}
function seedRng(seed) {
  let s = (BigInt(seed) * 0x9E3779B97F4A7C15n + 0x1234567n) & 0xFFFFFFFFFFFFFFFFn; if (s === 0n) s = 1n;
  rh = Number(s >> 32n) | 0; rl = Number(s & 0xFFFFFFFFn) | 0;
  for (let i = 0; i < 8; i++) rnd();
}

/* ------------------------------------------------------------------ one fight (fastsim2p.c fight) */
const MODW = 11, LOWW = 19, TBW = 4, CDW = 3, MAXLOW = 16, MAXTB = 16, MAXPEND = 64, HEAL_CAP = 0.06, ABSORB_CAP = 0.75, LS_CAP = 0.15;
const P_WRATH = 1, P_FURY = 2, P_VOW = 4, P_LAST = 8, P_PIERCE = 16, P_VENOM = 32;
const L = { atkPct: 0, defPct: 0, crit: 0, ls: 0, absorb: 0, atkFlat: 0, all: 0, dmgPerAtk: 0, regenPerAtk: 0, regenPerCrit: 0, atkLs: 0, permDef: 0, immuneCrit: 0, gcrit: 0 };
function lowagg(low, nlow, r) {
  L.atkPct = L.defPct = L.crit = L.ls = L.absorb = L.atkFlat = L.all = L.dmgPerAtk = L.regenPerAtk = L.regenPerCrit = L.atkLs = L.permDef = 0;
  L.immuneCrit = 0; L.gcrit = 0;
  for (let i = 0; i < nlow; i++) {
    const o = i * LOWW;
    if (r < low[o]) {
      L.atkPct += low[o + 1]; L.defPct += low[o + 2]; L.crit += low[o + 3]; L.ls += low[o + 5]; L.absorb += low[o + 6]; L.atkFlat += low[o + 7];
      L.all += low[o + 8]; L.dmgPerAtk += low[o + 9]; L.regenPerAtk += low[o + 10]; L.regenPerCrit += low[o + 11]; L.atkLs += low[o + 12];
      if (low[o + 13] > 0) L.immuneCrit = 1; L.permDef += low[o + 14]; if (low[o + 15] > 0) L.gcrit = 1;
    }
  }
  if (L.absorb > ABSORB_CAP) L.absorb = ABSORB_CAP;
}
const pend = new Float64Array(MAXPEND * 10);       // rem pct flat ign ocrit cbon full mult nopar heal
const nextA = new Float64Array(16), nextC = new Float64Array(16), tbNext = new Float64Array(MAXTB), tbStack = new Int32Array(MAXTB);
const regStart = new Float64Array(MAXLOW), regOnce = new Int32Array(MAXLOW), ptdExp = new Float64Array(48), debExp = new Float64Array(32);
const F = { php: 0, turns: 0, kst: 0 };            // fight in/out
const ST = { dealt: 0, taken: 0, healed: 0, attacks: 0, crits: 0, pswings: 0, eswings: 0, pparry: 0, lastBreath: 0, immo: 0 };
let gImmo = 0, gPtm = 1, gPreg = 0, gEhpm = 1;

function pushMod(mods, o, npend) {
  if (npend < MAXPEND) {
    const b = npend++ * 10; pend[b] = mods[o + 1] < 1 ? 1 : mods[o + 1]; pend[b + 1] = mods[o + 2]; pend[b + 2] = mods[o + 3]; pend[b + 3] = mods[o + 4];
    pend[b + 4] = mods[o + 5]; pend[b + 5] = mods[o + 6]; pend[b + 6] = mods[o + 7]; pend[b + 7] = mods[o + 8]; pend[b + 8] = mods[o + 9]; pend[b + 9] = mods[o + 10];
  }
  return npend;
}
function fight(p, mods, low, tb, cond, e) {
  const cPERKS = p[I.PERKS], cNLOW = p[I.NLOW], cNTB = p[I.NTB], cNCOND = p[I.NCOND], cNEA = p[I.NEA], cNEC = p[I.NEC], cNOC = p[I.NOC], cNOP = p[I.NOP], cNFA = p[I.NFA], cDMULT = p[I.DMULT], cTMULT = p[I.TMULT], cNOHEAL = p[I.NOHEAL], cCAP = p[I.CAP], cOVERHEAL = p[I.OVERHEAL], cANGEL = p[I.ANGEL], cFIRSTN_ABSORB = p[I.FIRSTN_ABSORB], cLUNGE = p[I.LUNGE], cECHO = p[I.ECHO], cPARRY_IGN = p[I.PARRY_IGN], cFH_ATKPCT = p[I.FH_ATKPCT], cFURYM = p[I.FURYM], cMOMENTUM = p[I.MOMENTUM], cFIRST_CRIT = p[I.FIRST_CRIT], cNOCRIT = p[I.NOCRIT], cRIPOSTE = p[I.RIPOSTE], cKILL_DMG = p[I.KILL_DMG], cKILL_MAX = p[I.KILL_MAX], cDEBUFF_AMT = p[I.DEBUFF_AMT], cDEF_IGN = p[I.DEF_IGN], cFLAT = p[I.FLAT], cCHUNT = p[I.CHUNT], cCRIT_BONUS = p[I.CRIT_BONUS], cPLS = p[I.PLS], cBCURSE = p[I.BCURSE], cLIFESTEAL = p[I.LIFESTEAL], cCRIT_LS = p[I.CRIT_LS], cCRIT_HEAL = p[I.CRIT_HEAL], cDEBUFF_TURNS = p[I.DEBUFF_TURNS], cCRIT_HALVE = p[I.CRIT_HALVE], cPOISON_TOTAL = p[I.POISON_TOTAL], cPOISON_TURNS = p[I.POISON_TURNS], cCOUP = p[I.COUP], cKILL_HEAL = p[I.KILL_HEAL], cPARRY_HEAL = p[I.PARRY_HEAL], cPARRY_REFL = p[I.PARRY_REFL], cPARRY_COUNTER = p[I.PARRY_COUNTER], cPARRY_DEF_REST = p[I.PARRY_DEF_REST], cPTD_AMT = p[I.PTD_AMT], cPTD_SEC = p[I.PTD_SEC], cECC = p[I.ECC], cECM = p[I.ECM], cIMM_SEC = p[I.IMM_SEC], cIMM_THR = p[I.IMM_THR], cFH_ABSORB = p[I.FH_ABSORB], cFH_COUNTER = p[I.FH_COUNTER], cFH_HEAL = p[I.FH_HEAL], cHITN1_N = p[I.HITN1_N], cHITN1_KIND = p[I.HITN1_KIND], cHITN_HEAL = p[I.HITN_HEAL], cHITN2_N = p[I.HITN2_N], cHITN2_KIND = p[I.HITN2_KIND], cBULWARK = p[I.BULWARK], cREFLECT = p[I.REFLECT], cPREFLECT = p[I.PREFLECT], cREFL_HEAL = p[I.REFL_HEAL], cATK = p[I.ATK], cDFN = p[I.DFN], cCRIT = p[I.CRIT], cPAR = p[I.PAR];
  const maxhp = p[0]; let php = F.php; const ehp0 = e[0]; let ehp = ehp0; const eatk = e[1];
  const perks = cPERKS | 0, nlow = cNLOW | 0, ntb = cNTB | 0, ncond = cNCOND | 0;
  const nea = cNEA | 0, nec = cNEC | 0, noc = cNOC | 0, nop = cNOP | 0, nfa = cNFA | 0;
  const mea = 0, mec = mea + nea * MODW, moc = mec + nec * MODW, mop = moc + noc * MODW, mfa = mop + nop * MODW;
  const pierce = perks & P_PIERCE, fury = perks & P_FURY, hasWrath = perks & P_WRATH; let last = perks & P_LAST;
  const cv = (perks & P_VOW) ? 3 : 0;
  const dmult = cDMULT > 0 ? cDMULT : 1, tmult = (cTMULT > 0 ? cTMULT : 1) * gPtm;
  const noheal = cNOHEAL > 0, cap = cCAP, healcap = cround(HEAL_CAP * maxhp);
  const overheal = cOVERHEAL > 0;
  let npend = 0;
  for (let i = 0; i < nea && i < 16; i++) nextA[i] = Math.trunc(mods[mea + i * MODW]);
  for (let i = 0; i < nec && i < 16; i++) nextC[i] = Math.trunc(mods[mec + i * MODW]);
  for (let i = 0; i < ntb && i < MAXTB; i++) { tbNext[i] = tb[i * TBW]; tbStack[i] = 0; }
  for (let i = 0; i < MAXLOW; i++) { regStart[i] = -1; regOnce[i] = 0; }
  let tAtk = 0, tDef = 0, tCrit = 0, tPar = 0, permDef = 0, pdef = 0, wrath = 0, elapsed = 0, poison = 0;
  let shield = (cANGEL > 0 && php < 0.5 * maxhp) ? Math.floor(cANGEL * maxhp) : 0;
  let nptd = 0, ndeb = 0;
  let fhDone = 0, fhAtk = 0, firstN = cFIRSTN_ABSORB | 0, hc1 = 0, hc2 = 0, halvePend = 0, immArmed = 0, mom = 0, rip = 0, pt = 0;
  let healed = 0, immUntil = 0, turns = 0, attacks = 0, crits = 0, swings = 0;
  for (;;) {
    /* ------------------------------------------------ player swing */
    turns++; swings++;
    lowagg(low, nlow, php / maxhp);
    if (L.permDef > permDef) permDef = L.permDef;
    let heal = L.regenPerAtk, dealt = 0;
    const lunge = cLUNGE > 0 && swings % 3 === 0, echo = cECHO > 0 && swings % 5 === 0;
    let epar = (e[4] > 55 ? 55 : e[4]) / 100.0 * (pierce ? 0.65 : 1.0) * (1 - cPARRY_IGN);
    {
      let un = 0;
      for (let i = 0; i < npend; i++) if (pend[i * 10 + 8] > 0) un = 1;
      for (let i = 0; i < nea && i < 16; i++) if (mods[mea + i * MODW + 9] > 0 && nextA[i] <= attacks + 1) un = 1;
      if (un) epar = 0;
    }
    if (lunge || echo || rnd() >= epar) {
      attacks++;
      if (attacks === 1) for (let i = 0; i < nfa; i++) npend = pushMod(mods, mfa + i * MODW, npend);
      for (let i = 0; i < nea && i < 16; i++) if (attacks >= nextA[i]) { npend = pushMod(mods, mea + i * MODW, npend); nextA[i] += Math.trunc(mods[mea + i * MODW]); heal += mods[mea + i * MODW + 10]; }
      let aPct = 0, aFlat = 0, aIgn = 0, aOcrit = 0, aCbon = 0, aFull = 0, aMult = 0;
      for (let i = 0; i < npend; i++) {
        const b = i * 10; aPct += pend[b + 1]; aFlat += pend[b + 2]; if (pend[b + 3] > aIgn) aIgn = pend[b + 3];
        if (pend[b + 4] > aOcrit) aOcrit = pend[b + 4]; aCbon += pend[b + 5]; if (pend[b + 6] > 0) aFull = 1; if (pend[b + 7] > aMult) aMult = pend[b + 7];
      }
      let atk = (1 + L.atkPct) * cATK + tAtk + L.atkFlat + L.all;
      if (fhAtk) atk *= 1 + cFH_ATKPCT;
      if (fury && php < 0.4 * maxhp) atk *= cFURYM > 0 ? cFURYM : 1.8;
      let d = atk * (0.8 + 0.4 * rnd()) * dmult;
      if (cMOMENTUM > 0) { d *= 1 + cMOMENTUM * mom; if (mom < 10) mom++; }
      let cc = cCRIT + L.crit; if (cc > cap) cc = cap; cc += tCrit; if (cc > cap) cc = cap; cc += L.all; if (cc > cap) cc = cap;
      const ch = aOcrit > 0 ? aOcrit : (aCbon * 100 + cc + wrath) / 100.0;
      let c = rnd() < ch;
      if (cFIRST_CRIT > 0 && attacks === 1) c = true;
      if (L.gcrit) c = true;
      if (cNOCRIT > 0) c = false;
      if (hasWrath) { if (c) wrath = 0; else { wrath += 10; if (wrath > 50) wrath = 50; } }
      if (c) d *= 2;
      if (aMult > 0) d *= aMult;
      if (aPct > 0) d *= 1 + aPct;
      if (lunge) d *= 1 + cLUNGE;
      if (echo) d *= 1 + cECHO;
      if (rip > 0) { d *= 1 + cRIPOSTE; rip--; }
      if (cKILL_DMG > 0 && F.kst > 0) { let st = F.kst; if (cKILL_MAX > 0 && st > cKILL_MAX) st = cKILL_MAX | 0; d *= 1 + st * cKILL_DMG; }
      {
        const r = ehp / ehp0;
        for (let i = 0; i < ncond; i++) { const o = i * CDW; if ((cond[o + 1] > 0 && cond[o] < r) || (cond[o + 1] <= 0 && r < cond[o])) d *= 1 + cond[o + 2]; }
      }
      d *= e[7];
      let ed = e[2];
      if (ndeb) { let k = 0; for (let i = 0; i < ndeb; i++) if (debExp[i] > turns) debExp[k++] = debExp[i]; ndeb = k; ed -= cDEBUFF_AMT * ndeb; if (ed < 0) ed = 0; }
      let ign = aIgn + cDEF_IGN + (pierce ? 0.35 : 0.0); if (ign > 0.5) ign = 0.5;
      if (aFull > 0) ed = 0; else ed *= 1 - ign;
      const flatd = aFlat + L.dmgPerAtk + cFLAT + cround(cCHUNT * ehp0);
      let dmg = cround((flatd + d) * 60.0 / (ed + 60.0)); if (dmg < 1) dmg = 1;
      if (c) dmg += cCRIT_BONUS;
      ehp -= dmg; dealt = dmg; ST.dealt += dmg; ST.attacks++;
      { let k = 0; for (let i = 0; i < npend; i++) { const b = i * 10; pend[b] -= 1; if (pend[b] >= 1) { if (k !== i) pend.copyWithin(k * 10, b, b + 10); k++; } } npend = k; }
      let ls = cPLS + cBCURSE + L.ls + cLIFESTEAL + L.atkLs + (c ? cCRIT_LS : 0); if (ls > LS_CAP) ls = LS_CAP;
      heal += cround(dmg * ls) + cv;
      if (c) {
        crits++; ST.crits++; heal += cCRIT_HEAL + L.regenPerCrit;
        for (let i = 0; i < noc; i++) npend = pushMod(mods, moc + i * MODW, npend);
        if (cDEBUFF_AMT > 0 && ndeb < 32) debExp[ndeb++] = turns + cDEBUFF_TURNS;
        for (let i = 0; i < nec && i < 16; i++) if (crits >= nextC[i]) { npend = pushMod(mods, mec + i * MODW, npend); nextC[i] += Math.trunc(mods[mec + i * MODW]); }
        if (cCRIT_HALVE > 0) halvePend++;
        if (perks & P_VENOM) { poison += 28; pt = 8; }
        if (cPOISON_TOTAL > 0) { if (cPOISON_TOTAL > poison) poison = cPOISON_TOTAL; if (cPOISON_TURNS > pt) pt = cPOISON_TURNS | 0; }
      }
      if (cCOUP > 0 && ehp > 0 && ehp < cCOUP * ehp0) ehp = 0;
    }
    for (let k = 0; k < 2; k++) if (pt && ehp > 0) { let t = Math.floor(poison / pt); if (t < 1) t = 1; ehp -= t; poison -= t; pt--; }
    if (gImmo > 0 && ehp > 0) { const b = cround(gImmo * ehp0); ehp -= b; ST.immo += b; }
    if (ehp <= 0) {
      if (cKILL_DMG > 0) F.kst++;
      if (cKILL_HEAL > 0) { const h = cround(maxhp * cKILL_HEAL); heal += h < 1 ? 1 : h; }
    }
    { let h_ = heal; if (!noheal && h_ > 0) { if (h_ > healcap) h_ = healcap; let n_ = php + h_; if (n_ > maxhp) { if (overheal) { shield += n_ - maxhp; if (shield > maxhp) shield = maxhp; } n_ = maxhp; } healed += n_ - php; php = n_; } }
    if (cBCURSE > 0 && dealt > 0) { php -= cround(0.11 * dealt); if (php < 1) php = 1; }
    if (ehp <= 0) { F.php = php; F.turns = turns; ST.healed += healed; ST.pswings += swings; ST.eswings += turns - swings; return 1; }
    elapsed += 0.5;
    /* ------------------------------------------------ enemy swing */
    turns++;
    lowagg(low, nlow, php / maxhp);
    if (L.permDef > permDef) permDef = L.permDef;
    heal = 0;
    {
      const r = php / maxhp;
      for (let i = 0; i < nlow && i < MAXLOW; i++) {
        const o = i * LOWW; if (low[o + 4] <= 0) continue;
        const restOn = low[o + 18] > 0 && regStart[i] >= 0;
        if (r < low[o] || restOn) {
          if (regStart[i] < 0) regStart[i] = elapsed;
          if (low[o + 17] > 0) { if (regOnce[i]) continue; regOnce[i] = 1; }
          else if (low[o + 16] > 0 && elapsed - regStart[i] >= low[o + 16]) continue;
          heal += low[o + 4];
        }
      }
    }
    let pp = cPAR > 55 ? 55 : cPAR; pp += tPar; if (pp > 55) pp = 55;
    if (rnd() < pp / 100.0) {
      ST.pparry++;
      heal += cPARRY_HEAL;
      ehp -= cround(eatk * cPARRY_REFL) + cPARRY_COUNTER;
      for (let i = 0; i < nop; i++) npend = pushMod(mods, mop + i * MODW, npend);
      pdef += cPARRY_DEF_REST; if (pdef > 40 * cPARRY_DEF_REST) pdef = 40 * cPARRY_DEF_REST;
      if (cPTD_AMT > 0 && nptd < 48) ptdExp[nptd++] = elapsed + cPTD_SEC;
      if (cRIPOSTE > 0) rip = 2;
    } else {
      const ecr = !L.immuneCrit && rnd() < e[3] / 100.0 * cECC;
      let d = eatk * (0.8 + 0.4 * rnd()) * (ecr ? 1 + cECM : 1.0);
      let df = ((1 + L.defPct) * cDFN + tDef) * (1 + permDef) + L.all + pdef;
      if (nptd) { let k = 0; for (let i = 0; i < nptd; i++) if (ptdExp[i] > elapsed) ptdExp[k++] = ptdExp[i]; nptd = k; df += cPTD_AMT * nptd; }
      d = cround(d * 60.0 / (df + 60.0) * tmult); if (d < 1) d = 1;
      if (cIMM_SEC > 0) {
        if (!immArmed && php / maxhp < cIMM_THR) { immArmed = 1; immUntil = elapsed + cIMM_SEC; }
        if (immArmed && elapsed < immUntil) d = 0;
      }
      if (d > 0 && halvePend > 0) { halvePend--; d = Math.floor(d / 2); if (d < 1) d = 1; }
      if (L.absorb > 0) d = cround((1 - L.absorb) * d);
      if (!fhDone && (cFH_ABSORB > 0 || cFH_COUNTER > 0 || cFH_HEAL > 0 || cFH_ATKPCT > 0)) {
        fhDone = 1; if (cFH_ABSORB > 0) d = cround(d * (1 - cFH_ABSORB));
        ehp -= cFH_COUNTER; heal += cFH_HEAL; if (cFH_ATKPCT > 0) fhAtk = 1;
      }
      {
        let kind = 0;
        if (cHITN1_N > 0) { if (++hc1 >= cHITN1_N) { hc1 = 0; if (cHITN1_KIND > kind) kind = cHITN1_KIND; heal += cHITN_HEAL; } }
        if (cHITN2_N > 0) { if (++hc2 >= cHITN2_N) { hc2 = 0; if (cHITN2_KIND > kind) kind = cHITN2_KIND; heal += cHITN_HEAL; } }
        if (kind >= 1) d = 0; else { if (kind > 0) d = Math.floor(d / 2); if (d > 0 && firstN > 0) { firstN--; d = 0; } }
      }
      if (cBULWARK > 0 && php < 0.25 * maxhp) d = cround(d * (1 - cBULWARK));
      if (shield > 0 && d > 0) { const ab = shield < d ? shield : d; shield -= ab; d -= ab; }
      if (d > 0) {
        const rf = cREFLECT + cPREFLECT; if (rf > 0) ehp -= cround(rf * d);
        if (cREFL_HEAL > 0) heal += cround(d * cREFL_HEAL);
        php -= d; ST.taken += d;
      }
      if (php <= 0 && last) { php = Math.ceil(0.25 * maxhp); last = 0; ST.lastBreath++; }
    }
    if (php <= 0) { F.php = 0; F.turns = turns; ST.healed += healed; ST.pswings += swings; ST.eswings += turns - swings; return 0; }
    if (gImmo > 0) { const b = cround(gImmo * ehp0); ehp -= b; ST.immo += b; }
    { let h_ = heal; if (!noheal && h_ > 0) { if (h_ > healcap) h_ = healcap; let n_ = php + h_; if (n_ > maxhp) { if (overheal) { shield += n_ - maxhp; if (shield > maxhp) shield = maxhp; } n_ = maxhp; } healed += n_ - php; php = n_; } }
    if (ehp <= 0) {
      if (cKILL_DMG > 0) F.kst++;
      if (cKILL_HEAL > 0) { const h = cround(maxhp * cKILL_HEAL); { let h_ = h < 1 ? 1 : h; if (!noheal && h_ > 0) { if (h_ > healcap) h_ = healcap; let n_ = php + h_; if (n_ > maxhp) { if (overheal) { shield += n_ - maxhp; if (shield > maxhp) shield = maxhp; } n_ = maxhp; } healed += n_ - php; php = n_; } } }
      F.php = php; F.turns = turns; ST.healed += healed; ST.pswings += swings; ST.eswings += turns - swings; return 1;
    }
    elapsed += 0.5;
    for (let i = 0; i < ntb && i < MAXTB; i++) {
      const o = i * TBW;
      if (tbNext[i] <= elapsed + 1e-4) {
        tbNext[i] += tb[o];
        const st = tb[o + 2] | 0;
        if (st === 5) { { let h_ = tb[o + 1]; if (!noheal && h_ > 0) { if (h_ > healcap) h_ = healcap; let n_ = php + h_; if (n_ > maxhp) { if (overheal) { shield += n_ - maxhp; if (shield > maxhp) shield = maxhp; } n_ = maxhp; } healed += n_ - php; php = n_; } } continue; }
        if (tb[o + 3] > 0 && tbStack[i] >= tb[o + 3]) continue;
        tbStack[i]++;
        if (st === 0) tAtk += tb[o + 1]; else if (st === 1) tDef += tb[o + 1]; else if (st === 2) tCrit += tb[o + 1]; else if (st === 3) tPar += tb[o + 1];
        else if (st === 4) { tAtk += tb[o + 1]; tDef += tb[o + 1]; tCrit += tb[o + 1]; tPar += tb[o + 1]; }
      }
    }
    if (cBULWARK > 0 && !noheal && php < 0.25 * maxhp) { php += 4; if (php > maxhp) php = maxhp; }
    if (turns > 400000) { F.php = 0; F.turns = turns; ST.healed += healed; ST.pswings += swings; ST.eswings += turns - swings; return 0; }
  }
}

const BOSS_DEF = [71.3, 47.8, 95.0, 130.25], BOSS_CRIT = [6.7, 41.3, 19.5, 44.6], BOSS_PAR = [16.2, 9.8, 16.2, 25.1], BOSS_ATK = [58.94, 126.9, 230.51];
const BLU = [0.70, 0.55, 0.35, 0.20];
const MAXW = 400;
const waveScale = wave => { const w = wave + 5; return { hs: 0.0022 * w * w + 0.1 * w + 1.5, as: 0.001 * w * w + 0.06 * w + 1.7 }; };

/* Eternal Arena loop (fastsim2p.c sim_arena2). Extra bookkeeping (time / deaths / first reach per wave) does not touch the RNG. */
function simArena(p, mods, low, tb, cond, aen, budgetSec, seed, startWave, bossmask, target, stop) {
  seedRng(seed);
  let t = 0, xp = 0, php = p[0], fights = 0, deaths = 0;
  let wave = startWave < 1 ? 1 : startWave, kills = 0, maxw = wave; F.kst = 0;
  const band = [0, 0, 0, 0]; let treach = -1, rec16 = 0, rec40 = 0, wt = 0, swingsTotal = 0;
  const timeAt = new Float64Array(MAXW), deathsAt = new Float64Array(MAXW), firstReach = new Float64Array(MAXW).fill(-1);
  const recAt = new Float64Array(MAXW);
  for (const k in ST) ST[k] = 0;
  const e = new Float64Array(ENW);
  firstReach[Math.min(wave, MAXW - 1)] = 0;
  while (t < budgetSec) {
    const f = 4 + 2 * Math.min(1.0, Math.max(0.0, (wave - 1) / 49.0));
    let sec = Math.floor(f); if (rnd() < f - sec) sec++; if (sec > 6) sec = 6; if (sec < 4) sec = 4;
    let cat = Math.trunc(rnd() * 5); if (cat > 4) cat = 4;
    let lb = Math.trunc((wave - 1) / 10); if (lb > 3) lb = 3;
    const col = rnd() < BLU[lb] ? 0 : 1;
    const v = (((sec - 4) * 5 + cat) * 2 + col) * ENW;
    const w = wave + 5, hs = 0.0022 * w * w + 0.1 * w + 1.5, as = 0.001 * w * w + 0.06 * w + 1.7;
    const w10 = Math.trunc(wave / 10);
    let boss = 0;
    if (kills >= 10 && wave % 10 === 0 && w10 <= 4 && !(bossmask & (1 << (w10 - 1)))) boss = 1;
    e[0] = cround(aen[v] * hs); e[1] = aen[v + 1] * as; e[2] = aen[v + 2]; e[3] = aen[v + 3]; e[4] = aen[v + 4]; e[5] = aen[v + 5]; e[6] = aen[v + 6]; e[7] = aen[v + 7];
    if (boss) {
      const bi = w10 - 1; let bs = Math.floor(f + 0.5); if (bs > 6) bs = 6; if (bs < 4) bs = 4;
      let bv = ((bs - 4) * 5 * 2 + 1) * ENW;
      for (let c = 1; c < 5; c++) { const q = (((bs - 4) * 5 + c) * 2 + 1) * ENW; if (aen[q] > aen[bv]) bv = q; }
      e[0] = cround(aen[bv] * hs * 1.6); e[1] = BOSS_ATK[bs - 4] * as * 1.63; e[2] = BOSS_DEF[bi]; e[3] = BOSS_CRIT[bi];
      e[4] = BOSS_PAR[bi]; e[5] = aen[bv + 5] * 1.6; e[6] = aen[bv + 6] * 1.6; e[7] = aen[bv + 7];
    }
    e[0] = cround(e[0] * gEhpm); F.php = php;
    const won = fight(p, mods, low, tb, cond, e); php = F.php; swingsTotal += F.turns;
    const dt = F.turns * p[I.TURN_SEC] + p[I.PAUSE_SEC]; t += dt; wt += dt * wave; fights++;
    const wi = wave < MAXW ? wave : MAXW - 1; timeAt[wi] += dt;
    if (!won) {
      xp += e[6]; deaths++; deathsAt[wi]++; php = p[0]; F.kst = 0;
      let back = Math.trunc(wave / 5) * 5; if (back === wave) back -= 5; if (back < 1) back = 1;
      wave = back; kills = 0; continue;
    }
    {
      const rg = cround((wave <= 10 ? 0.04 : 0.06) * p[0]); let fr = p[I.FIGHT_REGEN]; const c6 = cround(0.06 * p[0]); if (fr > c6) fr = c6;
      xp += e[5]; php += rg + fr + cround(gPreg * p[0]); if (php > p[0]) php = p[0];
    }
    band[lb]++;
    let done = 0; const w0 = wave;
    if (boss) { bossmask |= 1 << (w10 - 1); wave++; kills = 0; done = 1; }
    else { kills++; if (kills >= 10 && !(wave % 10 === 0 && w10 <= 4 && !(bossmask & (1 << (w10 - 1))))) { wave++; kills = 0; done = 1; } }
    if (done && w0 < maxw) { if (w0 >= 16) rec16++; if (w0 >= 40) rec40++; recAt[w0 < MAXW ? w0 : MAXW - 1]++; }
    if (wave > maxw) { maxw = wave; if (wave < MAXW) firstReach[wave] = t; }
    if (target > 0 && treach < 0 && wave > target) { treach = t; if (stop) break; }
  }
  return { t, xp, fights, deaths, maxwave: maxw, wave, treach, bossmask, band, rec16, rec40, meanwave: wt / (t > 0 ? t : 1), swings: swingsTotal,
           timeAt, deathsAt, firstReach, recAt, stats: Object.assign({}, ST) };
}

/* ------------------------------------------------------------------ build -> simulation */
const _G = new Map();
function gearOf(names) {
  const key = names.join('|'); let g = _G.get(key);
  if (!g) { if (_G.size > 4000) _G.clear(); g = gear(names.map(n => n ? BYNAME[n] : null)); g.aen = {}; _G.set(key, g); }
  return g;
}
/* build: { names[7], perks[], alloc[5], pots[] }; o: { plvl, budgetH, seed, startWave, bossmask, target, stop } */
function simulate(build, o) {
  const names = build.names, K = (build.perks || []).filter(k => PERKS[k]), pots = build.pots || [];
  const g = gearOf(names), st = totals(g, build.alloc, K, pots), plvl = o.plvl || 60;
  const p = new Float64Array(IDX.length);
  for (const k in g.fx) p[I[k]] = g.fx[k];
  p[I.HP] = st.hp; p[I.ATK] = st.atk; p[I.DFN] = st.dfn; p[I.CRIT] = st.crit; p[I.PAR] = st.par;
  p[I.CAP] = K.indexOf(27) >= 0 ? 75 : CRIT_CAP;
  for (const k of ['ea', 'ec', 'oc', 'op', 'fa', 'low', 'tb', 'cond']) p[I['N' + k.toUpperCase()]] = g[k].length;
  let bits = 0;
  for (const k of K) {
    bits |= PERKS[k].bit || 0; const x = PERKS[k].x;
    if (x) for (const n in x) p[I[n]] = ((n === 'DMULT' || n === 'TMULT') && p[I[n]]) ? p[I[n]] * x[n] : x[n];
  }
  p[I.PERKS] = bits;
  if (pots.indexOf('Bloodthirst') >= 0) p[I.PLS] += 0.05;
  p[I.TURN_SEC] = TURN_SEC; p[I.PAUSE_SEC] = PAUSE_SEC;
  gImmo = pots.indexOf('Immolation') >= 0 ? 0.005 : 0; gPtm = pots.indexOf('Bastion') >= 0 ? 0.8 : 1;
  gPreg = pots.indexOf('Regeneration') >= 0 ? 0.18 : 0; gEhpm = pots.indexOf('Attrition') >= 0 ? 0.85 : 1;
  const mods = [];
  for (const k of ['ea', 'ec', 'oc', 'op', 'fa']) for (const q of g[k]) for (const x of q) mods.push(x);
  const fl = a => { const out = []; for (const r of a) for (const x of r) out.push(x); return Float64Array.from(out); };
  if (!g.aen[plvl]) g.aen[plvl] = Float64Array.from(arenaRows(g.welems, plvl));
  const r = simArena(p, Float64Array.from(mods), fl(g.low), fl(g.tb), fl(g.cond), g.aen[plvl], (o.budgetH || 50) * 3600, o.seed || 1,
                     o.startWave || 1, o.bossmask || 0, o.target || 0, o.stop || 0);
  r.st = st; r.startWave = o.startWave || 1; r.xph = r.xp / r.t * 3600; r.deaths_h = r.deaths / r.t * 3600; r.fights_h = r.fights / r.t * 3600;
  r.unparsed = g.unparsed;
  return loot(r, build, o);
}

/* ------------------------------------------------------------------ loot, stamina, Bloodmarks (lb2.loot + notes) */
const ROWS = [[16, 28, 48, 8, 0], [14, 22, 48, 14, 2], [12, 21, 46, 17, 4], [10, 19, 45, 20, 6]];
const FORGE_W = [1 / 112500, 1 / 7500, 1 / 500, 1 / 25, 1.0];      // mythic-equivalents through the forge (15/15/20/25)
const DISMANTLE = [1, 3, 6, 12, 20];
function loot(r, build, o) {
  const pots = build.pots || [], b = bonuses(build.names.map(n => n ? BYNAME[n] : null));
  const potDrop = (pots.indexOf("Seeker's Luck") >= 0 ? 0.08 : 0) + (pots.indexOf('Heavy Haul') >= 0 ? 0.10 : 0);
  const eye = pots.indexOf("Collector's Eye") >= 0 ? 0.25 : 0, rbEff = 1 - (1 - b.rb) * (1 - eye);
  const c = 0.8 * b.cm, n = Math.trunc(99 / c) + 1;
  const tf = n / (r.fights_h / 3600), tr = n * c / (0.2777778 * b.rm);
  const up = pots.indexOf('Tireless') >= 0 ? 1 : tf / (tf + tr);
  const pace = o.pace || 1;
  const real = r.t / 3600 / 1.25 / up * pace;
  let me = 0, my = 0, le = 0, dr = 0, bmd = 0; const byR = [0, 0, 0, 0, 0];
  for (let bnd = 0; bnd < 4; bnd++) {
    const wins = r.band[bnd];
    const pr = Math.min(1, 0.75 * (BLU[bnd] * 0.12 + (1 - BLU[bnd]) * 0.20) + b.ib + potDrop), rate = pr / (1 - Math.pow(1 - pr, 9));
    const row = ROWS[bnd].map(x => x / 100); let cap = 0; row.forEach((x, i) => { if (x > 0) cap = i; });
    const d = row.slice();
    for (let i = 0; i < cap; i++) { d[i] -= row[i] * rbEff; d[i + 1] += row[i] * rbEff; }
    const nd = wins * rate / real; dr += nd;
    for (let i = 0; i < 5; i++) { me += nd * d[i] * FORGE_W[i]; bmd += nd * d[i] * DISMANTLE[i]; byR[i] += nd * d[i]; }
    my += nd * d[4]; le += nd * d[3];
  }
  const asc = ((r.rec16 - r.rec40) * 0.004 + r.rec40 * 0.01) / real;
  // Bloodmarks from automatic PvP: one fight per 7 real minutes of fighting (3.5 with relief), 13 on a win / 6 on a loss
  const pvpEvery = o.pvpEveryMin || 7, pvpWin = o.pvpWin === undefined ? 0.5 : o.pvpWin;
  const bmPvp = 60 / pvpEvery * up / pace * (13 * pvpWin + 6 * (1 - pvpWin)) * (1 + b.bm);
  const xpMul = pots.indexOf('Wisdom') >= 0 ? 1.2 : 1;
  Object.assign(r, { me, myth: my, leg: le, asc, ib: b.ib, rb: b.rb, bmBonus: b.bm, drops: dr, dropsBy: byR, up, real_h: real,
    kills_h: (r.band[0] + r.band[1] + r.band[2] + r.band[3]) / real, deaths_rh: r.deaths / real, waves_h16: (r.rec16 - r.rec40) / real, waves_h40: r.rec40 / real,
    bmDismantle: bmd, bmPvp, bm: bmd + bmPvp, xp_rh: r.xp * xpMul / real });
  return r;
}


/* ------------------------------------------------------------------ PvP (tools/pvpsim.c + pvp2.py) */
const PVP_OFF = { CHUNT: 1, COUP: 1, ANGEL: 1 }, REFLECT_CAP = 0.25;
const _FT = new Map();
/* spec: { names[7], perks[], alloc[5] | stats{hp,atk,dfn,crit,par}, stacks } -> bound fighter */
function fighter(spec) {
  const key = JSON.stringify([spec.names, spec.perks, spec.alloc || null, spec.stats || null, spec.stacks || 0]);
  let f = _FT.get(key); if (f) return f;
  const K = (spec.perks || []).filter(k => PERKS[k]), g = gearOf(spec.names);
  const st = spec.stats ? Object.assign({}, spec.stats) : totals(g, spec.alloc, K, []);
  const p = new Float64Array(IDX.length);
  for (const k in g.fx) p[I[k]] = g.fx[k];
  p[I.HP] = st.hp; p[I.ATK] = st.atk; p[I.DFN] = st.dfn; p[I.CRIT] = st.crit; p[I.PAR] = st.par;
  p[I.CAP] = K.indexOf(27) >= 0 ? 75 : CRIT_CAP;
  for (const k of ['ea', 'ec', 'oc', 'op', 'fa', 'low', 'tb', 'cond']) p[I['N' + k.toUpperCase()]] = g[k].length;
  let bits = 0;
  for (const k of K) {
    bits += PERKS[k].bit || 0; const x = Object.assign({}, PERKS[k].x || {}, PERKS[k].pvp || {});
    for (const n in x) { if (PVP_OFF[n]) continue; p[I[n]] = ((n === 'DMULT' || n === 'TMULT') && p[I[n]]) ? p[I[n]] * x[n] : x[n]; }
  }
  p[I.PERKS] = bits;
  if (spec.stacks && p[I.KILL_DMG] > 0) p[I.DMULT] = (p[I.DMULT] || 1.0) * (1 + spec.stacks * p[I.KILL_MAX] * p[I.KILL_DMG]);
  const mods = []; for (const k of ['ea', 'ec', 'oc', 'op', 'fa']) for (const q of g[k]) for (const x of q) mods.push(x);
  const fl = a => { const out = []; for (const r of a) for (const x of r) out.push(x); return Float64Array.from(out); };
  const nea = g.ea.length, nec = g.ec.length, noc = g.oc.length, nop = g.op.length, nfa = g.fa.length;
  f = { p, mods: Float64Array.from(mods), low: fl(g.low), tb: fl(g.tb), cond: fl(g.cond), st,
        nea, nec, noc, nop, nfa, nlow: g.low.length, ntb: g.tb.length, ncond: g.cond.length, perks: bits,
        mea: 0, mec: nea * MODW, moc: (nea + nec) * MODW, mop: (nea + nec + noc) * MODW, mfa: (nea + nec + noc + nop) * MODW,
        maxhp: st.hp, healcap: cround(HEAL_CAP * st.hp), dmult: p[I.DMULT] > 0 ? p[I.DMULT] : 1, tmult: p[I.TMULT] > 0 ? p[I.TMULT] : 1, noheal: p[I.NOHEAL] > 0,
        pend: new Float64Array(MAXPEND * 10), nextA: new Float64Array(16), nextC: new Float64Array(16), tbNext: new Float64Array(MAXTB), tbStack: new Int32Array(MAXTB),
        regStart: new Float64Array(MAXLOW), regOnce: new Int32Array(MAXLOW), ptdExp: new Float64Array(48), debExp: new Float64Array(32) };
  if (_FT.size > 3000) _FT.clear();
  _FT.set(key, f); return f;
}
function fzero(f) { f.dealt = f.healed = f.plain = 0; f.landed = f.tried = f.ncrit = f.lbused = f.nplain = 0; }
function freset(f) {
  f.hp = f.maxhp; f.shield = 0; f.npend = 0;
  for (let i = 0; i < f.nea && i < 16; i++) f.nextA[i] = Math.trunc(f.mods[f.mea + i * MODW]);
  for (let i = 0; i < f.nec && i < 16; i++) f.nextC[i] = Math.trunc(f.mods[f.mec + i * MODW]);
  for (let i = 0; i < f.ntb && i < MAXTB; i++) { f.tbNext[i] = f.tb[i * TBW]; f.tbStack[i] = 0; }
  for (let i = 0; i < MAXLOW; i++) { f.regStart[i] = -1; f.regOnce[i] = 0; }
  f.tAtk = f.tDef = f.tCrit = f.tPar = f.permDef = f.pdef = f.wrath = f.poison = f.immUntil = 0;
  f.nptd = f.ndeb = f.pt = f.fhDone = f.fhAtk = f.hc1 = f.hc2 = f.halvePend = f.immArmed = f.mom = f.rip = 0;
  f.firstN = f.p[I.FIRSTN_ABSORB] | 0; f.last = f.perks & P_LAST; f.attacks = f.crits = f.swings = 0;
}
function fheal(f, h) {
  if (f.noheal || h <= 0 || f.hp <= 0) return;
  if (h > f.healcap) h = f.healcap;
  let n = f.hp + h; f.healed += h;
  if (n > f.maxhp) { if (f.p[I.OVERHEAL] > 0) { f.shield += n - f.maxhp; if (f.shield > f.maxhp) f.shield = f.maxhp; } n = f.maxhp; }
  f.hp = n;
}
function fpush(f, o) {
  if (f.npend >= MAXPEND) return;
  const b = f.npend++ * 10, m = f.mods; f.pend[b] = m[o + 1] < 1 ? 1 : m[o + 1];
  for (let i = 1; i < 10; i++) f.pend[b + i] = m[o + 1 + i];
}
function sdm(turn) {
  if (turn < 60) return 1.0;
  const steps = turn < 200 ? 1 + Math.trunc((turn - 60) / 10) : 15 + Math.trunc((turn - 200) / 3);
  const m = Math.pow(1.05, steps); return m > 1000 ? 1000 : m;
}
const mkLow = () => ({ atkPct: 0, defPct: 0, crit: 0, ls: 0, absorb: 0, atkFlat: 0, all: 0, dmgPerAtk: 0, regenPerAtk: 0, regenPerCrit: 0, atkLs: 0, permDef: 0, immuneCrit: 0, gcrit: 0 });
const LA = mkLow(), LD = mkLow();
function lowaggF(f, o) {
  const r = f.hp / f.maxhp, low = f.low;
  o.atkPct = o.defPct = o.crit = o.ls = o.absorb = o.atkFlat = o.all = o.dmgPerAtk = o.regenPerAtk = o.regenPerCrit = o.atkLs = o.permDef = 0; o.immuneCrit = 0; o.gcrit = 0;
  for (let i = 0; i < f.nlow; i++) {
    const b = i * LOWW;
    if (r < low[b]) {
      o.atkPct += low[b + 1]; o.defPct += low[b + 2]; o.crit += low[b + 3]; o.ls += low[b + 5]; o.absorb += low[b + 6]; o.atkFlat += low[b + 7];
      o.all += low[b + 8]; o.dmgPerAtk += low[b + 9]; o.regenPerAtk += low[b + 10]; o.regenPerCrit += low[b + 11]; o.atkLs += low[b + 12];
      if (low[b + 13] > 0) o.immuneCrit = 1; o.permDef += low[b + 14]; if (low[b + 15] > 0) o.gcrit = 1;
    }
  }
  if (o.absorb > ABSORB_CAP) o.absorb = ABSORB_CAP;
}
function swing(A, D, turn, elapsed) {
  const p = A.p, q = D.p;
  lowaggF(A, LA); lowaggF(D, LD);
  if (LA.permDef > A.permDef) A.permDef = LA.permDef;
  if (LD.permDef > D.permDef) D.permDef = LD.permDef;
  const sd = sdm(turn); let healA = LA.regenPerAtk, healD = 0, dealt = 0;
  A.swings++; A.tried++;
  {
    const r = D.hp / D.maxhp, low = D.low;
    for (let i = 0; i < D.nlow && i < MAXLOW; i++) {
      const b = i * LOWW; if (low[b + 4] <= 0) continue;
      const restOn = low[b + 18] > 0 && D.regStart[i] >= 0;
      if (r < low[b] || restOn) {
        if (D.regStart[i] < 0) D.regStart[i] = elapsed;
        if (low[b + 17] > 0) { if (D.regOnce[i]) continue; D.regOnce[i] = 1; }
        else if (low[b + 16] > 0 && elapsed - D.regStart[i] >= low[b + 16]) continue;
        healD += low[b + 4];
      }
    }
  }
  const pierce = A.perks & P_PIERCE;
  const lunge = p[I.LUNGE] > 0 && A.swings % 3 === 0, echo = p[I.ECHO] > 0 && A.swings % 5 === 0;
  let atk = (1 + LA.atkPct) * p[I.ATK] + A.tAtk + LA.atkFlat + LA.all;
  if (A.fhAtk) atk *= 1 + p[I.FH_ATKPCT];
  let pp = q[I.PAR] > 55 ? 55 : q[I.PAR]; pp += D.tPar; if (pp > 55) pp = 55;
  let epar = pp / 100.0 * (pierce ? 0.65 : 1.0) * (1 - p[I.PARRY_IGN]);
  {
    let un = 0;
    for (let i = 0; i < A.npend; i++) if (A.pend[i * 10 + 8] > 0) un = 1;
    for (let i = 0; i < A.nea && i < 16; i++) if (A.mods[A.mea + i * MODW + 9] > 0 && A.nextA[i] <= A.attacks + 1) un = 1;
    if (un) epar = 0;
  }
  if (!lunge && !echo && rnd() < epar) {
    healD += q[I.PARRY_HEAL];
    A.hp -= cround(atk * q[I.PARRY_REFL]) + q[I.PARRY_COUNTER];
    for (let i = 0; i < D.nop; i++) fpush(D, D.mop + i * MODW);
    D.pdef += q[I.PARRY_DEF_REST]; if (D.pdef > 40 * q[I.PARRY_DEF_REST]) D.pdef = 40 * q[I.PARRY_DEF_REST];
    if (q[I.PTD_AMT] > 0 && D.nptd < 48) D.ptdExp[D.nptd++] = elapsed + q[I.PTD_SEC];
    if (q[I.RIPOSTE] > 0) D.rip = 2;
  } else {
    A.attacks++;
    if (A.attacks === 1) for (let i = 0; i < A.nfa; i++) fpush(A, A.mfa + i * MODW);
    for (let i = 0; i < A.nea && i < 16; i++) if (A.attacks >= A.nextA[i]) {
      fpush(A, A.mea + i * MODW); A.nextA[i] += Math.trunc(A.mods[A.mea + i * MODW]); healA += A.mods[A.mea + i * MODW + 10];
    }
    let aPct = 0, aFlat = 0, aIgn = 0, aOcrit = 0, aCbon = 0, aFull = 0, aMult = 0; const pe = A.pend;
    for (let i = 0; i < A.npend; i++) {
      const b = i * 10; aPct += pe[b + 1]; aFlat += pe[b + 2]; if (pe[b + 3] > aIgn) aIgn = pe[b + 3];
      if (pe[b + 4] > aOcrit) aOcrit = pe[b + 4]; aCbon += pe[b + 5]; if (pe[b + 6] > 0) aFull = 1; if (pe[b + 7] > aMult) aMult = pe[b + 7];
    }
    if ((A.perks & P_FURY) && A.hp < 0.4 * A.maxhp) atk *= p[I.FURYM] > 0 ? p[I.FURYM] : 1.8;
    let d = atk * (0.8 + 0.4 * rnd()) * A.dmult;
    if (p[I.MOMENTUM] > 0) { d *= 1 + p[I.MOMENTUM] * A.mom; if (A.mom < 10) A.mom++; }
    const cap = p[I.CAP];
    let cc = p[I.CRIT] + LA.crit; if (cc > cap) cc = cap; cc += A.tCrit; if (cc > cap) cc = cap; cc += LA.all; if (cc > cap) cc = cap;
    const ch = aOcrit > 0 ? aOcrit : (aCbon * 100 + cc + A.wrath) / 100.0 * q[I.ECC];
    let c = rnd() < ch;
    if (p[I.FIRST_CRIT] > 0 && A.attacks === 1) c = true;
    if (LA.gcrit) c = true;
    if (p[I.NOCRIT] > 0) c = false;
    if (A.perks & P_WRATH) { if (c) A.wrath = 0; else { A.wrath += 10; if (A.wrath > 50) A.wrath = 50; } }
    if (c && !LD.immuneCrit) d *= 1 + q[I.ECM];
    if (aMult > 0) d *= aMult;
    if (aPct > 0) d *= 1 + aPct;
    if (lunge) d *= 1 + p[I.LUNGE];
    if (echo) d *= 1 + p[I.ECHO];
    if (A.rip > 0) { d *= 1 + p[I.RIPOSTE]; A.rip--; }
    {
      const r = D.hp / D.maxhp, cd = A.cond;
      for (let i = 0; i < A.ncond; i++) { const b = i * CDW; if ((cd[b + 1] > 0 && cd[b] < r) || (cd[b + 1] <= 0 && r < cd[b])) d *= 1 + cd[b + 2]; }
    }
    let ed = ((1 + LD.defPct) * q[I.DFN] + D.tDef) * (1 + D.permDef) + LD.all + D.pdef;
    if (D.nptd) { let k = 0; for (let i = 0; i < D.nptd; i++) if (D.ptdExp[i] > elapsed) D.ptdExp[k++] = D.ptdExp[i]; D.nptd = k; ed += q[I.PTD_AMT] * D.nptd; }
    if (A.ndeb) { let k = 0; for (let i = 0; i < A.ndeb; i++) if (A.debExp[i] > turn) A.debExp[k++] = A.debExp[i]; A.ndeb = k; ed -= p[I.DEBUFF_AMT] * A.ndeb; }
    if (ed < 0) ed = 0;
    let ign = aIgn + p[I.DEF_IGN] + (pierce ? 0.35 : 0.0); if (ign > 0.5) ign = 0.5;
    if (aFull > 0) ed = 0; else ed *= 1 - ign;
    const flatd = aFlat + LA.dmgPerAtk + p[I.FLAT];
    let dmg = cround((flatd + d) * 60.0 / (ed + 60.0) * sd * D.tmult); if (dmg < 1) dmg = 1;
    { let k = 0; for (let i = 0; i < A.npend; i++) { const b = i * 10; pe[b] -= 1; if (pe[b] >= 1) { if (k !== i) pe.copyWithin(k * 10, b, b + 10); k++; } } A.npend = k; }
    if (q[I.IMM_SEC] > 0) {
      if (!D.immArmed && D.hp / D.maxhp < q[I.IMM_THR]) { D.immArmed = 1; D.immUntil = elapsed + q[I.IMM_SEC]; }
      if (D.immArmed && elapsed < D.immUntil) dmg = 0;
    }
    if (dmg > 0 && D.halvePend > 0) { D.halvePend--; dmg = Math.floor(dmg / 2); if (dmg < 1) dmg = 1; }
    if (LD.absorb > 0) dmg = cround((1 - LD.absorb) * dmg);
    if (!D.fhDone && (q[I.FH_ABSORB] > 0 || q[I.FH_COUNTER] > 0 || q[I.FH_HEAL] > 0 || q[I.FH_ATKPCT] > 0)) {
      D.fhDone = 1; if (q[I.FH_ABSORB] > 0) dmg = cround(dmg * (1 - q[I.FH_ABSORB]));
      A.hp -= q[I.FH_COUNTER]; healD += q[I.FH_HEAL]; if (q[I.FH_ATKPCT] > 0) D.fhAtk = 1;
    }
    {
      let kind = 0;
      if (q[I.HITN1_N] > 0) { if (++D.hc1 >= q[I.HITN1_N]) { D.hc1 = 0; if (q[I.HITN1_KIND] > kind) kind = q[I.HITN1_KIND]; healD += q[I.HITN_HEAL]; } }
      if (q[I.HITN2_N] > 0) { if (++D.hc2 >= q[I.HITN2_N]) { D.hc2 = 0; if (q[I.HITN2_KIND] > kind) kind = q[I.HITN2_KIND]; healD += q[I.HITN_HEAL]; } }
      if (kind >= 1) dmg = 0; else { if (kind > 0) dmg = Math.floor(dmg / 2); if (dmg > 0 && D.firstN > 0) { D.firstN--; dmg = 0; } }
    }
    if (q[I.BULWARK] > 0 && D.hp < 0.25 * D.maxhp) dmg = cround(dmg * (1 - q[I.BULWARK]));
    if (D.shield > 0 && dmg > 0) { const ab = D.shield < dmg ? D.shield : dmg; D.shield -= ab; dmg -= ab; }
    if (dmg > 0) {
      let rf = q[I.REFLECT] + q[I.PREFLECT]; if (rf > REFLECT_CAP) rf = REFLECT_CAP;
      if (rf > 0) A.hp -= cround(rf * dmg);
      if (q[I.REFL_HEAL] > 0) healD += cround(dmg * q[I.REFL_HEAL]);
    }
    if (c) dmg += p[I.CRIT_BONUS];
    D.hp -= dmg; dealt = dmg; A.dealt += dmg; A.landed++;
    if (!c && aFull <= 0 && dmg > 0 && sd <= 1.0) { A.plain += dmg; A.nplain++; }
    let ls = p[I.PLS] + p[I.BCURSE] + LA.ls + p[I.LIFESTEAL] + LA.atkLs + (c ? p[I.CRIT_LS] : 0); if (ls > LS_CAP) ls = LS_CAP;
    healA += cround(dmg * ls) + ((A.perks & P_VOW) && dmg > 0 ? 3 : 0);
    if (c) {
      A.crits++; A.ncrit++; healA += p[I.CRIT_HEAL] + LA.regenPerCrit;
      for (let i = 0; i < A.noc; i++) fpush(A, A.moc + i * MODW);
      if (p[I.DEBUFF_AMT] > 0 && A.ndeb < 32) A.debExp[A.ndeb++] = turn + p[I.DEBUFF_TURNS];
      for (let i = 0; i < A.nec && i < 16; i++) if (A.crits >= A.nextC[i]) { fpush(A, A.mec + i * MODW); A.nextC[i] += Math.trunc(A.mods[A.mec + i * MODW]); }
      if (p[I.CRIT_HALVE] > 0) A.halvePend++;
      if (A.perks & P_VENOM) { D.poison += 28; D.pt = 8; }
      if (p[I.POISON_TOTAL] > 0) { if (p[I.POISON_TOTAL] > D.poison) D.poison = p[I.POISON_TOTAL]; if (p[I.POISON_TURNS] > D.pt) D.pt = p[I.POISON_TURNS] | 0; }
    }
    if (D.hp <= 0 && D.last) { D.hp = Math.ceil(0.25 * D.maxhp); D.last = 0; D.lbused++; }
  }
  if (D.pt && D.hp > 0) { let t = Math.floor(D.poison / D.pt); if (t < 1) t = 1; D.hp -= t; D.poison -= t; D.pt--; }
  if (A.pt && A.hp > 0) { let t = Math.floor(A.poison / A.pt); if (t < 1) t = 1; A.hp -= t; A.poison -= t; A.pt--; }
  if (A.hp > 0) fheal(A, healA);
  if (D.hp > 0) fheal(D, healD);
  if (p[I.BCURSE] > 0 && dealt > 0) { A.hp -= cround(0.11 * dealt); if (A.hp < 1) A.hp = 1; }
  if (A.hp <= 0 && A.last) { A.hp = Math.ceil(0.25 * A.maxhp); A.last = 0; A.lbused++; }
}
function fticks(f, elapsed) {
  for (let i = 0; i < f.ntb && i < MAXTB; i++) {
    const b = i * TBW, q = f.tb;
    if (f.tbNext[i] <= elapsed + 1e-4) {
      f.tbNext[i] += q[b];
      const st = q[b + 2] | 0;
      if (st === 5) { fheal(f, q[b + 1]); continue; }
      if (q[b + 3] > 0 && f.tbStack[i] >= q[b + 3]) continue;
      f.tbStack[i]++;
      if (st === 0) f.tAtk += q[b + 1]; else if (st === 1) f.tDef += q[b + 1]; else if (st === 2) f.tCrit += q[b + 1]; else if (st === 3) f.tPar += q[b + 1];
      else if (st === 4) { f.tAtk += q[b + 1]; f.tDef += q[b + 1]; f.tCrit += q[b + 1]; f.tPar += q[b + 1]; }
    }
  }
  if (f.p[I.BULWARK] > 0 && !f.noheal && f.hp < 0.25 * f.maxhp) { f.hp += 4; if (f.hp > f.maxhp) f.hp = f.maxhp; }
}
/* n fights; X swings first when first is truthy. A double KO counts as a loss for X. */
function duel(X, Y, n, seed, first) {
  if (X === Y) throw new Error('duel needs two distinct fighters');
  seedRng(seed); fzero(X); fzero(Y);
  let wins = 0, turns = 0, sdn = 0;
  for (let k = 0; k < n; k++) {
    freset(X); freset(Y);
    let turn = 0, elapsed = 0, res = -1; const a = first ? X : Y, b = first ? Y : X;
    while (res < 0) {
      turn++; swing(a, b, turn, elapsed);
      if (X.hp <= 0) res = 0; else if (Y.hp <= 0) res = 1;
      if (res >= 0) break;
      elapsed += 0.5;
      turn++; swing(b, a, turn, elapsed);
      if (X.hp <= 0) res = 0; else if (Y.hp <= 0) res = 1;
      if (res >= 0) break;
      elapsed += 0.5;
      fticks(X, elapsed); fticks(Y, elapsed);
      if (turn > 2000) res = 0;
    }
    wins += res; turns += turn; if (turn >= 60) sdn++;
  }
  return { win: wins / n, turns: turns / n, xdpl: X.dealt / (X.landed || 1), xland: X.landed / (X.tried || 1), xcrit: X.ncrit / (X.landed || 1),
           ydpl: Y.dealt / (Y.landed || 1), yland: Y.landed / (Y.tried || 1), ycrit: Y.ncrit / (Y.landed || 1), sd: sdn / n, xheal: X.healed / n, yheal: Y.healed / n,
           xlb: X.lbused / n, ylb: Y.lbused / n, xplain: X.plain / (X.nplain || 1), yplain: Y.plain / (Y.nplain || 1) };
}
/* Fit a replay opponent (tools/pvpfit2.py): gear and max HP are known, perks and stat points are guessed from the swings. */
function fitOpponent(job) {
  const o = job.obs, names = job.names, g = gearOf(names), POINTS = Math.max(0, ((job.level || 60) - 1) * 5);
  const me = fighter(job.me);
  const binll = (k, n, p) => { p = Math.min(0.999, Math.max(0.001, p)); return k * Math.log(p) + (n - k) * Math.log(1 - p); };
  let best = null;
  for (const hpk of [null, 10, 9]) for (const ig of [0, 1]) for (const du of [0, 1]) for (const rival of [0, 1]) {
    const K = [hpk, ig ? 30 : null, du ? 22 : null, rival ? 14 : null, (o.lb === true || o.lb === null) ? 29 : null].filter(Boolean);
    const base = totals(g, [0, 0, 0, 0, 0], K, []).hp, per = (totals(g, [100, 0, 0, 0, 0], K, []).hp - base) / 100;
    let h = pyRound((job.maxHp - base) / per);
    if (h < -3 || h > POINTS + 3) continue;
    h = Math.min(POINTS, Math.max(0, h)); const rest = POINTS - h;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) for (let d = 0; d < 5; d++) {
      if (a + b + c + d !== 4) continue;
      const al = [h, pyRound(rest * a / 4), pyRound(rest * b / 4), pyRound(rest * c / 4), pyRound(rest * d / 4)];
      const f = fighter({ names, perks: K, alloc: al }), r = duel(me, f, 150, 3, 1);
      let ll = binll(o.my_par, o.n_my, 1 - r.xland) + binll(o.th_crit, o.th_land, r.ycrit);
      if (o.my_land >= 3) ll -= 0.5 * Math.pow(Math.log(Math.max(1, r.xdpl) / o.my_dpl) / (0.2 + 0.35 / Math.sqrt(o.my_land)), 2);
      if (o.n_plain >= 2) ll -= 0.5 * Math.pow(Math.log(Math.max(1, r.xplain) / o.plain) / (0.1 + 0.3 / Math.sqrt(o.n_plain)), 2);
      if (o.th_land >= 3) ll -= 0.5 * Math.pow(Math.log(Math.max(1, r.ydpl) / o.th_dpl) / (0.12 + 0.35 / Math.sqrt(o.th_land)), 2);
      ll -= 0.3 * K.filter(k => k === 22 || k === 14).length;
      if (best === null || ll > best.ll) best = { ll, perks: K, alloc: al };
    }
  }
  if (!best) return { failed: true };
  const f = fighter({ names, perks: best.perks, alloc: best.alloc }), r = duel(me, f, 1500, 9, 1);
  return { perks: best.perks, alloc: best.alloc, st: Object.assign({}, f.st), simWin: r.win, ll: best.ll };
}
/* job: { type:'pvp', build, opps:[spec], n, seed, robust, detail } */
function runPvp(job) {
  const b = job.build, K = b.perks.filter(k => PERKS[k]);
  const X = fighter({ names: b.names, perks: K, alloc: b.alloc, stacks: job.stacks === undefined ? 0.5 : job.stacks });
  const rs = job.opps.map(s => duel(X, fighter(s), job.n, job.seed, 1)), wins = rs.map(r => r.win);
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  let score = avg(wins);
  if (job.robust) { const w = wins.slice().sort((x, y) => x - y); score = 0.5 * score + 0.5 * avg(w.slice(0, Math.max(1, Math.ceil(w.length / 3)))); }
  const res = { score };
  if (job.detail) {
    const X0 = fighter({ names: b.names, perks: K, alloc: b.alloc, stacks: 0 });
    const def = job.opps.map(s => duel(X0, fighter(s), job.n, job.seed + 1, 0));
    res.r = { wins, mean: avg(wins), min: Math.min.apply(null, wins), def: def.map(r => r.win), defMean: avg(def.map(r => r.win)), st: X.st, duels: rs, unparsed: gearOf(b.names).unparsed };
  }
  return res;
}

/* ------------------------------------------------------------------ goals */
const GOALS = {
  push: { label: 'Push the highest wave', unit: 'max wave', short: 'Max wave',
          score: r => r.maxwave > r.startWave ? r.maxwave + r.meanwave / 10000 : r.meanwave, fmt: v => 'wave ' + v.toFixed(1) },
  mythic: { label: 'Farm Mythics', unit: 'mythic-equivalents / real h', short: 'Mythic-eq / h', score: r => r.me, fmt: v => v.toFixed(2) + ' ME/h' },
  ascended: { label: 'Farm Ascended', unit: 'Ascended drops / real h', short: 'Ascended / h', score: r => r.asc, fmt: v => v.toFixed(3) + ' /h' },
  bloodmarks: { label: 'Farm Bloodmarks', unit: 'Bloodmarks / real h', short: 'Bloodmarks / h', score: r => r.bm, fmt: v => v.toFixed(0) + ' BM/h' },
  pvp: { label: 'PvP win rate', unit: 'win rate attacking first, against the opponent pool', short: 'PvP win rate', pvp: true, score: r => r.mean, fmt: v => (v * 100).toFixed(0) + '%' },
  xp: { label: 'Farm XP', unit: 'XP / real h', short: 'XP / h', score: r => r.xp_rh, fmt: v => (v / 1e6).toFixed(2) + 'M XP/h' },
};

/* Slim, transferable summary of a run (typed arrays trimmed to the waves that matter). */
function summarize(r) {
  const hi = Math.min(MAXW - 1, r.maxwave + 1);
  const out = {};
  for (const k of ['startWave', 't', 'xp', 'fights', 'deaths', 'maxwave', 'wave', 'treach', 'bossmask', 'band', 'rec16', 'rec40', 'meanwave', 'swings', 'st', 'xph',
    'deaths_h', 'fights_h', 'me', 'myth', 'leg', 'asc', 'ib', 'rb', 'bmBonus', 'drops', 'dropsBy', 'up', 'real_h', 'kills_h', 'deaths_rh', 'waves_h16',
    'waves_h40', 'bmDismantle', 'bmPvp', 'bm', 'xp_rh', 'stats', 'unparsed']) out[k] = r[k];
  out.timeAt = Array.from(r.timeAt.subarray(0, hi + 1)); out.deathsAt = Array.from(r.deathsAt.subarray(0, hi + 1));
  out.firstReach = Array.from(r.firstReach.subarray(0, hi + 1)); out.recAt = Array.from(r.recAt.subarray(0, hi + 1));
  return out;
}
/* job: { build, o, goal, detail } -> { score, r? } */
function runJob(job) {
  if (job.type === 'pvp') return runPvp(job);
  if (job.type === 'fit') return fitOpponent(job);
  const r = simulate(job.build, job.o);
  const res = { score: GOALS[job.goal].score(r) };
  if (job.detail) res.r = summarize(r);
  return res;
}

return { PVP_PERK_IDS, fighter, duel, fitOpponent, IDX, I, ALL, BYNAME, BYID, PERKS, PERK_IDS, UNMODELLED_PERKS, SLOT_UNLOCK, POTIONS, POTION_NAMES, POTION_BY_ID, ELEM_NAME, RARITY, SLOT, ORDER,
         POS_NAME, GOALS, BASE, PT: [HP_PT, ATK_PT, DEF_PT, CRIT_PT, PARRY_PT], gear, gearOf, totals, bonuses, simulate, summarize, runJob, isShield,
         waveScale, reqLevel, ROWS, BLU, DISMANTLE };
})(typeof LB_DATA !== 'undefined' ? LB_DATA : (typeof globalThis !== 'undefined' ? globalThis.LB_DATA : undefined));
if (typeof module !== 'undefined') module.exports = LB;
