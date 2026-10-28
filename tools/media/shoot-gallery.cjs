// Captures the README gallery images: node tools/media/shoot-gallery.cjs <out dir> [types,rare|pick] [picks]
// Build first: npx esbuild tools/media/gallery.ts --bundle --outfile=tools/media/gallery.js
const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
 fs.writeFileSync(`${__dirname}/gallery.html`, '<html><body style="margin:0;background:#05060e"><canvas id="sheet"></canvas><script src="gallery.js"></script></body></html>'); const b = await chromium.launch(); const out = process.argv[2];
 const parts = (process.argv[3] ?? 'types,rare').split(','); const picks = process.argv[4] ?? '';
 for (const part of parts) { const p = await b.newPage({ viewport: { width: 1700, height: 2200 }, deviceScaleFactor: 2 });
   p.on('pageerror', e => console.log('error', e.message));
   await p.goto(`file://${__dirname}/gallery.html?part=${part}&picks=${picks}`); await p.waitForFunction(() => document.title.startsWith('done'), null, { timeout: 120000 });
   await p.locator('canvas').screenshot({ path: `${out}/gallery-${part}.png` }); }
 await b.close(); })();
