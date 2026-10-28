// Suns (one per folder) and black holes. Like planets, a star is a short list
// of traits; every type works with every surface and corona, so all
// combinations are valid.

import { RGB, clamp01, hexToRgb, hsl, ramp, ridge, smoothstep, stretch } from "./color";
import { makeNoise, makeRng } from "./noise";

export type StarType =
	| "yellowDwarf" | "orangeDwarf" | "redDwarf" | "redGiant" | "blueGiant"
	| "whiteDwarf" | "yellowWhite" | "pulsar" | "emerald" | "violet";
export type StarSurface = "calm" | "granulated" | "sunspots" | "plasma" | "active";
export type Corona = "soft" | "rays" | "halo" | "prominences" | "streamers";

export interface StarSpec {
	seed: number;
	type: StarType;
	/** Index into the type's tints. */
	tint: number;
	surface: StarSurface;
	corona: Corona;
}

interface StarTypeDef {
	label: string;
	hue: number;
	sat: number;
	/** Lightness multiplier: red dwarfs are dimmer, blue giants brighter. */
	light: number;
	/** Display size relative to a yellow dwarf. */
	size: number;
	/** Hue shifts for the type's 4 tints. */
	tints: number[];
}

export const STAR_TYPES: Record<StarType, StarTypeDef> = {
	yellowDwarf: { label: "Yellow dwarf", hue: 44, sat: 1, light: 1, size: 1, tints: [0, -8, 8, 16] },
	orangeDwarf: { label: "Orange dwarf", hue: 28, sat: 1, light: 0.95, size: 0.9, tints: [0, -8, 8, -16] },
	redDwarf: { label: "Red dwarf", hue: 8, sat: 1, light: 0.85, size: 0.7, tints: [0, -8, 8, 345] },
	redGiant: { label: "Red giant", hue: 14, sat: 0.95, light: 0.9, size: 1.6, tints: [0, -10, 10, 20] },
	blueGiant: { label: "Blue giant", hue: 215, sat: 0.85, light: 1.05, size: 1.5, tints: [0, -15, 15, 30] },
	whiteDwarf: { label: "White dwarf", hue: 210, sat: 0.3, light: 1.1, size: 0.5, tints: [0, 30, -170, 60] },
	yellowWhite: { label: "Yellow-white star", hue: 56, sat: 0.55, light: 1.05, size: 1.1, tints: [0, -10, 10, -25] },
	pulsar: { label: "Pulsar", hue: 195, sat: 0.7, light: 1.05, size: 0.4, tints: [0, 25, -25, 90] },
	emerald: { label: "Emerald star", hue: 135, sat: 0.85, light: 0.95, size: 1, tints: [0, -20, 20, 40] },
	violet: { label: "Violet star", hue: 285, sat: 0.85, light: 0.95, size: 1.1, tints: [0, -20, 20, 40] },
};

export const STAR_SURFACES: StarSurface[] = ["calm", "granulated", "sunspots", "plasma", "active"];
export const CORONAS: Corona[] = ["soft", "rays", "halo", "prominences", "streamers"];
const ALL_STAR_TYPES = Object.keys(STAR_TYPES) as StarType[];

export const STAR_VARIATIONS = ALL_STAR_TYPES.length * 4 * STAR_SURFACES.length * CORONAS.length;

export function generateStar(seed: number, overrides: Partial<StarSpec> = {}): StarSpec {
	const rng = makeRng(seed ^ 0x51a75);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
	const spec: StarSpec = {
		seed,
		type: pick(ALL_STAR_TYPES),
		tint: Math.floor(rng() * 4),
		surface: pick(STAR_SURFACES),
		corona: pick(CORONAS),
	};
	return { ...spec, ...overrides };
}

export function describeStar(spec: StarSpec): string {
	return [STAR_TYPES[spec.type].label, `tint ${spec.tint + 1}`, spec.surface, spec.corona].join(" · ");
}

function starHue(spec: StarSpec): number {
	const def = STAR_TYPES[spec.type];
	return def.hue + def.tints[spec.tint];
}

/** Deep color at the edge to a white-hot core. */
function starRamp(spec: StarSpec): RGB[] {
	const def = STAR_TYPES[spec.type];
	const h = starHue(spec), s = def.sat, l = def.light;
	return [
		hsl(h - 12, s, 0.3 * l), hsl(h - 5, s, 0.5 * l), hsl(h, s, 0.64 * l),
		hsl(h + 6, s * 0.85, 0.74 * Math.min(l, 1.05)), hsl(h + 12, s * 0.55, 0.86), hsl(h + 15, s * 0.3, 0.95),
	].map(hexToRgb);
}

function coronaColor(spec: StarSpec, alpha: number, light = 0.62): string {
	const def = STAR_TYPES[spec.type];
	const c = hexToRgb(hsl(starHue(spec), def.sat, light * def.light));
	return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
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

/** Paints the star's glowing disc. Stars make their own light, so there is no shading from outside. */
export function renderStarTexture(spec: StarSpec, size: number): HTMLCanvasElement {
	return pixelsToCanvas(size, computeStarPixels(spec, size));
}

/** The star disc's pixels (pure, so it can run in a background worker). */
export function computeStarPixels(spec: StarSpec, size: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(size * size * 4);
	const n = makeNoise(spec.seed);
	const colors = starRamp(spec);
	const rng = makeRng(spec.seed ^ 0x9e37);
	const spots: Array<{ x: number; y: number; z: number; r: number }> = [];
	if (spec.surface === "sunspots") {
		const count = 3 + Math.floor(rng() * 5);
		for (let i = 0; i < count; i++) {
			const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 0.75;
			const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.6;
			spots.push({ x, y, z: Math.sqrt(Math.max(0, 1 - x * x - y * y)), r: 0.05 + rng() * 0.1 });
		}
	}
	const c: RGB = [0, 0, 0];

	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const x = ((px + 0.5) / size) * 2 - 1;
			const y = ((py + 0.5) / size) * 2 - 1;
			const d2 = x * x + y * y;
			if (d2 > 1) continue;
			const z = Math.sqrt(1 - d2);
			// Limb darkening: the edge of a star looks dimmer and redder than its middle.
			const limb = 0.22 + 0.78 * Math.pow(z, 0.45);
			const cells = stretch(n.fbm(x * 10, y * 10, z * 10, 3), 2.2);
			const lanes = smoothstep(0.88, 0.96, ridge(n.fbm(x * 8 + 5, y * 8, z * 8, 3)));
			let s: number;
			switch (spec.surface) {
				case "calm":
					s = 0.78 + 0.22 * (stretch(n.fbm(x * 3, y * 3, z * 3, 4), 2) - 0.5);
					break;
				case "granulated":
					s = 0.66 + 0.28 * cells - 0.22 * lanes;
					break;
				case "sunspots": {
					s = 0.74 + 0.12 * (cells - 0.5);
					for (const sp of spots) {
						const u = Math.hypot(x - sp.x, y - sp.y, z - sp.z) / sp.r;
						if (u < 0.55) s *= 0.3;
						else if (u < 1) s *= 0.68;
					}
					break;
				}
				case "plasma": {
					const w = n.fbm(x * 2, y * 2, z * 2, 3);
					const f = ridge(stretch(n.fbm(x * 3 + w * 3, y * 3 + w * 3, z * 3, 4), 2));
					s = 0.55 + 0.45 * smoothstep(0.75, 1, f) + 0.1 * (cells - 0.5);
					break;
				}
				default: {
					// Active: granulation plus bright magnetic patches (faculae).
					const fac = smoothstep(0.6, 0.66, n.fbm(x * 4 + 2, y * 4, z * 4, 3));
					s = 0.64 + 0.26 * cells - 0.2 * lanes + 0.25 * fac;
				}
			}
			// Only the brightest middle reaches white, so surface detail stays visible.
			ramp(colors, clamp01(s * limb * 0.95), c);
			const i = (py * size + px) * 4;
			data[i] = c[0];
			data[i + 1] = c[1];
			data[i + 2] = c[2];
			// A soft edge a few pixels wide; the glow drawn on top melts it away.
			data[i + 3] = 255 * clamp01((1 - Math.sqrt(d2)) * size * 0.12);
		}
	}
	return data;
}

/** How far the wispy corona reaches, in star radii. */
export const CORONA_REACH = 2.8;

/** Pre-made images for drawStar, so the slow pixel work can happen elsewhere. */
export interface StarLayers {
	disc: HTMLCanvasElement;
	corona: HTMLCanvasElement;
}

/**
 * Draws a star in the wispy style: a layered aura, flowing strands of corona,
 * a white-hot disc whose edge melts into its glow, plus the star's corona
 * style (rays, halo, prominences or streamers) on top. r is the disc radius.
 */
export function drawStar(ctx: CanvasRenderingContext2D, spec: StarSpec, cx: number, cy: number, r: number, aura = true, layers?: StarLayers) {
	const rng = makeRng(spec.seed ^ 0x2c1b);
	const def = STAR_TYPES[spec.type];
	const h = starHue(spec);
	const color = hexToRgb(hsl(h, def.sat, 0.6 * def.light));
	const pale = hexToRgb(hsl(h + 10, def.sat * 0.4, 0.88));
	const density = Math.max(1, ctx.getTransform().a);

	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	// The aura: a huge faint tint, then a halo in the star's color.
	if (aura) glowLayer(ctx, cx, cy, r * 0.9, r * 6, color, 0.16);
	glowLayer(ctx, cx, cy, r * 0.9, r * 2.6, color, 0.38);

	const reach = CORONA_REACH;
	const corona = layers?.corona ?? renderWispyCorona(spec, Math.ceil(r * reach * 2 * Math.min(density, 1.5)), reach);
	ctx.drawImage(corona, cx - r * reach, cy - r * reach, r * reach * 2, r * reach * 2);

	if (spec.corona === "rays") {
		const count = 24 + Math.floor(rng() * 12);
		for (let i = 0; i < count; i++) {
			const a = (i / count) * Math.PI * 2 + rng() * 0.15;
			const len = r * (1.6 + rng() * 1.4);
			const wid = r * (0.025 + rng() * 0.035);
			const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
			grad.addColorStop(0.3, coronaColor(spec, 0.4, 0.78));
			grad.addColorStop(1, coronaColor(spec, 0));
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(a + Math.PI / 2) * wid, cy + Math.sin(a + Math.PI / 2) * wid);
			ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
			ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * wid, cy + Math.sin(a - Math.PI / 2) * wid);
			ctx.fill();
		}
	} else if (spec.corona === "halo") {
		const ring = ctx.createRadialGradient(cx, cy, r * 1.5, cx, cy, r * 2.05);
		ring.addColorStop(0, coronaColor(spec, 0));
		ring.addColorStop(0.45, coronaColor(spec, 0.38, 0.78));
		ring.addColorStop(1, coronaColor(spec, 0));
		ctx.fillStyle = ring;
		ctx.beginPath();
		ctx.arc(cx, cy, r * 2.05, 0, Math.PI * 2);
		ctx.fill();
	} else if (spec.corona === "streamers") {
		// Long soft petals, like the corona seen in a solar eclipse.
		const count = 4 + Math.floor(rng() * 3);
		for (let i = 0; i < count; i++) {
			const a = (i / count) * Math.PI * 2 + rng() * 0.6;
			const len = r * (2.4 + rng() * 1.2);
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(a);
			ctx.scale(1, 0.22);
			const petal = ctx.createRadialGradient(r * 0.6, 0, 0, r * 0.6, 0, len);
			petal.addColorStop(0, coronaColor(spec, 0.35, 0.75));
			petal.addColorStop(1, coronaColor(spec, 0));
			ctx.fillStyle = petal;
			ctx.beginPath();
			ctx.arc(r * 0.6, 0, len, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}
	}
	if (spec.type === "pulsar") drawPulsarBeams(ctx, spec, cx, cy, r, rng);
	ctx.restore();

	const disc = layers?.disc ?? renderStarTexture(spec, Math.max(16, Math.ceil(r * 2 * density)));
	ctx.drawImage(disc, cx - r, cy - r, r * 2, r * 2);

	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	// Light spilling over the edge, so the disc melts into its glow.
	glowLayer(ctx, cx, cy, r * 0.9, r * 1.3, pale, 0.45);
	ctx.restore();

	if (spec.corona === "prominences") drawProminences(ctx, spec, cx, cy, r, rng);
}

/**
 * Just the star's huge faint aura (out to 6 radii). The plugin draws this live
 * and caches the rest of the star, so cached images can stay small.
 */
export function drawStarAura(ctx: CanvasRenderingContext2D, spec: StarSpec, cx: number, cy: number, r: number) {
	const def = STAR_TYPES[spec.type];
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	glowLayer(ctx, cx, cy, r * 0.9, r * 6, hexToRgb(hsl(starHue(spec), def.sat, 0.6 * def.light)), 0.16);
	ctx.restore();
}

/** Glowing loops of plasma rising from the edge of the star. */
function drawProminences(ctx: CanvasRenderingContext2D, spec: StarSpec, cx: number, cy: number, r: number, rng: () => number) {
	ctx.save();
	// Only draw outside the disc, so loops appear to rise from behind the edge.
	ctx.beginPath();
	ctx.rect(cx - r * 4, cy - r * 4, r * 8, r * 8);
	ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
	ctx.clip("evenodd");
	ctx.globalCompositeOperation = "lighter";
	ctx.lineCap = "round";
	const count = 4 + Math.floor(rng() * 4);
	for (let i = 0; i < count; i++) {
		const a = rng() * Math.PI * 2;
		const spread = 0.08 + rng() * 0.12;
		const height = r * (0.12 + rng() * 0.22);
		// Each prominence is a few nested arches, so it looks like a glowing tuft, not a line.
		for (let k = 0; k < 3; k++) {
			const sp = spread * (1 - k * 0.22), ht = height * (1 - k * 0.25);
			const a1 = a - sp, a2 = a + sp;
			const top = r + ht * 1.9;
			const qx = cx + Math.cos(a) * top, qy = cy + Math.sin(a) * top;
			for (const [width, alpha, light] of [[0.11, 0.35, 0.6], [0.045, 0.95, 0.8]] as const) {
				ctx.strokeStyle = coronaColor(spec, alpha, light);
				ctx.lineWidth = r * width;
				ctx.beginPath();
				ctx.moveTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
				ctx.quadraticCurveTo(qx, qy, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
				ctx.stroke();
			}
		}
	}
	ctx.restore();
}

function drawPulsarBeams(ctx: CanvasRenderingContext2D, spec: StarSpec, cx: number, cy: number, r: number, rng: () => number) {
	const a = -Math.PI / 2 + (rng() - 0.5) * 1.2;
	for (const dir of [a, a + Math.PI]) {
		const len = r * 7;
		const ex = cx + Math.cos(dir) * len, ey = cy + Math.sin(dir) * len;
		const grad = ctx.createLinearGradient(cx, cy, ex, ey);
		grad.addColorStop(0, coronaColor(spec, 0.9, 0.85));
		grad.addColorStop(1, coronaColor(spec, 0));
		ctx.fillStyle = grad;
		const w = r * 0.9;
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(dir + Math.PI / 2) * w * 0.3, cy + Math.sin(dir + Math.PI / 2) * w * 0.3);
		ctx.lineTo(ex + Math.cos(dir + Math.PI / 2) * w, ey + Math.sin(dir + Math.PI / 2) * w);
		ctx.lineTo(ex + Math.cos(dir - Math.PI / 2) * w, ey + Math.sin(dir - Math.PI / 2) * w);
		ctx.lineTo(cx + Math.cos(dir - Math.PI / 2) * w * 0.3, cy + Math.sin(dir - Math.PI / 2) * w * 0.3);
		ctx.fill();
	}
}

// ---------------------------------------------------------------------------
// Black holes

export type DiskColor = "ember" | "ice" | "violet" | "emerald" | "crimson" | "gold";
export type DiskWidth = "thin" | "medium" | "wide";

export interface BlackHoleSpec {
	seed: number;
	disk: DiskColor;
	width: DiskWidth;
	/** How edge-on the disk is seen: 0 = edge-on, 1 = face-on. */
	tilt: 0 | 1 | 2;
	jets: boolean;
	/** Which side of the disk spins toward the viewer (and looks brighter). */
	brightSide: "left" | "right";
}

const DISKS: Record<DiskColor, string[]> = {
	ember: ["#fff6ea", "#ffd08a", "#ff8a2a", "#7a2a08"],
	ice: ["#f4faff", "#d8ecff", "#6aa8ff", "#1a3a8a"],
	violet: ["#fbf2ff", "#f0d0ff", "#b060ff", "#3a1070"],
	emerald: ["#f2fff8", "#d0ffe8", "#40e0a0", "#0a5a3a"],
	crimson: ["#fff2f2", "#ffd0d0", "#ff4050", "#6a0a1a"],
	gold: ["#fffdf0", "#fff4c0", "#ffc840", "#7a5a08"],
};
export const DISK_COLORS = Object.keys(DISKS) as DiskColor[];
const WIDTHS: Record<DiskWidth, number> = { thin: 1.3, medium: 2.3, wide: 3.4 };
const TILTS = [0.14, 0.24, 0.36];

export const BLACK_HOLE_VARIATIONS = DISK_COLORS.length * 3 * TILTS.length * 2 * 2;

export function generateBlackHole(seed: number, overrides: Partial<BlackHoleSpec> = {}): BlackHoleSpec {
	const rng = makeRng(seed ^ 0xb1ac);
	const spec: BlackHoleSpec = {
		seed,
		disk: DISK_COLORS[Math.floor(rng() * DISK_COLORS.length)],
		width: (["thin", "medium", "wide"] as const)[Math.floor(rng() * 3)],
		tilt: Math.floor(rng() * 3) as 0 | 1 | 2,
		jets: rng() < 0.5,
		brightSide: rng() < 0.5 ? "left" : "right",
	};
	return { ...spec, ...overrides };
}

/**
 * Draws a black hole: a black shadow ringed by light, with a glowing disk of
 * matter. The far side of the disk is bent by gravity into an arch over the
 * top, as in real black hole images. r is the shadow's radius.
 */
export function drawBlackHole(ctx: CanvasRenderingContext2D, spec: BlackHoleSpec, cx: number, cy: number, r: number) {
	const colors = DISKS[spec.disk].map(hexToRgb);
	const inner = r * 1.6, outer = inner + r * WIDTHS[spec.width];
	const flatten = TILTS[spec.tilt];
	const side = spec.brightSide === "left" ? Math.PI : 0;
	const rng = makeRng(spec.seed ^ 0xd15c);
	const ringAlpha = Array.from({ length: 30 }, () => 0.35 + rng() * 0.65);
	const angle = (rng() - 0.5) * 0.3;

	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(angle);
	ctx.globalCompositeOperation = "lighter";

	const deep = colors[3];
	const halo = ctx.createRadialGradient(0, 0, r, 0, 0, outer * 1.25);
	halo.addColorStop(0, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0.32)`);
	halo.addColorStop(1, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0)`);
	ctx.fillStyle = halo;
	ctx.beginPath();
	ctx.arc(0, 0, outer * 1.25, 0, Math.PI * 2);
	ctx.fill();

	if (spec.jets) {
		for (const dir of [-1, 1]) {
			const len = r * 4.5;
			const grad = ctx.createLinearGradient(0, 0, 0, dir * len);
			const c = colors[2];
			grad.addColorStop(0, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.55)`);
			grad.addColorStop(1, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`);
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(-r * 0.12, 0);
			ctx.lineTo(-r * 0.35, dir * len);
			ctx.lineTo(r * 0.35, dir * len);
			ctx.lineTo(r * 0.12, 0);
			ctx.fill();
		}
	}

	// Far half of the disk, then the shadow hides the part behind the hole.
	drawDisk(ctx, colors, ringAlpha, inner, outer, flatten, side, "back");
	ctx.globalCompositeOperation = "source-over";
	ctx.fillStyle = "#000";
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalCompositeOperation = "lighter";

	// Gravity bends light from the far side of the disk up and over the shadow.
	const lensWidth = r * (0.45 + 0.2 * WIDTHS[spec.width]);
	drawDisk(ctx, colors, ringAlpha, r * 1.05, r * 1.05 + lensWidth, 0.95, side, "back", 1.4);
	drawDisk(ctx, colors, ringAlpha, r * 1.04, r * 1.04 + lensWidth * 0.3, 0.95, side, "front", 0.7);

	// Photon ring: light orbiting right at the edge of the shadow.
	// Drawn as a soft glow plus a fine bright core, not a hard outline.
	const hot = colors[0], warm = colors[1];
	for (const [width, alpha, c] of [[0.16, 0.25, warm], [0.07, 0.45, warm], [0.025, 0.8, hot]] as const) {
		ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
		ctx.lineWidth = Math.max(0.6, r * width);
		ctx.beginPath();
		ctx.arc(0, 0, r * 1.03, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Near half of the disk passes in front of the hole.
	drawDisk(ctx, colors, ringAlpha, inner, outer, flatten, side, "front");
	ctx.restore();
}

function drawDisk(
	ctx: CanvasRenderingContext2D,
	colors: RGB[],
	ringAlpha: number[],
	inner: number,
	outer: number,
	flatten: number,
	brightAngle: number,
	half: "back" | "front",
	strength = 1
) {
	const rings = ringAlpha.length;
	const segments = 48;
	const c: RGB = [0, 0, 0];
	ctx.save();
	ctx.scale(1, flatten);
	ctx.lineWidth = (outer - inner) / rings + 0.3;
	for (let i = 0; i < rings; i++) {
		const t = i / (rings - 1);
		const rr = inner + (outer - inner) * t;
		ramp(colors, Math.pow(t, 0.7), c);
		// Brightest near the hole, fading toward the outer edge.
		const base = Math.pow(1 - t, 0.8) * ringAlpha[i] * strength;
		// The back half is y < 0 (angles PI..2PI), the front half y > 0.
		const start = half === "back" ? Math.PI : 0;
		for (let sIdx = 0; sIdx < segments; sIdx++) {
			const a0 = start + (sIdx / segments) * Math.PI;
			const a1 = start + ((sIdx + 1) / segments) * Math.PI;
			// Doppler beaming: matter moving toward us looks brighter.
			const doppler = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((a0 + a1) / 2 - brightAngle));
			ctx.strokeStyle = `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${base * doppler})`;
			ctx.beginPath();
			ctx.arc(0, 0, rr, a0, a1);
			ctx.stroke();
		}
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------
// Sun style experiments: three looks to compare before rebuilding all suns.

export type SunStyle = "cinematic" | "wispy" | "stylized";

function rgba(c: RGB, a: number): string {
	return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
}

function glowLayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, c: RGB, alpha: number) {
	const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
	g.addColorStop(0, rgba(c, alpha));
	g.addColorStop(0.4, rgba(c, alpha * 0.35));
	g.addColorStop(1, rgba(c, 0));
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(cx, cy, r1, 0, Math.PI * 2);
	ctx.fill();
}

/** White-hot disc: near-white center, the star's color toward the edge, and a soft edge. */
function renderHotTexture(spec: StarSpec, size: number, smooth: boolean): HTMLCanvasElement {
	const canvas = createEl("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) return canvas;
	const img = ctx.createImageData(size, size);
	const data = img.data;
	const n = makeNoise(spec.seed);
	const def = STAR_TYPES[spec.type];
	const h = starHue(spec), s = def.sat, l = def.light;
	const colors = [
		hsl(h - 12, s, 0.3 * l), hsl(h - 5, s, 0.5 * l), hsl(h, s, 0.64 * l),
		hsl(h + 6, s * 0.85, 0.74 * Math.min(l, 1.05)), hsl(h + 12, s * 0.55, 0.86), hsl(h + 15, s * 0.3, 0.95),
	].map(hexToRgb);
	const c: RGB = [0, 0, 0];
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const x = ((px + 0.5) / size) * 2 - 1, y = ((py + 0.5) / size) * 2 - 1;
			const d2 = x * x + y * y;
			if (d2 > 1) continue;
			const z = Math.sqrt(1 - d2);
			const limb = 0.22 + 0.78 * Math.pow(z, 0.45);
			let surf: number;
			if (smooth) surf = 0.92 + 0.08 * (n.fbm(x * 3, y * 3, z * 3, 3) - 0.5);
			else {
				const cells = stretch(n.fbm(x * 12, y * 12, z * 12, 3), 2.2);
				const lanes = smoothstep(0.88, 0.96, ridge(n.fbm(x * 9 + 5, y * 9, z * 9, 3)));
				surf = 0.8 + 0.22 * cells - 0.2 * lanes;
			}
			ramp(colors, clamp01(surf * limb * 0.97), c);
			const i = (py * size + px) * 4;
			data[i] = c[0];
			data[i + 1] = c[1];
			data[i + 2] = c[2];
			// A soft edge a few pixels wide; the bloom drawn on top melts it into the glow.
			data[i + 3] = 255 * clamp01((1 - Math.sqrt(d2)) * size * 0.12);
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** Fine strands of light streaming out from the star, rendered per pixel. */
export function renderWispyCorona(spec: StarSpec, size: number, reach: number): HTMLCanvasElement {
	return pixelsToCanvas(size, computeCoronaPixels(spec, size, reach));
}

/** The corona's pixels (pure, so it can run in a background worker). */
export function computeCoronaPixels(spec: StarSpec, size: number, reach: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(size * size * 4);
	const n = makeNoise(spec.seed ^ 0x77);
	const def = STAR_TYPES[spec.type];
	const tint = hexToRgb(hsl(starHue(spec), def.sat, 0.68 * def.light));
	const hot = hexToRgb(hsl(starHue(spec) + 12, def.sat * 0.4, 0.9));
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			// Distance in star radii from the center.
			const x = (((px + 0.5) / size) * 2 - 1) * reach, y = (((py + 0.5) / size) * 2 - 1) * reach;
			const d = Math.hypot(x, y);
			if (d < 0.92 || d > reach) continue;
			const a = Math.atan2(y, x);
			// Noise that changes fast around the star and slowly outward gives radial strands.
			const ca = Math.cos(a) * 4, sa = Math.sin(a) * 4;
			const strands = Math.pow(n.fbm(ca, sa, d * 0.6, 4), 2.6) * 2.2;
			const fine = Math.pow(n.noise(ca * 3, sa * 3, d * 1.5), 3) * 1.2;
			const fall = Math.exp(-(d - 1) * 2.1) * smoothstep(reach, reach * 0.7, d);
			const loops = smoothstep(0.93, 0.99, ridge(n.fbm(ca * 1.5 + 9, sa * 1.5, d * 3, 3))) * smoothstep(1.5, 1.05, d);
			const v = clamp01((strands + fine) * fall + loops * 0.6);
			const k = clamp01((1.4 - d) * 2);
			const i = (py * size + px) * 4;
			data[i] = tint[0] + (hot[0] - tint[0]) * k;
			data[i + 1] = tint[1] + (hot[1] - tint[1]) * k;
			data[i + 2] = tint[2] + (hot[2] - tint[2]) * k;
			data[i + 3] = 255 * v;
		}
	}
	return data;
}

export function drawStyledStar(ctx: CanvasRenderingContext2D, spec: StarSpec, cx: number, cy: number, r: number, style: SunStyle) {
	const def = STAR_TYPES[spec.type];
	const h = starHue(spec);
	const color = hexToRgb(hsl(h, def.sat, 0.6 * def.light));
	const pale = hexToRgb(hsl(h + 10, def.sat * 0.4, 0.88));
	const density = Math.max(1, ctx.getTransform().a);
	const texSize = Math.max(16, Math.ceil(r * 2 * density));

	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	// The aura: a huge faint tint, a halo in the star's color, then a bright spill at the edge.
	glowLayer(ctx, cx, cy, r * 0.9, r * (style === "stylized" ? 4 : 6), color, 0.16);
	glowLayer(ctx, cx, cy, r * 0.9, r * 2.6, color, 0.38);

	if (style === "stylized") {
		// Soft concentric bands, like a clean game-style halo.
		for (const [rad, alpha] of [[1.35, 0.3], [1.75, 0.18], [2.25, 0.1]] as const) {
			const g = ctx.createRadialGradient(cx, cy, r * (rad - 0.12), cx, cy, r * (rad + 0.12));
			g.addColorStop(0, rgba(color, 0));
			g.addColorStop(0.5, rgba(pale, alpha));
			g.addColorStop(1, rgba(color, 0));
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(cx, cy, r * (rad + 0.12), 0, Math.PI * 2);
			ctx.fill();
		}
	}
	if (style === "wispy") {
		const reach = 2.8;
		const size = Math.ceil(r * reach * 2 * Math.min(density, 1.5));
		ctx.drawImage(renderWispyCorona(spec, size, reach), cx - r * reach, cy - r * reach, r * reach * 2, r * reach * 2);
	}
	ctx.restore();

	ctx.drawImage(renderHotTexture(spec, texSize, style === "stylized"), cx - r, cy - r, r * 2, r * 2);

	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	// Light spilling over the edge, so the disc melts into its glow.
	glowLayer(ctx, cx, cy, r * 0.9, r * 1.3, pale, style === "stylized" ? 0.3 : 0.45);
	if (style === "stylized") {
		ctx.strokeStyle = rgba(pale, 0.55);
		ctx.lineWidth = Math.max(1, r * 0.035);
		ctx.beginPath();
		ctx.arc(cx, cy, r * 1.02, 0, Math.PI * 2);
		ctx.stroke();
	}
	if (style === "cinematic") {
		// The center burns brighter than the disc can show.
		const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.95);
		core.addColorStop(0, "rgba(255, 255, 255, 0.22)");
		core.addColorStop(1, "rgba(255, 255, 255, 0)");
		ctx.fillStyle = core;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		// Camera-style diffraction spikes and a wide horizontal flare.
		const spikes = 6, rot = 0.3;
		for (let i = 0; i < spikes; i++) {
			const a = rot + (i / spikes) * Math.PI * 2;
			const len = r * (i % 2 === 0 ? 4.2 : 2.8);
			const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
			g.addColorStop(0, rgba(pale, 0.7));
			g.addColorStop(1, rgba(color, 0));
			ctx.strokeStyle = g;
			ctx.lineWidth = Math.max(1, r * 0.03);
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
			ctx.stroke();
		}
		ctx.translate(cx, cy);
		ctx.scale(1, 0.035);
		const streak = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 6);
		streak.addColorStop(0, rgba(pale, 0.55));
		streak.addColorStop(1, rgba(color, 0));
		ctx.fillStyle = streak;
		ctx.beginPath();
		ctx.arc(0, 0, r * 6, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------
// The sun pool: each folder rolls a sun, and now and then a black hole.

export type SunSpec = { kind: "star"; star: StarSpec } | { kind: "blackHole"; hole: BlackHoleSpec };

export const BLACK_HOLE_CHANCE = 1 / 12;

/** The main color of a sun or black hole, for tinting things around it. */
export function sunTint(sun: SunSpec): RGB {
	if (sun.kind === "blackHole") return hexToRgb(DISKS[sun.hole.disk][2]);
	const def = STAR_TYPES[sun.star.type];
	return hexToRgb(hsl(starHue(sun.star), def.sat, 0.6 * def.light));
}

/** One in how many suns looks exactly like this one. */
export function sunRarity(sun: SunSpec): number {
	if (sun.kind === "blackHole") return 1 / (BLACK_HOLE_CHANCE / BLACK_HOLE_VARIATIONS);
	return 1 / ((1 - BLACK_HOLE_CHANCE) / STAR_VARIATIONS);
}

export function describeSun(sun: SunSpec): string {
	if (sun.kind === "star") {
		const st = sun.star;
		return [STAR_TYPES[st.type].label, `${st.surface} surface`, `${st.corona} corona`].join(" · ");
	}
	const h = sun.hole;
	return ["Black hole", `${h.width} ${h.disk} disk`, h.jets ? "with jets" : "no jets"].join(" · ");
}

export function generateSun(seed: number): SunSpec {
	const roll = makeRng(seed ^ 0x5eed)();
	return roll < BLACK_HOLE_CHANCE
		? { kind: "blackHole", hole: generateBlackHole(seed) }
		: { kind: "star", star: generateStar(seed) };
}
