// The look of empty space: layered parallax stars, twinkling bright stars,
// the odd shooting star, a vignette, and cached glow sprites used for suns,
// link lanes and their pulses. Everything expensive is drawn once into small
// canvases and reused every frame.

import { makeRng } from "./planets/noise";
import type { RGB } from "./planets/color";

const TILE = 512;

interface Layer {
	pattern: CanvasPattern | null;
	/** How much the layer moves with the camera; nearer layers move more. */
	parallax: number;
	/** How much the layer spreads out as you zoom in. */
	zoomSpread: number;
	alpha: number;
}

interface Twinkler {
	x: number;
	y: number;
	size: number;
	phase: number;
	speed: number;
	color: string;
	spikes: boolean;
}

interface Meteor {
	x: number;
	y: number;
	dx: number;
	dy: number;
	start: number;
	life: number;
	len: number;
}

/** Star colors, from cool blue to warm orange, mostly white. */
const STAR_TINTS: RGB[] = [
	[255, 255, 255], [255, 255, 255], [255, 255, 255], [205, 220, 255], [180, 200, 255], [255, 240, 215], [255, 215, 180],
];

function tile(seed: number, count: number, minSize: number, maxSize: number, minAlpha: number, maxAlpha: number, soft: boolean): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = TILE;
	const ctx = c.getContext("2d");
	if (!ctx) return c;
	const rng = makeRng(seed);
	for (let i = 0; i < count; i++) {
		const x = rng() * TILE, y = rng() * TILE;
		const s = minSize + Math.pow(rng(), 3) * (maxSize - minSize);
		const a = minAlpha + rng() * (maxAlpha - minAlpha);
		const t = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
		if (soft) {
			const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
			g.addColorStop(0, `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${a})`);
			g.addColorStop(0.35, `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${a * 0.35})`);
			g.addColorStop(1, `rgba(${t[0]}, ${t[1]}, ${t[2]}, 0)`);
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(x, y, s * 2.2, 0, Math.PI * 2);
			ctx.fill();
		} else {
			ctx.fillStyle = `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${a})`;
			ctx.fillRect(x, y, s, s);
		}
	}
	return c;
}

export class Starfield {
	private layers: Layer[] = [];
	private twinklers: Twinkler[] = [];
	private meteor: Meteor | null = null;
	private nextMeteor = 4;
	private vignette: HTMLCanvasElement | null = null;
	private vignetteSize = "";

	constructor(ctx: CanvasRenderingContext2D, seed = 7) {
		const specs: Array<[number, number, number, number, number, number, boolean, number, number, number]> = [
			// seed, count, sizes, alphas, soft, parallax, zoom spread, layer alpha
			[seed, 900, 0.6, 1.1, 0.15, 0.5, false, 0.006, 0.02, 1],
			[seed + 1, 260, 0.9, 1.6, 0.3, 0.75, false, 0.016, 0.05, 1],
			[seed + 2, 45, 0.9, 1.8, 0.45, 0.9, true, 0.035, 0.1, 1],
		];
		for (const [s, n, a, b, c, d, soft, parallax, zoomSpread, alpha] of specs) {
			this.layers.push({ pattern: ctx.createPattern(tile(s, n, a, b, c, d, soft), "repeat"), parallax, zoomSpread, alpha });
		}
		const rng = makeRng(seed + 99);
		for (let i = 0; i < 46; i++) {
			const t = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
			this.twinklers.push({
				x: rng(),
				y: rng(),
				size: 1 + Math.pow(rng(), 2) * 2.2,
				phase: rng() * Math.PI * 2,
				speed: 0.6 + rng() * 1.6,
				color: `${t[0]}, ${t[1]}, ${t[2]}`,
				spikes: i < 9,
			});
		}
	}

	/**
	 * Draws the still star layers (these only change when the camera moves, so
	 * the view caches them). `camX/camY` say how far the camera has travelled;
	 * `zoomRel` is the zoom compared with the whole-universe view.
	 */
	drawLayers(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, zoomRel: number) {
		const logZ = Math.log(Math.max(1e-3, zoomRel));
		const base = ctx.globalAlpha;
		for (const layer of this.layers) {
			if (!layer.pattern) continue;
			const s = Math.min(1.6, Math.max(0.75, Math.exp(logZ * layer.zoomSpread)));
			const ox = -camX * layer.parallax, oy = -camY * layer.parallax;
			// Spread from the middle of the screen, so zooming in feels like flying forward.
			layer.pattern.setTransform(new DOMMatrix().translate(w / 2, h / 2).scale(s).translate(-w / 2 + ox / s, -h / 2 + oy / s));
			ctx.globalAlpha = base * layer.alpha;
			ctx.fillStyle = layer.pattern;
			ctx.fillRect(0, 0, w, h);
		}
		ctx.globalAlpha = base;
	}

	/** The moving parts: twinkling bright stars and the odd shooting star. */
	drawLive(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, seconds: number, detail: number) {
		const base = ctx.globalAlpha;
		// A few bright stars twinkle; the brightest show soft cross spikes.
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		const glow = glowSprite();
		const p = 0.05;
		for (const t of this.twinklers) {
			const x = mod(t.x * w - camX * p, w), y = mod(t.y * h - camY * p, h);
			const tw = 0.55 + 0.45 * Math.sin(seconds * t.speed + t.phase);
			const a = base * tw;
			const r = t.size * 2.4;
			ctx.globalAlpha = a * 0.8;
			ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
			if (t.spikes && detail > 0) {
				const len = t.size * (5 + 3 * tw);
				ctx.globalAlpha = a * 0.5;
				ctx.drawImage(spikeSprite(), x - len, y - len, len * 2, len * 2);
			}
		}
		ctx.restore();
		ctx.globalAlpha = base;

		if (detail > 0) this.drawMeteor(ctx, w, h, seconds);
	}

	/** Now and then a shooting star streaks across the sky. */
	private drawMeteor(ctx: CanvasRenderingContext2D, w: number, h: number, seconds: number) {
		if (!this.meteor && seconds > this.nextMeteor) {
			const rng = Math.random;
			const angle = Math.PI * (0.15 + rng() * 0.25) * (rng() < 0.5 ? 1 : -1) + (rng() < 0.5 ? 0 : Math.PI);
			const speed = 700 + rng() * 500;
			this.meteor = {
				x: w * (0.1 + rng() * 0.8),
				y: h * (0.1 + rng() * 0.5),
				dx: Math.cos(angle) * speed,
				dy: Math.abs(Math.sin(angle)) * speed,
				start: seconds,
				life: 0.7 + rng() * 0.5,
				len: 90 + rng() * 110,
			};
			this.nextMeteor = seconds + 6 + rng() * 10;
		}
		const m = this.meteor;
		if (!m) return;
		const t = (seconds - m.start) / m.life;
		if (t >= 1 || t < 0) {
			this.meteor = null;
			return;
		}
		const fade = Math.sin(Math.PI * t);
		const hx = m.x + m.dx * (seconds - m.start), hy = m.y + m.dy * (seconds - m.start);
		const sp = Math.hypot(m.dx, m.dy);
		const tx = hx - (m.dx / sp) * m.len, ty = hy - (m.dy / sp) * m.len;
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		const g = ctx.createLinearGradient(hx, hy, tx, ty);
		g.addColorStop(0, `rgba(255, 255, 255, ${0.85 * fade})`);
		g.addColorStop(0.25, `rgba(190, 215, 255, ${0.35 * fade})`);
		g.addColorStop(1, "rgba(150, 180, 255, 0)");
		ctx.strokeStyle = g;
		ctx.lineWidth = 1.6;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo(hx, hy);
		ctx.lineTo(tx, ty);
		ctx.stroke();
		ctx.globalAlpha = fade;
		ctx.drawImage(glowSprite(), hx - 5, hy - 5, 10, 10);
		ctx.restore();
	}

	/** Darkens the corners a little, which draws the eye to the middle and adds depth. */
	drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const key = `${Math.round(w)}x${Math.round(h)}`;
		if (!this.vignette || this.vignetteSize !== key) {
			// Small and stretched: a vignette is perfectly smooth, so a low resolution is invisible.
			const c = document.createElement("canvas");
			c.width = 256;
			c.height = Math.max(32, Math.round((256 * h) / Math.max(1, w)));
			const vctx = c.getContext("2d");
			if (vctx) {
				const g = vctx.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) / 2);
				g.addColorStop(0, "rgba(2, 3, 10, 0)");
				g.addColorStop(1, "rgba(2, 3, 10, 0.6)");
				vctx.fillStyle = g;
				vctx.fillRect(0, 0, c.width, c.height);
			}
			this.vignette = c;
			this.vignetteSize = key;
		}
		ctx.drawImage(this.vignette, 0, 0, w, h);
	}
}

let glow: HTMLCanvasElement | null = null;

/** A white soft dot: tinted pulses, star twinkles and meteor heads. */
export function glowSprite(): HTMLCanvasElement {
	if (glow) return glow;
	glow = document.createElement("canvas");
	const S = 64;
	glow.width = glow.height = S;
	const ctx = glow.getContext("2d");
	if (ctx) {
		const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
		g.addColorStop(0, "rgba(255, 255, 255, 1)");
		g.addColorStop(0.18, "rgba(255, 255, 255, 0.55)");
		g.addColorStop(0.5, "rgba(255, 255, 255, 0.12)");
		g.addColorStop(1, "rgba(255, 255, 255, 0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, S, S);
	}
	return glow;
}

let spikes: HTMLCanvasElement | null = null;

/** Four thin rays, like light caught in a telescope. */
export function spikeSprite(): HTMLCanvasElement {
	if (spikes) return spikes;
	spikes = document.createElement("canvas");
	const S = 128;
	spikes.width = spikes.height = S;
	const ctx = spikes.getContext("2d");
	if (ctx) {
		const ray = (angle: number, len: number, width: number, alpha: number) => {
			ctx.save();
			ctx.translate(S / 2, S / 2);
			ctx.rotate(angle);
			const g = ctx.createLinearGradient(-len, 0, len, 0);
			g.addColorStop(0, "rgba(255, 255, 255, 0)");
			g.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`);
			g.addColorStop(1, "rgba(255, 255, 255, 0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(-len, 0);
			ctx.lineTo(0, -width);
			ctx.lineTo(len, 0);
			ctx.lineTo(0, width);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		};
		ray(0, S / 2, 1.6, 0.9);
		ray(Math.PI / 2, S / 2, 1.6, 0.9);
		ray(Math.PI / 4, S * 0.28, 1, 0.35);
		ray(-Math.PI / 4, S * 0.28, 1, 0.35);
	}
	return spikes;
}

const tinted = new Map<string, HTMLCanvasElement>();

/** A sun's bloom: a bright core fading into a wide colored glow. Cached per color. */
export function bloomSprite(c: RGB): HTMLCanvasElement {
	const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
	let s = tinted.get(key);
	if (s) return s;
	s = document.createElement("canvas");
	const S = 128;
	s.width = s.height = S;
	const ctx = s.getContext("2d");
	if (ctx) {
		const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
		const rgb = `${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}`;
		g.addColorStop(0, "rgba(255, 255, 255, 0.9)");
		g.addColorStop(0.06, `rgba(${rgb}, 0.75)`);
		g.addColorStop(0.2, `rgba(${rgb}, 0.25)`);
		g.addColorStop(0.5, `rgba(${rgb}, 0.07)`);
		g.addColorStop(1, `rgba(${rgb}, 0)`);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, S, S);
	}
	tinted.set(key, s);
	if (tinted.size > 200) tinted.delete(tinted.keys().next().value as string);
	return s;
}

function mod(a: number, n: number) {
	return ((a % n) + n) % n;
}
