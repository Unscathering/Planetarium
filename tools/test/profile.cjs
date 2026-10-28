// CPU profile of the stress vault. Usage: node tools/test/profile.cjs [far|zoom]
// node profile.cjs page.html scenario   (scenario: far | zoom)
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
 await p.goto('file://' + __dirname + '/' + 'stress.html'); await p.waitForFunction(() => window.view && window.view.universe);
 await p.waitForTimeout(1500);
 if (process.argv[2] === 'zoom') { await p.evaluate(() => { const v = window.view; Object.assign(v.cam, v.fitSystem(0)); v.cam.zoom *= 3; window.plugin.settings.planetScale = 2.5; }); await p.waitForTimeout(1500); }
 const c = await p.context().newCDPSession(p); await c.send('Profiler.enable'); await c.send('Profiler.start');
 await p.waitForTimeout(3000);
 const { profile } = await c.send('Profiler.stop');
 const self = new Map(); const dt = profile.timeDeltas; const idx = new Map(profile.nodes.map((n, i) => [n.id, n]));
 const counts = new Map(); profile.samples.forEach((s, i) => counts.set(s, (counts.get(s) || 0) + (dt[i] || 0)));
 let total = 0; for (const [id, t] of counts) { const n = idx.get(id); const k = n.callFrame.functionName + ' ' + (n.callFrame.url.split('/').pop()) + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + t); total += t; }
 const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n);
 const by = new Map(); for (const [id, t] of counts) { const n = idx.get(id); if (n.callFrame.functionName !== 'drawImage') continue; const pa = parent.get(id); const k = 'drawImage <- ' + (pa ? pa.callFrame.functionName + ':' + pa.callFrame.lineNumber : '?'); by.set(k, (by.get(k) || 0) + t); }
 [...by].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, t]) => console.log((t / 1000).toFixed(0).padStart(6) + 'ms', k));
 console.log(await p.evaluate(() => { const v = window.view; let n = 0, sum = 0, big = 0; for (const r of v.screen.r) if (r >= 0) { n++; sum += r; if (r > 30) big++; } return { onScreen: n, avgR: Math.round(sum / n), over30: big, dpr: v.dpr, w: v.width, h: v.height }; }));
 [...self].sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, t]) => console.log((t / 1000).toFixed(0).padStart(6) + 'ms', (100 * t / total).toFixed(1).padStart(5) + '%', k));
 await b.close(); })();
