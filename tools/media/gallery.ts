// Gallery images for the README: one planet of each kind, and the rare finds.
// Built and captured by tools/media/record.cjs.
import "../../preview/dom";
import { PlanetSpec, PlanetType, Vec3, drawPlanet, generatePlanet } from "../../src/planets/planet";

const LIGHT: Vec3 = { x: -0.75, y: -0.35, z: 0.58 };
const params = new URLSearchParams(location.search);
const part = params.get("part") ?? "types";

const NAMES: Partial<Record<PlanetType, string>> = {
	terran: "Earth-like", ocean: "Ocean", jungle: "Jungle", desert: "Desert", gas: "Gas giant",
	toxic: "Toxic", lava: "Lava", scorched: "Scorched", ice: "Ice", rocky: "Rocky", crystal: "Crystal",
	machine: "City world", dead: "Dead", destroyed: "Destroyed", snow: "Snow",
};

/** The first planet, counting up from `start`, that passes the test. */
function find(test: (s: PlanetSpec) => boolean, start: number): PlanetSpec {
	for (let seed = start; seed < start + 2_000_000; seed++) {
		const s = generatePlanet(seed);
		if (test(s)) return s;
	}
	throw new Error("nothing found");
}

/** Clean examples for the gallery: no loose rocks, at most one moon, no rings. */
const clean = (t: PlanetType) => (s: PlanetSpec) => s.type === t && s.rings === "none" && s.moons.length <= 1 && !s.features.includes("debris");

/** The `n`th clean example of a type. */
function example(t: PlanetType, n: number): PlanetSpec {
	let seed = 1000 + n * 104729;
	let found = 0;
	for (;;) {
		const s = generatePlanet(seed++);
		if (clean(t)(s) && found++ === n % 1000) return s;
	}
}

// Picked by eye from ?part=pick, which shows the first 10 examples of each kind.
const PICKS: Partial<Record<PlanetType, number>> = {};
const DEFAULT_PICKS = "terran:2,ocean:1,jungle:6,desert:4,gas:4,toxic:5,lava:9,scorched:0,ice:5,rocky:1,crystal:5,machine:0,dead:3,destroyed:1,snow:6";
for (const pair of (params.get("picks") || DEFAULT_PICKS).split(",").filter(Boolean)) {
	const [t, n] = pair.split(":");
	PICKS[t as PlanetType] = Number(n);
}

const cells: Array<{ spec: PlanetSpec; name: string }> = [];
if (part === "types") {
	for (const t of Object.keys(NAMES) as PlanetType[]) cells.push({ spec: example(t, PICKS[t] ?? 0), name: NAMES[t]! });
} else if (part === "pick") {
	for (const t of Object.keys(NAMES) as PlanetType[]) for (let n = 0; n < 10; n++) cells.push({ spec: example(t, n), name: `${t} ${n}` });
} else {
	for (const name of ["Saturn", "Jupiter", "Earth", "J1407b"]) {
		cells.push({ spec: find((s) => s.type === "real" && s.pattern === name, 1), name });
	}
	for (const name of ["tidal ocean", "forest moon", "storm ocean"]) {
		cells.push({ spec: find((s) => s.type === "inspired" && s.pattern === name, 1), name: name[0].toUpperCase() + name.slice(1) });
	}
}

const cols = part === "types" ? 5 : part === "pick" ? 10 : cells.length;
const cellW = part === "rare" ? 230 : part === "pick" ? 120 : 190, cellH = part === "rare" ? 250 : part === "pick" ? 130 : 200;
const radius = part === "pick" ? 40 : part === "types" ? 62 : 58;
const rows = Math.ceil(cells.length / cols);
const canvas = document.getElementById("sheet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = window.devicePixelRatio || 1;
const w = cols * cellW, h = rows * cellH;
canvas.style.width = `${w}px`;
canvas.width = w * dpr;
canvas.height = h * dpr;
ctx.scale(dpr, dpr);
ctx.fillStyle = "#05060e";
ctx.fillRect(0, 0, w, h);
cells.forEach((c, i) => {
	const cx = (i % cols) * cellW + cellW / 2;
	const cy = Math.floor(i / cols) * cellH + cellH / 2 - 14;
	drawPlanet(ctx, c.spec, cx, cy, c.spec.pattern === "J1407b" ? radius * 0.45 : radius, LIGHT);
	ctx.textAlign = "center";
	ctx.font = "600 13px -apple-system, Segoe UI, sans-serif";
	ctx.fillStyle = "rgba(225, 230, 245, 0.85)";
	ctx.fillText(c.name, cx, cy + radius + (part === "pick" ? 20 : 34));
});
document.title = `done:${cells.length}`;
