// Assembles the single-file page: web/index.html (stand-alone, for any static host or opening from disk)
// and web/dist/planner.html (same page without the document wrapper).
import fs from 'node:fs';
const rd = f => fs.readFileSync(new URL('./src/' + f, import.meta.url), 'utf8');
const engine = rd('data.js') + '\n' + rd('engine.js');
if (/<\/script/i.test(engine + rd('planner.js') + rd('app.js'))) throw new Error('script terminator inside a source file');
const page = rd('page.html').replace('/*CSS*/', () => rd('style.css')).replace('/*ENGINE*/', () => engine).replace('/*PLANNER*/', () => rd('planner.js')).replace('/*APP*/', () => rd('app.js'));
fs.mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./dist/planner.html', import.meta.url), page);
const m = page.match(/<title>[^<]*<\/title>/)[0];
fs.writeFileSync(new URL('./index.html', import.meta.url), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + m +
  '\n</head>\n<body>\n' + page.replace(m, '') + '\n</body>\n</html>\n');
console.log('built', (page.length / 1024).toFixed(0), 'KB');
