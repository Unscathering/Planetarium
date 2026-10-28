// Screenshots the far view with every nebula style: node tools/test/nebulas.cjs
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 640 } });
 const errs = []; p.on('pageerror', e => errs.push(e.message));
 require('fs').mkdirSync(__dirname + '/out', { recursive: true });
 await p.goto('file://' + __dirname + '/vault.html'); await p.waitForTimeout(4500);
 const styles = ['classic', 'violet', 'emerald', 'crimson', 'golden', 'ice', 'sunset', 'smoke', 'wisps'];
 for (const s of styles) {
   await p.evaluate((s) => { window.plugin.settings.nebulaStyle = s; window.view.settingsChanged('nebulaStyle'); }, s);
   await p.waitForTimeout(2600); await p.screenshot({ path: `${__dirname}/out/nebula-${s}.png` });
 }
 console.log('errors:', JSON.stringify(errs)); await b.close(); })();
