// Paints the surface of a planet: given a point on the sphere, returns its
// color, glow and shininess. Each type has its own painter; details, craters
// and ice caps are layered on top.

import { CellHit, Noise, cells, makeNoise, makeRng } from "./noise";
import { RGB, clamp01, hexToRgb, hueRotate, mix, ramp, ridge, scale, smoothstep, stretch } from "./color";
import { PLANET_TYPES, PlanetSpec, STORM_STRENGTH, Vec3, hasFeature } from "./types";

interface Spot extends Vec3 {
	r: number;
}

/** Everything a texture render needs that does not change per pixel. */
export interface Prepared {
	spec: PlanetSpec;
	noise: Noise;
	a: RGB[];
	b: RGB[];
	atmo: RGB;
	accent: RGB;
	craters: Spot[];
	cells: Vec3[];
	cellShade: number[];
	vents: Spot[];
	storms: Spot[];
	spots: Spot[];
	/** One giant impact crater, if the planet has that feature. */
	impact: Spot | null;
	/** A line of fresh craters. */
	chain: Spot[];
	/** A single spiral storm (terran, ocean, jungle); spin is +1 or -1. */
	hurricane: (Spot & { spin: number }) | null;
	geysers: Spot[];
	/** A great canyon: its middle, the normal of the great circle it follows, and its half length. */
	canyon: { c: Vec3; n: Vec3; len: number } | null;
	/** Center of a hexagonal polar storm. */
	hex: Vec3 | null;
	dust: Spot | null;
	/** Color of glowing life on the night side. */
	bioColor: RGB;
	/** Storm strength: scales storm sizes and turbulence (1 = moderate). */
	storm: number;
	/** Dead worlds: where the corruption spreads from. */
	blight: Spot[];
	/** Destroyed worlds: the giant impact basin, or the great chasm splitting the planet. */
	basin: Spot | null;
	chasm: { c: Vec3; n: Vec3 } | null;
	/** Rayed craters (rocky) or cryovolcanoes (ice). */
	sources: Spot[];
	/** A living world's great rift: its middle and the normal of the great circle it follows. */
	rift: { c: Vec3; n: Vec3 } | null;
}

/** Per-pixel result, reused so no memory is allocated per pixel. */
export interface Surface {
	color: RGB;
	emit: RGB;
	/** City lights, 0..1: shown only on the night side. */
	city: number;
	/** Glowing life (plankton, fungi), 0..1: also night side only. */
	bio: number;
	specular: number;
	/** Surface normal; only crystal facets change it. */
	nx: number;
	ny: number;
	nz: number;
}

const SNOW: RGB = [242, 246, 252];
const WHITE: RGB = [255, 255, 255];
const tmp: RGB = [0, 0, 0];
const V = { best: 0, second: 0, d1: 0, d2: 0 };
const H: CellHit = { d1: 0, d2: 0, id: 0 };
const H2: CellHit = { d1: 0, d2: 0, id: 0 };

function randomOnSphere(rng: () => number): Vec3 {
	const z = rng() * 2 - 1;
	const a = rng() * Math.PI * 2;
	const r = Math.sqrt(1 - z * z);
	return { x: r * Math.cos(a), y: r * Math.sin(a), z };
}

/** A random point on the side of the planet that faces the viewer, at most `maxR` from the center. */
function visibleSpot(rng: () => number, maxR: number): Vec3 {
	const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * maxR;
	const x = Math.cos(a) * d, y = Math.sin(a) * d;
	return { x, y, z: Math.sqrt(Math.max(0, 1 - x * x - y * y)) };
}

function normalize(v: Vec3): Vec3 {
	const l = Math.hypot(v.x, v.y, v.z) || 1;
	return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cellCount(spec: PlanetSpec): number {
	const p = spec.pattern;
	switch (spec.type) {
		case "crystal": return p === "shards" ? 64 : p === "geodes" ? 22 : p === "prism" ? 34 : p === "facets" ? 28 : 0;
		default: return 0;
	}
}

function craterSetup(spec: PlanetSpec): { count: number; min: number; spread: number } {
	const p = spec.pattern;
	if (p === "moon") return { count: 9, min: 0.16, spread: 0.22 };
	if (spec.type === "rocky") {
		if (p === "pitted") return { count: 55, min: 0.03, spread: 0.06 };
		if (p === "maria") return { count: 10, min: 0.05, spread: 0.18 };
		if (p === "fractured") return { count: 6, min: 0.05, spread: 0.18 };
		if (p === "rayed") return { count: 16, min: 0.03, spread: 0.08 };
		if (p === "basalt plains") return { count: 8, min: 0.03, spread: 0.06 };
		return { count: 26, min: 0.05, spread: 0.22 };
	}
	if (spec.type === "desert" && p === "cratered") return { count: 18, min: 0.05, spread: 0.2 };
	if (spec.type === "crystal" && p === "geode basins") return { count: 12, min: 0.14, spread: 0.18 };
	if (spec.type === "destroyed" && p === "ancient scar") return { count: 34, min: 0.03, spread: 0.08 };
	if (spec.type === "destroyed" && p === "cratered ruin") return { count: 22, min: 0.12, spread: 0.24 };
	if (spec.type === "dead" && p === "ashen") return { count: 8, min: 0.05, spread: 0.12 };
	if (spec.type === "real") {
		if (p === "Mercury") return { count: 48, min: 0.025, spread: 0.13 };
		if (p === "Mars") return { count: 14, min: 0.03, spread: 0.08 };
		if (p === "Pluto") return { count: 6, min: 0.03, spread: 0.06 };
	}
	return { count: 0, min: 0, spread: 0 };
}

export function prepare(spec: PlanetSpec): Prepared {
	const pal = PLANET_TYPES[spec.type].palettes[spec.palette];
	const rng = makeRng(spec.seed ^ 0x2545f491);
	const k = STORM_STRENGTH[spec.storm] ?? 1;
	const grow = Math.sqrt(k);

	const cs = craterSetup(spec);
	const craters: Spot[] = [];
	for (let i = 0; i < cs.count; i++) {
		const r = cs.min + (spec.pattern === "moon" ? rng() : Math.pow(rng(), 2)) * cs.spread;
		craters.push({ ...randomOnSphere(rng), r });
	}

	const cells: Vec3[] = [];
	const cellShade: number[] = [];
	for (let i = 0, n = cellCount(spec); i < n; i++) {
		cells.push(randomOnSphere(rng));
		cellShade.push(rng());
	}

	const vents: Spot[] = [];
	// Planets never turn away from the viewer, so volcanoes go on the visible side.
	if (hasFeature(spec, "volcanoes")) {
		for (let i = 0; i < 7; i++) {
			const v = randomOnSphere(rng);
			vents.push({ x: v.x * 0.9, y: v.y * 0.9, z: Math.abs(v.z) + 0.1, r: 0.1 });
		}
	}
	if (spec.type === "lava" && spec.pattern === "volcanic fields") {
		for (let i = 0; i < 40; i++) vents.push({ ...randomOnSphere(rng), r: 0.05 + rng() * 0.06 });
	}

	// Gas storms are placed on the visible side so they are never wasted.
	const storms: Spot[] = [];
	if (spec.pattern === "storms") {
		for (let i = 0; i < 16; i++) {
			const p = randomOnSphere(rng);
			storms.push({ x: p.x * 0.85, y: p.y * 0.85, z: Math.abs(p.z), r: (0.04 + rng() * 0.07) * grow });
		}
	}

	const spots: Spot[] = [];
	if (spec.detail === "spots") for (let i = 0; i < 6; i++) spots.push({ ...randomOnSphere(rng), r: 0.06 + rng() * 0.09 });

	let impact: Spot | null = null;
	if (hasFeature(spec, "crater")) {
		// On the visible side, away from the very edge so it is not squashed flat.
		const a = rng() * Math.PI * 2, d = 0.2 + rng() * 0.35;
		const x = Math.cos(a) * d, y = Math.sin(a) * d;
		impact = { x, y, z: Math.sqrt(1 - x * x - y * y), r: 0.26 + rng() * 0.12 };
	}

	// The new features use their own random stream, so they never shift the ones above.
	const frng = makeRng(spec.seed ^ 0x6a09e667);
	const chain: Spot[] = [];
	if (hasFeature(spec, "craterChain")) {
		// A line of craters shrinking along a great circle, like a comet broken into pieces.
		const start = visibleSpot(frng, 0.55);
		const dir = normalize({ x: frng() - 0.5, y: frng() - 0.5, z: 0 });
		const n = normalize({ x: start.y * dir.z - start.z * dir.y, y: start.z * dir.x - start.x * dir.z, z: start.x * dir.y - start.y * dir.x });
		const t = { x: n.y * start.z - n.z * start.y, y: n.z * start.x - n.x * start.z, z: n.x * start.y - n.y * start.x };
		for (let i = 0; i < 9; i++) {
			const a = i * 0.15 + (frng() - 0.5) * 0.04;
			const p = { x: start.x * Math.cos(a) + t.x * Math.sin(a), y: start.y * Math.cos(a) + t.y * Math.sin(a), z: start.z * Math.cos(a) + t.z * Math.sin(a) };
			chain.push({ ...p, r: 0.1 * (1 - i * 0.07) * (0.85 + frng() * 0.3) });
		}
	}
	let hurricane: Prepared["hurricane"] = null;
	if (hasFeature(spec, "hurricane")) hurricane = { ...visibleSpot(frng, 0.45), r: (0.27 + frng() * 0.08) * Math.pow(k, 0.8), spin: frng() < 0.5 ? 1 : -1 };
	const geysers: Spot[] = [];
	if (hasFeature(spec, "geysers")) for (let i = 0; i < 6; i++) geysers.push({ ...visibleSpot(frng, 0.75), r: 0.05 + frng() * 0.03 });
	let canyon: Prepared["canyon"] = null;
	if (hasFeature(spec, "canyons")) {
		const c = visibleSpot(frng, 0.35);
		const along = normalize({ x: frng() - 0.5, y: (frng() - 0.5) * 0.6, z: 0 });
		canyon = { c, n: normalize({ x: c.y * along.z - c.z * along.y, y: c.z * along.x - c.x * along.z, z: c.x * along.y - c.y * along.x }), len: 0.7 + frng() * 0.3 };
	}
	const hex = hasFeature(spec, "polarHex") ? normalize({ x: (frng() - 0.5) * 0.3, y: -0.72, z: 0.62 }) : null;
	if (hasFeature(spec, "stormChain")) {
		// White oval storms strung along one band.
		const band = (frng() - 0.5) * 0.9;
		for (let i = 0; i < 6; i++) {
			const x = -0.62 + i * 0.25 + (frng() - 0.5) * 0.06;
			storms.push({ x, y: band, z: Math.sqrt(Math.max(0, 1 - x * x - band * band)), r: (0.055 + frng() * 0.025) * grow });
		}
	}
	const dust = hasFeature(spec, "dustStorm") ? { ...visibleSpot(frng, 0.4), r: (0.4 + frng() * 0.12) * Math.pow(k, 0.8) } : null;
	// The newest traits use their own random stream too.
	const nrng = makeRng(spec.seed ^ 0x3c6ef372);
	const blight: Spot[] = [];
	if (spec.type === "dead" && spec.pattern === "corruption") for (let i = 0; i < 3; i++) blight.push({ ...visibleSpot(nrng, 0.7), r: 0.35 + nrng() * 0.25 });
	const basin = spec.type === "destroyed" && (spec.pattern === "ancient scar" || spec.pattern === "glassed") ? { ...visibleSpot(nrng, 0.3), r: 0.55 + nrng() * 0.12 } : null;
	// Rayed craters and cryovolcanoes: a few points on the visible side.
	const sources: Spot[] = [];
	if ((spec.type === "rocky" && spec.pattern === "rayed") || (spec.type === "ice" && spec.pattern === "cryovolcanic")) {
		for (let i = 0; i < 4; i++) sources.push({ ...visibleSpot(nrng, 0.75), r: 0.04 + nrng() * 0.04 });
	}
	let chasm: Prepared["chasm"] = null;
	if (spec.type === "destroyed" && spec.pattern === "split") {
		const c = visibleSpot(nrng, 0.15);
		const along = normalize({ x: nrng() - 0.5, y: nrng() - 0.5, z: 0 });
		chasm = { c, n: normalize({ x: c.y * along.z - c.z * along.y, y: c.z * along.x - c.x * along.z, z: c.x * along.y - c.y * along.x }) };
	}
	let rift: Prepared["rift"] = null;
	if (hasFeature(spec, "greatRift")) {
		const c = visibleSpot(nrng, 0.25);
		const along = normalize({ x: nrng() - 0.5, y: (nrng() - 0.5) * 0.8, z: 0 });
		rift = { c, n: normalize({ x: c.y * along.z - c.z * along.y, y: c.z * along.x - c.x * along.z, z: c.x * along.y - c.y * along.x }) };
	}
	const bioColor: RGB = spec.type === "toxic" ? hexToRgb(pal.accent) : spec.type === "jungle" ? [120, 255, 150] : [70, 230, 255];

	return {
		spec,
		noise: makeNoise(spec.seed),
		a: pal.a.map(hexToRgb),
		b: (pal.b ?? pal.a).map(hexToRgb),
		atmo: hexToRgb(pal.atmo),
		accent: hexToRgb(pal.accent),
		craters,
		cells,
		cellShade,
		vents,
		storms,
		spots,
		impact,
		chain,
		hurricane,
		geysers,
		canyon,
		hex,
		dust,
		bioColor,
		storm: k,
		blight,
		basin,
		chasm,
		rift,
		sources,
	};
}

/** Nearest and second-nearest cell point; their gap is small on cell edges. */
function voronoi(P: Prepared, x: number, y: number, z: number) {
	let best = 0, second = 0, d1 = 9, d2 = 9;
	for (let i = 0; i < P.cells.length; i++) {
		const p = P.cells[i];
		const d = Math.hypot(x - p.x, y - p.y, z - p.z);
		if (d < d1) {
			d2 = d1;
			second = best;
			d1 = d;
			best = i;
		} else if (d < d2) {
			d2 = d;
			second = i;
		}
	}
	V.best = best;
	V.second = second;
	V.d1 = d1;
	V.d2 = d2;
}

/** True distance from the point to the edge between its cell and the next one (after voronoi()). */
function edgeDistance(P: Prepared): number {
	const a = P.cells[V.best], b = P.cells[V.second];
	const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) || 1;
	return (V.d2 * V.d2 - V.d1 * V.d1) / (2 * gap);
}

function setEmit(S: Surface, c: RGB, k: number) {
	S.emit[0] = c[0] * k;
	S.emit[1] = c[1] * k;
	S.emit[2] = c[2] * k;
}

/**
 * Round points of light scattered through space at `f` cells per unit: each
 * cell holds at most one (kept away from the cell's edges, so only one cell
 * needs checking). `density` is the share of cells that have a light.
 */
function lightDots(x: number, y: number, z: number, f: number, seed: number, density: number, radius: number): number {
	// The grid is tilted off the planet's axes, so its rows never line up on screen.
	const X = (x * 0.8 + y * 0.36 - z * 0.48) * f, Y = (-x * 0.6 + y * 0.48 - z * 0.64) * f, Z = (y * 0.8 + z * 0.6) * f;
	const ix = Math.floor(X), iy = Math.floor(Y), iz = Math.floor(Z);
	let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791) ^ seed;
	const next = () => {
		h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
		h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
		h ^= h >>> 15;
		return (h >>> 0) / 4294967296;
	};
	if (next() > density) return 0;
	const dx = X - ix - (0.22 + 0.56 * next()), dy = Y - iy - (0.22 + 0.56 * next()), dz = Z - iz - (0.22 + 0.56 * next());
	const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
	return smoothstep(radius, radius * 0.15, d) * (0.45 + 0.55 * next());
}

/**
 * City lights: they gather in settled regions (leaving wilderness dark), as
 * specks of light for towns, brighter soft points for cities, and a faint
 * haze between them.
 */
function cityLights(P: Prepared, x: number, y: number, z: number, S: Surface) {
	if (!hasFeature(P.spec, "cityLights")) return;
	const n = P.noise;
	const settled = n.fbm(x * 3.6 + 41, y * 3.6, z * 3.6, 4);
	const region = smoothstep(0.42, 0.6, settled);
	if (region <= 0) return;
	const seed = P.spec.seed;
	// Bend space a little so towns follow gentle curves rather than a grid.
	const bend = (n.noise(x * 6 + 3, y * 6, z * 6) - 0.5) * 0.05;
	x += bend;
	y -= bend;
	const towns = lightDots(x, y, z, 70, seed, 0.35 + 0.6 * region, 0.34);
	// Same seed, so each city's wide warm halo sits around its bright core.
	const cities = lightDots(x, y, z, 20, seed ^ 0x5a5a, 0.6 * region, 0.3);
	const halos = lightDots(x, y, z, 20, seed ^ 0x5a5a, 0.6 * region, 0.95);
	const haze = smoothstep(0.5, 0.75, settled) * 0.25;
	S.city = Math.min(1, region * (towns + cities * 1.4 + halos * 0.4 + haze));
}

/** Volcano lava: tints the ground so it shows in daylight, and glows at night. */
function lavaFlow(P: Prepared, c: RGB, S: Surface, amount: number) {
	const lava: RGB = [255, 110 + 80 * clamp01(amount - 0.6), 30];
	const k = clamp01(amount);
	mix(c, lava, k * 0.75);
	setEmit(S, lava, k * 0.9);
}

function vents(P: Prepared, x: number, y: number, z: number): number {
	let glow = 0;
	for (const v of P.vents) {
		const d = Math.hypot(x - v.x, y - v.y, z - v.z);
		glow += smoothstep(v.r, v.r * 0.15, d) + 0.3 * smoothstep(v.r * 2.4, v.r, d);
	}
	return glow;
}

export function sampleSurface(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { spec, noise: n } = P;
	S.emit[0] = S.emit[1] = S.emit[2] = 0;
	S.city = 0;
	S.bio = 0;
	S.specular = 0.05;
	S.nx = x;
	S.ny = y;
	S.nz = z;
	const c = S.color;
	const p = spec.pattern;
	// Fine grain gives every surface small-scale variation.
	const grain = (f: number) => n.noise(x * f + 17, y * f, z * f) - 0.5;
	// Hard-edged flecks: +1 on bright flecks, -1 on dark ones. Soft noise alone looks blurry.
	const fleck = (f: number) => {
		const v = n.noise(x * f + 31, y * f, z * f);
		return smoothstep(0.66, 0.7, v) - smoothstep(0.34, 0.3, v);
	};

	switch (spec.type) {
		case "terran": {
			const warp = n.fbm(x * 1.2 + 5, y * 1.2, z * 1.2, 3);
			let h = stretch(n.fbm(x * 1.6 + warp * 1.5, y * 1.6 + warp * 1.5, z * 1.6, 5), 2.6);
			if (p === "supercontinent") h = clamp01(h * 0.85 + 0.22 * (x * 0.4 - y * 0.5 + z * 0.75));
			if (p === "fjords") {
				// Coasts gouged by ancient glaciers into long narrow inlets.
				const cut = ridge(n.fbm(x * 9 + 4, y * 9, z * 9, 3)) - 0.5;
				h -= cut * 0.16 * smoothstep(0.2, 0, Math.abs(h - 0.52));
			}
			if (p === "tundra") {
				// Countless small lakes left by melting ice.
				h -= smoothstep(0.62, 0.68, n.fbm(x * 10 + 3, y * 10, z * 10, 3)) * 0.12;
			}
			const sea = p === "islands" ? 0.63 : p === "supercontinent" ? 0.5 : p === "lakes" ? 0.36 : p === "fjords" ? 0.52 : p === "tundra" ? 0.44 : 0.53;
			if (h < sea) {
				ramp(P.a, h / sea, c);
				S.specular = 0.55;
			} else {
				// The land ramp eases in so snow only caps the very highest ground.
				const t = Math.pow((h - sea) / (1 - sea), 1.35) + grain(18) * 0.08;
				ramp(P.b, t / 0.95, c);
				// Snowcaps are shaped by smooth layered noise: where the land tops out, fine
				// grain alone would decide, and its square grid would show as white dots.
				const peaks = n.fbm(x * 3.3 + 9, y * 3.3, z * 3.3, 4) - 0.5;
				const cold = p === "tundra" || p === "fjords";
				if (cold) {
					// Cold land: grey-green moss and brown heath instead of forest.
					const grey = (c[0] + c[1] + c[2]) / 3;
					c[0] = grey + (c[0] - grey) * 0.45 + 8;
					c[1] = grey + (c[1] - grey) * 0.45 + 6;
					c[2] = grey + (c[2] - grey) * 0.45;
				}
				const snow = smoothstep(cold ? 0.62 : 0.95, cold ? 0.75 : 1.02, t + peaks * 0.4 + grain(24) * 0.03);
				mix(c, SNOW, snow * (0.85 + 0.15 * (grain(40) + 0.5)));
				if (t < 0.7) cityLights(P, x, y, z, S);
				wildfires(P, x, y, z, S);
			}
			break;
		}
		case "ocean": {
			const warp = n.fbm(x * 1.4 + 2, y * 1.4, z * 1.4, 3);
			const h = stretch(n.fbm(x * 2.2 + warp * 1.4, y * 2.2 + warp * 1.4, z * 2.2, 5), 2.6);
			const level = p === "archipelago" ? 0.72 : p === "open seas" ? 0.84 : p === "reefs" ? 0.78 : p === "shelf seas" ? 0.76 : p === "abyss" ? 0.93 : 0.8;
			if (h < level) {
				// Water color follows depth: dark abyss, lighter toward the shore.
				let depth = (h / level) * 0.72;
				if (p === "shelf seas") {
					// Broad shallow shelves of bright water around the land, then a sudden drop to the deep.
					const shelf = smoothstep(level - 0.2, level - 0.15, h);
					depth = depth * (1 - shelf) + shelf * (0.82 + 0.1 * (h - level + 0.15) / 0.15);
				} else if (p === "deep trenches") {
					// Long trenches where the sea floor plunges, darker than anything around them.
					const tr = ridge(n.fbm(x * 2.4 + 13, y * 2.4, z * 2.4, 4));
					const trench = smoothstep(0.9, 0.97, tr);
					// The slopes down into each trench darken gradually, so the trench reads as deep, not drawn.
					depth *= 1 - trench * 0.85 - smoothstep(0.75, 0.9, tr) * 0.25;
				} else if (p === "abyss") {
					// Almost all deep ocean; underwater mountains show as paler patches.
					const mount = smoothstep(0.7, 0.85, n.fbm(x * 4 + 3, y * 4, z * 4, 4));
					depth = 0.08 + depth * 0.7 + mount * 0.3;
				}
				ramp(P.a, depth, c);
				// Wave texture so open water is never flat.
				scale(c, 1 + 0.05 * Math.sin(lat * 50 + n.fbm(x * 4, y * 4, z * 4, 3) * 12));
				if (p === "reefs" && h > level - 0.14) {
					const reef = smoothstep(0.45, 0.55, n.noise(x * 26, y * 26, z * 26));
					ramp(P.a, 0.75 + reef * 0.25, tmp);
					mix(c, tmp, smoothstep(level - 0.14, level - 0.06, h));
				}
				// Foam where waves break on the shore.
				const foam = smoothstep(level - 0.025, level, h) * smoothstep(0.6, 0.7, n.noise(x * 40, y * 40, z * 40));
				mix(c, WHITE, foam * 0.7);
				mix(c, WHITE, smoothstep(0.78, 0.82, n.noise(x * 44 + 31, y * 44, z * 44)) * 0.22);
				if (p === "maelstrom") {
					const dx = x + 0.15, dy = y + 0.1, d = Math.hypot(dx, dy);
					if (d < 0.5) {
						const arm = Math.sin(Math.atan2(dy, dx) * 3 + d * 26);
						mix(c, WHITE, smoothstep(0.6, 0.95, arm) * (1 - d / 0.5) * 0.8);
						mix(c, P.a[0], smoothstep(0.08, 0.0, d));
					}
				}
				S.specular = 0.6;
				bioluminescence(P, x, y, z, S, 1);
			} else {
				ramp(P.b, (h - level) / (1 - level) + grain(20) * 0.15, c);
				cityLights(P, x, y, z, S);
			}
			break;
		}
		case "jungle": {
			const canopy = stretch(n.fbm(x * 3, y * 3, z * 3, 6), 2.4);
			ramp(P.a, canopy * 0.72 + (grain(22) + 0.5) * 0.28, c);
			scale(c, 1 + 0.15 * fleck(22));
			const warp = n.fbm(x * 1.5, y * 1.5 + 3, z * 1.5, 3);
			const rv = ridge(stretch(n.fbm(x * 1.8 + warp * 2, y * 1.8 + warp * 2, z * 1.8, 4), 2.2));
			const riverAt = p === "rivers" ? 0.92 : p === "swamp" ? 0.96 : p === "deltas" ? 0.9 : 0.965;
			let water = smoothstep(riverAt, riverAt + 0.012, rv);
			if (p === "deltas") {
				// Great rivers fan out into many channels as they reach broad lakes.
				const lake = smoothstep(0.36, 0.32, canopy);
				const fan = smoothstep(0.93, 0.95, ridge(n.fbm(x * 6 + warp * 3, y * 6, z * 6, 3))) * smoothstep(0.5, 0.36, canopy);
				water = Math.max(water, lake, fan);
			}
			if (p === "mangroves") {
				// A mesh of land and shallow water, the forest standing in the tide.
				water = Math.max(water, smoothstep(0.5, 0.54, n.fbm(x * 8 + 2, y * 8, z * 8, 4)) * 0.85);
				// Tree crowns catch the light: brighter flecks over darker undergrowth.
				scale(c, 0.9 + 0.35 * fleck(48));
			}
			if (p === "swamp") water = Math.max(water, smoothstep(0.6, 0.63, n.fbm(x * 4 + 9, y * 4, z * 4, 4)) * 0.85);
			if (p === "rainforest") water = Math.max(water, smoothstep(0.3, 0.27, canopy));
			if (p === "highlands") {
				// Gentle stretch so heights do not pile up at the top, which made snow blobs.
				const m = stretch(n.fbm(x * 2.5 + 4, y * 2.5, z * 2.5, 5), 1.8);
				mix(c, [110, 96, 82], smoothstep(0.64, 0.67, m) * 0.85);
				mix(c, SNOW, smoothstep(0.8, 0.84, m + grain(24) * 0.08) * 0.9);
			}
			if (water > 0) {
				ramp(P.b, 0.5 + grain(30), tmp);
				mix(c, tmp, water);
				S.specular = 0.4 * water;
			}
			if (water < 0.5) cityLights(P, x, y, z, S);
			// Glowing fungi in the forest.
			bioluminescence(P, x, y, z, S, 1 - water);
			break;
		}
		case "desert": {
			let t = stretch(n.fbm(x * 2.4, y * 2.4, z * 2.4, 6), 2.4) + grain(28) * 0.12;
			if (p === "dunes") {
				// Sawtooth ridges: a slow rise then a sharp drop, like wind-blown dunes.
				const d = lat * 26 + n.fbm(x * 3, y * 3, z * 3, 3) * 8;
				const saw = d - Math.floor(d);
				t = t * 0.75 + 0.25 * (saw < 0.85 ? saw / 0.85 : (1 - saw) / 0.15);
			} else if (p === "mesas") {
				// Flat terraces with a dark cliff face at each step.
				const steps = t * 4, step = Math.floor(steps), f = steps - step;
				t = 0.12 + step / 4 + grain(30) * 0.05;
				if (f < 0.12) t -= 0.25;
			}
			if (p === "badlands") {
				// Layer upon layer of rock laid bare by erosion, in alternating bands of color.
				// Broad bands of rock, following the terrain's height like contour lines on a map.
				const height = n.fbm(x * 1.6 + 2, y * 1.6, z * 1.6, 4);
				const layer = height * 9 + n.fbm(x * 4, y * 4, z * 4, 2) * 0.4;
				t = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(layer * Math.PI * 2)) + grain(30) * 0.05;
			}
			ramp(P.a, t, c);
			scale(c, 1 + 0.16 * fleck(40));
			if (p === "badlands") {
				// Gullies cut down through the layers.
				scale(c, 1 - smoothstep(0.94, 0.98, ridge(n.fbm(x * 7 + 3, y * 7, z * 7, 3))) * 0.45);
			}
			if (p === "salt flats") {
				// Dry lakebeds crusted white with salt, cracked into polygons.
				const flat = smoothstep(0.42, 0.36, n.fbm(x * 1.8 + 13, y * 1.8, z * 1.8, 4));
				cells(x, y, z, 24, spec.seed, H);
				const crack = smoothstep(0.04, 0.012, H.d2 - H.d1);
				const white = 0.88 + 0.1 * H.id;
				mix(c, [238 * white, 236 * white, 228 * white], flat * 0.9);
				scale(c, 1 - crack * flat * 0.3);
				S.specular = Math.max(S.specular, 0.25 * flat);
			}
			if (p === "canyons") {
				const warp = n.fbm(x * 1.3, y * 1.3, z * 1.3, 3);
				const rv = ridge(stretch(n.fbm(x * 2.2 + warp * 2, y * 2.2 + warp * 2, z * 2.2, 4), 2.2));
				mix(c, P.a[0], smoothstep(0.9, 0.95, rv) * 0.85);
				mix(c, P.a[P.a.length - 1], smoothstep(0.86, 0.89, rv) * (1 - smoothstep(0.89, 0.9, rv)) * 0.6);
			}
			cityLights(P, x, y, z, S);
			const volcano = vents(P, x, y, z);
			if (volcano > 0) lavaFlow(P, c, S, volcano);
			break;
		}
		case "gas":
		case "toxic": {
			if (p === "swirls") {
				const w1 = n.fbm(x * 1.5, y * 1.5, z * 1.5, 3);
				const w2 = n.fbm(x * 1.5 + w1 * 4, y * 1.5 + w1 * 4, z * 1.5, 3);
				ramp(P.a, stretch(n.fbm(x * 2 + w2 * 4, y * 2 + w2 * 4, z * 2, 4), 2.4), c);
			} else if (p === "acid seas") {
				const h = stretch(n.fbm(x * 2, y * 2, z * 2, 5), 2.6);
				if (h < 0.48) {
					ramp(P.a, 0.55 + 0.4 * (h / 0.48), c);
					setEmit(S, P.accent, 0.25 + 0.5 * smoothstep(0.42, 0.48, h));
					S.specular = 0.5;
				} else {
					ramp(P.a, 0.05 + 0.3 * ((h - 0.48) / 0.52) + grain(26) * 0.1, c);
				}
			} else if (p === "sludge") {
				// Thick slow folds of chemical sludge, wrinkled where its skin has set.
				const fold = n.fbm(x * 1.4 + 3, y * 1.4, z * 1.4, 4);
				ramp(P.a, stretch(n.fbm(x * 2 + fold * 2, y * 2 + fold * 2, z * 2, 5), 2) * 0.8, c);
				const wrinkle = smoothstep(0.85, 0.95, ridge(n.fbm(x * 14 + fold * 3, y * 14, z * 14, 3)));
				scale(c, 1 - wrinkle * 0.25);
				setEmit(S, P.accent, smoothstep(0.6, 0.75, fold) * 0.25);
			} else if (p === "spore clouds") {
				// A hazy sky crowded with drifting spore clouds that glow faintly.
				// Billowing banks of spores drifting over a hazy murk, lumpy and lit on their tops.
				ramp(P.a, 0.15 + 0.35 * n.fbm(x * 2, y * 2, z * 2, 4), c);
				const bank = n.fbm(x * 3.5 + 8, y * 3.5, z * 3.5, 5);
				const puff = smoothstep(0.5, 0.62, bank);
				const lump = 0.75 + 0.35 * n.fbm(x * 14 + bank * 3, y * 14, z * 14, 3);
				ramp(P.a, (0.6 + 0.35 * smoothstep(0.5, 0.75, bank)) * lump, tmp);
				mix(c, tmp, puff * 0.9);
				setEmit(S, P.accent, smoothstep(0.62, 0.72, bank) * 0.3);
			} else if (p === "bubbling") {
				ramp(P.a, stretch(n.fbm(x * 2.5, y * 2.5, z * 2.5, 4), 2) * 0.6, c);
				// Swelling blisters of gas: irregular, of every size, clustered where the noise says.
				const wx = (n.fbm(x * 4 + 3, y * 4, z * 4, 3) - 0.5) * 0.25;
				cells(x + wx, y - wx, z, 9, spec.seed, H);
				const size = 0.25 + H.id * 0.25;
				const cluster = smoothstep(0.4, 0.6, n.fbm(x * 2 + 8, y * 2, z * 2, 3));
				if (H.id > 0.35 && cluster > 0) {
					const u = H.d1 / size;
					const dome = smoothstep(1, 0.75, u) * cluster;
					ramp(P.a, 0.55 + 0.4 * Math.sqrt(Math.max(0, 1 - u * u)), tmp);
					mix(c, tmp, dome);
					setEmit(S, P.accent, smoothstep(0.14, 0, Math.abs(u - 0.92)) * 0.35 * cluster);
				}
			} else if (p === "marbled") {
				// Eddies folded into eddies: bands torn apart into a marbled swirl.
				const w1 = n.fbm(x * 1.8, y * 3, z * 1.8, 4);
				const w2 = n.fbm(x * 2 + w1 * 3 * P.storm, y * 4 + w1 * 2, z * 2, 4);
				ramp(P.a, 0.5 + 0.45 * Math.sin((lat * 4 + w2 * 3) * Math.PI), c);
			} else if (p === "ribbons") {
				// Many narrow fast bands, their edges curling into festoons.
				// The band spacing itself wanders, so no two bands are the same width.
				const w = n.fbm(x * 3, y * 8, z * 3, 4) - 0.5;
				const v = lat * 10 + n.fbm(x * 0.5 + 3, lat * 3, z * 0.5, 3) * 6 + w * 0.9 * P.storm;
				const shade = n.noise(Math.floor(v) * 3.7, 1.3, 2.1);
				ramp(P.a, 0.3 + 0.4 * shade + 0.25 * Math.sin(v * Math.PI) + (n.fbm(x * 9, lat * 30, z * 9, 2) - 0.5) * 0.2, c);
			} else {
				const calm = p === "calm";
				const turbulent = p === "turbulent";
				const freq = calm ? 4 : turbulent ? 7 : 6;
				// Wilder weather churns the bands more.
				const turb = (calm ? 0.35 : turbulent ? 1.6 : 0.8) * P.storm;
				const w = n.fbm(x * 2, y * 5, z * 2, 4) - 0.5;
				const v = lat * freq + w * turb * 3;
				ramp(P.a, 0.5 + 0.45 * Math.sin(v * Math.PI) * (0.6 + 0.4 * Math.sin(v * 1.7 + 1)), c);
			}
			for (const s of P.storms) {
				const dx = (x - s.x) / s.r, dy = (y - s.y) / (s.r * 0.6);
				const d = Math.hypot(dx, dy);
				if (d < 1.15) {
					ramp(P.a, d < 1 ? 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(d * 9)) : 0.9, tmp);
					mix(c, tmp, smoothstep(1.15, 0.95, d));
				}
			}
			if (spec.type === "toxic") bioluminescence(P, x, y, z, S, 0.85);
			if (spec.type === "toxic" && p !== "acid seas" && p !== "bubbling") {
				setEmit(S, P.accent, smoothstep(0.82, 1, (c[0] + c[1] + c[2]) / 765) * 0.35);
			}
			if (hasFeature(spec, "stormEye")) {
				const eye = Math.sqrt(P.storm);
				const dx = (x - 0.28) / (0.27 * eye), dy = (y - 0.3) / (0.13 * eye);
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d < 1) {
					const swirl = 0.5 + 0.5 * Math.sin(d * 11 - Math.atan2(dy, dx) * 2);
					ramp([P.accent, P.a[P.a.length - 1], P.accent], swirl * (1 - d), tmp);
					mix(c, tmp, smoothstep(1, 0.55, d));
				}
			}
			break;
		}
		case "lava": {
			ramp(P.a, stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2) + grain(30) * 0.25, c);
			const cr = ridge(stretch(n.fbm(x * 2.2 + 9, y * 2.2, z * 2.2, 4), 2.2));
			let glow = 0;
			if (p === "cracks") glow = smoothstep(0.86, 0.98, cr);
			else if (p === "magma seas") {
				const m = stretch(n.fbm(x * 1.8, y * 1.8 + 4, z * 1.8, 4), 2.6);
				const sea = smoothstep(0.6, 0.63, m);
				const shore = sea * (1 - smoothstep(0.63, 0.7, m));
				// Dark crust plates float on the sea so it never becomes a flat blob.
				const crust = smoothstep(0.55, 0.6, n.noise(x * 9, y * 9, z * 9));
				glow = sea * (0.5 - 0.32 * crust) + shore * 0.5 + 0.7 * smoothstep(0.93, 0.99, cr);
			} else if (p === "lava rivers") {
				const w = n.fbm(x * 1.3, y * 1.3, z * 1.3, 3);
				// The difference of two noise fields always crosses zero, so every seed gets rivers.
				const rv = ridge(0.5 + n.fbm(x * 1.2 + w * 2, y * 3.5 + w * 2, z * 1.2, 4) - n.fbm(x * 1.2 + 40, y * 3.5, z * 1.2 + w * 2, 4));
				glow = smoothstep(0.94, 0.98, rv);
			} else if (p === "lava lakes") {
				// A few big lakes of lava, crusted at the edges, in black rock.
				const w = (n.fbm(x * 3, y * 3, z * 3, 3) - 0.5) * 0.3;
				cells(x + w, y, z - w, 2.6, spec.seed, H);
				const r = 0.22 + H.id * 0.18;
				const edgeWob = 1 + (n.fbm(x * 8, y * 8, z * 8, 3) - 0.5) * 0.5;
				const lake = smoothstep(r * edgeWob, r * edgeWob * 0.85, H.d1) * (H.id > 0.35 ? 1 : 0);
				// Rafts of dark crust drift on each lake; the lava is hottest where it wells up in the middle.
				const raft = smoothstep(0.5, 0.58, n.fbm(x * 10 + 4, y * 10, z * 10, 3));
				const heat = 0.55 + 0.4 * smoothstep(r, 0, H.d1) + 0.15 * (n.noise(x * 25, y * 25, z * 25) - 0.5);
				glow = lake * heat * (1 - raft * 0.8) + 0.6 * smoothstep(0.93, 0.99, cr);
			} else if (p === "cooling crust") {
				// Mostly cooled black crust with a fine web of cracks still glowing.
				const fine = ridge(n.fbm(x * 8 + 3, y * 8, z * 8, 3));
				glow = smoothstep(0.9, 0.98, fine) * (0.45 + 0.55 * smoothstep(0.4, 0.7, n.fbm(x * 2 + 5, y * 2, z * 2, 3)));
				// The crust is not quite black: it is still dull red-brown where it is thinnest.
				mix(c, [90, 40, 24], smoothstep(0.5, 0.8, fine) * 0.5);
			} else glow = 0.85 * smoothstep(0.93, 0.985, cr);
			glow = clamp01(glow + vents(P, x, y, z));
			ramp(P.b, glow, tmp);
			mix(c, tmp, glow * 0.6);
			setEmit(S, tmp, glow);
			break;
		}
		case "scorched": {
			let t = stretch(n.fbm(x * 3, y * 3, z * 3, 6), 2.4) + grain(26) * 0.15;
			if (p === "ash plains") {
				const d = lat * 30 + n.fbm(x * 4, y * 4, z * 4, 3) * 8;
				const saw = d - Math.floor(d);
				t += 0.16 * (saw < 0.8 ? saw / 0.8 : (1 - saw) / 0.2) - 0.08;
			} else if (p === "dust bowl") {
				// Sand-blasted plains, smoothed by endless wind, with long bright streaks behind every rock.
				t = 0.35 + 0.35 * n.fbm(x * 2, y * 2, z * 2, 4) + 0.2 * smoothstep(0.6, 0.9, n.fbm(x * 2, lat * 18, z * 2, 3));
				// Dark boulders and outcrops the wind cannot move.
				t -= 0.3 * smoothstep(0.72, 0.8, n.fbm(x * 9 + 4, y * 9, z * 9, 3));
			} else if (p === "tectonic") {
				// Huge plates of crust grinding past each other.
				const w = (n.fbm(x * 2 + 3, y * 2, z * 2, 3) - 0.5) * 0.4;
				cells(x + w, y - w, z, 3, spec.seed, H);
				const seam = smoothstep(0.08, 0.02, H.d2 - H.d1);
				const edge = smoothstep(0.16, 0.08, H.d2 - H.d1) * (1 - seam);
				t = t * 0.7 + H.id * 0.3 + edge * 0.15 - seam * 0.35;
			}
			ramp(P.a, t, c);
			scale(c, 1 + 0.3 * fleck(36));
			let glow = 0;
			if (p === "cracked crust") {
				const cr = ridge(stretch(n.fbm(x * 3.2 + 5, y * 3.2, z * 3.2, 4), 2.2));
				scale(c, 1 - smoothstep(0.93, 0.97, cr) * 0.8);
				glow = smoothstep(0.975, 0.99, cr) * 0.6;
			} else if (p === "embers") {
				glow = smoothstep(0.8, 0.86, stretch(n.fbm(x * 12 + 3, y * 12, z * 12, 2), 2.4));
			} else if (p === "glassed") {
				const g = smoothstep(0.6, 0.63, n.fbm(x * 2 + 7, y * 2, z * 2, 4));
				ramp(P.a, 0.12 + grain(40) * 0.05, tmp);
				mix(c, tmp, g);
				S.specular = 0.05 + 0.5 * g;
			}
			if (p === "tectonic") {
				const seam = smoothstep(0.05, 0.015, H.d2 - H.d1);
				glow = Math.max(glow, seam * 0.45 * smoothstep(0.5, 0.7, n.noise(x * 20, y * 20, z * 20)));
			}
			glow = clamp01(glow + vents(P, x, y, z));
			setEmit(S, P.accent, glow);
			break;
		}
		case "ice": {
			let t = stretch(n.fbm(x * 3.2, y * 3.2, z * 3.2, 6), 2.8) + 0.08 * Math.sin(lat * 26 + n.fbm(x * 5, y * 5, z * 5, 4) * 9);
			let crack = 0;
			if (p === "frozen sea") {
				// Ice floes with jagged edges, open dark water and slush between them.
				// Big floes of every size, pulled apart by currents: where the ice is loose the
				// leads of open water widen, and small broken pieces drift in them.
				const w = (n.fbm(x * 2.5 + 5, y * 2.5, z * 2.5, 4) - 0.5) * 0.5;
				cells(x + w, y + w * 0.7, z - w, 3.4, spec.seed, H);
				t = 0.5 + H.id * 0.35 + grain(30) * 0.08 + (n.fbm(x * 8, y * 8, z * 8, 3) - 0.5) * 0.2;
				const loose = smoothstep(0.4, 0.7, n.fbm(x * 2 + 30, y * 2, z * 2, 3));
				const gap = H.d2 - H.d1 + (n.fbm(x * 20, y * 20, z * 20, 2) - 0.5) * 0.12;
				let open = smoothstep(0.05 + 0.25 * loose, 0.01 + 0.12 * loose, gap);
				if (open > 0) {
					// Brash ice: small fragments floating in the open water.
					cells(x, y, z, 26, spec.seed ^ 5, H2);
					open *= 1 - smoothstep(0.35, 0.2, H2.d1) * (H2.id > 0.55 ? 0.9 : 0);
				}
				crack = open;
				S.specular = 0.6;
			} else if (p === "glacier flows") {
				// Rivers of ice streaming down from the highlands, striped with the rock they carry.
				const w = n.fbm(x * 2 + 4, y * 2, z * 2, 3);
				const flow = n.fbm(x * 1.5 + w * 1.5, lat * 6 + w * 2, z * 1.5, 4);
				t = 0.45 + 0.4 * flow;
				// Soft dark bands of rock debris carried along in the ice, a few broad ones rather than many lines.
				const stripe = smoothstep(0.82, 0.95, ridge(n.fbm(x * 1.4 + w * 2, lat * 7 + w * 3, z * 1.4, 3)));
				crack = stripe * 0.4;
			} else if (p === "cryovolcanic") {
				// Plumes from ice volcanoes have laid dark streaks downwind across the surface.
				for (const s of P.sources) {
					const dx = x - s.x, dy = y - s.y;
					const along = dx * 0.85 + dy * 0.5, across = -dx * 0.5 + dy * 0.85;
					if (along > -0.03) crack = Math.max(crack, smoothstep(0.05 + along * 0.15, 0, Math.abs(across)) * smoothstep(0.6, 0, along) * 0.8);
					crack = Math.max(crack, smoothstep(s.r, 0, Math.hypot(dx, dy)) * 0.9);
				}
			} else if (p === "crevasses") {
				// Long branching fractures that mostly run one way, as ice sheets split under stress.
				const main = ridge(n.fbm(x * 1.6 + 9, lat * 5.5, z * 1.6, 4));
				const side = ridge(n.fbm(x * 5 + 2, lat * 3, z * 5, 3));
				crack = Math.max(smoothstep(0.955, 0.985, main), smoothstep(0.97, 0.99, side) * smoothstep(0.75, 0.9, main) * 0.8);
			} else {
				// Two crack networks at different scales; narrow thresholds keep lines crisp.
				const big = ridge(n.fbm(x * 2.6 + 3, y * 2.6, z * 2.6, 3));
				const fine = ridge(n.fbm(x * 7 + 11, y * 7, z * 7, 2));
				const cracked = p === "cracked";
				crack = Math.max(
					smoothstep(cracked ? 0.955 : 0.975, cracked ? 0.975 : 0.99, big),
					smoothstep(0.975, 0.99, fine) * (cracked ? 0.8 : 0.4)
				);
			}
			ramp(P.a, t, c);
			mix(c, P.b[0], crack * 0.9);
			// Frost speckle: tiny bright flecks that give the surface a sharp texture.
			mix(c, WHITE, smoothstep(0.7, 0.78, n.noise(x * 60, y * 60, z * 60)) * 0.5);
			S.specular = Math.max(S.specular, 0.45);
			break;
		}
		case "rocky": {
			ramp(P.a, stretch(n.fbm(x * 4, y * 4, z * 4, 6), 2.2) + grain(32) * 0.14, c);
			scale(c, 1 + 0.15 * fleck(40));
			if (p === "maria") {
				const m = stretch(n.fbm(x * 1.6 + 3, y * 1.6, z * 1.6, 4), 2.4);
				ramp(P.a, 0.1 + grain(36) * 0.06, tmp);
				mix(c, tmp, smoothstep(0.6, 0.64, m) * 0.7);
			} else if (p === "fractured") {
				scale(c, 1 - smoothstep(0.95, 0.975, ridge(stretch(n.fbm(x * 2.6, y * 2.6 + 5, z * 2.6, 4), 2.2))) * 0.7);
			} else if (p === "basalt plains") {
				// Dark lava plains, smooth but for winding channels and wrinkle ridges.
				// Pale old highlands stand out like islands in the dark flows.
				const flow = smoothstep(0.62, 0.55, n.fbm(x * 1.8 + 2, y * 1.8, z * 1.8, 4));
				ramp(P.a, 0.1 + 0.18 * n.fbm(x * 3, y * 3, z * 3, 4) + (1 - flow) * 0.45, c);
				const rille = smoothstep(0.955, 0.985, ridge(n.fbm(x * 3 + 7, y * 3, z * 3, 4))) * flow;
				const wrinkle = smoothstep(0.9, 0.96, ridge(n.fbm(x * 6 + 1, y * 6, z * 6, 3))) * flow;
				scale(c, 1 - rille * 0.55 + wrinkle * 0.45);
			} else if (p === "rayed") {
				// Young craters with bright rays of ejecta thrown across the old dark surface.
				for (const s of P.sources) {
					const dx = x - s.x, dy = y - s.y, dz = z - s.z;
					const d = Math.hypot(dx, dy, dz) || 1e-6;
					const ray = Math.pow(n.noise((dx / d) * 9 + s.r * 50, (dy / d) * 9, (dz / d) * 9), 4) * 2;
					scale(c, 1 + ray * smoothstep(0.9, s.r, d) + 0.6 * smoothstep(s.r * 2, s.r, d));
				}
			}
			const volcano = vents(P, x, y, z);
			if (volcano > 0) lavaFlow(P, c, S, volcano);
			break;
		}
		case "dead":
			deadWorld(P, x, y, z, lat, S);
			break;
		case "destroyed":
			destroyedWorld(P, x, y, z, lat, S);
			break;
		case "snow":
			snowWorld(P, x, y, z, lat, S);
			break;
		case "real":
			realPlanet(P, x, y, z, lat, S);
			break;
		case "inspired":
			inspiredWorld(P, x, y, z, lat, S);
			break;
		case "crystal": {
			if (P.cells.length > 0) {
				faceted(P, x, y, z, S);
				break;
			}
			// A mineral world: pale rough rock overgrown with crystal. Crystals are small and
			// many, so up close they glitter and from afar they read as a gem-like sheen.
			const rock = 0.15 + stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2) * 0.35 + grain(40) * 0.08;
			let crystal = 0;
			if (p === "crystal fields") {
				crystal = smoothstep(0.42, 0.55, n.fbm(x * 2.2 + 4, y * 2.2, z * 2.2, 4));
			} else if (p === "spires") {
				// Crystal ridges grow along cracks in the crust.
				const w = n.fbm(x * 1.5, y * 1.5 + 6, z * 1.5, 3);
				crystal = smoothstep(0.78, 0.93, ridge(n.fbm(x * 2.6 + w * 1.5, y * 2.6 + w * 1.5, z * 2.6, 4)));
			} else if (p === "geode basins") {
				// Crater bowls lined with crystal, deepest color in the middle (the bowls are shaded later).
				for (const cr of P.craters) {
					const u = Math.hypot(x - cr.x, y - cr.y, z - cr.z) / cr.r;
					if (u < 1) crystal = Math.max(crystal, smoothstep(1, 0.6, u));
				}
				crystal = Math.max(crystal, smoothstep(0.6, 0.7, n.fbm(x * 3 + 9, y * 3, z * 3, 4)) * 0.6);
			}
			ramp(P.a, rock, c);
			// Rock is a muted, greyed version of the crystal color.
			const grey = (c[0] + c[1] + c[2]) / 3;
			c[0] = grey + (c[0] - grey) * 0.35;
			c[1] = grey + (c[1] - grey) * 0.35;
			c[2] = grey + (c[2] - grey) * 0.35;
			if (p === "opal") {
				// Polished opal: a milky body with smooth flowing play-of-color, no hard patches.
				const w1 = n.fbm(x * 1.8 + 3, y * 1.8, z * 1.8, 4);
				const w2 = n.fbm(x * 2.5 + w1 * 2, y * 2.5 + w1 * 2, z * 2.5, 4);
				ramp(P.a, 0.55 + 0.35 * w2, c);
				hueRotate(c, (w1 - 0.5) * 220 + (w2 - 0.5) * 120);
				mix(c, WHITE, 0.2 + 0.15 * smoothstep(0.45, 0.7, w2));
				// Bright flashes of color where the layers catch the light.
				const flash = smoothstep(0.7, 0.85, n.fbm(x * 9 + w2 * 3, y * 9, z * 9, 3));
				scale(c, 1 + flash * 0.35);
				// Tiny sharp flecks of fire inside the stone, each its own color.
				const fleckV = n.noise(x * 70 + 3, y * 70, z * 70);
				if (fleckV > 0.78) {
					const f = smoothstep(0.78, 0.84, fleckV);
					scale(c, 1 + f * 0.45);
					hueRotate(c, f * 60);
				}
				S.specular = 0.75;
			} else if (crystal > 0) {
				// Each tiny crystal catches the light at its own angle.
				cells(x, y, z, 42, spec.seed, H);
				const face = 0.35 + H.id * 0.6;
				ramp(P.a, 0.25 + 0.7 * face, tmp);
				mix(tmp, WHITE, smoothstep(0.82, 1, H.id) * 0.5 * smoothstep(0.5, 0, H.d1));
				scale(tmp, 0.75 + 0.35 * smoothstep(0.6, 0.1, H.d1));
				mix(c, tmp, crystal);
				S.specular = 0.25 + 0.65 * crystal;
				if (H.id > 0.9) setEmit(S, P.accent, 0.35 * crystal * smoothstep(0.6, 0.1, H.d1));
				// Turn the surface normal a little per crystal so glints sparkle across the field.
				const a = H.id * Math.PI * 2, tilt = 0.35 * crystal;
				const nx = x + Math.cos(a) * tilt, ny = y + Math.sin(a) * tilt;
				const len = Math.hypot(nx, ny, z) || 1;
				S.nx = nx / len;
				S.ny = ny / len;
				S.nz = z / len;
			}
			break;
		}
		case "machine": {
			// A world covered by one endless city, seen from orbit. Like a real city from
			// space it is mostly texture and tone: districts, fine urban grain, roads and
			// waterways that curve with the land, and clustered lights at night.
			const district = n.fbm(x * 2.2 + 7, y * 2.2, z * 2.2, 5);
			// Fine urban grain: city blocks too small to see one by one, but they give the surface its texture.
			const grainy = n.fbm(x * 40 + 3, y * 40, z * 40, 2) - 0.5;
			const blocks = n.noise(x * 150 + 9, y * 150, z * 150) - 0.5;
			let t = 0.15 + 0.7 * district + grainy * 0.35 + blocks * 0.2 + fleck(110) * 0.1;
			// Main roads: thin curving lines of a ridged noise; smaller streets at a finer scale.
			const roads = smoothstep(0.965, 0.99, ridge(n.fbm(x * 5 + 11, y * 5, z * 5, 3)));
			const streets = smoothstep(0.95, 0.985, ridge(n.fbm(x * 16 + 5, y * 16, z * 16, 2))) * 0.6;
			// Where lights gather: busy cores, quiet outskirts.
			let busy = smoothstep(0.35, 0.7, n.fbm(x * 3.5 + 19, y * 3.5, z * 3.5, 4));
			if (p === "metropolis") busy = 0.6 + 0.4 * busy;
			if (p === "ruins") busy *= 0.25;
			let water = 0, green = 0, heat = 0, bank = 0;
			if (p === "foundry") {
				// Industrial zones: rust and soot, glowing furnaces, and smoke trails.
				heat = lightDots(x, y, z, 30, spec.seed ^ 0xf0, 0.35 * smoothstep(0.45, 0.6, district), 0.3);
			} else if (p === "garden city") {
				// Parkland threaded through the city: forest, meadow and lakes in different shades.
				green = smoothstep(0.42, 0.5, n.fbm(x * 4 + 33, y * 4, z * 4, 4)) * (0.75 + 0.25 * n.noise(x * 30, y * 30, z * 30));
				t += 0.12;
				water = smoothstep(0.66, 0.7, n.fbm(x * 2 + 50, y * 2, z * 2, 4));
			} else if (p === "canals") {
				const w = n.fbm(x * 2 + 4, y * 2, z * 2, 3);
				const canal = ridge(n.fbm(x * 3 + w * 2, y * 3 + w * 2, z * 3, 4));
				water = smoothstep(0.94, 0.975, canal);
				// Lit embankments line both sides of each canal.
				bank = smoothstep(0.9, 0.935, canal) * (1 - water);
			} else if (p === "ruins") {
				// An abandoned city, reclaimed by forest and water; only a few lights still burn.
				green = smoothstep(0.38, 0.5, n.fbm(x * 3 + 33, y * 3, z * 3, 4)) * (0.7 + 0.3 * n.noise(x * 40, y * 40, z * 40));
				water = smoothstep(0.68, 0.72, n.fbm(x * 2 + 50, y * 2, z * 2, 4));
				t += 0.15;
			} else if (p === "metropolis") {
				// One continuous downtown: brighter, denser, and lit up everywhere at night.
				t += 0.1;
			} else {
				// "sprawl": the last of the old seas survive as dark reservoirs.
				water = smoothstep(0.24, 0.2, district);
			}
			ramp(P.a, t, c);
			if (p === "foundry") {
				mix(c, [150, 92, 58], smoothstep(0.45, 0.7, district) * 0.5);
				mix(c, [30, 27, 26], smoothstep(0.4, 0.25, district) * 0.7);
				mix(c, [150, 140, 128], smoothstep(0.55, 0.75, n.fbm(x * 6 + district * 3, y * 6, z * 6, 3)) * 0.3);
			}
			scale(c, 1 - roads * 0.35 - streets * 0.15);
			const meadow = n.fbm(x * 10 + 4, y * 10, z * 10, 3);
			mix(c, [34 + 50 * meadow, 66 + 50 * meadow, 40 + 20 * meadow], green * 0.8);
			mix(c, [24, 40, 58], water * 0.9);
			if (water > 0.5) S.specular = 0.6;
			if (heat > 0) {
				// Furnaces are small hot points: dull by day, glowing at night.
				mix(c, [200, 110, 50], heat * 0.3);
				S.emit[0] += 255 * heat;
				S.emit[1] += 130 * heat;
				S.emit[2] += 40 * heat;
			}
			S.specular = Math.max(S.specular, 0.3);
			// Night: lights along roads and canal banks, sprinkled through busy districts.
			// Roads show as strings of separate lights, not solid lines.
			const dotted = smoothstep(0.45, 0.7, n.noise(x * 160 + 1, y * 160, z * 160));
			const towns = lightDots(x, y, z, 90, spec.seed, 0.15 + 0.6 * busy, 0.32);
			const cores = lightDots(x, y, z, 24, spec.seed ^ 0x99, 0.5 * busy, 0.7) * 0.35;
			S.city = Math.min(1, ((roads * 0.7 + bank * 0.6) * dotted + streets * dotted * 0.3 + towns * 0.85 + cores) * (0.2 + 0.8 * busy) * (1 - water) * (1 - green * 0.7));
			break;
		}
	}

	applyDetail(P, x, y, z, lat, c);

	if (P.craters.length > 0) {
		const moon = p === "moon";
		const bowl = moon ? 0.5 : 0.55, rimLight = moon ? 0.4 : 0.45;
		let f = 1;
		for (const cr of P.craters) {
			const u = Math.hypot(x - cr.x, y - cr.y, z - cr.z) / cr.r;
			// Dark bowl, then a sharp bright rim just outside it.
			if (u < 1) f *= bowl + (1 - bowl) * u * u * u;
			else if (u < 1.12) f *= 1 + rimLight * (1 - (u - 1) / 0.12);
		}
		scale(c, f);
	}

	if (P.impact) {
		const im = P.impact;
		const dx = x - im.x, dy = y - im.y, dz = z - im.z;
		const u = Math.hypot(dx, dy, dz) / im.r;
		if (u < 1) {
			// Deep bowl with a raised central peak.
			scale(c, 0.42 + 0.3 * u * u * u + 0.45 * smoothstep(0.18, 0, u));
		} else if (u < 1.14) {
			scale(c, 1.7 - (u - 1) * 5);
		} else if (u < 2.6) {
			// Bright ejecta rays splashed out from the impact.
			const len = Math.hypot(dx, dy, dz) || 1;
			const ray = Math.pow(n.noise((dx / len) * 7 + 3, (dy / len) * 7, (dz / len) * 7), 4) * 2.2;
			scale(c, 1 + ray * smoothstep(2.6, 1.14, u));
		}
	}

	if (hasFeature(spec, "iceCaps")) {
		const cap = smoothstep(0.74, 0.8, Math.abs(lat) + (n.noise(x * 6, y * 6, z * 6) - 0.5) * 0.15);
		mix(c, [240, 246, 255], cap);
		if (cap > 0.5) S.specular = 0.25;
	}

	if (spec.features.length > 0) applyFeatures(P, x, y, z, S);
}

/** Dead worlds: nothing lives here any more. Cold crust, ash and dust, and sometimes fire beneath. */
function deadWorld(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { spec, noise: n } = P;
	const p = spec.pattern, c = S.color;
	const grain = n.noise(x * 30 + 17, y * 30, z * 30) - 0.5;
	const rough = stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2);
	ramp(P.a, rough * 0.75 + grain * 0.12 + 0.1, c);
	let glow = 0;
	if (p === "fractured crust") {
		// The crust has broken into plates; molten rock shows through the widest cracks.
		// Plates of every size; only some cracks have opened far enough to show the fire below.
		const w = (n.fbm(x * 2.5 + 4, y * 2.5, z * 2.5, 4) - 0.5) * 0.55;
		cells(x + w, y - w, z + w, 3.6, spec.seed, H);
		const gap = H.d2 - H.d1 + (n.fbm(x * 18, y * 18, z * 18, 2) - 0.5) * 0.08;
		const open = smoothstep(0.45, 0.65, n.fbm(x * 2 + 9, y * 2, z * 2, 3));
		const crack = smoothstep(0.03 + 0.05 * open, 0.008, gap);
		scale(c, 0.75 + H.id * 0.4);
		glow = crack * (0.25 + 0.75 * open);
		scale(c, 1 - smoothstep(0.1, 0.04, gap) * 0.5);
	} else if (p === "corruption") {
		// Dark veins spread out from a few blighted places, staining the rock around them.
		let reach = 0;
		for (const b of P.blight) reach = Math.max(reach, smoothstep(b.r * 1.6, 0, Math.hypot(x - b.x, y - b.y, z - b.z)));
		const w = n.fbm(x * 2 + 3, y * 2, z * 2, 3);
		// Thin dark veins with a faint sick glow at their core, the rock blackened around them.
		const vr = ridge(n.fbm(x * 4 + w * 2, y * 4 + w * 2, z * 4, 4));
		const vein = smoothstep(0.95, 0.985, vr) * smoothstep(0.05, 0.4, reach);
		const fr = ridge(n.fbm(x * 11 + 7, y * 11, z * 11, 3));
		const fine = smoothstep(0.965, 0.99, fr) * smoothstep(0.3, 0.8, reach);
		scale(c, 1 - reach * 0.35);
		mix(c, P.accent, reach * 0.08);
		const v = Math.max(vein, fine * 0.7);
		scale(c, 1 - v * 0.6);
		const core = Math.max(smoothstep(0.978, 0.995, vr) * smoothstep(0.1, 0.5, reach), smoothstep(0.985, 0.997, fr) * smoothstep(0.4, 0.9, reach) * 0.6);
		mix(c, P.accent, core * 0.55);
		S.emit[0] += P.accent[0] * core * 0.7;
		S.emit[1] += P.accent[1] * core * 0.7;
		S.emit[2] += P.accent[2] * core * 0.7;
	} else if (p === "frozen tomb") {
		// A dead world gone cold: grey rock under frost, its old seas frozen solid.
		const grey = (c[0] + c[1] + c[2]) / 3;
		c[0] = grey * 1.1 + 10;
		c[1] = grey * 1.1 + 14;
		c[2] = grey * 1.1 + 22;
		const sea = smoothstep(0.42, 0.36, n.fbm(x * 1.8 + 21, y * 1.8, z * 1.8, 4));
		mix(c, [190, 205, 220], sea * 0.75);
		mix(c, [235, 242, 250], smoothstep(0.62, 0.75, n.fbm(x * 6 + 3, y * 6, z * 6, 3)) * 0.4);
		S.specular = 0.15 + 0.4 * sea;
	} else if (p === "rust plains") {
		// Iron-red dust plains, cut by the dry beds of rivers that vanished long ago.
		mix(c, [150, 70, 38], 0.6);
		const bed = smoothstep(0.95, 0.985, ridge(n.fbm(x * 3 + 4, y * 3, z * 3, 4)));
		// Darker volcanic rock shows through the dust in places.
		const dark = smoothstep(0.55, 0.65, n.fbm(x * 2.5 + 30, y * 2.5, z * 2.5, 4));
		scale(c, 1 - bed * 0.45 - dark * 0.4 + 0.2 * smoothstep(0.6, 0.9, n.fbm(x * 2, lat * 14, z * 2, 3)));
	} else if (p === "ashen") {
		// Pale grey ash drifted into dunes; a few embers still smoulder.
		const grey = (c[0] + c[1] + c[2]) / 3;
		c[0] = c[1] = c[2] = grey * 1.5 + 20;
		c[0] += 6;
		const d = lat * 22 + n.fbm(x * 3, y * 3, z * 3, 3) * 6;
		scale(c, 1 + 0.08 * Math.sin(d * Math.PI * 2));
		glow = lightDots(x, y, z, 40, spec.seed, 0.06, 0.25) * 0.7;
	} else {
		// "petrified": the seas dried long ago, leaving dark seabeds ringed with salt and cracked mud.
		// Old seabeds crusted with pale salt and cracked into polygons, old shorelines in bands around them.
		const sea = n.fbm(x * 1.8 + 21, y * 1.8, z * 1.8, 4);
		const bed = smoothstep(0.48, 0.4, sea);
		cells(x, y, z, 22, spec.seed ^ 3, H);
		const mud = smoothstep(0.045, 0.012, H.d2 - H.d1) * bed;
		const crust = 0.72 + 0.16 * H.id + (n.noise(x * 40, y * 40, z * 40) - 0.5) * 0.1;
		mix(c, [205 * crust, 198 * crust, 186 * crust], bed * 0.8);
		scale(c, 1 - mud * 0.35);
		// Terraces left by the falling water, as soft bands just outside the bed.
		const terrace = smoothstep(0.4, 0.56, sea) * (1 - smoothstep(0.56, 0.62, sea));
		scale(c, 1 + 0.12 * Math.sin(sea * 140) * terrace);
	}
	if (glow > 0) {
		ramp(P.b, glow, tmp);
		mix(c, tmp, glow * 0.75);
		S.emit[0] += tmp[0] * glow;
		S.emit[1] += tmp[1] * glow;
		S.emit[2] += tmp[2] * glow;
	}
	const volcano = vents(P, x, y, z);
	if (volcano > 0) lavaFlow(P, c, S, volcano);
}

/** Destroyed worlds: wrecked by an enormous impact, recently or long ago. */
function destroyedWorld(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { spec, noise: n } = P;
	const p = spec.pattern, c = S.color;
	const rough = stretch(n.fbm(x * 3.2, y * 3.2, z * 3.2, 5), 2);
	ramp(P.a, rough * 0.8 + (n.noise(x * 34, y * 34, z * 34) - 0.5) * 0.15, c);
	let glow = 0;
	if (p === "shattered") {
		// Blown apart: huge blocks drifting from each other with the molten interior blazing between them.
		// A few huge blocks, charred and scorched, pulling apart along jagged fissures of every width.
		const w = (n.fbm(x * 1.6 + 4, y * 1.6, z * 1.6, 4) - 0.5) * 0.6;
		cells(x + w, y - w, z + w, 1.7, spec.seed, H);
		const gap = H.d2 - H.d1 + (n.fbm(x * 12, y * 12, z * 12, 3) - 0.5) * 0.1;
		const wide = 0.03 + 0.07 * smoothstep(0.35, 0.65, n.fbm(x * 2.5 + 7, y * 2.5, z * 2.5, 3));
		const fissure = smoothstep(wide, wide * 0.25, gap);
		scale(c, 0.55 + H.id * 0.6);
		const heat = smoothstep(wide * 3, wide, gap);
		mix(c, [120, 40, 18], heat * 0.4);
		// Smaller cracks spread from the fissures into the blocks.
		const crack = smoothstep(0.955, 0.985, ridge(n.fbm(x * 7 + 3, y * 7, z * 7, 3))) * heat;
		glow = Math.max(fissure, crack * 0.8);
	} else if (p === "molten remnant") {
		// What is left is boiling away: a sea of glowing rock with dark crust floating on it.
		// A thin cooling skin over molten rock, torn open in a web of glowing seams and pools.
		const m = n.fbm(x * 3 + 11, y * 3, z * 3, 5);
		const seams = smoothstep(0.88, 0.97, ridge(n.fbm(x * 5 + m * 2, y * 5, z * 5, 4)));
		const pools = smoothstep(0.62, 0.7, m);
		glow = Math.max(seams * 0.85, pools * (0.7 + 0.3 * n.noise(x * 20, y * 20, z * 20)));
		ramp(P.a, 0.08 + rough * 0.35, c);
		// The skin itself is hot: dull red where it is thinnest.
		mix(c, [110, 36, 16], smoothstep(0.45, 0.62, m) * 0.6);
	} else if (p === "glassed") {
		// The impact melted the whole surface to glass: dark, glossy, frozen in ripples around the strike.
		const b = P.basin;
		ramp(P.a, 0.18 + 0.25 * rough, c);
		if (b) {
			const u = Math.hypot(x - b.x, y - b.y, z - b.z) / b.r;
			// Frozen ripples of melted rock, broken and uneven like real splash marks, not neat rings.
			const wave = Math.sin(u * 14 + n.fbm(x * 3, y * 3, z * 3, 4) * 7);
			const broken = smoothstep(0.35, 0.6, n.fbm(x * 6 + 2, y * 6, z * 6, 3));
			scale(c, 1 + (0.18 * wave + 0.35 * smoothstep(0.8, 1, wave)) * broken * smoothstep(2.2, 0.3, u));
			glow = smoothstep(0.18, 0, u) * 0.35 * (0.6 + 0.4 * n.noise(x * 20, y * 20, z * 20));
		}
		// Cracks where the glass cooled and shrank.
		scale(c, 1 - smoothstep(0.96, 0.99, ridge(n.fbm(x * 8 + 2, y * 8, z * 8, 3))) * 0.5);
		S.specular = 0.8;
	} else if (p === "cratered ruin") {
		// Pounded by impact after impact; the craters are drawn over this rubble.
		ramp(P.a, 0.2 + rough * 0.6 + (n.noise(x * 50, y * 50, z * 50) - 0.5) * 0.25, c);
		scale(c, 1 + 0.2 * (smoothstep(0.66, 0.7, n.noise(x * 40, y * 40, z * 40)) - smoothstep(0.34, 0.3, n.noise(x * 40, y * 40, z * 40))));
	} else if (p === "ancient scar") {
		// A giant multi-ring basin from an impact long ago: a smooth floor, rings of mountains, ejecta rays.
		const b = P.basin;
		if (b) {
			const dx = x - b.x, dy = y - b.y, dz = z - b.z;
			const u = Math.hypot(dx, dy, dz) / b.r;
			const wob = (n.fbm(x * 5 + 3, y * 5, z * 5, 3) - 0.5) * 0.08;
			if (u < 0.42 + wob) {
				ramp(P.a, 0.2 + 0.15 * rough, c);
			} else if (u < 1.05) {
				const ring = Math.sin((u + wob) * Math.PI * 7.5);
				scale(c, 1 + 0.55 * smoothstep(0.5, 1, ring) - 0.3 * smoothstep(-0.4, -1, ring));
			} else if (u < 2.2) {
				const len = Math.hypot(dx, dy, dz) || 1;
				const ray = Math.pow(n.noise((dx / len) * 8 + 3, (dy / len) * 8, (dz / len) * 8), 3) * 1.4;
				scale(c, 1 + ray * smoothstep(2.2, 1.05, u));
			}
		}
	} else {
		// "split": a chasm right through the planet, its walls falling away to a glowing core.
		const ch = P.chasm;
		if (ch) {
			const off = x * ch.n.x + y * ch.n.y + z * ch.n.z;
			const wob = (n.fbm(x * 4 + 1, y * 4, z * 4, 3) - 0.5) * 0.06;
			const d = Math.abs(off + wob);
			// The chasm widens and narrows along its length; its walls darken as they fall toward the core.
			const width = 0.12 + 0.1 * n.fbm(x * 2 + 30, y * 2, z * 2, 3);
			const inside = smoothstep(width, width * 0.8, d);
			const depth = d / width;
			ramp(P.a, 0.04 + 0.35 * depth * depth, tmp);
			scale(tmp, 0.6 + 0.4 * n.fbm(x * 14, y * 14, z * 14, 3));
			mix(c, tmp, inside);
			// Heat rises from the core: white-hot at the bottom, dull red up the walls.
			const fall = smoothstep(width * 0.9, 0, d);
			glow = fall * fall * (0.75 + 0.25 * n.noise(x * 25, y * 25, z * 25));
			// The wall facing up the slope catches light along the rim.
			const rim = smoothstep(width * 1.15, width, d) * (1 - smoothstep(width, width * 0.9, d));
			scale(c, 1 + rim * (off + wob > 0 ? 0.6 : -0.25));
			// Cracks spread out from the rim.
			const crack = smoothstep(0.94, 0.98, ridge(n.fbm(x * 6 + 7, y * 6, z * 6, 3))) * smoothstep(width * 3, width, d) * (1 - inside);
			glow = Math.max(glow, crack * 0.8);
			scale(c, 1 - smoothstep(width * 1.4, width, d) * (1 - inside) * 0.3);
		}
	}
	if (glow > 0) {
		ramp(P.b, glow, tmp);
		mix(c, tmp, glow * 0.85);
		S.emit[0] += tmp[0] * glow;
		S.emit[1] += tmp[1] * glow;
		S.emit[2] += tmp[2] * glow;
	}
}

/** Snow worlds: deep snow everywhere under a heavy sky, shadows tinted by the palette. */
function snowWorld(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { spec, noise: n } = P;
	const p = spec.pattern, c = S.color;
	// Snow is mostly bright, but drifts, hollows and ridges cast tinted shadows.
	const h = n.fbm(x * 2 + 5, y * 2, z * 2, 5);
	const drift = n.fbm(x * 6 + 1, y * 6, z * 6, 4);
	let t = 0.08 + 0.75 * stretch(h, 2) + (drift - 0.5) * 0.45 + (n.noise(x * 40, y * 40, z * 40) - 0.5) * 0.08;
	if (p === "blizzard") {
		// Wind-driven snow in long streaks, and a white-out haze over everything.
		const w = n.fbm(x * 2, y * 2 + 9, z * 2, 3);
		t += 0.22 * Math.sin(lat * 34 + w * 10) * (0.5 + 0.5 * n.noise(x * 6, y * 6, z * 6));
		t = t * 0.8 + 0.2;
	} else if (p === "glacial valleys") {
		// Rivers of blue ice wind between the snowfields.
		const w = n.fbm(x * 2, y * 2 + 3, z * 2, 3);
		const valley = smoothstep(0.9, 0.97, ridge(n.fbm(x * 2.2 + w * 2, y * 2.2 + w * 2, z * 2.2, 4)));
		t = t * (1 - valley * 0.4);
	} else if (p === "frost peaks") {
		// Ranges of sharp peaks, each lit on one side and in blue shadow on the other.
		const peak = ridge(n.fbm(x * 4 + 3, y * 4, z * 4, 4));
		const side = n.fbm(x * 4 + 3.02, y * 4 - 0.02, z * 4, 4) - n.fbm(x * 4 + 2.98, y * 4 + 0.02, z * 4, 4);
		t += smoothstep(0.7, 0.95, peak) * side * 14;
	} else if (p === "sastrugi") {
		// Ridges carved by the wind, all running the same way.
		const w = n.fbm(x * 3 + 2, y * 3, z * 3, 3);
		const r = ridge(n.fbm(x * 3 + w, lat * 16 + w * 3, z * 3, 3));
		t += 0.4 * (r - 0.5);
	}
	ramp(P.a, clamp01(t), c);
	if (p === "glacial valleys") {
		const w = n.fbm(x * 2, y * 2 + 3, z * 2, 3);
		const valley = smoothstep(0.9, 0.97, ridge(n.fbm(x * 2.2 + w * 2, y * 2.2 + w * 2, z * 2.2, 4)));
		mix(c, [130, 180, 225], valley * 0.6);
		S.specular = Math.max(S.specular, 0.6 * valley);
	}
	if (p === "buried forests") {
		// Dark forest shows through the snow in the lowlands.
		// Dark forest in the lowlands, in clumps with soft edges, dusted with snow.
		const low = smoothstep(0.48, 0.4, h);
		const clumps = smoothstep(0.45, 0.6, n.fbm(x * 14 + 3, y * 14, z * 14, 3)) * low;
		const dusting = 0.75 + 0.25 * n.noise(x * 70, y * 70, z * 70);
		mix(c, P.b[P.b.length - 1], clumps * 0.8 * dusting);
		if (low > 0.3) cityLights(P, x, y, z, S);
	} else cityLights(P, x, y, z, S);
	// Crisp wind-crust texture, frost glitter, and the odd dark rock poking through.
	scale(c, 1 + 0.08 * (n.noise(x * 70 + 5, y * 70, z * 70) - 0.5) * 2);
	mix(c, WHITE, smoothstep(0.82, 0.88, n.noise(x * 90, y * 90, z * 90)) * 0.35);
	mix(c, P.b[0], smoothstep(0.86, 0.9, n.noise(x * 55 + 9, y * 55, z * 55)) * 0.5);
	S.specular = 0.35;
}

/** Worlds in the spirit of famous science fiction. */
function inspiredWorld(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { noise: n } = P;
	const c = S.color;
	switch (P.spec.pattern) {
		case "tidal ocean": {
			// A shallow sea over pale sand, swept by walls of water hundreds of metres high.
			const floor = n.fbm(x * 3 + 2, y * 3, z * 3, 4);
			ramp(P.a, 0.3 + 0.35 * floor, c);
			mix(c, P.b[0], smoothstep(0.55, 0.75, floor) * 0.35);
			const w = n.fbm(x * 1.2 + 9, y * 1.2, z * 1.2, 3);
			const v = (x * 0.8 + y * 0.6) * 2.6 + w * 1.6;
			const f = v - Math.floor(v);
			// Each wave: a long smooth back rising to a crest, a broad band of churning foam,
			// and the steep dark face below it; between waves the shallows lie calm.
			const reach = smoothstep(0.3, 0.55, n.fbm(x * 2 + 40, y * 2, z * 2, 3));
			const back = smoothstep(0.35, 0.8, f) * (1 - smoothstep(0.8, 0.82, f));
			const face = smoothstep(0.8, 0.84, f) * (1 - smoothstep(0.84, 0.95, f));
			const foam = smoothstep(0.76, 0.82, f) * (1 - smoothstep(0.86, 0.92, f)) * (0.6 + 0.4 * n.fbm(x * 20, y * 20, z * 20, 3));
			scale(c, 1 + back * 0.18 * reach - face * 0.45 * reach);
			mix(c, [236, 246, 246], foam * 0.9 * reach);
			S.specular = 0.7;
			break;
		}
		case "dune sea": {
			// Endless dunes the size of mountains, their crests sharp and their lee sides in shadow.
			// Two sets of dunes cross where the wind shifts, and their size changes from place to place.
			const w = n.fbm(x * 1.3 + 3, y * 1.3, z * 1.3, 4);
			const size = 7 + 6 * n.fbm(x * 1.1 + 30, y * 1.1, z * 1.1, 3);
			const d1 = (x * 0.3 + lat) * size + w * 6;
			const d2 = (x - lat * 0.4) * size * 0.6 + w * 5 + 11;
			const saw = (d: number) => {
				const f = d - Math.floor(d);
				return f < 0.75 ? f / 0.75 : (1 - f) / 0.25;
			};
			const mixW = smoothstep(0.35, 0.65, n.fbm(x * 2 + 50, y * 2, z * 2, 3));
			const slope = saw(d1) * (1 - mixW * 0.6) + saw(d2) * mixW * 0.6;
			ramp(P.a, 0.25 + 0.6 * slope + (n.noise(x * 40, y * 40, z * 40) - 0.5) * 0.08, c);
			// Fine ripples, and dark rock where the sand runs thin.
			scale(c, 1 + 0.05 * Math.sin(lat * 200 + w * 20));
			mix(c, P.b[0], smoothstep(0.72, 0.8, n.fbm(x * 3 + 20, y * 3, z * 3, 4)) * 0.7);
			break;
		}
		case "frozen waste": {
			// Ice plains under blowing snow, with dark rock ridges breaking through.
			const h = n.fbm(x * 2.5, y * 2.5, z * 2.5, 5);
			ramp(P.a, 0.45 + 0.5 * h + 0.1 * Math.sin(lat * 50 + h * 12), c);
			// Ranges of bare rock where the wind scours the snow away: rugged, shaded and dusted white.
			const range = smoothstep(0.55, 0.7, n.fbm(x * 2 + 7, y * 2, z * 2, 4));
			const rugged = n.fbm(x * 12 + 3, y * 12, z * 12, 4);
			const rock = range * smoothstep(0.45, 0.6, rugged);
			ramp(P.b, rugged, tmp);
			mix(c, tmp, rock * 0.8);
			mix(c, WHITE, rock * smoothstep(0.65, 0.8, n.noise(x * 50, y * 50, z * 50)) * 0.5);
			S.specular = 0.4;
			break;
		}
		case "forest moon": {
			// Unbroken forest canopy, threaded with rivers and hung with mist; it glows at night.
			const canopy = n.fbm(x * 5, y * 5, z * 5, 6);
			ramp(P.a, canopy * 0.9 + (n.noise(x * 60, y * 60, z * 60) - 0.5) * 0.15, c);
			const river = smoothstep(0.955, 0.975, ridge(n.fbm(x * 2.2 + 3, y * 2.2, z * 2.2, 4)));
			ramp(P.b, 0.5, tmp);
			mix(c, tmp, river * 0.85);
			mix(c, [205, 220, 212], smoothstep(0.6, 0.75, n.fbm(x * 4 + 30, y * 4, z * 4, 4)) * 0.45);
			bioluminescence(P, x, y, z, S, 1 - river);
			break;
		}
		case "fire world": {
			// Black volcanic rock cut by rivers of lava; the ash clouds come from its feature.
			ramp(P.a, stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2) * 0.9, c);
			const w = n.fbm(x * 1.3, y * 1.3, z * 1.3, 3);
			const rv = ridge(0.5 + n.fbm(x * 1.6 + w * 2, y * 2.5 + w * 2, z * 1.6, 4) - n.fbm(x * 1.6 + 40, y * 2.5, z * 1.6 + w * 2, 4));
			const glow = Math.max(smoothstep(0.9, 0.97, rv), smoothstep(0.96, 0.99, ridge(n.fbm(x * 6 + 2, y * 6, z * 6, 3))) * 0.7);
			ramp(P.b, glow, tmp);
			mix(c, tmp, glow * 0.8);
			setEmit(S, tmp, glow);
			break;
		}
		case "storm ocean": {
			// A dark, wind-whipped ocean with no land at all (mostly hidden under storm clouds).
			ramp(P.a, 0.3 + 0.5 * n.fbm(x * 3, y * 3, z * 3, 4), c);
			mix(c, WHITE, smoothstep(0.75, 0.85, n.fbm(x * 12, lat * 20, z * 12, 3)) * 0.35);
			S.specular = 0.6;
			break;
		}
		case "cloud giant": {
			// Soft pastel bands of billowing cloud tops, a giant you could float a city in.
			const w = n.fbm(x * 2, y * 5, z * 2, 4) - 0.5;
			const v = lat * 5 + w * 1.2;
			const bands = 0.5 + 0.3 * Math.sin(v * Math.PI);
			const billow = ridge(n.fbm(x * 7 + v, y * 7, z * 7, 4));
			ramp(P.a, bands + (billow - 0.5) * 0.35, c);
			scale(c, 0.9 + 0.15 * billow);
			break;
		}
	}
}

/** Our own solar system's planets, painted as they really look. */
function realPlanet(P: Prepared, x: number, y: number, z: number, lat: number, S: Surface) {
	const { spec, noise: n } = P;
	const c = S.color;
	const band = (freq: number, turb: number, ramp1: number) => {
		const w = n.fbm(x * 2, y * 5, z * 2, 4) - 0.5;
		const v = lat * freq + w * turb;
		return 0.5 + ramp1 * Math.sin(v * Math.PI) * (0.6 + 0.4 * Math.sin(v * 1.7 + 1));
	};
	switch (spec.pattern) {
		case "Mercury":
			ramp(P.a, stretch(n.fbm(x * 4, y * 4, z * 4, 6), 2) * 0.8 + (n.noise(x * 40, y * 40, z * 40) - 0.5) * 0.15 + 0.1, c);
			break;
		case "Venus": {
			// A world-wide cloud deck with faint sideways V-shaped bands.
			const v = lat * 3 + Math.abs(x) * 1.4 + n.fbm(x * 2, y * 2, z * 2, 4) * 0.8;
			ramp(P.a, 0.55 + 0.2 * Math.sin(v * Math.PI) + (n.fbm(x * 6, y * 6, z * 6, 3) - 0.5) * 0.15, c);
			break;
		}
		case "Earth": {
			const warp = n.fbm(x * 1.2 + 5, y * 1.2, z * 1.2, 3);
			const h = stretch(n.fbm(x * 1.6 + warp * 1.5, y * 1.6 + warp * 1.5, z * 1.6, 5), 2.4);
			if (h < 0.6) {
				ramp(P.a, h / 0.6, c);
				S.specular = 0.55;
			} else {
				// Deserts toward the tropics, forest elsewhere, brown in the mountains.
				const dry = smoothstep(0.5, 0.75, n.fbm(x * 3 + 2, y * 3, z * 3, 3)) * (1 - Math.abs(lat));
				ramp(P.b.slice(1), Math.pow((h - 0.6) / 0.4, 1.3), c);
				mix(c, P.b[0], dry * 0.7);
				cityLights(P, x, y, z, S);
			}
			break;
		}
		case "Mars": {
			ramp(P.a, stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2) * 0.6 + 0.35 + (n.noise(x * 30, y * 30, z * 30) - 0.5) * 0.08, c);
			// Darker regions of exposed rock.
			const dark = smoothstep(0.52, 0.62, n.fbm(x * 1.6 + 7, y * 1.6, z * 1.6, 4));
			scale(c, 1 - dark * 0.35);
			break;
		}
		case "Jupiter": {
			ramp(P.a, band(7, 1.4, 0.45), c);
			// The Great Red Spot, swirling in the southern belt.
			const dx = (x - 0.25) / 0.2, dy = (y - 0.32) / 0.11;
			const d = Math.hypot(dx, dy);
			if (d < 1.2) {
				const swirl = 0.5 + 0.5 * Math.sin(d * 9 - Math.atan2(dy, dx) * 2);
				ramp([[150, 55, 35], P.accent, [225, 150, 110]], swirl * (1 - d * 0.6), tmp);
				mix(c, tmp, smoothstep(1.2, 0.85, d));
			}
			break;
		}
		case "Saturn":
			ramp(P.a, band(5, 0.5, 0.3), c);
			break;
		case "J1407b":
			ramp(P.a, band(6, 0.9, 0.35), c);
			break;
		case "Uranus":
			// Almost featureless: the faintest bands.
			ramp(P.a, 0.55 + 0.08 * Math.sin(lat * 6) + (n.fbm(x * 3, y * 3, z * 3, 3) - 0.5) * 0.08, c);
			break;
		case "Neptune": {
			ramp(P.a, band(4, 0.8, 0.25), c);
			// Bright high streaks of cloud, and the Great Dark Spot with white clouds at its edge.
			const streak = smoothstep(0.75, 0.9, n.fbm(x * 3, lat * 20, z * 3, 3));
			mix(c, [235, 240, 255], streak * 0.7);
			const d = Math.hypot((x + 0.22) / 0.17, (y + 0.22) / 0.1);
			mix(c, P.accent, smoothstep(1, 0.6, d) * 0.85);
			mix(c, [240, 244, 255], smoothstep(0.25, 0, Math.abs(d - 1.15)) * 0.6 * smoothstep(0, 0.5, x + 0.22));
			break;
		}
		case "Pluto": {
			ramp(P.a, stretch(n.fbm(x * 3, y * 3, z * 3, 5), 2) * 0.7 + 0.15, c);
			// The bright "heart" of nitrogen ice, and dark red highlands to its west.
			const hx = (x - 0.12) / 0.38, hy = (y + 0.05) / 0.38;
			const lobe = Math.min(Math.hypot(hx + 0.35, hy + 0.25), Math.hypot(hx - 0.35, hy + 0.25));
			const heart = Math.max(smoothstep(0.55, 0.45, lobe), hy > -0.3 && Math.abs(hx) < 0.9 - hy * 0.9 ? smoothstep(-0.3, -0.2, hy) * smoothstep(0.95, 0.4, hy) : 0);
			mix(c, [245, 235, 222], heart * 0.85 * smoothstep(0.1, 0.4, z));
			mix(c, [70, 30, 22], smoothstep(0.1, -0.2, x + 0.2) * smoothstep(0.5, 0.1, Math.abs(lat)) * 0.7);
			break;
		}
	}
}

/**
 * The faceted crystal worlds: the whole planet cut like a gem. Each face is a
 * flat plane that catches the light on its own, with depth inside it (color
 * shifting across the face, as light refracts), bevelled bright edges, and
 * tiny inclusions that sparkle.
 */
function faceted(P: Prepared, x: number, y: number, z: number, S: Surface) {
	const { spec, noise: n } = P;
	const p = spec.pattern, c = S.color;
	voronoi(P, x, y, z);
	const shade = P.cellShade[V.best];
	const cell = P.cells[V.best];
	const edge = edgeDistance(P);
	// A direction of its own for each face, along which its color deepens.
	const dir = shade * Math.PI * 2;
	const along = ((x - cell.x) * Math.cos(dir) + (y - cell.y) * Math.sin(dir) + (z - cell.z) * 0.3) * 3;
	// Cloudy depth inside the crystal, so faces are never flat paint.
	let t = 0.18 + shade * 0.62 + along * 0.14 + (n.fbm(x * 5 + shade * 11, y * 5, z * 5, 3) - 0.5) * 0.14;
	let tilt = 0.65;
	if (p === "geodes") {
		// Agate banding inside each cell, wobbling like real mineral layers, around a sparkling crystal heart.
		const band = V.d1 * 8 + (n.fbm(x * 5 + shade * 9, y * 5, z * 5, 3) - 0.5) * 1.6 + shade * 3;
		const f = band - Math.floor(band);
		t = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(f * Math.PI * 2)) + 0.25 * shade;
		tilt = 0.3;
		const heart = smoothstep(0.07, 0.03, V.d1);
		if (heart > 0) {
			cells(x, y, z, 120, spec.seed, H);
			t = Math.max(t, heart * (0.6 + 0.4 * H.id));
		}
	}
	ramp(P.a, clamp01(t), c);
	if (p === "prism") {
		// Rainbow light split across each face, as in a prism.
		hueRotate(c, (shade - 0.5) * 180 + along * 70);
		mix(c, WHITE, 0.08);
	}
	if (p === "shards") {
		// Growth lines running along each shard.
		const sa = dir + 1.2;
		scale(c, 1 + 0.07 * Math.sin((x * Math.cos(sa) + y * Math.sin(sa)) * 160 + shade * 20));
		tilt = 0.8;
	}
	// Bevelled edges: a crisp bright line on the border, a shadowed groove just inside it.
	const bevel = smoothstep(0.012, 0.003, edge);
	const groove = smoothstep(0.035, 0.012, edge) * (1 - bevel);
	scale(c, 1 - groove * 0.3);
	mix(c, WHITE, bevel * 0.6);
	// Inclusions: specks of light caught deep in the crystal.
	const inclusion = smoothstep(0.86, 0.92, n.noise(x * 95 + shade * 7, y * 95, z * 95)) * (1 - bevel);
	mix(c, WHITE, inclusion * 0.55);
	// Faces tip toward their center, so each one catches the light flatly.
	const nx = x * (1 - tilt) + cell.x * tilt, ny = y * (1 - tilt) + cell.y * tilt, nz = z * (1 - tilt) + cell.z * tilt;
	const len = Math.hypot(nx, ny, nz) || 1;
	S.nx = nx / len;
	S.ny = ny / len;
	S.nz = nz / len;
	// The edges glow faintly from within, so at night the cut lines stay visible.
	setEmit(S, P.accent, bevel * 0.4 + inclusion * 0.2);
	S.specular = 0.9;
}

/** The newer features, painted over the finished surface. */
function applyFeatures(P: Prepared, x: number, y: number, z: number, S: Surface) {
	const { spec, noise: n } = P;
	const c = S.color;

	for (const cr of P.chain) {
		const u = Math.hypot(x - cr.x, y - cr.y, z - cr.z) / cr.r;
		// Fresh craters: a deep dark bowl, a bright raised rim and a splash of light ejecta.
		if (u < 1) scale(c, 0.35 + 0.45 * u * u);
		else if (u < 1.18) scale(c, 1.55 - (u - 1) * 2);
		else if (u < 1.9) scale(c, 1 + 0.18 * smoothstep(1.9, 1.18, u));
	}

	if (P.canyon) {
		const { c: cc, n: cn, len } = P.canyon;
		// Distance from the canyon's great circle, and how far along it from the middle.
		const off = x * cn.x + y * cn.y + z * cn.z;
		const along = Math.acos(Math.max(-1, Math.min(1, (x * cc.x + y * cc.y + z * cc.z) / Math.sqrt(Math.max(1e-6, 1 - off * off)))));
		const reach = smoothstep(len, len * 0.55, along);
		if (reach > 0) {
			// The trench meanders, and is widest in the middle.
			const wobble = (n.fbm(x * 3 + 21, y * 3, z * 3, 3) - 0.5) * 0.16 + (n.fbm(x * 9 + 5, y * 9, z * 9, 2) - 0.5) * 0.03;
			const width = (0.035 + 0.045 * smoothstep(len, 0, along)) * reach;
			const d = Math.abs(off + wobble);
			// Side canyons branch out from the trench and fade with distance.
			const near = smoothstep(0.22, 0.03, d) * reach;
			const branch = smoothstep(0.91, 0.96, ridge(n.fbm(x * 6 + 3, y * 6, z * 6, 4))) * near;
			const floor = Math.max(smoothstep(width, width * 0.4, d), branch * 0.85);
			// A sunlit edge on one wall and a shadow on the other give it depth.
			const wall = smoothstep(width * 1.7, width, d) * (1 - smoothstep(width, width * 0.7, d));
			const lit = off + wobble > 0 ? 0.35 : -0.15;
			scale(c, 1 - floor * 0.6 + wall * lit);
			c[0] = Math.min(255, c[0] + floor * 18);
			c[2] *= 1 - floor * 0.15;
		}
	}

	if (hasFeature(spec, "glowVeins")) {
		const v = smoothstep(0.955, 0.985, ridge(n.fbm(x * 3.4 + 13, y * 3.4, z * 3.4, 4)));
		if (v > 0) {
			mix(c, P.accent, v * 0.7);
			S.emit[0] += P.accent[0] * v * 0.85;
			S.emit[1] += P.accent[1] * v * 0.85;
			S.emit[2] += P.accent[2] * v * 0.85;
		}
	}

	for (const g of P.geysers) {
		const dx = x - g.x, dy = y - g.y, dz = z - g.z;
		const u = Math.hypot(dx, dy, dz) / g.r;
		if (u < 4) {
			// Frost blown out in streaks around each vent, a bright core, and a faint glow at night.
			const streak = 0.6 + 0.4 * Math.sin(Math.atan2(dy, dx) * 7 + g.r * 100);
			mix(c, [235, 246, 255], smoothstep(4, 1.2, u) * 0.6 * streak + smoothstep(1, 0.2, u) * 0.6);
			const k = smoothstep(1.4, 0, u) * 0.9;
			S.emit[0] += 140 * k;
			S.emit[1] += 215 * k;
			S.emit[2] += 255 * k;
		}
	}

	if (P.hex) {
		const h = P.hex;
		const dot = x * h.x + y * h.y + z * h.z;
		// Position in the plane touching the planet at the hexagon's center.
		const ux = x - h.x * dot, uy = y - h.y * dot, uz = z - h.z * dot;
		const e1 = normalize({ x: 1, y: 0, z: -h.x / (h.z || 1) });
		const e2 = { x: h.y * e1.z - h.z * e1.y, y: h.z * e1.x - h.x * e1.z, z: h.x * e1.y - h.y * e1.x };
		const px = ux * e1.x + uy * e1.y + uz * e1.z, py = ux * e2.x + uy * e2.y + uz * e2.z;
		const rr = Math.hypot(px, py), a = Math.atan2(py, px);
		const seg = Math.PI / 3, local = ((a % seg) + seg) % seg - seg / 2;
		// The edge wobbles a little, as a jet stream would, so it never looks drawn with a ruler.
		const hd = (rr * Math.cos(local)) / 0.4 + (n.fbm(x * 9 + 4, y * 9, z * 9, 3) - 0.5) * 0.1;
		if (dot > 0 && hd < 1.2) {
			// A dark swirling hexagon with a bright jet stream tracing its six edges.
			const swirl = 0.5 + 0.5 * Math.sin(rr * 34 - a * 3 + n.noise(x * 8, y * 8, z * 8) * 2);
			if (hd < 1) {
				ramp(P.a, 0.08 + 0.3 * swirl * hd, tmp);
				mix(c, tmp, 0.8 * smoothstep(1, 0.9, hd));
				const eye = smoothstep(0.18, 0.05, rr / 0.4);
				ramp(P.a, 0.85, tmp);
				mix(c, tmp, eye);
			}
			const edge = smoothstep(0.16, 0.02, Math.abs(hd - 1));
			ramp(P.a, 0.85, tmp);
			mix(c, tmp, edge * 0.45);
		}
	}

	if (P.rift) {
		const { c: rc, n: rn } = P.rift;
		// An enormous crevice across a living world: sheer walls dropping into darkness,
		// a faint glow of magma far below, and the land along its rim broken and lifted.
		const off = x * rn.x + y * rn.y + z * rn.z;
		const along = Math.acos(Math.max(-1, Math.min(1, (x * rc.x + y * rc.y + z * rc.z) / Math.sqrt(Math.max(1e-6, 1 - off * off)))));
		const reach = smoothstep(1.35, 1, along);
		if (reach > 0) {
			const wob = (n.fbm(x * 3 + 2, y * 3, z * 3, 3) - 0.5) * 0.08 + (n.fbm(x * 12, y * 12, z * 12, 2) - 0.5) * 0.015;
			const width = (0.06 + 0.07 * n.fbm(x * 2 + 9, y * 2, z * 2, 3)) * reach;
			const d = Math.abs(off + wob);
			const inside = smoothstep(width, width * 0.75, d);
			const depth = d / Math.max(width, 1e-4);
			ramp(P.a, 0.03, tmp);
			scale(tmp, 0.4 + 0.6 * depth * depth);
			mix(c, tmp, inside * 0.95);
			// Sunlit edge on one wall, deep shadow on the other.
			const rim = smoothstep(width * 1.4, width, d) * (1 - smoothstep(width, width * 0.85, d));
			scale(c, 1 + rim * (off + wob > 0 ? 0.35 : -0.3));
			// Cracked land along both sides.
			const crack = smoothstep(0.95, 0.985, ridge(n.fbm(x * 8 + 5, y * 8, z * 8, 3))) * smoothstep(width * 4, width, d) * (1 - inside);
			scale(c, 1 - crack * 0.45);
			const glow = smoothstep(width * 0.35, 0, d) * reach * 0.8;
			S.emit[0] += 255 * glow;
			S.emit[1] += 110 * glow;
			S.emit[2] += 30 * glow;
			S.city *= 1 - inside;
			S.bio *= 1 - inside;
			S.specular *= 1 - inside;
		}
	}

	if (P.dust) {
		const d = P.dust;
		const dx = x - d.x, dy = y - d.y;
		const u = Math.hypot(dx, dy, z - d.z) / d.r;
		if (u < 1.4) {
			// A billowing wall of dust: bright, smooth and pale, hiding the ground's detail beneath.
			const a = Math.atan2(dy, dx);
			const curl = n.fbm(x * 3.5 + Math.cos(a + u * 2.5) * 0.5 + 31, y * 3.5 + Math.sin(a + u * 2.5) * 0.5, z * 3.5, 5);
			const cover = smoothstep(1.4, 0.3, u) * (0.5 + 0.5 * smoothstep(0.3, 0.55, curl));
			const mid = P.a[Math.floor(P.a.length / 2)];
			// Billows of light and shade, so it reads as a cloud of dust rolling over the ground.
			const billow = 0.72 + 0.9 * (curl - 0.35) + 0.1 * (n.noise(x * 18, y * 18, z * 18) - 0.5);
			tmp[0] = Math.min(255, (mid[0] * 0.25 + 205) * billow);
			tmp[1] = Math.min(255, (mid[1] * 0.25 + 172) * billow);
			tmp[2] = Math.min(255, (mid[2] * 0.25 + 125) * billow);
			// The storm front throws a dark band of shadow just outside its edge.
			const front = smoothstep(0.2, 0.25, curl) * (1 - smoothstep(0.25, 0.32, curl)) * smoothstep(1.4, 0.6, u);
			scale(c, 1 - front * 0.35);
			mix(c, tmp, cover * 0.95);
			S.city *= 1 - cover;
		}
	}

	if (P.hurricane) {
		const hc = P.hurricane;
		const dx = x - hc.x, dy = y - hc.y, dz = z - hc.z;
		const u = Math.hypot(dx, dy, dz) / hc.r;
		if (u < 2.6) {
			// Cloud texture twisted around the center, more tightly near it, so the
			// storm's bands wind inward the way a real cyclone's do.
			const twist = hc.spin * 2.5 * Math.exp(-u * 1.2);
			const ct = Math.cos(twist), st = Math.sin(twist);
			const qx = hc.x + dx * ct - dy * st, qy = hc.y + dx * st + dy * ct;
			const cloud = n.fbm(qx * 4.5 + 70, qy * 4.5, z * 4.5, 5);
			const puff = n.fbm(qx * 14 + 3, qy * 14, z * 14, 3);
			// Two spiral rain bands wind into the core (a logarithmic spiral), broken up by the cloud texture.
			const a = Math.atan2(dy, dx);
			const arm = 0.5 + 0.5 * Math.sin(2 * a + hc.spin * Math.log(u + 0.02) * 4.2);
			// A solid central mass, broken spiral bands outside it, and overcast across the region.
			const mass = smoothstep(0.6, 0.2, u);
			const bands = smoothstep(0.55, 0.72, arm * 0.6 + cloud * 0.55 + mass * 0.3) * smoothstep(2.6, 0.7, u);
			const overcast = smoothstep(2.6, 1.4, u) * smoothstep(0.5, 0.7, n.fbm(x * 3 + 11, y * 3, z * 3, 4)) * 0.55;
			let cover = Math.max(mass, bands, overcast);
			// The eye: a clear hole ringed by the tallest, brightest cloud.
			cover *= smoothstep(0.045, 0.1, u);
			const wall = smoothstep(0.26, 0.11, u);
			const shade = 0.78 + 0.16 * puff + 0.12 * wall;
			tmp[0] = 238 * shade + 10;
			tmp[1] = 241 * shade + 10;
			tmp[2] = 250 * shade + 5;
			mix(c, tmp, Math.min(1, cover));
			// Looking down the eye, the surface sits in the storm's shadow.
			if (u < 0.1) scale(c, 0.8 + 0.2 * smoothstep(0.02, 0.1, u));
			S.city *= 1 - cover;
			S.bio *= 1 - cover;
		}
	}

	if (hasFeature(spec, "ashClouds")) {
		const puff = n.fbm(x * 2.4 + 50, y * 2.4, z * 2.4, 5);
		const cover = smoothstep(0.54, 0.68, puff) * 0.85;
		if (cover > 0) {
			// Billowing grey-brown smoke, lighter on the tops of the billows.
			const lightness = 0.8 + 0.6 * n.noise(x * 10 + 3, y * 10, z * 10);
			tmp[0] = 88 * lightness;
			tmp[1] = 80 * lightness;
			tmp[2] = 74 * lightness;
			mix(c, tmp, cover);
			S.emit[0] *= 1 - cover * 0.7;
			S.emit[1] *= 1 - cover * 0.7;
			S.emit[2] *= 1 - cover * 0.7;
		}
	}

	if (hasFeature(spec, "smog")) {
		// A brown industrial haze, thick in places, that dims the city lights beneath it.
		const cover = 0.25 + 0.5 * smoothstep(0.35, 0.7, n.fbm(x * 2 + 60, y * 2, z * 2, 5));
		mix(c, [128, 112, 82], cover * 0.65);
		S.city *= 1 - cover * 0.55;
	}
}

/**
 * Wildfires on land: blackened burn scars, smoke drifting off them, and
 * fire fronts along their edges that glow (faintly by day, brightly at night).
 */
function wildfires(P: Prepared, x: number, y: number, z: number, S: Surface) {
	if (!hasFeature(P.spec, "wildfires")) return;
	const n = P.noise, c = S.color;
	const burn = n.fbm(x * 3 + 90, y * 3, z * 3, 4);
	const scar = smoothstep(0.56, 0.6, burn);
	scale(c, 1 - scar * 0.55);
	c[0] = Math.min(255, c[0] + scar * 10);
	// The fire line sits on the edge of the burn, broken up by wind.
	const front = smoothstep(0.012, 0, Math.abs(burn - 0.57)) * smoothstep(0.55, 0.75, n.noise(x * 45, y * 45, z * 45));
	S.emit[0] += 255 * front;
	S.emit[1] += 120 * front;
	S.emit[2] += 30 * front;
	const smoke = smoothstep(0.5, 0.7, n.fbm(x * 5 + burn * 2 + 3, y * 5, z * 5, 4)) * smoothstep(0.45, 0.6, burn) * 0.6;
	mix(c, [150, 146, 140], smoke);
}

/** Glowing plankton or fungi: fine drifting filaments and sparkles that only show at night. */
function bioluminescence(P: Prepared, x: number, y: number, z: number, S: Surface, amount: number) {
	if (!hasFeature(P.spec, "bioluminescence") || amount <= 0) return;
	const n = P.noise;
	const w = n.fbm(x * 2 + 9, y * 2, z * 2, 3);
	const bloom = smoothstep(0.45, 0.65, n.fbm(x * 2.6 + 40, y * 2.6, z * 2.6, 3));
	if (bloom <= 0) return;
	// Thin glowing threads where the warped noise folds, like plankton drawn out by currents.
	const thread = smoothstep(0.9, 0.97, ridge(n.fbm(x * 5 + w * 3, y * 5 + w * 3, z * 5, 4)));
	const sparkle = smoothstep(0.74, 0.82, n.noise(x * 85 + 5, y * 85, z * 85));
	S.bio = Math.min(1, amount * bloom * (thread * 0.9 + sparkle * 0.7 + 0.08));
}

function applyDetail(P: Prepared, x: number, y: number, z: number, lat: number, c: RGB) {
	const n = P.noise;
	switch (P.spec.detail) {
		case "streaks":
			scale(c, 1 + 0.09 * Math.sin(lat * 70 + n.noise(x * 5, y * 5, z * 5) * 8));
			break;
		case "speckled": {
			const g = n.noise(x * 48 + 7, y * 48, z * 48);
			scale(c, 1 + 0.25 * smoothstep(0.72, 0.76, g) - 0.2 * smoothstep(0.28, 0.24, g));
			break;
		}
		case "rifts":
			scale(c, 1 - 0.55 * smoothstep(0.965, 0.985, ridge(stretch(n.fbm(x * 1.3 + 17, y * 1.3, z * 1.3, 3), 2))));
			break;
		case "mottled":
			// Soft blotches of lighter and darker ground.
			scale(c, 1 + 0.24 * (n.fbm(x * 7 + 3, y * 7, z * 7, 3) - 0.5));
			break;
		case "pocked": {
			// Countless tiny pits, each with a sunlit rim.
			cells(x, y, z, 55, P.spec.seed ^ 0x51, H);
			if (H.id > 0.55) {
				const u = H.d1 / (0.18 + H.id * 0.12);
				if (u < 1) scale(c, 0.78 + 0.15 * u);
				else if (u < 1.25) scale(c, 1 + 0.12 * smoothstep(1.25, 1, u));
			}
			break;
		}
		case "veined":
			// A fine network of darker veins through the surface.
			scale(c, 1 - 0.3 * smoothstep(0.955, 0.985, ridge(n.fbm(x * 9 + 7, y * 9, z * 9, 3))));
			break;
		case "ripples":
			// Fine ripples laid down by wind or water.
			scale(c, 1 + 0.07 * Math.sin(lat * 120 + n.fbm(x * 4, y * 4, z * 4, 3) * 24));
			break;
		case "spots":
			for (const s of P.spots) {
				// Ragged blotches, not circles: the edge wanders with noise.
				const edge = 1 + (n.fbm(x * 9 + s.x * 5, y * 9, z * 9, 3) - 0.5) * 0.7;
				const u = Math.hypot(x - s.x, y - s.y, z - s.z) / (s.r * edge);
				if (u < 1) scale(c, 0.72 + 0.1 * u);
				else if (u < 1.12) scale(c, 1 + 0.12 * smoothstep(1.12, 1, u));
			}
			break;
		default:
			break;
	}
}
