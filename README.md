# Lootborne Arena Planner (web)

Single-page build simulator for the Eternal Arena. Open `index.html` in a browser; nothing is uploaded.

- `src/engine.js` — port of `tools/lb2.py` + `tools/fastsim2p.c` (same RNG stream, identical results).
- `src/planner.js` — save parsing, restrictions, coordinate-ascent search, explanations.
- `src/app.js`, `src/page.html`, `src/style.css` — the page.
- `node build.mjs` — writes `index.html` (stand-alone) and `dist/planner.html` (no document wrapper).
- `python3 test/dump.py` — regenerates `src/data.js` and the reference cases from the Python / C tools
  (`python3 test/dump.py data` for the catalogue only); `node test/parity.mjs` and `node test/pvpparity.mjs` check the arena and PvP ports against them.
- `node test/search.mjs <save.json|-> <goal> <depth> <owned|market|all> [save|free]` — the search from the command line.

Free hosting: `index.html` is one self-contained file, so any static host works (GitHub Pages, Cloudflare Pages,
Netlify) with no build step and no server.
