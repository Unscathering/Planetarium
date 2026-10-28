// Larger previews: ?part=blackholes shows big black holes, ?part=system shows
// a sun with orbiting planets lit from the sun's direction.
import "./dom";
import { Vec3, describePlanet, drawPlanet, generatePlanet, PlanetSpec } from "../src/planets/planet";
import { Orbit, generateOrbits, orbitPath, orbitPosition } from "../src/planets/orbit";
import { hashString, makeRng } from "../src/planets/noise";
import { BlackHoleSpec, StarType, SunStyle, drawBlackHole, drawStar, drawStyledStar, generateBlackHole, generateStar } from "../src/planets/star";

const part = new URLSearchParams(location.search).get("part") ?? "system";
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = Math.max(1, window.devicePixelRatio || 1);
const W = 1500, H = part === "blackholes" ? 900 : part === "sunstyles" ? 1060 : part === "farview" ? 760 : 820;
canvas.style.width = `${W}px`;
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

ctx.fillStyle = "#03040a";
ctx.fillRect(0, 0, W, H);
const rng = makeRng(11);
for (let i = 0; i < 1400; i++) {
	ctx.globalAlpha = 0.1 + rng() * 0.6;
	ctx.fillStyle = "#fff";
	const s = rng() < 0.06 ? 1.7 : 1;
	ctx.fillRect(rng() * W, rng() * H, s, s);
}
ctx.globalAlpha = 1;

function label(text: string, sub: string, x: number, y: number) {
	ctx.textAlign = "center";
	ctx.fillStyle = "#eef0ff";
	ctx.font = "600 15px sans-serif";
	ctx.fillText(text, x, y);
	ctx.fillStyle = "rgba(220, 225, 255, 0.55)";
	ctx.font = "12px sans-serif";
	ctx.fillText(sub, x, y + 18);
}

function drawOrbitPath(o: Orbit, cx: number, cy: number, squash: number, alpha: number) {
	const pts = orbitPath(o, squash);
	ctx.strokeStyle = `rgba(200, 210, 255, ${alpha})`;
	ctx.lineWidth = 1;
	ctx.beginPath();
	pts.forEach((p, i) => (i === 0 ? ctx.moveTo(cx + p.x, cy + p.y) : ctx.lineTo(cx + p.x, cy + p.y)));
	ctx.stroke();
}

/** Light direction from a planet toward the thing it orbits. */
function toward(px: number, py: number, sx: number, sy: number): Vec3 {
	const dx = sx - px, dy = sy - py, d = Math.hypot(dx, dy) || 1;
	return { x: dx / d, y: dy / d, z: 0.3 };
}

if (part === "bhsystems") {
	const systems: Array<[string, Partial<BlackHoleSpec>, string[]]> = [
		["Archive", { disk: "ember", width: "wide", tilt: 1, jets: false, brightSide: "left" }, ["Old Drafts", "2019 Notes", "Scraps", "Retired Ideas", "Backups"]],
		["Research", { disk: "ice", width: "medium", tilt: 1, jets: true, brightSide: "right" }, ["Papers", "Sources", "Questions", "Experiments"]],
	];
	systems.forEach(([folder, traits, notes], i) => {
		const cx = i * (W / 2) + W / 4, cy = 390;
		const hole = generateBlackHole(70 + i, traits);
		const flat = [0.14, 0.24, 0.36][hole.tilt];
		const orbits = notes.map((note, k) => {
			const rx = 215 + k * 34, a = (k * 2.1 + i) % (Math.PI * 2);
			return { note, rx, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * rx * flat * 1.6, r: [9, 6, 12, 7, 10][k] };
		});
		ctx.strokeStyle = "rgba(200, 210, 255, 0.1)";
		for (const o of orbits) {
			ctx.beginPath();
			ctx.ellipse(cx, cy, o.rx, o.rx * flat * 1.6, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		// Planets on the far side of their orbit go behind the black hole.
		const draw = (o: (typeof orbits)[number]) => {
			drawPlanet(ctx, generatePlanet(hashString(o.note), { moons: [] }), o.x, o.y, o.r, toward(o.x, o.y, cx, cy));
			ctx.textAlign = "center";
			ctx.fillStyle = "rgba(220, 225, 255, 0.6)";
			ctx.font = "11px sans-serif";
			ctx.fillText(o.note, o.x, o.y + o.r * 2.4 + 12);
		};
		orbits.filter((o) => o.y < cy).forEach(draw);
		drawBlackHole(ctx, hole, cx, cy, 34);
		orbits.filter((o) => o.y >= cy).forEach(draw);
		label(folder, "folder · black hole", cx, 720);
	});
	ctx.fillStyle = "rgba(200, 210, 255, 0.12)";
	ctx.fillRect(W / 2, 20, 1, H - 40);
} else if (part === "farview") {
	// The same far-away view twice: detailed planets on the left, soft glows on the right.
	const systems: Array<{ x: number; y: number; r: number; seed: number; hole?: boolean }> = [
		{ x: 160, y: 200, r: 16, seed: 1 }, { x: 470, y: 150, r: 11, seed: 2 }, { x: 330, y: 440, r: 20, seed: 3, hole: true },
		{ x: 600, y: 420, r: 13, seed: 4 }, { x: 150, y: 600, r: 12, seed: 5 }, { x: 520, y: 640, r: 15, seed: 6 },
	];
	for (const side of [0, 1]) {
		const x0 = side * (W / 2);
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0, 0, W / 2, H);
		ctx.clip();
		ctx.textAlign = "left";
		ctx.fillStyle = "#eef0ff";
		ctx.font = "600 18px sans-serif";
		ctx.fillText("Far view", x0 + 24, 34);
		for (const s of systems) {
			const sx = x0 + s.x + 30, sy = s.y + 20;
			const rng2 = makeRng(s.seed);
			const count = 3 + Math.floor(rng2() * 4);
			const squash = 0.34;
			const orbits = generateOrbits(s.seed, count, s.r * 2.4 + 10, 1.28);
			const planets = orbits.map((o, k) => {
				const pos = orbitPosition(o, 0, squash);
				return { o, x: sx + pos.x, y: sy + pos.y, depth: pos.depth, r: 2 + rng2() * 2.6, spec: generatePlanet(s.seed * 100 + k, { moons: [] }) };
			});
			for (const p of planets) drawOrbitPath(p.o, sx, sy, squash, 0.07);
			const drawP = (p: (typeof planets)[number]) => {
				const light = toward(p.x, p.y, sx, sy);
				drawPlanet(ctx, p.spec, p.x, p.y, p.r, light);
			};
			planets.filter((p) => p.depth < 0).forEach(drawP);
			if (s.hole) drawBlackHole(ctx, generateBlackHole(s.seed), sx, sy, s.r * 0.45);
			else drawStyledStar(ctx, generateStar(s.seed * 13), sx, sy, s.r, "wispy");
			planets.filter((p) => p.depth >= 0).forEach(drawP);
		}
		ctx.restore();
	}
	ctx.fillStyle = "rgba(200, 210, 255, 0.12)";
	ctx.fillRect(W / 2, 20, 1, H - 40);
} else if (part === "sunstyles") {
	const styles: Array<[SunStyle, string, string]> = [
		["cinematic", "A · Cinematic bloom", "white-hot core, layered aura, lens-flare spikes"],
		["wispy", "B · Wispy realistic", "white-hot core, flowing strands of corona"],
		["stylized", "C · Stylized glow", "clean disc, soft halo bands, rim light"],
	];
	// Compressed realism: planets keep realistic sizes relative to each other, much smaller than the sun.
	const planets: Array<[string, number, number]> = [["rocky", 4, 175], ["terran", 6.5, 215], ["gas", 15, 260], ["ice", 9, 305]];
	const panelW = W / 3;
	styles.forEach(([style, title, sub], i) => {
		const x0 = i * panelW;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0, 0, panelW, H);
		ctx.clip();
		ctx.textAlign = "left";
		ctx.fillStyle = "#eef0ff";
		ctx.font = "600 19px sans-serif";
		ctx.fillText(title, x0 + 24, 36);
		ctx.fillStyle = "rgba(220, 225, 255, 0.55)";
		ctx.font = "13px sans-serif";
		ctx.fillText(sub, x0 + 24, 56);
		const sx = x0 + panelW / 2, sy = 300;
		ctx.strokeStyle = "rgba(200, 210, 255, 0.1)";
		for (const [, , orbit] of planets) {
			ctx.beginPath();
			ctx.ellipse(sx, sy, orbit * 0.78, orbit * 0.3 + 40, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		drawStyledStar(ctx, generateStar(21, { type: "yellowDwarf", tint: 0 }), sx, sy, 92, style);
		planets.forEach(([type, size, orbit], k) => {
			const a = [0.5, 2.3, 0.95, 2.75][k];
			const px = sx + Math.cos(a) * orbit * 0.78, py = sy + Math.sin(a) * (orbit * 0.3 + 40);
			const dx = sx - px, dy = sy - py, d = Math.hypot(dx, dy);
			drawPlanet(ctx, generatePlanet(300 + k, { type: type as PlanetSpec["type"], rings: type === "gas" ? "wide" : "none", moons: [], atmosphere: "thin" }), px, py, size, { x: dx / d, y: dy / d, z: 0.3 });
		});
		const types: StarType[] = ["redDwarf", "redGiant", "blueGiant", "violet"];
		types.forEach((t, k) => {
			const cx = x0 + 70 + k * ((panelW - 140) / 3), cy = 790;
			drawStyledStar(ctx, generateStar(40 + k, { type: t, tint: 0 }), cx, cy, t === "redGiant" || t === "blueGiant" ? 40 : t === "redDwarf" ? 22 : 32, style);
		});
		ctx.restore();
		label("same style on other star types", "red dwarf · red giant · blue giant · violet", x0 + panelW / 2, 925);
	});
	ctx.fillStyle = "rgba(200, 210, 255, 0.12)";
	ctx.fillRect(panelW, 20, 1, H - 40);
	ctx.fillRect(panelW * 2, 20, 1, H - 40);
} else if (part === "blackholes") {
	const holes: Array<[string, Partial<BlackHoleSpec>]> = [
		["Ember · wide disk", { disk: "ember", width: "wide", tilt: 0, jets: false, brightSide: "left" }],
		["Ice · jets", { disk: "ice", width: "medium", tilt: 1, jets: true, brightSide: "right" }],
		["Violet · steep view", { disk: "violet", width: "medium", tilt: 2, jets: false, brightSide: "left" }],
		["Gold · thin disk", { disk: "gold", width: "thin", tilt: 1, jets: false, brightSide: "right" }],
		["Emerald · jets", { disk: "emerald", width: "wide", tilt: 1, jets: true, brightSide: "left" }],
		["Crimson · edge-on", { disk: "crimson", width: "medium", tilt: 0, jets: false, brightSide: "right" }],
	];
	holes.forEach(([name, traits], i) => {
		const cx = (i % 3) * (W / 3) + W / 6, cy = Math.floor(i / 3) * 430 + 200;
		drawBlackHole(ctx, generateBlackHole(31 + i, traits), cx, cy, 48);
		label(name, "black hole", cx, cy + 190);
	});
} else {
	// A solar system with rolled orbits: uneven spacing, slight ovals, varied tilts, random positions.
	const sun = { x: W / 2, y: H / 2 };
	const star = generateStar(hashString("Projects"), { type: "yellowDwarf", tint: 0, surface: "granulated", corona: "rays" });
	const notes = ["Daily Journal", "Book Notes", "Ideas", "Recipes", "Workouts", "Philosophy", "Travel Plans"];
	const squash = 0.34;
	const orbits = generateOrbits(hashString("Projects"), notes.length, 150, 1.28);
	for (const o of orbits) drawOrbitPath(o, sun.x, sun.y, squash, 0.12);
	// Planet sizes follow type: gas giants large, rocky worlds small.
	const SIZE: Record<string, number> = { gas: 16, toxic: 13, ice: 10, ocean: 9, terran: 8.5, jungle: 8.5, machine: 8.5, desert: 7.5, crystal: 7.5, lava: 6.5, scorched: 6.5, rocky: 5.5 };
	const planets = notes.map((note, i) => {
		const pos = orbitPosition(orbits[i], 0, squash);
		const spec: PlanetSpec = generatePlanet(hashString(note));
		return { note, spec, x: sun.x + pos.x, y: sun.y + pos.y, depth: pos.depth, r: SIZE[spec.type] };
	});
	const drawP = (p: (typeof planets)[number]) => {
		drawPlanet(ctx, p.spec, p.x, p.y, p.r, toward(p.x, p.y, sun.x, sun.y));
		ctx.textAlign = "center";
		ctx.fillStyle = "rgba(220, 225, 255, 0.7)";
		ctx.font = "12px sans-serif";
		ctx.fillText(p.note, p.x, p.y + p.r * 2.2 + 12);
	};
	planets.filter((p) => p.depth < 0).forEach(drawP);
	drawStyledStar(ctx, star, sun.x, sun.y, 62, "wispy");
	planets.filter((p) => p.depth >= 0).forEach(drawP);
	label("Projects", "folder · yellow dwarf", sun.x, H - 40);
}
document.title = "done";
(window as unknown as { __report: unknown[] }).__report = [];
