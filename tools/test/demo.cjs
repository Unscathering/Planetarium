// Checks the web demo: node demo/build.mjs, then node tools/test/demo.cjs
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
 const errs = []; const out = (n) => `${__dirname}/out/demo-${n}.png`;
 const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
 await p.goto('file://' + __dirname + '/../../demo/dist/index.html'); await p.waitForTimeout(6000);
 console.log('banner', await p.evaluate(() => document.querySelector('.solar-banner')?.textContent));
 console.log('buttons', await p.evaluate(() => [...document.querySelectorAll('.demo-action')].filter(b => b.style.display !== 'none').map(b => b.title).join(' | ')));
 await p.screenshot({ path: out('1-far') });
 // Fly into the biggest system and hover a planet.
 await p.evaluate(() => { const v = window.view, u = v.universe; let best = 0; u.systems.forEach((s, i) => { if (s.bodies.length > u.systems[best].bodies.length) best = i; }); v.flyTo(v.fitSystem(best)); window.best = best; }); await p.waitForTimeout(2500);
 await p.screenshot({ path: out('2-system') });
 const pt = await p.evaluate(() => { const v = window.view, s = v.universe.systems[window.best]; const bi = s.bodies.find(i => v.screen.r[i] > 3 && v.screen.x[i] > 100 && v.screen.x[i] < 1100 && v.screen.y[i] > 100 && v.screen.y[i] < 600); return bi === undefined ? null : { x: v.screen.x[bi], y: v.screen.y[bi], bi }; });
 if (pt) { await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(700); console.log('card', await p.evaluate(() => document.querySelector('.solar-card')?.textContent.slice(0, 160)));
   await p.screenshot({ path: out('3-card') }); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(2000); console.log('click follows', await p.evaluate((bi) => window.view.follow === bi, pt.bi)); await p.screenshot({ path: out('4-follow') }); }
 await p.click('.demo-action[title^="Roll"]'); await p.waitForTimeout(5000); console.log('rolled', await p.evaluate(() => document.querySelector('.solar-banner')?.textContent));
 await p.selectOption('#demo-nebula', 'violet'); await p.waitForTimeout(2500); await p.screenshot({ path: out('5-rolled-violet') });
 const m = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); m.on('pageerror', e => errs.push('mobile: ' + e.message));
 await m.goto('file://' + __dirname + '/../../demo/dist/index.html'); await m.waitForTimeout(6000); await m.screenshot({ path: out('6-phone') });
 console.log('phone scroll width', await m.evaluate(() => document.documentElement.scrollWidth));
 console.log('errors:', JSON.stringify(errs)); await b.close(); })();
