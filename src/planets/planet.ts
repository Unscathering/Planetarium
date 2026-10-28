// Procedural planets: rolling a planet's traits and drawing it. The catalogue
// of types lives in types.ts, the surface painters in surface.ts, and the pixel
// work (which can run in a background worker) in pixels.ts.
//
// A planet is drawn in layers so its lighting can follow the sun smoothly
// without the planet itself ever turning: a flat-lit surface, a shadow mask
// rotated to face the sun, a glow layer that shows on the night side, and
// rings, debris and moons around it.

import { makeRng } from "./noise";
import { RGB, hexToRgb } from "./color";
import { MASK_LIGHT, SphereLayers, atmosphereColor, computeLitPixels, computeMasks, computeSphereLayers, contrast } from "./pixels";
import {
	ALL_TYPES,
	CLOUD_STYLES,
	Feature,
	MAX_FEATURES,
	MAX_MOONS,
	MOON_TYPES,
	MoonType,
	PLANET_TYPES,
	PlanetSpec,
	RING_COLORS,
	RING_STYLES,
	RING_WEIGHTS,
	RingStyle,
	Rings,
	MoonSize,
	RING_ANGLES,
	RING_FLAT,
	RingAngle,
	SizeClass,
	StormLevel,
	TiltClass,
	Vec3,
	fixedLooks,
	hasFeature,
	hasWeather,
} from "./types";

export * from "./types";

function pickRing(roll: number): Rings {
	const total = RING_STYLES.reduce((s, r) => s + RING_WEIGHTS[r], 0);
	let left = roll * total;
	return RING_STYLES.find((r) => (left -= RING_WEIGHTS[r]) < 0) ?? "thin";
}

/** Rolls a full planet from a seed. Anything in `overrides` is kept as given. */
export function generatePlanet(seed: number, overrides: Partial<PlanetSpec> = {}): PlanetSpec {
	const rng = makeRng(seed);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
	// Rare kinds (destroyed worlds, real planets) have small weights.
	const total = ALL_TYPES.reduce((s, t) => s + (PLANET_TYPES[t].weight ?? 1), 0);
	let roll = rng() * total;
	const rolled = ALL_TYPES.find((t) => (roll -= PLANET_TYPES[t].weight ?? 1) < 0) ?? ALL_TYPES[0];
	const type = overrides.type ?? rolled;
	const def = PLANET_TYPES[type];
	// Most planets stay simple; big moon families and many features are rare.
	const moonCount = Math.min(pick([0, 0, 0, 1, 1, 1, 2, 2, 3, 4]), MAX_MOONS);
	const featureCount = Math.min(pick([0, 0, 0, 1, 1, 1, 2, 2, 3]), MAX_FEATURES);
	const pool = [...def.features];
	const features: Feature[] = [];
	for (let i = 0; i < featureCount && pool.length > 0; i++) features.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
	const spec: PlanetSpec = {
		seed,
		type,
		pattern: pick(def.patterns),
		detail: pick(def.details),
		palette: Math.floor(rng() * def.palettes.length),
		atmosphere: pick(def.atmospheres),
		clouds: rng() < def.cloudChance ? pick(CLOUD_STYLES) : "none",
		rings: rng() < def.ringChance ? pickRing(rng()) : "none",
		ringColor: Math.floor(rng() * RING_COLORS.length),
		ringTilt: (rng() - 0.5) * 0.8,
		moons: Array.from({ length: moonCount }, () => pick(MOON_TYPES)).sort(),
		features: features.sort(),
		axialTilt: (rng() - 0.5) * 0.6,
		storm: "moderate",
		size: "standard",
		moonSizes: [],
		ringAngle: "tilted",
		tilt: "tilted",
	};
	// Rolled last, so it never changes anything rolled before it.
	const level = pick<StormLevel>(["calm", "moderate", "moderate", "heavy", "heavy", "extreme"]);
	const sizeClass = pick<SizeClass>(["small", "standard", "standard", "large"]);
	const moonSizes = Array.from({ length: MAX_MOONS }, () => pick<MoonSize>(["small", "small", "medium", "medium", "large"]));
	const ringAngle = pick<RingAngle>(RING_ANGLES);
	const tiltRoll = rng(), tiltSide = rng() < 0.5 ? -1 : 1, tiltAmount = rng();
	const tilt: TiltClass = tiltRoll < 0.35 ? "upright" : tiltRoll < 0.8 ? "tilted" : "sideways";
	// A shattered world is always surrounded by its own wreckage.
	if (type === "destroyed" && spec.pattern === "shattered" && !features.includes("debris")) {
		if (features.length >= MAX_FEATURES) features.pop();
		features.push("debris");
		features.sort();
	}
	// Real and fiction-inspired planets keep their fixed traits; only the seed (and so tiny details) changes.
	const fixed = fixedLooks(type);
	if (fixed) {
		const pattern = overrides.pattern ?? spec.pattern;
		// No cosmetics: no moons or extra features, just the planet as it is.
		Object.assign(spec, { features: [], moons: [], ringColor: 0, ringTilt: -0.3 }, fixed[pattern], { palette: def.patterns.indexOf(pattern), detail: "plain" });
	}
	// A hurricane needs weather around it: such a planet is never cloudless.
	if (features.includes("hurricane") && spec.clouds === "none") spec.clouds = rng() < 0.5 ? "wispy" : "patchy";
	const out = { ...spec, ...overrides };
	const fixedOut = fixedLooks(out.type);
	if (overrides.storm === undefined) out.storm = fixedOut ? fixedOut[out.pattern]?.storm ?? "moderate" : hasWeather(out) ? level : "moderate";
	if (overrides.size === undefined) out.size = fixedOut ? "standard" : sizeClass;
	if (fixedOut) {
		const lean = Math.abs(out.axialTilt);
		out.tilt = lean > 1.1 ? "sideways" : lean > 0.25 ? "tilted" : "upright";
		if (overrides.ringAngle === undefined) out.ringAngle = fixedOut[out.pattern]?.ringAngle ?? "tilted";
	} else {
		if (overrides.tilt === undefined) out.tilt = tilt;
		// The lean follows the tilt class (unless the caller chose an exact angle).
		if (overrides.axialTilt === undefined) {
			const lean = out.tilt === "upright" ? tiltAmount * 0.12 : out.tilt === "tilted" ? 0.3 + tiltAmount * 0.25 : 1.35 + tiltAmount * 0.2;
			out.axialTilt = lean * tiltSide;
		}
		if (overrides.ringAngle === undefined) out.ringAngle = ringAngle;
	}
	// Moon sizes, kept in a stable order so the same family always reads the same.
	if (overrides.moonSizes === undefined) {
		const pairs = out.moons.map((m, i) => [m, moonSizes[i]] as const).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
		out.moons = pairs.map((p) => p[0]);
		out.moonSizes = pairs.map((p) => p[1]);
	}
	return out;
}

const FEATURE_LABELS: Record<Feature, string> = {
	cityLights: "city lights",
	volcanoes: "volcanoes",
	stormEye: "giant storm",
	iceCaps: "ice caps",
	debris: "debris field",
	crater: "giant crater",
	hurricane: "hurricane",
	wildfires: "wildfires",
	bioluminescence: "bioluminescence",
	dustStorm: "dust storm",
	canyons: "great canyon",
	craterChain: "crater chain",
	geysers: "geysers",
	polarHex: "polar hexagon",
	stormChain: "storm chain",
	glowVeins: "glowing veins",
	smog: "smog",
	ashClouds: "ash clouds",
	greatRift: "great rift",
};

export function describePlanet(spec: PlanetSpec): string {
	const parts = [PLANET_TYPES[spec.type].label, spec.pattern];
	if (spec.size && spec.size !== "standard") parts.unshift(spec.size);
	if (spec.detail !== "plain") parts.push(spec.detail);
	if (spec.clouds !== "none") parts.push(`${spec.clouds} clouds`);
	if (spec.atmosphere !== "none") parts.push(`${spec.atmosphere} atmosphere`);
	if (spec.rings !== "none") parts.push(`${spec.rings} rings (${RING_COLORS[spec.ringColor]})`);
	for (const f of spec.features) parts.push(FEATURE_LABELS[f]);
	if (hasWeather(spec) && spec.storm !== "moderate") parts.push(`${spec.storm} weather`);
	if (spec.tilt === "sideways") parts.push("lying on its side");
	if (spec.moons.length > 0) {
		const list = spec.moons.map((m, i) => (spec.moonSizes?.[i] && spec.moonSizes[i] !== "medium" ? `${spec.moonSizes[i]} ${m}` : m));
		parts.push(`${spec.moons.length} moon${spec.moons.length > 1 ? "s" : ""} (${list.join(", ")})`);
	}
	return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Rarity: the chance of rolling exactly this planet, worked out from the same
// odds generatePlanet uses. Shown as "1 in N".

const MOON_COUNT_ODDS = [0, 0, 0, 1, 1, 1, 2, 2, 3, 4];
const FEATURE_COUNT_ODDS = [0, 0, 0, 1, 1, 1, 2, 2, 3];
const MOON_SIZE_ODDS: Record<MoonSize, number> = { small: 0.4, medium: 0.4, large: 0.2 };
const STORM_ODDS: Record<StormLevel, number> = { calm: 1 / 6, moderate: 2 / 6, heavy: 2 / 6, extreme: 1 / 6 };
const SIZE_ODDS: Record<SizeClass, number> = { small: 0.25, standard: 0.5, large: 0.25 };
const TILT_ODDS: Record<TiltClass, number> = { upright: 0.35, tilted: 0.45, sideways: 0.2 };

function chooseCount(n: number, k: number): number {
	let r = 1;
	for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
	return r;
}

function factorial(n: number): number {
	let r = 1;
	for (let i = 2; i <= n; i++) r *= i;
	return r;
}

/** One in how many planets looks exactly like this one (same traits, any seed). */
export function planetRarity(spec: PlanetSpec): number {
	const def = PLANET_TYPES[spec.type];
	const totalWeight = ALL_TYPES.reduce((s, t) => s + (PLANET_TYPES[t].weight ?? 1), 0);
	let p = (def.weight ?? 1) / totalWeight;
	if (fixedLooks(spec.type)) return 1 / (p / def.patterns.length);
	p /= def.patterns.length * def.details.length * def.palettes.length * def.atmospheres.length;
	p *= spec.clouds === "none" ? 1 - def.cloudChance : def.cloudChance / CLOUD_STYLES.length;
	if (spec.rings === "none") p *= 1 - def.ringChance;
	else {
		const ringTotal = RING_STYLES.reduce((s, r) => s + RING_WEIGHTS[r], 0);
		p *= (def.ringChance * RING_WEIGHTS[spec.rings]) / ringTotal / RING_COLORS.length / RING_ANGLES.length;
	}
	// Moons: how many, then which mix of types and sizes (in any order).
	const k = spec.moons.length;
	p *= MOON_COUNT_ODDS.filter((c) => Math.min(c, MAX_MOONS) === k).length / MOON_COUNT_ODDS.length;
	const kinds = new Map<string, number>();
	spec.moons.forEach((m, i) => {
		const size = spec.moonSizes?.[i] ?? "medium";
		kinds.set(m + size, (kinds.get(m + size) ?? 0) + 1);
		p *= (1 / MOON_TYPES.length) * MOON_SIZE_ODDS[size];
	});
	let orders = factorial(k);
	for (const c of kinds.values()) orders /= factorial(c);
	p *= orders;
	// Features: how many, then which ones from the type's list.
	const pool = def.features.length, f = spec.features.length;
	p *= FEATURE_COUNT_ODDS.filter((c) => Math.min(c, MAX_FEATURES, pool) === f).length / FEATURE_COUNT_ODDS.length;
	p /= chooseCount(pool, f) || 1;
	if (hasWeather(spec)) p *= STORM_ODDS[spec.storm];
	p *= SIZE_ODDS[spec.size ?? "standard"] * TILT_ODDS[spec.tilt ?? "tilted"];
	return 1 / p;
}

/** A name for how rare a planet is, from its 1-in-N odds. */
export function rarityTier(spec: PlanetSpec, oneIn: number): string {
	if (spec.type === "real") return "Real planet";
	if (spec.type === "inspired") return "Fiction icon";
	if (oneIn < 1e9) return "Common";
	if (oneIn < 1e11) return "Uncommon";
	if (oneIn < 1e13) return "Rare";
	if (oneIn < 1e15) return "Epic";
	return "Legendary";
}

/** "1 in 4.2 billion" */
export function formatOdds(oneIn: number): string {
	const n = Math.max(1, Math.round(oneIn));
	const scales: Array<[number, string]> = [[1e18, "quintillion"], [1e15, "quadrillion"], [1e12, "trillion"], [1e9, "billion"], [1e6, "million"]];
	for (const [v, name] of scales) if (n >= v) return `1 in ${(n / v).toFixed(n / v < 10 ? 1 : 0)} ${name}`;
	return `1 in ${n.toLocaleString("en-US")}`;
}

/** A single color that stands for the planet, for far-away dots and placeholders. */
export function planetDotColor(spec: PlanetSpec): string {
	const a = PLANET_TYPES[spec.type].palettes[spec.palette].a;
	return a[Math.floor(a.length / 2)];
}

// ---------------------------------------------------------------------------
// Layer images

export interface SphereImages {
	day: HTMLCanvasElement;
	glow: HTMLCanvasElement | null;
	lights: HTMLCanvasElement | null;
	shine: number;
}

function pixelsToCanvas(size: number, pixels: Uint8ClampedArray): HTMLCanvasElement {
	const canvas = createEl("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		const img = ctx.createImageData(size, size);
		img.data.set(pixels);
		ctx.putImageData(img, 0, 0);
	}
	return canvas;
}

export function layersToImages(layers: SphereLayers): SphereImages {
	return {
		day: pixelsToCanvas(layers.size, layers.day),
		glow: layers.glow ? pixelsToCanvas(layers.size, layers.glow) : null,
		lights: layers.lights ? pixelsToCanvas(layers.size, layers.lights) : null,
		shine: layers.shine,
	};
}

/**
 * Where surface images come from. The default makes them on the spot (fine for
 * previews); the plugin swaps in a cache fed by background workers. Returning
 * null means "not ready yet": a shaded disc in the planet's color is drawn.
 */
export type SphereSource = (spec: PlanetSpec, size: number, lumps: number) => SphereImages | null;

/** Everything that changes how a planet's surface is painted, as one string for caching. */
export function surfaceKey(spec: PlanetSpec, lumps: number): string {
	return [spec.seed, spec.type, spec.pattern, spec.detail, spec.palette, spec.clouds, spec.atmosphere, spec.features.join(","), spec.storm, spec.axialTilt.toFixed(3), lumps.toFixed(3)].join("|");
}

const directCache = new Map<string, SphereImages>();
const renderDirect: SphereSource = (spec, size, lumps) => {
	const key = `${surfaceKey(spec, lumps)}|${size}`;
	let imgs = directCache.get(key);
	if (!imgs) {
		imgs = layersToImages(computeSphereLayers(spec, size, lumps));
		directCache.set(key, imgs);
		if (directCache.size > 300) directCache.delete(directCache.keys().next().value as string);
	}
	return imgs;
};
let sphereSource: SphereSource = renderDirect;

export function setSphereSource(source: SphereSource | null) {
	sphereSource = source ?? renderDirect;
}

/** A finished sphere lit from one fixed direction (contact sheets, checks and color sampling). */
export function renderPlanetTexture(spec: PlanetSpec, size: number, light: Vec3, hardEdge = spec.pattern === "moon", lumps = 0): HTMLCanvasElement {
	return pixelsToCanvas(size, computeLitPixels(spec, size, light, hardEdge, lumps));
}

const maskCache = new Map<string, { shadow: HTMLCanvasElement; night: HTMLCanvasElement; dark: HTMLCanvasElement }>();

/** Shadow and night masks for a round body lit from the right; rotate them to aim at the sun. */
export function sphereMasks(size: number, hard: boolean) {
	const key = `${size}|${hard}`;
	let m = maskCache.get(key);
	if (!m) {
		const px = computeMasks(size, hard, MASK_LIGHT);
		m = { shadow: pixelsToCanvas(size, px.shadow), night: pixelsToCanvas(size, px.night), dark: pixelsToCanvas(size, px.dark) };
		maskCache.set(key, m);
	}
	return m;
}

/** Rounds a pixel size up to a power of two, so nearby zoom levels share images. */
export function textureSize(px: number, min = 8, max = 512): number {
	let b = min;
	while (b < px && b < max) b *= 2;
	return b;
}

// Off-screen canvases for combining layers, one per size: drawing from a canvas
// makes the browser copy all of it, so a small body must not use a big one.
const scratches = new Map<string, CanvasRenderingContext2D | null>();

function scratch(which: "a" | "b", size: number): CanvasRenderingContext2D | null {
	const side = textureSize(size, 8, 1024);
	const key = which + side;
	let ctx = scratches.get(key);
	if (ctx === undefined) {
		const c = createEl("canvas");
		c.width = c.height = side;
		ctx = c.getContext("2d");
		scratches.set(key, ctx);
	}
	if (!ctx) return null;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, size, size);
	return ctx;
}

/** Draws `img` with a mask rotated by `angle`, using `mode` to combine them, into a scratch canvas. */
function rotateInto(ctx: CanvasRenderingContext2D, mask: HTMLCanvasElement, size: number, angle: number) {
	ctx.save();
	ctx.translate(size / 2, size / 2);
	ctx.rotate(angle);
	ctx.drawImage(mask, -size / 2, -size / 2, size, size);
	ctx.restore();
}

/**
 * Draws a lit sphere at (x, y) with radius r. `angle` points toward the sun
 * (screen radians). Lumpy bodies are combined off-screen so the shadow never
 * spills past their outline; round ones are drawn straight onto the canvas.
 */
export function paintSphere(
	ctx: CanvasRenderingContext2D,
	imgs: SphereImages,
	x: number,
	y: number,
	r: number,
	angle: number,
	hard: boolean,
	lumpy: boolean
) {
	const t = ctx.getTransform();
	const density = Math.max(1, Math.hypot(t.a, t.b));
	const px = Math.max(4, Math.min(1024, Math.ceil(r * 2 * density)));
	const masks = sphereMasks(textureSize(px, 8, 256), hard);

	if (lumpy) {
		const s = scratch("a", px);
		if (!s) return;
		s.drawImage(imgs.day, 0, 0, px, px);
		s.globalCompositeOperation = "source-atop";
		rotateInto(s, masks.shadow, px, angle);
		if (imgs.glow) {
			s.globalCompositeOperation = "lighter";
			s.globalAlpha = 0.6;
			s.drawImage(imgs.glow, 0, 0, px, px);
		}
		ctx.drawImage(s.canvas, 0, 0, px, px, x - r, y - r, r * 2, r * 2);
		return;
	}

	ctx.drawImage(imgs.day, x - r, y - r, r * 2, r * 2);
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.drawImage(masks.shadow, -r, -r, r * 2, r * 2);
	ctx.restore();

	if (imgs.glow) {
		// Self-made light shows fully on the night side and faintly by day.
		const s = scratch("b", px);
		if (s) {
			s.drawImage(imgs.glow, 0, 0, px, px);
			s.globalCompositeOperation = "destination-in";
			rotateInto(s, masks.night, px, angle);
			ctx.save();
			ctx.globalCompositeOperation = "lighter";
			ctx.drawImage(s.canvas, 0, 0, px, px, x - r, y - r, r * 2, r * 2);
			ctx.restore();
		}
	}

	if (imgs.lights) {
		// City lights only on the night side, switching on just past the day/night line.
		const s = scratch("b", px);
		if (s) {
			s.drawImage(imgs.lights, 0, 0, px, px);
			s.globalCompositeOperation = "destination-in";
			rotateInto(s, masks.dark, px, angle);
			ctx.save();
			ctx.globalCompositeOperation = "lighter";
			ctx.drawImage(s.canvas, 0, 0, px, px, x - r, y - r, r * 2, r * 2);
			ctx.restore();
		}
	}

	if (imgs.shine > 0.08) {
		// A soft sun glint on shiny surfaces, where the sun's reflection would be.
		const lx = Math.cos(angle), ly = Math.sin(angle), lz = MASK_LIGHT.z;
		const hl = Math.hypot(lx, ly, lz + 1);
		const gx = x + (lx / hl) * r * 0.9, gy = y + (ly / hl) * r * 0.9;
		const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 0.42);
		g.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.45, imgs.shine * 0.8)})`);
		g.addColorStop(1, "rgba(255, 255, 255, 0)");
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(gx, gy, r * 0.42, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
}

/** A shaded disc in the planet's color, shown while its surface image is still being made. */
export function paintPlaceholder(ctx: CanvasRenderingContext2D, spec: PlanetSpec, x: number, y: number, r: number, angle: number) {
	ctx.fillStyle = planetDotColor(spec);
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.drawImage(sphereMasks(textureSize(r * 2, 8, 64), false).shadow, -r, -r, r * 2, r * 2);
	ctx.restore();
}

const atmoCache = new Map<string, HTMLCanvasElement>();

/** The soft glow of a planet's atmosphere around its edge (a small cached image, scaled). */
export function drawAtmosphereGlow(ctx: CanvasRenderingContext2D, spec: PlanetSpec, x: number, y: number, r: number) {
	if (spec.atmosphere === "none") return;
	const a = spec.atmosphere;
	const reach = a === "thick" ? 1.28 : a === "haze" ? 1.3 : a === "aurora" ? 1.22 : a === "storm" ? 1.2 : a === "rim" ? 1.18 : a === "airglow" ? 1.08 : 1.12;
	const strength = a === "thick" ? 0.55 : a === "haze" ? 0.5 : a === "rim" ? 0.6 : a === "airglow" ? 0.45 : 0.35;
	const c = atmosphereColor(spec);
	const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}|${reach}|${strength}`;
	let sprite = atmoCache.get(key);
	if (!sprite) {
		sprite = createEl("canvas");
		const S = 128;
		sprite.width = sprite.height = S;
		const sctx = sprite.getContext("2d");
		if (sctx) {
			const g = sctx.createRadialGradient(S / 2, S / 2, (S / 2) * (0.92 / reach), S / 2, S / 2, S / 2);
			g.addColorStop(0, `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${strength})`);
			g.addColorStop(1, `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, 0)`);
			sctx.fillStyle = g;
			sctx.fillRect(0, 0, S, S);
		}
		atmoCache.set(key, sprite);
	}
	ctx.drawImage(sprite, x - r * reach, y - r * reach, r * reach * 2, r * reach * 2);
}

/** How far rings and debris reach, in planet radii; cached ring images cover this much. */
export const RING_REACH = 2.45;
/** Colossal ring systems reach much further. */
export const COLOSSAL_REACH = 6.6;

export function ringReach(spec: PlanetSpec): number {
	return spec.rings === "colossal" ? COLOSSAL_REACH : RING_REACH;
}

export function hasRingLayer(spec: PlanetSpec): boolean {
	return spec.rings !== "none" || hasFeature(spec, "debris");
}

/** The part of the rings and debris behind the planet ("back") or in front of it ("front"). */
export function drawRingHalf(ctx: CanvasRenderingContext2D, spec: PlanetSpec, x: number, y: number, r: number, half: "back" | "front") {
	if (spec.rings !== "none") drawRings(ctx, spec, x, y, r, half);
	if (hasFeature(spec, "debris")) drawDebris(ctx, spec, x, y, r, half);
}

// ---------------------------------------------------------------------------
// Moons

export interface MoonPlacement {
	type: MoonType;
	spec: PlanetSpec;
	/** Offset and radius, in units of the planet's radius. */
	dx: number;
	dy: number;
	r: number;
	lumps: number;
	tilt: number;
}

function moonSpec(type: MoonType, seed: number): PlanetSpec {
	const plain = { detail: "plain" as const, atmosphere: "none" as const, rings: "none" as const, moons: [], features: [], clouds: "none" as const };
	if (type === "icy") return generatePlanet(seed, { ...plain, type: "ice", pattern: "cracked" });
	if (type === "lava") return generatePlanet(seed, { ...plain, type: "lava", pattern: "cracks" });
	if (type === "dusty") return generatePlanet(seed, { ...plain, type: "desert", pattern: "cratered" });
	if (type === "verdant") return generatePlanet(seed, { ...plain, type: "jungle", pattern: "rainforest" });
	if (type === "crystal") return generatePlanet(seed, { ...plain, type: "crystal", pattern: "crystal fields" });
	return generatePlanet(seed, { ...plain, type: "rocky", pattern: "moon" });
}

/** Where a planet's moons sit and how big they are; the same every time for the same planet. */
export function moonPlacements(spec: PlanetSpec): MoonPlacement[] {
	const rng = makeRng(spec.seed ^ 0x7f4a7c15);
	// Moons are spread around the planet so neighbours do not sit on top of each other.
	const start = rng() * Math.PI * 2, count = spec.moons.length;
	return spec.moons.map((type, i) => {
		const angle = start + (i / count) * Math.PI * 2 + (rng() - 0.5) * (2.4 / count);
		const dist = (1.55 + i * 0.42 + rng() * 0.2) * (spec.rings !== "none" ? 1.35 : 1);
		// Each moon's size class sets its size, with a little variation within the class.
		const size = spec.moonSizes?.[i];
		const jitter = rng();
		const r = size === "small" ? 0.08 + jitter * 0.04 : size === "large" ? 0.22 + jitter * 0.08 : size === "medium" ? 0.14 + jitter * 0.05 : 0.1 + Math.pow(jitter, 1.4) * 0.2;
		let dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist * 0.55;
		// Orbits are flattened, so push the moon out if it would land on the planet.
		const minDist = 1 + r * 1.8;
		const od = Math.hypot(dx, dy);
		if (od < minDist) {
			dx *= minDist / od;
			dy *= minDist / od;
		}
		// Every moon gets its own outline: nearly round for icy moons, properly lumpy for asteroids.
		const lumps =
			type === "asteroid" ? 0.24 + rng() * 0.12
			: type === "icy" || type === "ringed" || type === "verdant" ? 0.03 + rng() * 0.03
			: type === "crystal" ? 0.1 + rng() * 0.06
			: 0.06 + rng() * 0.08;
		const tilt = rng() * 0.8 - 0.4;
		return { type, spec: moonSpec(type, spec.seed + 101 * (i + 1)), dx, dy, r, lumps, tilt };
	});
}

/** Draws the decorative moons of a planet of radius `r` at (x, y), lit from `angle`. */
export function drawMoons(ctx: CanvasRenderingContext2D, placements: MoonPlacement[], x: number, y: number, r: number, angle: number) {
	const density = Math.max(1, ctx.getTransform().a);
	for (const m of placements) {
		const mr = Math.max(1.5, r * m.r);
		const mx = x + m.dx * r, my = y + m.dy * r;
		if (m.type === "ringed") drawMiniRing(ctx, mx, my, mr, m.tilt, "back");
		const imgs = mr * density >= 2 ? sphereSource(m.spec, textureSize(mr * 2 * density, 8, 128), m.lumps) : null;
		if (imgs) paintSphere(ctx, imgs, mx, my, mr, angle, true, true);
		else paintPlaceholder(ctx, m.spec, mx, my, mr, angle);
		if (m.type === "ringed") drawMiniRing(ctx, mx, my, mr, m.tilt, "front");
	}
}

/** How lumpy a planet's outline is: round, except for worlds that have been blown apart. */
export function bodyLumps(spec: PlanetSpec): number {
	return spec.type === "destroyed" && spec.pattern === "shattered" ? 0.16 : 0;
}

/**
 * Draws a complete planet (atmosphere, rings, sphere, moons) centered at
 * (cx, cy) with the given radius in pixels, lit from the direction of `light`.
 */
export function drawPlanet(ctx: CanvasRenderingContext2D, spec: PlanetSpec, cx: number, cy: number, radius: number, light: Vec3) {
	const angle = Math.atan2(light.y, light.x);
	const density = Math.max(1, ctx.getTransform().a);
	drawAtmosphereGlow(ctx, spec, cx, cy, radius);
	drawRingHalf(ctx, spec, cx, cy, radius, "back");
	const lumps = bodyLumps(spec);
	const imgs = sphereSource(spec, textureSize(radius * 2 * density, 16, 512), lumps);
	if (imgs) paintSphere(ctx, imgs, cx, cy, radius, angle, spec.pattern === "moon", lumps > 0);
	else paintPlaceholder(ctx, spec, cx, cy, radius, angle);
	drawRingHalf(ctx, spec, cx, cy, radius, "front");
	drawMoons(ctx, moonPlacements(spec), cx, cy, radius, angle);
}

function drawMiniRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, half: "back" | "front") {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(tilt);
	ctx.beginPath();
	if (half === "back") ctx.rect(-r * 3, -r * 3, r * 6, r * 3);
	else ctx.rect(-r * 3, 0, r * 6, r * 3);
	ctx.clip();
	ctx.scale(1, 0.3);
	// A soft band with a brighter middle, like a ring of fine ice, not a drawn line.
	for (const [w, a] of [[0.55, 0.22], [0.3, 0.4], [0.12, 0.6]]) {
		ctx.strokeStyle = `rgba(210, 206, 196, ${a})`;
		ctx.lineWidth = Math.max(0.6, r * w);
		ctx.beginPath();
		ctx.arc(0, 0, r * 1.75, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------
// Rings and debris

function ringColor(spec: PlanetSpec): RGB {
	const pal = PLANET_TYPES[spec.type].palettes[spec.palette];
	const base = hexToRgb(pal.a[Math.max(0, pal.a.length - 2)]);
	const match: RGB = [base[0] * 0.8 + 35, base[1] * 0.8 + 33, base[2] * 0.8 + 30];
	switch (RING_COLORS[spec.ringColor]) {
		case "contrast": {
			// Rotate the hue, then push it away from grey so it clearly stands apart.
			const c = contrast(match);
			const grey = (c[0] + c[1] + c[2]) / 3;
			return c.map((v) => Math.max(0, Math.min(255, grey + (v - grey) * 2.2))) as RGB;
		}
		case "ice": return [215, 228, 242];
		case "dark": return [92, 80, 72];
		case "rust": return [158, 92, 62];
		case "gold": return [218, 188, 126];
		default: return match;
	}
}

const RING_BANDS: Record<RingStyle, number[][]> = {
	thin: [[1.4, 1.65]],
	wide: [[1.3, 2.15]],
	double: [[1.3, 1.65], [1.8, 2.1]],
	icy: [[1.35, 2.0]],
	belt: [],
	broken: [[1.3, 1.7], [1.85, 2.1]],
	colossal: [],
	dusty: [],
	gapped: [[1.3, 2.25]],
	braided: [],
	halo: [],
};

function drawRings(ctx: CanvasRenderingContext2D, spec: PlanetSpec, cx: number, cy: number, radius: number, half: "back" | "front") {
	if (spec.rings === "none") return;
	const color = ringColor(spec);
	// Rings circle the planet's equator, so they lean with it (ringTilt only nudges them).
	drawRingLayer(ctx, spec, spec.rings, color, cx, cy, radius, -spec.axialTilt + spec.ringTilt * 0.12, half, 0);
}

function drawRingLayer(
	ctx: CanvasRenderingContext2D,
	spec: PlanetSpec,
	style: RingStyle,
	color: RGB,
	cx: number,
	cy: number,
	radius: number,
	tilt: number,
	half: "back" | "front",
	layer: number
) {
	// Same seed for both halves, so the back and front line up exactly.
	const rng = makeRng(spec.seed ^ 0x3c6ef372 ^ (layer * 0x9e37));
	const [r0, g0, b0] = color.map((v) => v | 0);
	const flat = RING_FLAT[spec.ringAngle ?? "tilted"];
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(tilt);
	ctx.beginPath();
	// The far half of the ring (above the center) is hidden behind the planet.
	const span = style === "colossal" ? COLOSSAL_REACH + 0.5 : 3;
	if (half === "back") ctx.rect(-radius * span, -radius * span, radius * span * 2, radius * span);
	else ctx.rect(-radius * span, 0, radius * span * 2, radius * span);
	ctx.clip();

	if (style === "dusty" || style === "halo") {
		// Rings of fine dust: smooth and faint, with no sharp edges. A halo ring is a broad
		// diffuse glow around a brighter core, the way fine dust scatters sunlight.
		ctx.scale(1, flat);
		const halo = style === "halo";
		const inner = halo ? 1.2 : 1.4, outer = halo ? 2.4 : 2.3;
		const steps = 24;
		for (let s = 0; s < steps; s++) {
			const t = (s + 0.5) / steps;
			const rr = radius * (inner + (outer - inner) * t);
			const profile = halo ? 0.12 * Math.sin(Math.PI * t) + 0.5 * Math.exp(-Math.pow((t - 0.42) / 0.06, 2)) : 0.32 * Math.sin(Math.PI * t) * (0.85 + 0.15 * Math.sin(t * 11));
			ctx.strokeStyle = `rgba(${r0}, ${g0}, ${b0}, ${profile})`;
			ctx.lineWidth = (radius * (outer - inner)) / steps + 0.6;
			ctx.beginPath();
			ctx.arc(0, 0, rr, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
		return;
	}

	if (style === "braided") {
		// A narrow ring of two or three strands twisting around each other, with brighter clumps,
		// like the strands that shepherd moons pull into Saturn's F ring.
		ctx.scale(1, flat);
		const base = 1.9, strands = 2 + Math.floor(rng() * 2);
		// A faint band of dust around the strands, so they read as fine material, not wire.
		ctx.strokeStyle = `rgba(${r0}, ${g0}, ${b0}, 0.12)`;
		ctx.lineWidth = radius * 0.16;
		ctx.beginPath();
		ctx.arc(0, 0, radius * base, 0, Math.PI * 2);
		ctx.stroke();
		for (let k = 0; k < strands; k++) {
			const phase = rng() * Math.PI * 2, waves = 5 + Math.floor(rng() * 4);
			ctx.lineWidth = Math.max(0.8, radius * 0.03);
			for (let i = 0; i < 120; i++) {
				const a0 = (i / 120) * Math.PI * 2, a1 = ((i + 1) / 120) * Math.PI * 2;
				const off = (a: number) => radius * (base + 0.045 * Math.sin(a * waves + phase));
				const clump = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(a0 * 13 + phase * 3), 4);
				ctx.strokeStyle = `rgba(${r0}, ${g0}, ${b0}, ${0.15 + 0.55 * clump})`;
				ctx.beginPath();
				ctx.moveTo(Math.cos(a0) * off(a0), Math.sin(a0) * off(a0));
				ctx.lineTo(Math.cos(a1) * off(a1), Math.sin(a1) * off(a1));
				ctx.stroke();
			}
		}
		ctx.restore();
		return;
	}

	if (style === "colossal") {
		// A vast system of dusty rings separated by gaps, like J1407b's: each ring its own
		// shade and density, thinning out toward the edge.
		ctx.scale(1, flat);
		let r = 1.3;
		while (r < COLOSSAL_REACH - 0.1) {
			const width = 0.08 + rng() * 0.55;
			const outer = Math.min(COLOSSAL_REACH, r + width);
			const fade = 1 - (r - 1.3) / (COLOSSAL_REACH - 1.3);
			const shade = 0.65 + rng() * 0.5;
			const alpha = (0.15 + rng() * 0.55) * (0.35 + 0.65 * fade);
			const steps = 6;
			for (let s = 0; s < steps; s++) {
				const rr = radius * (r + ((outer - r) * (s + 0.5)) / steps);
				ctx.strokeStyle = `rgba(${Math.min(255, r0 * shade) | 0}, ${Math.min(255, g0 * shade) | 0}, ${Math.min(255, b0 * shade) | 0}, ${alpha * (0.75 + 0.25 * rng())})`;
				ctx.lineWidth = (radius * (outer - r)) / steps + 0.5;
				ctx.beginPath();
				ctx.arc(0, 0, rr, 0, Math.PI * 2);
				ctx.stroke();
			}
			// A clear gap before the next ring, where a moon may have swept the dust away.
			r = outer + (rng() < 0.35 ? 0.06 + rng() * 0.25 : 0.01);
		}
		ctx.restore();
		return;
	}

	if (style === "belt") {
		// An asteroid belt: a faint band of dust with shaded rocks in it. Rocks are rock-colored
		// (the ring color only tints them), lit on top, and of varied sizes, so they never read
		// as loose pixels.
		const tint = (v: number, grey: number) => (v * 0.35 + grey * 0.65) | 0;
		ctx.save();
		ctx.scale(1, flat);
		ctx.strokeStyle = `rgba(${tint(r0, 150)}, ${tint(g0, 140)}, ${tint(b0, 128)}, 0.12)`;
		ctx.lineWidth = radius * 0.7;
		ctx.beginPath();
		ctx.arc(0, 0, radius * 1.75, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
		for (let i = 0; i < 110; i++) {
			const a = rng() * Math.PI * 2, rr = radius * (1.38 + rng() * 0.75);
			const size = Math.max(0.9, radius * 0.03 * Math.pow(0.35 + rng(), 1.6));
			const shade = 0.55 + rng() * 0.45;
			const x = Math.cos(a) * rr, y = Math.sin(a) * rr * flat;
			ctx.fillStyle = `rgb(${(tint(r0, 120) * shade * 0.6) | 0}, ${(tint(g0, 110) * shade * 0.6) | 0}, ${(tint(b0, 100) * shade * 0.6) | 0})`;
			ctx.beginPath();
			ctx.arc(x, y, size, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = `rgb(${(tint(r0, 175) * shade) | 0}, ${(tint(g0, 165) * shade) | 0}, ${(tint(b0, 150) * shade) | 0})`;
			ctx.beginPath();
			ctx.arc(x - size * 0.2, y - size * 0.22, size * 0.7, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		return;
	}

	ctx.scale(1, flat);
	// Broken rings only fill a few arcs of the circle.
	const arcs: Array<[number, number]> = style === "broken"
		? Array.from({ length: 4 }, (_, i) => {
			const start = (i / 4) * Math.PI * 2 + rng() * 0.6;
			return [start, start + 0.9 + rng() * 0.7];
		})
		: [[0, Math.PI * 2]];
	const icy = style === "icy";
	const broken = style === "broken";
	const gapped = style === "gapped";
	for (const [inner, outer] of RING_BANDS[style]) {
		const steps = gapped ? 40 : 16;
		for (let s = 0; s < steps; s++) {
			const rr = radius * (inner + ((outer - inner) * (s + 0.5)) / steps);
			// Gapped rings: many fine divisions where moons have cleared lanes in the ring.
			const gap = gapped && rng() < 0.28;
			const alpha = gap ? 0.03 : icy ? 0.45 + 0.5 * rng() : 0.25 + 0.55 * rng();
			ctx.lineWidth = (radius * (outer - inner)) / steps + 0.5;
			for (const [a0, a1] of arcs) {
				if (!broken) {
					ctx.strokeStyle = `rgba(${r0}, ${g0}, ${b0}, ${alpha})`;
					ctx.beginPath();
					ctx.arc(0, 0, rr, a0, a1);
					ctx.stroke();
					continue;
				}
				// Clumpy arcs thin out gradually at their ends, like real ring arcs, instead of stopping dead.
				const pieces = 14;
				for (let k = 0; k < pieces; k++) {
					const t0 = k / pieces, t1 = (k + 1) / pieces;
					ctx.strokeStyle = `rgba(${r0}, ${g0}, ${b0}, ${alpha * Math.pow(Math.sin(Math.PI * (t0 + t1) / 2), 1.5)})`;
					ctx.beginPath();
					ctx.arc(0, 0, rr, a0 + (a1 - a0) * t0, a0 + (a1 - a0) * t1 + 0.01);
					ctx.stroke();
				}
			}
		}
	}
	if (icy) {
		// Glinting ice chunks scattered through the ring.
		ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
		for (let i = 0; i < 110; i++) {
			const a = rng() * Math.PI * 2, rr = radius * (1.37 + rng() * 0.6);
			const size = Math.max(0.6, radius * 0.018 * (0.4 + rng()));
			ctx.beginPath();
			ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, size, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	ctx.restore();
}

/** A loose cloud of rubble around the planet: small round rocks with a lighter cap on top. */
function drawDebris(ctx: CanvasRenderingContext2D, spec: PlanetSpec, cx: number, cy: number, radius: number, half: "back" | "front") {
	const rng = makeRng(spec.seed ^ 0xdeb1);
	for (let i = 0; i < 40; i++) {
		const a = rng() * Math.PI * 2, rr = radius * (1.25 + rng() * 0.7);
		const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.45;
		const size = Math.max(0.7, radius * 0.035 * (0.35 + rng()));
		const shade = 95 + rng() * 60;
		if ((y < cy) !== (half === "back")) continue;
		ctx.fillStyle = `rgb(${(shade * 0.55) | 0}, ${(shade * 0.5) | 0}, ${(shade * 0.46) | 0})`;
		ctx.beginPath();
		ctx.arc(x, y, size, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = `rgb(${shade | 0}, ${(shade * 0.94) | 0}, ${(shade * 0.86) | 0})`;
		ctx.beginPath();
		ctx.arc(x - size * 0.2, y - size * 0.22, size * 0.7, 0, Math.PI * 2);
		ctx.fill();
	}
}
