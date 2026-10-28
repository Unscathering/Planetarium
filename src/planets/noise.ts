// Seeded randomness and 3D value noise. The same seed always gives the same
// planet, so a note keeps its look every time the vault is opened.

export function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Small, fast seeded random number generator (mulberry32). Returns 0..1. */
export function makeRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Noise {
	/** Smooth noise in 0..1. */
	noise(x: number, y: number, z: number): number;
	/** Layered noise in 0..1; more octaves add finer detail. */
	fbm(x: number, y: number, z: number, octaves: number): number;
}

export function makeNoise(seed: number): Noise {
	const rng = makeRng(seed);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = p[i];
		p[i] = p[j];
		p[j] = tmp;
	}
	const perm = new Uint8Array(512);
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const values = new Float32Array(256);
	for (let i = 0; i < 256; i++) values[i] = rng();

	const at = (x: number, y: number, z: number) =>
		values[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
	const fade = (t: number) => t * t * (3 - 2 * t);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

	const noise = (x: number, y: number, z: number): number => {
		const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
		const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
		return lerp(
			lerp(
				lerp(at(xi, yi, zi), at(xi + 1, yi, zi), u),
				lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), u),
				v
			),
			lerp(
				lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), u),
				lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u),
				v
			),
			w
		);
	};

	const fbm = (x: number, y: number, z: number, octaves: number): number => {
		let sum = 0, amp = 0.5, freq = 1, norm = 0;
		for (let i = 0; i < octaves; i++) {
			sum += amp * noise(x * freq, y * freq, z * freq);
			norm += amp;
			amp *= 0.5;
			freq *= 2.03;
		}
		return sum / norm;
	};

	return { noise, fbm };
}

/** Result of `cells`, reused between calls so nothing is allocated per pixel. */
export interface CellHit {
	/** Distance to the nearest and second-nearest cell point, in cell units. */
	d1: number;
	d2: number;
	/** A stable random number 0..1 for the nearest cell. */
	id: number;
}

function cellRand(ix: number, iy: number, iz: number, seed: number, k: number): number {
	let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791) ^ Math.imul(seed + k, 0x27d4eb2d);
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
	return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Cellular (Worley) noise: space is split into irregular cells around
 * scattered points, `f` cells per unit. Cell edges are where d2 - d1 is small.
 * Checking a 3x3x3 block of grid cells keeps it fast however many cells there are.
 */
export function cells(x: number, y: number, z: number, f: number, seed: number, out: CellHit): CellHit {
	const X = x * f, Y = y * f, Z = z * f;
	const ix = Math.floor(X), iy = Math.floor(Y), iz = Math.floor(Z);
	let d1 = 9, d2 = 9, id = 0;
	for (let dz = -1; dz <= 1; dz++) {
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				const cx = ix + dx, cy = iy + dy, cz = iz + dz;
				const px = cx + cellRand(cx, cy, cz, seed, 1) - X;
				const py = cy + cellRand(cx, cy, cz, seed, 2) - Y;
				const pz = cz + cellRand(cx, cy, cz, seed, 3) - Z;
				const d = Math.sqrt(px * px + py * py + pz * pz);
				if (d < d1) {
					d2 = d1;
					d1 = d;
					id = cellRand(cx, cy, cz, seed, 4);
				} else if (d < d2) d2 = d;
			}
		}
	}
	out.d1 = d1;
	out.d2 = d2;
	out.id = id;
	return out;
}
