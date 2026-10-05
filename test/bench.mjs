import fs from 'node:fs';
import { load } from './load.mjs';
const LB = load();
const B = { tank: { names: ["Haughtiness of the Gods", "Remains of Sbard the Ugly", "Mawfire Cummerbund", "Sword of Divine Justice", "Frirekr Toto's Aegis", "Ring of Final Ascension", "Dawnguard Pendant"], perks: [10, 28, 17, 29, 30], alloc: [106, 0, 175, 0, 14], pots: [] },
  glass: { names: ["Frog Mouth Helm of Ire", "Fire Titan Cuirass", "The World's Serpent", "Bern the Bear's Scythe", "Mace of the Avalanche", "Ring of Final Ascension", "Essence of the Abyss"], perks: [22, 11, 28, 4, 6], alloc: [31, 0, 250, 0, 14], pots: [] } };
for (const [n, b] of Object.entries(B)) for (const sw of [1, 100]) {
  const t0 = performance.now(); const r = LB.simulate(b, { budgetH: 150, seed: 3, startWave: sw, bossmask: 15 });
  console.log(n, 'start', sw, (performance.now() - t0).toFixed(0), 'ms', 'swings', r.swings, 'fights', r.fights, 'max', r.maxwave, 'mean', r.meanwave.toFixed(1), 'asc', r.asc.toFixed(3), 'me', r.me.toFixed(2));
}
