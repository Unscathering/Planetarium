// The nebula behind the universe: soft clouds of gas and dark dust lanes,
// lit and tinted by the suns inside them. Painted once per universe at low
// resolution (clouds are soft, so scaling them up looks the same) and pure, so
// it can run in a background worker.

import { makeNoise } from "./planets/noise";

export interface NebulaJob {
	seed: number;
	width: number;
	height: number;
	/** Per sun, in texture pixels: x, y, reach, r, g, b (0..255), strength. */
	emitters: Float32Array;
	look: NebulaLook;
}

/** How a nebula style looks. Colors are 0..255. */
export interface NebulaLook {
	/** The gas's own color, blended between these two across space. */
	a: [number, number, number];
	b: [number, number, number];
	/** How strongly the gas's own color holds against the suns' tints. */
	base: number;
	/** Glow far from any sun. */
	floor: number;
	/** How much the suns light the gas. */
	sun: number;
	/** Cloud density thresholds: higher means thinner, patchier clouds. */
	lo: number;
	hi: number;
	/** Bright thin strands. */
	filaments: number;
	/** How dark the dust lanes are, and where they start. */
	dust: number;
	dustAt: number;
	/** Picks a different set of cloud shapes. */
	shape: number;
}

export type NebulaStyle = "classic" | "violet" | "emerald" | "crimson" | "golden" | "ice" | "sunset" | "smoke" | "wisps";

const look = (a: NebulaLook["a"], b: NebulaLook["b"], extra: Partial<NebulaLook> = {}): NebulaLook => ({
	a, b, base: 4, floor: 0.16, sun: 0.42, lo: 0.38, hi: 0.82, filaments: 0.35, dust: 0.75, dustAt: 0.52, shape: 0, ...extra,
});

export const NEBULA_STYLES: Record<NebulaStyle, { label: string; look: NebulaLook }> = {
	classic: { label: "Lit by the suns", look: look([30, 32, 100], [70, 22, 70], { base: 0.32, floor: 0.07, sun: 0.55 }) },
	violet: { label: "Violet veil", look: look([95, 35, 175], [190, 50, 160], { shape: 11 }) },
	emerald: { label: "Emerald clouds", look: look([20, 150, 120], [80, 175, 60], { shape: 23 }) },
	crimson: { label: "Crimson glow", look: look([200, 30, 55], [230, 60, 90], { shape: 37 }) },
	golden: { label: "Golden dust", look: look([215, 165, 70], [175, 100, 35], { lo: 0.34, dust: 0.92, dustAt: 0.48, shape: 41 }) },
	ice: { label: "Ice blue", look: look([60, 140, 230], [150, 210, 245], { floor: 0.14, shape: 53 }) },
	sunset: { label: "Sunset", look: look([240, 120, 45], [120, 40, 165], { shape: 67 }) },
	smoke: { label: "Smoky clouds", look: look([85, 90, 125], [120, 95, 100], { floor: 0.24, lo: 0.24, hi: 0.6, dust: 1, dustAt: 0.4, filaments: 0.1, shape: 79 }) },
	wisps: { label: "Faint wisps", look: look([100, 125, 200], [170, 135, 215], { floor: 0.15, lo: 0.6, hi: 0.95, filaments: 1.2, dust: 0.45, shape: 97 }) },
};

/** Values per emitter in NebulaJob.emitters. */
export const EMITTER_STRIDE = 7;

const smooth = (a: number, b: number, v: number) => {
	const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
	return t * t * (3 - 2 * t);
};

export function computeNebulaPixels(job: NebulaJob): Uint8ClampedArray {
	const { width: w, height: h, emitters: em, look: L } = job;
	const base3 = makeNoise(job.seed ^ 0x6e6562);
	// Each octave is turned a little, so the noise's square grid never shows as straight edges.
	const ROT = 0.62, cr = Math.cos(ROT), sr = Math.sin(ROT);
	const n = {
		noise: base3.noise,
		fbm(x: number, y: number, z: number, octaves: number) {
			let sum = 0, amp = 0.5, norm = 0;
			for (let i = 0; i < octaves; i++) {
				sum += amp * base3.noise(x, y, z);
				norm += amp;
				amp *= 0.5;
				const nx = (x * cr - y * sr) * 2.03, ny = (x * sr + y * cr) * 2.03;
				x = nx + 17.1;
				y = ny + 3.7;
				z *= 2.03;
			}
			return sum / norm;
		},
	};
	const count = em.length / EMITTER_STRIDE;
	const out = new Uint8ClampedArray(w * h * 4);
	// Noise features are sized by the texture, so clouds look alike at any resolution.
	const scale = 3.2 / Math.max(w, h);
	// A deep base tint for the gas far from any sun: blue to violet, varying across space.
	const z = (job.seed % 1000) * 0.37 + L.shape * 1.913;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const qx = x * scale, qy = y * scale;
			// Warp the coordinates by noise so clouds billow and curl instead of looking blotchy.
			const wx = n.fbm(qx + 5.2, qy + 1.3, z, 3) - 0.5;
			const wy = n.fbm(qx + 1.7, qy + 9.2, z, 3) - 0.5;
			const cloud = n.fbm(qx * 1.6 + wx * 2.4, qy * 1.6 + wy * 2.4, z + 3, 5);
			let density = smooth(L.lo, L.hi, cloud);
			// Bright thin filaments where the warped noise folds over.
			const fil = 1 - Math.abs(n.fbm(qx * 3.1 + wx * 3, qy * 3.1 + wy * 3, z + 7, 4) - 0.5) * 2;
			density += Math.pow(fil, 6) * L.filaments * smooth(0.3, 0.6, cloud);
			// Dark dust lanes cut through the glow.
			const dust = smooth(L.dustAt, L.dustAt + 0.2, n.fbm(qx * 2.2 - wy * 1.5, qy * 2.2 + wx * 1.5, z + 11, 4));
			density *= 1 - dust * L.dust;

			// Light from the suns: each one lights and tints the gas around it.
			let r = 0, g = 0, b = 0, lit = 0;
			for (let i = 0; i < count; i++) {
				const o = i * EMITTER_STRIDE;
				const dx = x - em[o], dy = y - em[o + 1], reach = em[o + 2];
				const d2 = (dx * dx + dy * dy) / (reach * reach);
				if (d2 > 9) continue;
				const k = em[o + 6] * Math.exp(-d2 * 1.4);
				r += em[o + 3] * k;
				g += em[o + 4] * k;
				b += em[o + 5] * k;
				lit += k;
			}
			const hueMix = n.noise(qx * 0.9, qy * 0.9, z + 21);
			const baseR = L.a[0] + (L.b[0] - L.a[0]) * hueMix, baseG = L.a[1] + (L.b[1] - L.a[1]) * hueMix, baseB = L.a[2] + (L.b[2] - L.a[2]) * hueMix;
			const base = L.base;
			const tw = lit + base;
			r = (r + baseR * base) / tw;
			g = (g + baseG * base) / tw;
			b = (b + baseB * base) / tw;
			const light = L.floor + L.sun * Math.min(1.2, lit);

			// Fade to black at the texture's edge so it blends into empty space.
			const ex = Math.min(x, w - 1 - x) / (w * 0.12), ey = Math.min(y, h - 1 - y) / (h * 0.12);
			const edge = smooth(0, 1, Math.min(1, ex)) * smooth(0, 1, Math.min(1, ey));
			const v = density * light * edge;
			const p = (y * w + x) * 4;
			out[p] = r * v;
			out[p + 1] = g * v;
			out[p + 2] = b * v;
			out[p + 3] = 255;
		}
	}
	return out;
}
