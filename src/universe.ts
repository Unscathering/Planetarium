// Turns the vault into a universe: each top-level folder becomes a solar
// system (a star, or now and then a black hole) and each note a planet on its
// own orbit. Notes with no links drift between systems as rogue planets, and a
// note whose only link is to one other note orbits that note as a moon.
// Systems are spread out so folders that link to each other a lot sit near
// each other. Nothing here touches Obsidian.

import { PlanetSpec, PlanetType, SIZE_SCALE, generatePlanet, planetDotColor } from "./planets/planet";
import { Orbit, generateOrbits, orbitPosition } from "./planets/orbit";
import { STAR_TYPES, SunSpec, generateSun } from "./planets/star";
import { hashString, makeRng } from "./planets/noise";

export interface NoteInput {
	path: string;
	name: string;
	/** Top-level folder, or "" for notes in the vault root. */
	folder: string;
	/** Created and last modified, in milliseconds since 1970. */
	ctime: number;
	mtime: number;
	tags: string[];
}

export interface UniverseOptions {
	/** Notes with no links become rogue planets instead of orbiting a sun. */
	rogues: boolean;
	/** Notes linked to exactly one note orbit it as moons. */
	moons: boolean;
	/** Mixed into every seed; the random dev universe uses it to re-roll. */
	salt?: string;
}

export type BodyKind = "planet" | "moon" | "rogue";

export interface Body {
	path: string;
	name: string;
	folder: string;
	kind: BodyKind;
	spec: PlanetSpec;
	/** Planets only. */
	orbit: Orbit | null;
	/** Radius in world units. */
	radius: number;
	/** The system whose sun lights this body; -1 for rogue planets. */
	system: number;
	/** Moons: the planet they orbit. */
	parent: number;
	/** Planets: their note moons, innermost first. */
	moons: number[];
	moonIndex: number;
	/** Rogue planets: home position. Also a per-body phase for drift and moon orbits. */
	hx: number;
	hy: number;
	phase: number;
	links: number[];
	color: string;
	ctime: number;
	mtime: number;
	tags: string[];
}

export interface SolarSystem {
	name: string;
	sun: SunSpec;
	sunRadius: number;
	x: number;
	y: number;
	/** Radius that contains every orbit, planet and moon. */
	extent: number;
	/** The planets orbiting this sun (moons hang off their planets). */
	bodies: number[];
}

export interface Universe {
	systems: SolarSystem[];
	bodies: Body[];
	links: Array<[number, number]>;
	rogues: number[];
}

/** How flat systems look: they are seen at a steep angle. */
export const SQUASH = 0.34;

/** Realistic-ish relative planet sizes: gas giants biggest, rocky worlds smallest. */
export const PLANET_SIZE: Record<PlanetType, number> = {
	gas: 16, toxic: 13, ice: 10, ocean: 9, terran: 8.5, jungle: 8.5,
	machine: 8.5, desert: 7.5, crystal: 7.5, lava: 6.5, scorched: 6.5, rocky: 5.5,
	dead: 7, destroyed: 6.5, snow: 8.5, real: 9, inspired: 8.5,
};

/** Real planets keep their real size order (squeezed, so Jupiter still fits beside Mercury). */
const REAL_SIZE: Record<string, number> = {
	Mercury: 4.5, Venus: 7.5, Earth: 7.8, Mars: 5.5, Jupiter: 17, Saturn: 15, Uranus: 11, Neptune: 10.8, Pluto: 3.5, J1407b: 15,
};

function bodySize(spec: PlanetSpec): number {
	return baseSize(spec) * SIZE_SCALE[spec.size ?? "standard"];
}

function baseSize(spec: PlanetSpec): number {
	if (spec.type === "real") return REAL_SIZE[spec.pattern] ?? 8;
	if (spec.type === "inspired") return spec.pattern === "cloud giant" ? 15 : 8.5;
	return PLANET_SIZE[spec.type];
}

/** How far a planet's k-th note moon orbits from it. */
export function moonDistance(parent: Body, k: number): number {
	return parent.radius * 3.6 + 5 + k * 5.5;
}

export function buildUniverse(
	notes: NoteInput[],
	resolvedLinks: Record<string, Record<string, number>>,
	options: UniverseOptions
): Universe {
	const salt = options.salt ?? "";
	const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
	const index = new Map<string, number>();
	const bodies: Body[] = sorted.map((note, i) => {
		index.set(note.path, i);
		const spec = generatePlanet(hashString(salt + note.path));
		return {
			path: note.path, name: note.name, folder: note.folder, kind: "planet", spec, orbit: null,
			radius: bodySize(spec), system: -1, parent: -1, moons: [], moonIndex: 0,
			hx: 0, hy: 0, phase: (hashString(`phase:${salt}${note.path}`) % 6283) / 1000,
			links: [], color: planetDotColor(spec), ctime: note.ctime, mtime: note.mtime, tags: note.tags,
		};
	});

	const links: Array<[number, number]> = [];
	const seen = new Set<string>();
	for (const src of Object.keys(resolvedLinks)) {
		const a = index.get(src);
		if (a === undefined) continue;
		for (const dest of Object.keys(resolvedLinks[src])) {
			const b = index.get(dest);
			if (b === undefined || b === a) continue;
			const key = a < b ? `${a}:${b}` : `${b}:${a}`;
			if (seen.has(key)) continue;
			seen.add(key);
			links.push([a, b]);
			bodies[a].links.push(b);
			bodies[b].links.push(a);
		}
	}

	// Decide what each note becomes.
	const rogues: number[] = [];
	bodies.forEach((b, i) => {
		if (options.rogues && b.links.length === 0) {
			b.kind = "rogue";
			rogues.push(i);
		} else if (options.moons && b.links.length === 1 && bodies[b.links[0]].links.length > 1) {
			b.kind = "moon";
			b.parent = b.links[0];
			b.radius = Math.min(b.radius * 0.45, 4.2);
		}
	});
	bodies.forEach((b, i) => {
		if (b.kind === "moon") bodies[b.parent].moons.push(i);
	});

	// Planets, grouped by folder, become solar systems.
	const groups = new Map<string, number[]>();
	bodies.forEach((b, i) => {
		if (b.kind !== "planet") return;
		const list = groups.get(b.folder);
		if (list) list.push(i);
		else groups.set(b.folder, [i]);
	});
	const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
	const systems: SolarSystem[] = [];
	ordered.forEach(([folder, members], si) => {
		const seed = hashString(`${salt}folder:${folder}`);
		const sun = generateSun(seed);
		// Oldest notes orbit closest, so a brand-new note takes the outermost orbit.
		members.sort((x, y) => bodies[x].ctime - bodies[y].ctime || bodies[x].path.localeCompare(bodies[y].path));
		const n = members.length;
		const base = 40 + 6 * Math.sqrt(n);
		const sunRadius = sun.kind === "star" ? base * Math.min(1.5, Math.max(0.6, STAR_TYPES[sun.star.type].size)) : base * 0.42;
		// First orbit clears the star's corona, or a black hole's disk.
		const inner = sun.kind === "star" ? sunRadius * 3 + 24 : sunRadius * 6.2 + 24;
		const orbits = generateOrbits(seed, n, inner);
		let extent = inner;
		members.forEach((bi, k) => {
			const b = bodies[bi];
			b.orbit = orbits[k];
			b.system = si;
			const reach = b.moons.length > 0 ? moonDistance(b, b.moons.length - 1) + 5 : b.radius * 4;
			extent = Math.max(extent, b.orbit.a * (1 + b.orbit.e) + reach);
			b.moons.forEach((mi, j) => {
				bodies[mi].system = si;
				bodies[mi].moonIndex = j;
			});
		});
		systems.push({ name: folder || "Vault", sun, sunRadius, x: 0, y: 0, extent, bodies: members });
	});

	layoutSystems(systems, bodies, links);
	placeRogues(systems, bodies, rogues, hashString(`${salt}rogues`));
	return { systems, bodies, links, rogues };
}

export interface Position {
	x: number;
	y: number;
	depth: number;
}

/** Where a body is at `time`, in world units. */
export function bodyPosition(u: Universe, bi: number, time: number, out: Position): Position {
	const b = u.bodies[bi];
	if (b.kind === "rogue") {
		// Rogues wander slowly around their home point.
		out.x = b.hx + Math.sin(time * 0.05 + b.phase) * 40;
		out.y = b.hy + Math.cos(time * 0.037 + b.phase * 1.3) * 24;
		out.depth = 0;
		return out;
	}
	if (b.kind === "moon") {
		bodyPosition(u, b.parent, time, out);
		const parent = u.bodies[b.parent];
		const d = moonDistance(parent, b.moonIndex);
		const a = b.phase + time * (1.6 / (1 + b.moonIndex * 0.5));
		out.x += Math.cos(a) * d;
		out.y += Math.sin(a) * d * SQUASH;
		return out;
	}
	const sys = u.systems[b.system];
	if (b.orbit) orbitPosition(b.orbit, time, SQUASH, out);
	else out.x = out.y = out.depth = 0;
	out.x += sys.x;
	out.y += sys.y;
	return out;
}

/**
 * Spreads systems out without overlapping, pulling together the ones that
 * share many links. A small, deterministic force simulation.
 */
function layoutSystems(systems: SolarSystem[], bodies: Body[], links: Array<[number, number]>) {
	const n = systems.length;
	if (n === 0) return;
	const weight = new Map<number, number>();
	for (const [a, b] of links) {
		const i = bodies[a].system, j = bodies[b].system;
		if (i < 0 || j < 0 || i === j) continue;
		const key = i < j ? i * n + j : j * n + i;
		weight.set(key, (weight.get(key) ?? 0) + 1);
	}
	const avg = systems.reduce((s, sys) => s + sys.extent, 0) / n;
	systems.forEach((sys, i) => {
		const a = i * 2.39996, d = Math.sqrt(i) * avg * 2.2;
		sys.x = Math.cos(a) * d;
		sys.y = Math.sin(a) * d;
	});

	const ITER = 350;
	const fx = new Float64Array(n), fy = new Float64Array(n);
	for (let it = 0; it < ITER + 60; it++) {
		const settling = it >= ITER;
		const cool = settling ? 0.5 : 1 - it / ITER;
		fx.fill(0);
		fy.fill(0);
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const A = systems[i], B = systems[j];
				let dx = B.x - A.x, dy = B.y - A.y;
				let d = Math.hypot(dx, dy);
				if (d < 1e-6) {
					dx = 1;
					dy = 0;
					d = 1;
				}
				const ux = dx / d, uy = dy / d;
				// Small systems still get room around them for their glow and name.
				const minD = Math.max((A.extent + B.extent) * 1.12 + 60, (A.extent + B.extent) * 0.5 + avg * 1.3);
				let f = 0;
				if (d < minD) f = -(minD - d) * 0.5;
				else if (!settling) {
					const w = weight.get(i * n + j) ?? 0;
					// Linked systems pull together; unlinked ones drift slightly apart.
					f = w > 0 ? Math.min(0.06, 0.006 * w) * (d - minD) : -Math.max(0, minD * 2.5 - d) * 0.01;
				}
				fx[i] += ux * f;
				fy[i] += uy * f;
				fx[j] -= ux * f;
				fy[j] -= uy * f;
			}
		}
		for (let i = 0; i < n; i++) {
			const sys = systems[i];
			if (!settling) {
				// Gentle pull toward the middle keeps the universe compact.
				fx[i] -= sys.x * 0.004;
				fy[i] -= sys.y * 0.004;
			}
			sys.x += fx[i] * cool;
			sys.y += fy[i] * cool;
		}
	}
}

/** Scatters rogue planets through the empty space between systems. */
function placeRogues(systems: SolarSystem[], bodies: Body[], rogues: number[], seed: number) {
	if (rogues.length === 0) return;
	let minX = -400, maxX = 400, minY = -300, maxY = 300;
	if (systems.length > 0) {
		minX = Math.min(...systems.map((s) => s.x - s.extent));
		maxX = Math.max(...systems.map((s) => s.x + s.extent));
		minY = Math.min(...systems.map((s) => s.y - s.extent * 0.6));
		maxY = Math.max(...systems.map((s) => s.y + s.extent * 0.6));
	}
	const padX = (maxX - minX) * 0.12 + 60, padY = (maxY - minY) * 0.12 + 60;
	minX -= padX;
	maxX += padX;
	minY -= padY;
	maxY += padY;
	const rng = makeRng(seed);
	const placed: Array<[number, number]> = [];
	for (const ri of rogues) {
		let x = 0, y = 0;
		for (let tries = 0; tries < 40; tries++) {
			x = minX + rng() * (maxX - minX);
			y = minY + rng() * (maxY - minY);
			const clearOfSystems = systems.every((s) => Math.hypot(s.x - x, (s.y - y) / 0.6) > s.extent * 1.05 + 30);
			const clearOfRogues = placed.every(([px, py]) => Math.hypot(px - x, py - y) > 50);
			if (clearOfSystems && clearOfRogues) break;
		}
		placed.push([x, y]);
		bodies[ri].hx = x;
		bodies[ri].hy = y;
	}
}
