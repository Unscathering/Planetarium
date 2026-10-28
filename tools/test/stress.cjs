// Frame rates on the stress vault. Usage: node tools/test/stress.cjs [quality 0-2 to lock it]
// Needs Playwright (the cloud container has it globally: NODE_PATH=$(npm root -g)).
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
 const errs = []; p.on('pageerror', e => errs.push(e.message));
 await p.goto('file://' + __dirname + '/stress.html'); await p.waitForFunction(() => window.view && window.view.universe);
 const measure = async (name, ms = 3000) => { await p.evaluate(() => frameStats()); await p.waitForTimeout(ms); console.log(name.padEnd(26), JSON.stringify(await p.evaluate(() => frameStats())), 'quality', await p.evaluate(() => window.view.quality)); };
 if (process.argv[2]) await p.evaluate((q) => { window.view.qualityLock = +q; }, process.argv[2]);
 await p.waitForTimeout(1500); await measure('far view');
 await p.evaluate(() => { const v = window.view; Object.assign(v.cam, v.fitSystem(0)); }); await p.waitForTimeout(300); await measure('big folder system view');
 await p.evaluate(() => { window.view.cam.zoom *= 3; }); await measure('big folder zoomed x3');
 await p.evaluate(() => { window.plugin.settings.planetScale = 2.5; }); await measure('zoomed x3, planets x2.5');
 if (errs.length) console.log('errors', errs);
 await b.close(); })();
