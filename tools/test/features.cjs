const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
 const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
 const shot = (n) => p.screenshot({ path: `${__dirname}/out/feat-${n}.png` });
 const ev = (f, a) => p.evaluate(f, a);
 require('fs').mkdirSync(__dirname + '/out', { recursive: true }); await p.goto('file://' + __dirname + '/vault.html'); await p.waitForTimeout(4500);
 const info = await ev(() => { const u = window.view.universe; return { systems: u.systems.length, bodies: u.bodies.length, rogues: u.rogues.length, moons: u.bodies.filter(b => b.kind === 'moon').length, current: window.view.current }; });
 console.log('universe', JSON.stringify(info), 'frames', JSON.stringify(await ev(() => frameStats())));
 await shot('1-far');
 // Search: type and press Enter, the camera flies to and follows the planet.
 await p.click('.solar-search'); await p.keyboard.type('Ideas note 3'); await p.waitForTimeout(200);
 console.log('results', await ev(() => [...document.querySelectorAll('.solar-result-label')].map(e => e.textContent).join(' | ')));
 await p.keyboard.press('Enter'); await p.waitForTimeout(2200);
 const f = await ev(() => { const v = window.view; return { follow: v.follow, name: v.universe.bodies[v.follow]?.name, x: v.screen.x[v.follow], y: v.screen.y[v.follow], r: v.screen.r[v.follow] }; });
 console.log('following', JSON.stringify(f));
 await shot('2-follow');
 // Hover card on the followed planet.
 await p.mouse.move(f.x, f.y); await p.waitForTimeout(500);
 console.log('card', await ev(() => document.querySelector('.solar-card').style.display + ' :: ' + document.querySelector('.solar-card').textContent.slice(0, 120)));
 await shot('3-card');
 // Locate the open note.
 await p.mouse.move(5, 5); await p.keyboard.press('Escape'); await ev(() => window.view.contentEl.focus()); await p.keyboard.press('l'); await p.waitForTimeout(2000);
 console.log('locate follows', await ev(() => window.view.universe.bodies[window.view.follow]?.name));
 await shot('4-you-are-here');
 // Filter by tag from the far view.
 await p.keyboard.press('h'); await p.waitForTimeout(1500);
 await p.click('.solar-filter'); await p.keyboard.type('#idea'); await p.waitForTimeout(300);
 console.log('dimmed', await ev(() => [...window.view.dim].filter(x => x).length));
 await shot('5-filter');
 await p.fill('.solar-filter', ''); await p.dispatchEvent('.solar-filter', 'input');
 // History mode.
 await ev(() => window.view.setHistory(true)); await p.waitForTimeout(5000);
 console.log('history', await ev(() => document.querySelector('.solar-date').textContent), 'shown', await ev(() => window.view.screen.r.filter(r => r >= 0).length));
 await shot('6-history');
 await ev(() => window.view.setHistory(false));
 // Keyboard: Tab flies to a system.
 await ev(() => window.view.contentEl.focus()); const z0 = await ev(() => window.view.cam.zoom); await p.keyboard.press('Tab'); await p.waitForTimeout(1500);
 console.log('tab zoom', z0.toFixed(4), '->', (await ev(() => window.view.cam.zoom)).toFixed(4));
 // Pinch zoom with two pointers.
 const pz = await ev(() => { const v = window.view, c = v.canvas, r = c.getBoundingClientRect(); const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
   const z = v.cam.zoom; fire('pointerdown', 1, 600, 425); fire('pointerdown', 2, 800, 425); fire('pointermove', 1, 500, 425); fire('pointermove', 2, 900, 425); fire('pointerup', 1, 500, 425); fire('pointerup', 2, 900, 425); return [z, v.cam.zoom]; });
 console.log('pinch zoom', pz.map(x => x.toFixed(4)).join(' -> '));
 // Orbital planes and bigger planets in the system view.
 await ev(() => { window.plugin.settings.showPlanes = true; window.plugin.settings.planetScale = 2.2; }); await p.waitForTimeout(1500);
 await shot('7-planes');
 // Rogue planets and child moons.
 const rogue = await ev(() => { const v = window.view, u = v.universe; return u.rogues.length ? u.rogues[0] : -1; });
 if (rogue >= 0) { await ev((i) => window.view.focusBody(i), rogue); await p.waitForTimeout(2200); await shot('8-rogue'); }
 const moon = await ev(() => { const u = window.view.universe; return u.bodies.findIndex(b => b.kind === 'moon'); });
 if (moon >= 0) { await ev((i) => window.view.focusBody(window.view.universe.bodies[i].parent), moon); await ev(() => { window.view.cam.zoom *= 0.6; }); await p.waitForTimeout(2200); await shot('9-moons'); }
 // Developer random universe, rolled twice.
 await ev(() => { window.plugin.settings.showPlanes = false; window.plugin.settings.planetScale = 1; window.plugin.settings.devMode = true; window.view.settingsChanged('devMode'); window.view.rollRandom(); }); await p.waitForTimeout(4500);
 console.log('random 1', await ev(() => document.querySelector('.solar-banner').textContent));
 await shot('10-random-a');
 await ev(() => window.view.rollRandom()); await p.waitForTimeout(4500);
 console.log('random 2', await ev(() => document.querySelector('.solar-banner').textContent), 'frames', JSON.stringify(await ev(() => frameStats())));
 await shot('11-random-b');
 // Back to the vault: legend, sun card, double-click into a sun, and live births.
 await ev(() => window.view.leaveRandom()); await p.waitForTimeout(300);
 await ev(() => { window.plugin.settings.devMode = false; window.view.settingsChanged('devMode'); });
 await ev(() => window.view.contentEl.focus()); await p.keyboard.press('?'); await p.waitForTimeout(300);
 console.log('legend', await ev(() => getComputedStyle(document.querySelector('.solar-legend')).display));
 await shot('12-legend'); await p.keyboard.press('?');
 await ev(() => { window.view.cam.zoom = 0.07; window.view.cam.x = 0; window.view.cam.y = 0; }); await p.waitForTimeout(600);
 const sp = await ev(() => { const v = window.view, s = v.universe.systems[0]; return { x: v.toScreenX(s.x), y: v.toScreenY(s.y), name: s.name }; });
 await p.mouse.click(sp.x, sp.y); await p.waitForTimeout(400);
 console.log('sun card', await ev(() => document.querySelector('.solar-card').textContent.slice(0, 120)));
 await shot('13-sun-card');
 const zb = await ev(() => window.view.cam.zoom); await p.mouse.dblclick(sp.x, sp.y); await p.waitForTimeout(2000);
 console.log('dblclick sun zoom', zb.toFixed(4), '->', (await ev(() => window.view.cam.zoom)).toFixed(4));
 const n0 = await ev(() => window.view.universe.bodies.length);
 await ev((sys) => { window.addNote(`${sys}/Brand new idea.md`, `${sys}/${sys} note 1.md`, `${sys}/${sys} note 2.md`); window.view.rebuild(); }, sp.name); await p.waitForTimeout(150);
 await shot('14-birth-start'); await p.waitForTimeout(700); await shot('15-birth');
 console.log('births', n0, '->', await ev(() => window.view.universe.bodies.length), 'born', await ev(() => [...window.view.bornAt].filter(x => x > 0).length), 'intro', await ev(() => !!window.view.intro), 'orbit', await ev(() => { const u = window.view.universe, i = u.bodies.findIndex(b => b.name === 'Brand new idea'), s = u.systems[u.bodies[i].system]; return u.bodies[i].kind + ' ' + (s.bodies.indexOf(i) + 1) + ' of ' + s.bodies.length; }));
 await ev(() => { window.addNote('Brand new folder/First note.md', 'Root 1.md', 'Root 2.md'); window.view.rebuild(); window.view.cam.zoom = 0.07; }); await p.waitForTimeout(900);
 console.log('new sun born', await ev(() => [...window.view.sunBornAt].filter(x => x > 0).length));
 await shot('16-sun-birth');
 await ev(() => { window.plugin.settings.performance = 'battery'; }); await ev(() => frameStats()); await p.waitForTimeout(1500);
 console.log('battery quality', await ev(() => window.view.quality), 'frames', JSON.stringify(await ev(() => frameStats())));
 await ev(() => { window.plugin.settings.performance = 'auto'; });
 console.log('notices', JSON.stringify(await ev(() => window.notices || [])));
 console.log('errors:', JSON.stringify(errs)); await b.close(); })();
