"""Writes web/src/data.js (catalogue + arena enemy tables) and web/test/cases.json (reference results from lb2 / fastsim2p)."""
import sys, json, random, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools'))
import pot38 as P
L = P.L; ALL = P.ALL; PERK = P.PERK
from lbfast import SECTORS
HERE = os.path.dirname(os.path.abspath(__file__))
items = [{k: i[k] for k in ('id', 'slot', 'rarity', 'category', 'isBossExclusive', 'hp', 'atk', 'def', 'crit', 'parry', 'itemName', 'effects')} for i in ALL]
sect = {s: [dict(name=c[0], resist=list(c[1]), weak=c[2], v=[list(v) for v in c[3]]) for c in SECTORS[s][2]] for s in (4, 5, 6)}
open(os.path.join(HERE, '..', 'src', 'data.js'), 'w').write('var LB_DATA = ' + json.dumps(dict(items=items, sectors=sect), separators=(',', ':')) + ';\n')
if 'data' in sys.argv: sys.exit()
rng = random.Random(7); cases = []
pool = {s: [i['itemName'] for i in ALL if i['slot'] == s and i['rarity'] >= 2] for s in range(6)}
POTS = ['Immolation', 'Bastion', 'Rampart', 'Vigor', 'Fury', 'Feline', 'Savagery', 'Regeneration', 'Attrition']
PRESET = [(("Haughtiness of the Gods", "Remains of Sbard the Ugly", "Mawfire Cummerbund", "Sword of Divine Justice", "Frirekr Toto's Aegis", "Ring of Final Ascension", "Dawnguard Pendant"), (10, 28, 17, 29, 30), (106, 0, 175, 0, 14)),
          (("Frog Mouth Helm of Ire", "Fire Titan Cuirass", "The World's Serpent", "Bern the Bear's Scythe", "Mace of the Avalanche", "Ring of Final Ascension", "Essence of the Abyss"), (22, 11, 28, 4, 6), (31, 0, 250, 0, 14)),
          (("Haughtiness of the Gods", "Remains of Sbard the Ugly", "Sash of Death Sentence", "Frirekr Toto's Aegis", "Sword of Divine Justice", "Oathkeeper's Circle", "Tears of Lumi the Angel"), (10, 28, 17, 29, 30), (145, 0, 150, 0, 0)),
          (("Frog Mouth Helm of Ire", "Simon of Vineyards' Vest", "Sash of Death Sentence", "Bern the Bear's Scythe", "Sword of Divine Justice", "Farn Ahb'Ahzz's Trial", "Essence of the Abyss"), (22, 21, 6, 29, 11), (150, 0, 120, 0, 25))]
for n in range(60):
    if n < len(PRESET)*2: names, K, alloc = PRESET[n//2]
    else:
        names = tuple(rng.choice(pool[s]) for s in (0, 1, 2, 3, 3, 4, 5)); K = tuple(rng.sample(sorted(PERK), rng.randint(3, 5)))
        a = [0]*5
        for _ in range(59): a[rng.randrange(5)] += 5
        alloc = tuple(a)
    pots = tuple(rng.sample(POTS, rng.randint(0, 2))) if n % 2 else ()
    sw = rng.choice([1, 1, 20, 60, 100]); bm = 15 if sw > 40 else 0; seed = rng.randint(1, 99); plvl = rng.choice([60, 60, 52])
    P.setp(pots)
    r = L.loot(L.simulate(names, K, alloc, plvl=plvl, budget_h=40, seed=seed, start_wave=sw, bossmask=bm))
    g = L.gear([P.BYNAME[x] for x in names])
    cases.append(dict(names=names, K=K, alloc=alloc, pots=pots, sw=sw, bm=bm, seed=seed, plvl=plvl,
                      g={k: g[k] for k in ('s', 'pct', 'fx', 'ea', 'ec', 'oc', 'op', 'fa', 'low', 'tb', 'cond', 'conv', 'allper')},
                      r={k: r[k] for k in ('st', 't', 'xph', 'deaths_h', 'fights_h', 'maxwave', 'wave', 'bossmask', 'band', 'rec16', 'rec40', 'meanwave', 'me', 'myth', 'leg', 'asc', 'ib', 'rb', 'drops', 'up', 'real_h')}))
single = {}
for i in ALL:
    g = L.gear([i]); single[i['itemName']] = {k: g[k] for k in ('s', 'pct', 'fx', 'ea', 'ec', 'oc', 'op', 'fa', 'low', 'tb', 'cond', 'conv', 'allper')}
json.dump(dict(cases=cases, single=single, unparsed=sorted(L.UNPARSED)), open(os.path.join(HERE, 'cases.json'), 'w'))
print(len(cases), 'cases; unparsed:', sorted(L.UNPARSED))
