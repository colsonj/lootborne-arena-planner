// Loads data.js + engine.js (+ optional extra sources) the way the page does: plain scripts sharing one scope.
import fs from 'node:fs';
export function load(extra = [], ret = 'LB') {
  const src = ['data.js', 'engine.js', ...extra].map(f => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
  return new Function(src + '\nreturn ' + ret + ';')();
}
