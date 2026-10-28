// Contact sheets for checking planet variations by eye, plus automatic checks
// that flag planets likely to look bad. Build with `npm run preview`, then open
// preview/sheet.html. URL options:
//   ?mode=bodies            every type × pattern × palette, body only (default)
//   ?mode=bodies&type=ice   one type only
//   ?mode=details           every type with each of its surface details
//   ?mode=random&n=50       fully random planets with all extras
import {
	Detail,
	PLANET_TYPES,
	PlanetSpec,
	PlanetType,
	Vec3,
	describePlanet,
	drawPlanet,
	generatePlanet,
	renderPlanetTexture,
} from "../src/planets/planet";
import { makeRng } from "../src/planets/noise";

interface Cell {
	spec: PlanetSpec;
	label: string;
	/** Shorter caption for dense sheets. */
	short?: string;
}

interface Report {
	label: string;
	brightness: number;
	contrast: number;
	detail: number;
	sharpness: number;
	clipped: number;
	flags: string[];
}

// Thresholds for the automatic checks. Measured with the planet lit face-on,
// on a 0-255 brightness scale.
const LIMITS = {
	minBrightness: 45,
	maxBrightness: 225,
	minContrast: 14,
	/** Average edge strength: catches surfaces with no fine texture at all. */
	minDetail: 2.2,
	/** Strength of the crispest 5% of edges: catches soft, smeared surfaces. */
	minSharpness: 12,
	maxClipped: 0.06,
};

// Some types are meant to break the general rules.
const TYPE_LIMITS: Partial<Record<PlanetType, Partial<typeof LIMITS>>> = {
	// Ominous worlds are meant to be dark and gloomy; only flag them if they are unreadable.
	lava: { minBrightness: 18, minContrast: 9 },
	scorched: { minBrightness: 18, minContrast: 9 },
	dead: { minBrightness: 16, minContrast: 8 },
	destroyed: { minBrightness: 16, minContrast: 8, minSharpness: 9 },
	ice: { maxClipped: 0.2 },
	// Shiny facets put a bright highlight dead center under the face-on test light.
	crystal: { maxClipped: 0.12 },
};

const LIGHT: Vec3 = { x: -0.75, y: -0.3, z: 0.6 };
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "bodies";

function bodySpec(type: PlanetType, pattern: string, palette: number, seed: number, detail: Detail = "plain"): PlanetSpec {
	return generatePlanet(seed, {
		type,
		pattern,
		detail,
		palette,
		atmosphere: "none",
		clouds: "none",
		rings: "none",
		moons: [],
		features: [],
		axialTilt: 0.15,
	});
}

function buildCells(): Cell[] {
	if (mode === "random") {
		const n = Number(params.get("n") ?? 50);
		const rng = makeRng(Number(params.get("seed") ?? 1));
		const cells: Cell[] = [];
		for (let i = 0; i < n; i++) {
			const spec = generatePlanet(Math.floor(rng() * 2 ** 32));
			cells.push({ spec, label: describePlanet(spec) });
		}
		return cells;
	}
	const only = params.get("type");
	const cells: Cell[] = [];
	if (mode === "details") {
		for (const type of Object.keys(PLANET_TYPES) as PlanetType[]) {
			if (only && type !== only) continue;
			const def = PLANET_TYPES[type];
			def.details.forEach((detail, di) => {
				const pattern = def.patterns[di % def.patterns.length];
				const spec = bodySpec(type, pattern, (di * 3) % def.palettes.length, 2000 + di * 13, detail);
				cells.push({ spec, label: `${def.label} · ${pattern} · ${detail}` });
			});
		}
		return cells;
	}
	for (const type of Object.keys(PLANET_TYPES) as PlanetType[]) {
		if (only && type !== only) continue;
		const def = PLANET_TYPES[type];
		def.patterns.forEach((pattern, pi) => {
			def.palettes.forEach((_, pal) => {
				const spec = bodySpec(type, pattern, pal, 1000 + pi * 37 + pal * 11);
				cells.push({ spec, label: `${def.label} · ${pattern} · palette ${pal + 1}`, short: `${pattern} · ${pal + 1}` });
			});
		});
	}
	return cells;
}

/** Measures a planet lit face-on, so the surface itself is judged, not the shadow. */
function measure(spec: PlanetSpec, label: string): Report {
	const size = 128;
	const tex = renderPlanetTexture(spec, size, { x: 0, y: 0, z: 1 });
	const data = tex.getContext("2d")!.getImageData(0, 0, size, size).data;
	const lum = new Float32Array(size * size);
	const inside: number[] = [];
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const i = py * size + px;
			lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
			const x = ((px + 0.5) / size) * 2 - 1, y = ((py + 0.5) / size) * 2 - 1;
			// Skip the outer rim, where shading dominates.
			if (x * x + y * y < 0.75) inside.push(i);
		}
	}
	let sum = 0, sum2 = 0, clipped = 0, grad = 0;
	const grads: number[] = [];
	for (const i of inside) {
		const l = lum[i];
		sum += l;
		sum2 += l * l;
		if (data[i * 4] > 250 && data[i * 4 + 1] > 250 && data[i * 4 + 2] > 250) clipped++;
		// Average difference to right and lower neighbours: high means crisp detail.
		const g = (Math.abs(l - lum[i + 1]) + Math.abs(l - lum[i + size])) / 2;
		grad += g;
		grads.push(g);
	}
	const n = inside.length;
	const brightness = sum / n;
	const contrast = Math.sqrt(Math.max(0, sum2 / n - brightness * brightness));
	const detail = grad / n;
	grads.sort((a, b) => a - b);
	const sharpness = grads[Math.floor(grads.length * 0.95)];
	const L = { ...LIMITS, ...TYPE_LIMITS[spec.type] };
	const flags: string[] = [];
	if (brightness < L.minBrightness) flags.push("too dark");
	if (brightness > L.maxBrightness) flags.push("washed out");
	if (contrast < L.minContrast) flags.push("low contrast");
	if (detail < L.minDetail || sharpness < L.minSharpness) flags.push("blurry");
	if (clipped / n > L.maxClipped) flags.push("blown out");
	return { label, brightness, contrast, detail, sharpness, clipped: clipped / n, flags };
}

const cells = buildCells();
const cols = Math.min(mode === "random" ? 8 : mode === "details" ? 8 : 10, cells.length);
const cellW = mode === "bodies" ? 170 : 230, cellH = mode === "random" ? 250 : mode === "bodies" ? 175 : 210;
const radius = mode === "bodies" ? 58 : 62;
const rows = Math.ceil(cells.length / cols);
const canvas = document.getElementById("sheet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = Math.max(1, window.devicePixelRatio || 1);
const w = cols * cellW, h = rows * cellH;
canvas.style.width = `${w}px`;
canvas.width = w * dpr;
canvas.height = h * dpr;
ctx.scale(dpr, dpr);
ctx.fillStyle = "#04050d";
ctx.fillRect(0, 0, w, h);

const reports: Report[] = [];
cells.forEach((cell, i) => {
	const cx = (i % cols) * cellW + cellW / 2;
	const cy = Math.floor(i / cols) * cellH + (mode === "random" ? 105 : mode === "bodies" ? 75 : 90);
	drawPlanet(ctx, cell.spec, cx, cy, radius, LIGHT);
	const report = measure(cell.spec, cell.label);
	reports.push(report);

	ctx.textAlign = "center";
	ctx.font = "11px sans-serif";
	ctx.fillStyle = "rgba(225, 230, 255, 0.75)";
	const words = cell.label.split(" · ");
	const lines = mode === "random" ? [words.slice(0, 3).join(" · "), words.slice(3).join(" · ")] : [cell.short ?? cell.label];
	const top = cy + radius + (mode === "random" ? 50 : mode === "bodies" ? 18 : 30);
	lines.forEach((line, li) => ctx.fillText(line, cx, top + li * 14));
	if (report.flags.length > 0) {
		ctx.fillStyle = "#ff5a5a";
		ctx.font = "600 11px sans-serif";
		ctx.fillText(`⚠ ${report.flags.join(", ")}`, cx, top + lines.length * 14 + 2);
	}
});

(window as unknown as { __report: Report[] }).__report = reports;
document.title = `done:${reports.length}`;
