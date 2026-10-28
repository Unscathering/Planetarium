// Records the README clips from the web demo, frame by frame with a fake clock,
// so they come out smooth however slow the machine is.
//   node demo/build.mjs && node tools/media/record.cjs <out dir> [clip names...]
// Writes <name>.mp4 (full quality) and <name>.gif (small, for the README).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30, W = 1280, H = 720;
const out = path.resolve(process.argv[2] || 'docs/media');
const only = process.argv.slice(3);
const page = 'file://' + path.resolve(__dirname, '../../demo/dist/index.html');

// Replaces the page's clock: time only moves when the recorder steps it.
const fakeClock = () => {
	let now = 0; let queue = [];
	performance.now = () => now;
	window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
	window.cancelAnimationFrame = () => {};
	window.__step = (ms) => { now += ms; const run = queue; queue = []; for (const cb of run) cb(now); };
};

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Each clip: setup runs once, frame(i, n) moves the camera; seconds is the length.
const CLIPS = {
	// The opening animation, then a slow drift across the whole universe.
	universe: { seconds: 9, universe: 761889, intro: true, gifSeconds: 7,
		// Frame the suns only (lone rogue planets far out would push them off-center).
		setup: `{ const v = window.view, u = v.universe; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
			for (const s of u.systems) { x0 = Math.min(x0, s.x - s.extent); x1 = Math.max(x1, s.x + s.extent); y0 = Math.min(y0, s.y - s.extent * 0.5); y1 = Math.max(y1, s.y + s.extent * 0.5); }
			const cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(v.width / (x1 - x0), v.height / (y1 - y0)) * 0.95 };
			window.__cam = cam; Object.assign(v.cam, cam, { zoom: cam.zoom * 1.6 }); }`,
		// The opening animation aims at its own framing, so keep it on ours.
		frame: (i, n) => `{ const v = window.view, c = window.__cam; if (v.intro) { v.intro.cam = c; v.cam.x = c.x; v.cam.y = c.y; } if (${i} > 100) v.cam.zoom *= 1.0012; }` },
	// From the whole universe into the biggest system, then a slow push in.
	flyin: { seconds: 9, universe: 761889,
		setup: `{ const v = window.view, u = v.universe; let best = 0; u.systems.forEach((s, i) => { if (s.bodies.length > u.systems[best].bodies.length) best = i; });
			window.__from = { ...v.cam }; window.__to = v.fitSystem(best); }`,
		frame: (i, n) => { const t = Math.min(1, i / (n * 0.6)); const k = ease(t);
			return `{ const v = window.view, a = window.__from, b = window.__to, k = ${k};
				v.cam.x = a.x + (b.x - a.x) * k; v.cam.y = a.y + (b.y - a.y) * k; v.cam.zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k) * ${1 + Math.pow(Math.max(0, i / n - 0.55) / 0.45, 1.5) * 1.2}; }`; } },
	// Close to a ringed planet as it travels its orbit, day and night sweeping over it.
	closeup: { seconds: 9, universe: 761889, settings: { planetScale: 2.4, orbitSpeed: 2.5 },
		setup: `{ const v = window.view, u = v.universe;
			const pick = u.bodies.findIndex((b) => b.kind === 'planet' && b.spec.rings !== 'none' && b.spec.rings !== 'colossal' && b.moons.length === 0 && b.spec.type === 'gas');
			v.focusBody(pick < 0 ? 0 : pick); v.flight = null; v.cam.zoom = 2.2; }`,
		frame: (i, n) => `{ window.view.cam.zoom *= ${Math.pow(1.6 / 2.2, 1 / 270)}; }` },
	// Hovering planets in a system: the cards with their looks and rarity.
	cards: { seconds: 10, universe: 761889, ui: true, settings: { planetScale: 1.8, orbitSpeed: 0.4 },
		setup: `{ const v = window.view, u = v.universe; let best = 0; u.systems.forEach((s, i) => { if (s.bodies.length > u.systems[best].bodies.length) best = i; });
			Object.assign(v.cam, v.fitSystem(best)); v.cam.zoom *= 2.2; window.__sys = best; }`,
		hover: true, gifCrop: 'crop=820:460:230:150,' },
};

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const browser = await chromium.launch();
	for (const [name, clip] of Object.entries(CLIPS)) {
		if (only.length && !only.includes(name)) continue;
		const p = await browser.newPage({ viewport: { width: W, height: H } });
		p.on('pageerror', (e) => console.log(name, 'error', e.message));
		await p.addInitScript(fakeClock);
		await p.goto(`${page}?universe=${clip.universe}`);
		await p.addStyleTag({ content: clip.ui
			? '.demo-bar, .demo-hint, #demo-actions, .solar-banner { display: none !important; }'
			: '.demo-bar, .demo-hint, #demo-actions, .solar-banner, .solar-search, .solar-filter { display: none !important; }' });
		await p.evaluate((s) => { Object.assign(window.plugin.settings, { performance: 'high', playIntro: true, ...s }); for (const k of Object.keys(s)) window.view.settingsChanged(k); }, clip.settings || {});
		// Let the universe build and its images paint (they paint in real time, in the background).
		const step = (ms) => p.evaluate((ms) => window.__step(ms), ms);
		for (let k = 0; k < 20; k++) { await step(16); await p.waitForTimeout(50); }
		if (!clip.intro) { await p.evaluate(() => window.view.endIntro()); }
		if (clip.setup) await p.evaluate(clip.setup);
		// Warm up so every planet image is ready before the first frame is kept.
		for (let k = 0; k < (clip.intro ? 1 : 40); k++) { await step(1000 / FPS); await p.waitForTimeout(clip.intro ? 0 : 60); }
		if (clip.intro) { await p.waitForTimeout(3000); }
		const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), `clip-${name}-`));
		const n = clip.seconds * FPS;
		const targets = [];
		for (let i = 0; i < n; i++) {
			if (clip.frame) await p.evaluate(clip.frame(i, n));
			if (clip.hover && i % 75 === 10) {
				// Glide the mouse to another planet in view.
				const pt = await p.evaluate((k) => { const v = window.view, s = v.universe.systems[window.__sys];
					const vis = s.bodies.filter((b) => v.screen.r[b] > 4 && v.screen.x[b] > 200 && v.screen.x[b] < 900 && v.screen.y[b] > 150 && v.screen.y[b] < 560);
					const b = vis[(k * 5) % Math.max(1, vis.length)]; return b === undefined ? null : { x: v.screen.x[b], y: v.screen.y[b] }; }, targets.length);
				if (pt) { targets.push(pt); await p.mouse.move(pt.x, pt.y, { steps: 6 }); }
			}
			await step(1000 / FPS);
			await p.waitForTimeout(clip.hover ? 25 : 0);
			await p.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) });
		}
		await p.close();
		const mp4 = path.join(out, `${name}.mp4`), gif = path.join(out, `${name}.gif`);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4]);
		// GIF: smaller, fewer frames, one shared palette tuned for the clip.
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf',
			(clip.gifCrop || '') + 'fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-t', String(clip.gifSeconds || 6), gif]);
		fs.rmSync(dir, { recursive: true, force: true });
		console.log(name, (fs.statSync(mp4).size / 1e6).toFixed(1) + ' MB mp4', (fs.statSync(gif).size / 1e6).toFixed(1) + ' MB gif');
	}
	await browser.close();
})();
