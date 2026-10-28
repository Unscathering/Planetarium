// Pure pixel work for planets and moons, with no DOM, so it can run in a
// background worker. A planet is made of layers that are combined at draw
// time: a flat-lit "day" surface, an optional "glow" layer (city lights, lava,
// aurora, lightning) and a shadow mask that is turned to face the sun.

import { makeNoise, makeRng } from "./noise";
import { RGB, clamp01, hexToRgb, hueRotate, smoothstep } from "./color";
import { Surface, prepare, sampleSurface } from "./surface";
import { PLANET_TYPES, PlanetSpec, STORM_STRENGTH, Vec3 } from "./types";

export interface SphereLayers {
	size: number;
	/** RGBA, flat lit: shading comes from the shadow mask at draw time. */
	day: Uint8ClampedArray;
	/** RGBA light the surface gives off itself (lava, aurora, lightning), or null if none. */
	glow: Uint8ClampedArray | null;
	/** RGBA city lights, shown only on the night side; null if the planet has none. */
	lights: Uint8ClampedArray | null;
	/** How shiny the surface is on average (water, ice, crystal), 0..1. */
	shine: number;
}

/** A color on the far side of the color wheel, used for contrasting rims and rings. */
export function contrast(c: RGB): RGB {
	const out: RGB = [c[0], c[1], c[2]];
	hueRotate(out, 150);
	return [Math.min(255, out[0] * 1.1 + 20), Math.min(255, out[1] * 1.1 + 20), Math.min(255, out[2] * 1.1 + 20)];
}

export function atmosphereColor(spec: PlanetSpec): RGB {
	const atmo = hexToRgb(PLANET_TYPES[spec.type].palettes[spec.palette].atmo);
	return spec.atmosphere === "rim" ? contrast(atmo) : atmo;
}

const RIM_STRENGTH: Record<PlanetSpec["atmosphere"], number> = { none: 0, thin: 0.4, thick: 0.75, aurora: 0.55, storm: 0.5, rim: 0.9, haze: 0.6, airglow: 0.3 };

/** Cloud cover (0..1) for a point, in the planet's cloud style. */
function cloudCover(spec: PlanetSpec, n: ReturnType<typeof makeNoise>, x: number, y: number, z: number, lat: number, cyclones: Vec3[]): number {
	// Stormier weather means more sky covered: the cloud thresholds drop.
	const b = (STORM_STRENGTH[spec.storm] - 1) * 0.07;
	switch (spec.clouds) {
		case "banded": {
			// Bands of cloud that follow the latitude but wave and break up like real weather fronts.
			const w = n.fbm(x * 2.2 + 5, lat * 2.2, z * 2.2, 4) - 0.5;
			return smoothstep(0.5 - b, 0.62 - b, n.fbm(x * 2.2 + w * 1.6 + 31, lat * 6 + w * 2.5 + 7, z * 2.2, 5)) * 0.9;
		}
		case "patchy": {
			// Big cloud masses with soft, torn edges rather than flat cut-out shapes.
			const body = n.fbm(x * 1.4 + 31, y * 1.4 + 7, z * 1.4, 4);
			const edge = n.fbm(x * 7 + 3, y * 7, z * 7, 3) - 0.5;
			return smoothstep(0.55 - b, 0.66 - b, body + edge * 0.08) * 0.95;
		}
		case "storms": {
			let cover = smoothstep(0.55 - b, 0.68 - b, n.fbm(x * 2.4 + 31, lat * 5 + 7, z * 2.4, 5)) * 0.7;
			// Spiral cyclones.
			for (const c of cyclones) {
				const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
				if (d < c.z) {
					const arm = Math.sin(Math.atan2(dy, dx) * 2 + d * 30);
					cover = Math.max(cover, smoothstep(0.2, 0.9, arm) * smoothstep(c.z, c.z * 0.15, d) * 0.95);
				}
			}
			return cover;
		}
		case "cirrus": {
			// High thin cloud drawn out into long streaks by fast winds: translucent, never solid.
			const w = n.fbm(x * 1.5 + 3, lat * 2, z * 1.5, 3) - 0.5;
			const streak = n.fbm(x * 1.2 + w * 1.2 + 31, lat * 16 + w * 6, z * 1.2, 4);
			return smoothstep(0.55 - b, 0.7 - b, streak) * (0.45 + 0.25 * n.noise(x * 20, y * 20, z * 20));
		}
		case "cumulus": {
			// Fields of small puffy fair-weather clouds, scattered like cotton over large regions.
			const field = smoothstep(0.42 - b, 0.58 - b, n.fbm(x * 1.6 + 7, y * 1.6, z * 1.6, 4));
			if (field <= 0) return 0;
			const puffs = n.fbm(x * 9 + 2, y * 9, z * 9, 4);
			return field * smoothstep(0.52 - b * 0.5, 0.64, puffs) * 0.9;
		}
		case "wispy":
			return smoothstep(0.52 - b, 0.66 - b, n.fbm(x * 2.4 + 31, lat * 5 + 7, z * 2.4, 5)) * 0.9;
		default:
			return 0;
	}
}

/**
 * Paints a planet's surface layers into square pixel buffers. `lumps` above 0
 * gives small bodies an irregular outline (it dips inward by up to that much).
 */
export function computeSphereLayers(spec: PlanetSpec, size: number, lumps = 0): SphereLayers {
	const day = new Uint8ClampedArray(size * size * 4);
	const glow = new Uint8ClampedArray(size * size * 4);
	const lights = spec.type === "machine" || spec.features.includes("cityLights") || spec.features.includes("bioluminescence")
		? new Uint8ClampedArray(size * size * 4)
		: null;
	let glowing = false, shineSum = 0, count = 0;
	const P = prepare(spec);
	const cosT = Math.cos(spec.axialTilt), sinT = Math.sin(spec.axialTilt);
	const rim = RIM_STRENGTH[spec.atmosphere];
	const rimColor = atmosphereColor(spec);
	const S: Surface = { color: [0, 0, 0], emit: [0, 0, 0], city: 0, bio: 0, specular: 0, nx: 0, ny: 0, nz: 0 };
	// Warm sodium-lamp light, nudged toward the planet's own accent color.
	const cityColor: RGB = [255 * 0.8 + P.accent[0] * 0.2, 196 * 0.8 + P.accent[1] * 0.2, 120 * 0.8 + P.accent[2] * 0.2];
	const cloudNoise = spec.clouds !== "none" || spec.atmosphere === "storm" ? makeNoise(spec.seed ^ 0x51ed270b) : null;
	const crng = makeRng(spec.seed ^ 0xc10d);
	// Cyclone centers on the visible side: x, y and radius (stored in z).
	const cyclones: Vec3[] = spec.clouds === "storms"
		? [0, 1].map(() => ({ x: (crng() - 0.5) * 1.1, y: (crng() - 0.5) * 1.1, z: 0.22 + crng() * 0.15 }))
		: [];
	const lumpNoise = lumps > 0 ? makeNoise(spec.seed ^ 0x10b5) : null;
	const crystal = spec.type === "crystal";

	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const x = ((px + 0.5) / size) * 2 - 1;
			const y = ((py + 0.5) / size) * 2 - 1;
			const d2 = x * x + y * y;
			let edge = 1;
			if (lumpNoise) {
				const a = Math.atan2(y, x);
				edge = 1 - lumps * lumpNoise.fbm(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4, 0.5, 3);
			}
			if (d2 > edge * edge) continue;
			const z = Math.sqrt(1 - d2);
			const lat = x * sinT + y * cosT;
			sampleSurface(P, x, y, z, lat, S);

			// Crystal facets keep their own relief, since the shadow mask only knows the round shape.
			const relief = crystal ? 0.55 + 0.45 * clamp01(S.nz) : 1;
			let r = S.color[0] * relief, g = S.color[1] * relief, b = S.color[2] * relief;
			let er = S.emit[0], eg = S.emit[1], eb = S.emit[2];
			let city = S.city, bio = S.bio;

			if (cloudNoise && spec.clouds !== "none") {
				const cover = cloudCover(spec, cloudNoise, x, y, z, lat, cyclones);
				// Clouds are puffy, not flat white: thicker parts brighter, thin parts greyer.
				// Heavy weather brings thick grey storm clouds.
				const gloom = Math.max(0, STORM_STRENGTH[spec.storm] - 1) * 0.22;
				const puff = (0.84 + 0.16 * cloudNoise.fbm(x * 16 + 2, y * 16, z * 16, 3) + 0.06 * cover) * (1 - gloom * cover);
				r += (250 * puff - r) * cover;
				g += (250 * puff - g) * cover;
				b += (255 * puff - b) * cover;
				er *= 1 - cover;
				eg *= 1 - cover;
				eb *= 1 - cover;
				// Thin cloud lets a little city light through, thick cloud none.
				city *= 1 - Math.min(1, cover * 1.3);
				bio *= 1 - Math.min(1, cover * 1.3);
			}
			if (cloudNoise && spec.atmosphere === "storm") {
				// Storm clouds, with lightning that shows up on the night side.
				const w = cloudNoise.fbm(x * 1.5 + 4, lat * 3, z * 1.5, 3);
				const sb = (STORM_STRENGTH[spec.storm] - 1) * 0.08;
				const cover = smoothstep(0.46 - sb, 0.58 - sb, cloudNoise.fbm(x * 2 + w * 2 + 11, lat * 4 + w * 2, z * 2, 5)) * 0.85;
				r += (124 - r) * cover;
				g += (130 - g) * cover;
				b += (150 - b) * cover;
				// Lightning lights the clouds from inside in soft patches (more the wilder the storm),
				// never as single bright pixels.
				const fl = 0.8 + (1 - STORM_STRENGTH[spec.storm]) * 0.08;
				const cell = cloudNoise.fbm(x * 4.5 + 5, y * 4.5, z * 4.5, 2);
				const flash = smoothstep(fl + 0.04, fl + 0.2, cell) * cover * (0.7 + 0.3 * cloudNoise.noise(x * 18, y * 18, z * 18));
				er += 150 * flash;
				eg += 175 * flash;
				eb += 235 * flash;
			}
			if (rim > 0) {
				const e = Math.pow(1 - z, 2.2) * rim;
				r += rimColor[0] * e;
				g += rimColor[1] * e;
				b += rimColor[2] * e;
			}
			if (spec.atmosphere === "haze") {
				// A thick tinted haze: everything softened and pulled toward the sky's color.
				const k = 0.22 + 0.25 * Math.pow(1 - z, 1.5);
				r += (rimColor[0] - r) * k;
				g += (rimColor[1] - g) * k;
				b += (rimColor[2] - b) * k;
			}
			if (spec.atmosphere === "airglow") {
				// A thin shell of glowing gas at the edge of the sky, seen best on the night side.
				const a = Math.pow(Math.max(0, 1 - z), 3.5) * 1.2;
				er += rimColor[0] * a;
				eg += rimColor[1] * a;
				eb += rimColor[2] * a;
			}
			if (spec.atmosphere === "aurora") {
				const a = smoothstep(0.72, 0.95, Math.abs(lat)) * P.noise.noise(x * 7, y * 7 + 3, z * 7) * 1.4;
				er += P.accent[0] * a;
				eg += P.accent[1] * a;
				eb += P.accent[2] * a;
			}

			const i = (py * size + px) * 4;
			// Soft one-pixel edge so the outline is not jagged.
			const alpha = 255 * clamp01((edge - Math.sqrt(d2)) * size * 0.5);
			day[i] = r;
			day[i + 1] = g;
			day[i + 2] = b;
			day[i + 3] = alpha;
			if (er > 1 || eg > 1 || eb > 1) {
				glowing = true;
				glow[i] = er;
				glow[i + 1] = eg;
				glow[i + 2] = eb;
				glow[i + 3] = alpha;
			}
			if (lights && city + bio > 0.004) {
				// City light and glowing life share the night layer; the stronger one sets the color.
				const total = city + bio, bc = P.bioColor;
				lights[i] = (cityColor[0] * city + bc[0] * bio) / total;
				lights[i + 1] = (cityColor[1] * city + bc[1] * bio) / total;
				lights[i + 2] = (cityColor[2] * city + bc[2] * bio) / total;
				lights[i + 3] = alpha * Math.min(1, total);
			}
			shineSum += S.specular;
			count++;
		}
	}
	return { size, day, glow: glowing ? glow : null, lights, shine: count ? shineSum / count : 0 };
}

/** The standard light used for masks: from the right (+x), a little toward the viewer. */
export const MASK_LIGHT: Vec3 = { x: 1, y: 0, z: 0.35 };

/** How lit a point on the sphere is for a light direction; `hard` sharpens the day/night line. */
function lighting(x: number, y: number, z: number, lx: number, ly: number, lz: number, hard: boolean) {
	const ndl = x * lx + y * ly + z * lz;
	const wrap = hard ? smoothstep(-0.04, 0.12, ndl) : smoothstep(-0.22, 0.3, ndl);
	const lit = wrap * (0.3 + 0.7 * clamp01(ndl));
	// City lights switch on past the day/night line and are fully lit a little way into the night.
	const dark = smoothstep(0.1, -0.2, ndl);
	return { shade: Math.min(1, 0.05 + lit * 1.05), night: 1 - 0.75 * wrap, dark };
}

/**
 * Shadow and night masks for a round body lit by `light` (default MASK_LIGHT).
 * shadow: black, alpha = how much to darken. night: white, alpha = how much
 * self-made light shows (full on the night side, a quarter by day).
 */
export function computeMasks(
	size: number,
	hard: boolean,
	light: Vec3 = MASK_LIGHT
): { shadow: Uint8ClampedArray; night: Uint8ClampedArray; dark: Uint8ClampedArray } {
	const shadow = new Uint8ClampedArray(size * size * 4);
	const night = new Uint8ClampedArray(size * size * 4);
	const dark = new Uint8ClampedArray(size * size * 4);
	const len = Math.hypot(light.x, light.y, light.z) || 1;
	const lx = light.x / len, ly = light.y / len, lz = light.z / len;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const x = ((px + 0.5) / size) * 2 - 1;
			const y = ((py + 0.5) / size) * 2 - 1;
			const d2 = x * x + y * y;
			if (d2 > 1) continue;
			const { shade, night: n, dark: dk } = lighting(x, y, Math.sqrt(1 - d2), lx, ly, lz, hard);
			const edge = clamp01((1 - Math.sqrt(d2)) * size * 0.5);
			const i = (py * size + px) * 4;
			shadow[i + 3] = 255 * (1 - shade) * edge;
			night[i] = night[i + 1] = night[i + 2] = 255;
			night[i + 3] = 255 * n * edge;
			dark[i] = dark[i + 1] = dark[i + 2] = 255;
			dark[i + 3] = 255 * dk * edge;
		}
	}
	return { shadow, night, dark };
}

/** Combines the layers for one fixed light, giving a finished lit sphere (used for previews and checks). */
export function computeLitPixels(spec: PlanetSpec, size: number, light: Vec3, hard: boolean, lumps = 0): Uint8ClampedArray {
	const layers = computeSphereLayers(spec, size, lumps);
	const { shadow, night, dark } = computeMasks(size, hard, light);
	const out = layers.day;
	for (let i = 0; i < out.length; i += 4) {
		const s = 1 - shadow[i + 3] / 255;
		out[i] *= s;
		out[i + 1] *= s;
		out[i + 2] *= s;
		if (layers.glow) {
			const n = night[i + 3] / 255;
			out[i] += layers.glow[i] * n;
			out[i + 1] += layers.glow[i + 1] * n;
			out[i + 2] += layers.glow[i + 2] * n;
		}
		if (layers.lights) {
			const k = (dark[i + 3] / 255) * (layers.lights[i + 3] / 255);
			out[i] += layers.lights[i] * k;
			out[i + 1] += layers.lights[i + 1] * k;
			out[i + 2] += layers.lights[i + 2] * k;
		}
	}
	return out;
}
