// Records the 30-second trailer from the web demo, shot by shot, frame by frame
// with a fake clock, then joins the shots with short fades.
//   node demo/build.mjs && node tools/media/trailer.cjs <out dir> [shot numbers...]
// Writes trailer.mp4 (1920x1080, 30 fps, no sound) and keeps each shot as shot-N.mp4.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FPS = 30, W = 1920, H = 1080;
const out = path.resolve(process.argv[2] || 'tools/test/out/trailer');
const only = process.argv.slice(3).map(Number);
const page = 'file://' + path.resolve(__dirname, '../../demo/dist/index.html');

/** The big universe the trailer opens on and flies into. */
const BIG = 15838;

const fakeClock = () => {
	let now = 0; let queue = [];
	performance.now = () => now;
	window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
	window.cancelAnimationFrame = () => {};
	window.__step = (ms) => { now += ms; const run = queue; queue = []; for (const cb of run) cb(now); };
};

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Frames the suns only (lone rogue planets far out would push them off-center).
const FRAME_SUNS = `{ const v = window.view, u = v.universe; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
	for (const s of u.systems) { x0 = Math.min(x0, s.x - s.extent); x1 = Math.max(x1, s.x + s.extent); y0 = Math.min(y0, s.y - s.extent * 0.5); y1 = Math.max(y1, s.y + s.extent * 0.5); }
	window.__cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(v.width / (x1 - x0), v.height / (y1 - y0)) * 1.12 }; }`;
const BIGGEST = `{ const u = window.view.universe; let best = 0; u.systems.forEach((s, i) => { if (s.bodies.length > u.systems[best].bodies.length) best = i; }); window.__sys = best; }`;

// A planet worth following: `test` is a body test, as source text.
const follow = (test, zoom) => `{ const v = window.view, u = v.universe;
	const i = u.bodies.findIndex((b) => b.kind === 'planet' && (${test}));
	v.focusBody(i < 0 ? 0 : i); v.flight = null; v.cam.zoom = ${zoom}; }`;

// Each shot: universe seed and size, settings, setup (once) and frame(i, n) (every frame).
const SHOTS = [
	// 1. A huge universe pops into place, then a slow drift.
	{ seconds: 6, universe: BIG, scale: 2.6, intro: true, setup: FRAME_SUNS + `{ const v = window.view; Object.assign(v.cam, window.__cam, { zoom: window.__cam.zoom * 1.6 }); }`,
		frame: (i) => `{ const v = window.view, c = window.__cam; if (v.intro) { v.intro.cam = c; v.cam.x = c.x; v.cam.y = c.y; } if (${i} > 110) v.cam.zoom *= 1.0016; }` },
	// 2-5. Four other universes, each with its own nebula.
	...[[837832, 'violet'], [2304038, 'emerald'], [1780393, 'sunset'], [3037141, 'ice']].map(([seed, nebula], k) => ({
		seconds: 1.25, universe: seed, scale: 1.8, settings: { nebulaStyle: nebula }, fade: k === 0 ? 'in' : 'cut',
		setup: FRAME_SUNS + `{ Object.assign(window.view.cam, window.__cam); window.view.cam.zoom *= 1.25; }`,
		frame: () => `{ window.view.cam.zoom *= 1.0022; }` })),
	// 6. From the whole big universe into its biggest system.
	{ seconds: 7, universe: BIG, scale: 2.6,
		setup: FRAME_SUNS + BIGGEST + `{ const v = window.view; Object.assign(v.cam, window.__cam); window.__from = { ...v.cam }; window.__to = v.fitSystem(window.__sys); }`,
		frame: (i, n) => { const k = ease(Math.min(1, i / (n * 0.7))); const push = 1 + Math.pow(Math.max(0, i / n - 0.62) / 0.38, 1.6) * 0.9;
			return `{ const v = window.view, a = window.__from, b = window.__to, k = ${k};
				v.cam.x = a.x + (b.x - a.x) * k; v.cam.y = a.y + (b.y - a.y) * k; v.cam.zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k) * ${push}; }`; } },
	// 7. Riding along with a ringed giant.
	{ seconds: 3, universe: BIG, scale: 2.6, settings: { planetScale: 2.6, orbitSpeed: 2.2 },
		setup: follow(`b.spec.type === 'gas' && b.spec.rings !== 'none' && b.spec.rings !== 'colossal' && b.moons.length === 0`, 3.2),
		frame: () => `{ window.view.cam.zoom *= 0.9985; }` },
	// 8. A living world with moons.
	{ seconds: 2.5, universe: BIG, scale: 2.6, fade: 'cut', settings: { planetScale: 2.6, orbitSpeed: 2.2 },
		setup: follow(`(b.spec.type === 'terran' || b.spec.type === 'ocean') && b.spec.moons.length >= 2`, 3.4),
		frame: () => `{ window.view.cam.zoom *= 0.9988; }` },
	// 9. Something rare: a colossal ring system, or a lava world if there is none.
	{ seconds: 2.5, universe: BIG, scale: 2.6, fade: 'cut', settings: { planetScale: 2.6, orbitSpeed: 2.2 },
		setup: follow(`b.spec.rings === 'colossal' || b.spec.type === 'crystal'`, 2.4),
		frame: () => `{ window.view.cam.zoom *= 0.9988; }` },
	// 10. Hovering planets in a system: the cards with their rarity.
	{ seconds: 3.75, universe: BIG, scale: 2.6, ui: true, settings: { planetScale: 1.9, orbitSpeed: 0.4 },
		setup: BIGGEST + `{ const v = window.view; Object.assign(v.cam, v.fitSystem(window.__sys)); v.cam.zoom *= 2.4; }`, hover: 36, fade: 'out' },
];

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const browser = await chromium.launch();
	for (const [index, shot] of SHOTS.entries()) {
		const num = index + 1;
		if (only.length && !only.includes(num)) continue;
		const p = await browser.newPage({ viewport: { width: W, height: H } });
		p.on('pageerror', (e) => console.log(`shot ${num} error`, e.message));
		await p.addInitScript(fakeClock);
		await p.goto(`${page}?universe=${shot.universe}&scale=${shot.scale}`);
		await p.addStyleTag({ content: shot.ui
			? '.demo-bar, .demo-hint, #demo-actions, .solar-banner, .solar-search, .solar-filter { display: none !important; }'
			: '.demo-bar, .demo-hint, #demo-actions, .solar-banner, .solar-search, .solar-filter, .solar-card { display: none !important; }' });
		await p.evaluate((s) => { Object.assign(window.plugin.settings, { performance: 'high', ...s }); for (const k of Object.keys(s)) window.view.settingsChanged(k); }, shot.settings || {});
		const step = (ms) => p.evaluate((ms) => window.__step(ms), ms);
		// Build the universe, then wait for the nebula to paint.
		for (let k = 0; k < 20; k++) { await step(16); await p.waitForTimeout(50); }
		for (let k = 0; k < 100 && !(await p.evaluate(() => !!window.view.nebula)); k++) { await step(16); await p.waitForTimeout(100); }
		if (!shot.intro) await p.evaluate(() => window.view.endIntro());
		if (shot.setup) await p.evaluate(shot.setup);
		// Warm up so every planet image is ready before the first kept frame.
		if (shot.intro) await p.waitForTimeout(3000);
		else for (let k = 0; k < 45; k++) { await step(1000 / FPS); await p.waitForTimeout(70); }
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shot-${num}-`));
		const n = Math.round(shot.seconds * FPS);
		let target = 0;
		for (let i = 0; i < n; i++) {
			if (shot.frame) await p.evaluate(shot.frame(i, n));
			if (shot.hover && i % shot.hover === 4) {
				// Glide the mouse to another planet in view.
				const pt = await p.evaluate((k) => { const v = window.view, s = v.universe.systems[window.__sys];
					const vis = s.bodies.filter((b) => v.screen.r[b] > 5 && v.screen.x[b] > 450 && v.screen.x[b] < 1300 && v.screen.y[b] > 300 && v.screen.y[b] < 800);
					const b = vis[(k * 7) % Math.max(1, vis.length)]; return b === undefined ? null : { x: v.screen.x[b], y: v.screen.y[b] }; }, target++);
				if (pt) await p.mouse.move(pt.x, pt.y, { steps: 6 });
			}
			await step(1000 / FPS);
			await p.waitForTimeout(shot.hover ? 25 : 0);
			await p.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) });
		}
		await p.close();
		// Fade from and to black where the shot asks for it (default: a short dip on both ends).
		const fade = shot.fade || 'both', d = 0.25, end = (shot.seconds - d).toFixed(2);
		const fades = [];
		if (fade === 'both' || fade === 'in') fades.push(`fade=t=in:st=0:d=${d}`);
		if (fade === 'both' || fade === 'out') fades.push(`fade=t=out:st=${end}:d=${shot.seconds > 3 ? 0.5 : d}`);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
			...(fades.length ? ['-vf', fades.join(',')] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', path.join(out, `shot-${num}.mp4`)]);
		fs.rmSync(dir, { recursive: true, force: true });
		console.log(`shot ${num} done`);
	}
	await browser.close();
	// Join every shot in order.
	const list = path.join(out, 'shots.txt');
	fs.writeFileSync(list, SHOTS.map((_, i) => `file 'shot-${i + 1}.mp4'`).join('\n'));
	if (SHOTS.every((_, i) => fs.existsSync(path.join(out, `shot-${i + 1}.mp4`)))) {
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(out, 'trailer.mp4')]);
		console.log('trailer.mp4', (fs.statSync(path.join(out, 'trailer.mp4')).size / 1e6).toFixed(1), 'MB');
	}
})();
