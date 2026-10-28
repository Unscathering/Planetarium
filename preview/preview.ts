// Draws a row of sample planets so their look can be checked in a browser.
// Build with `npm run preview`, then open preview/index.html.
import "./dom";
import { PlanetSpec, Vec3, describePlanet, drawPlanet, generatePlanet } from "../src/planets/planet";
import { hashString, makeRng } from "../src/planets/noise";

const SAMPLES: Array<{ note: string; traits: Partial<PlanetSpec> }> = [
	{ note: "Daily Journal", traits: { type: "terran", clouds: "wispy", features: ["cityLights"], atmosphere: "thin", rings: "none", moons: ["rocky"] } },
	{ note: "Project Ideas", traits: { type: "gas", pattern: "bands", rings: "wide", features: ["stormEye"], atmosphere: "thin", moons: [] } },
	{ note: "Book Notes", traits: { type: "lava", pattern: "cracks", features: ["volcanoes"], atmosphere: "thin", rings: "none", moons: ["icy", "rocky"] } },
	{ note: "Recipes", traits: { type: "ice", pattern: "cracked", atmosphere: "aurora", rings: "thin", moons: [] } },
	{ note: "Philosophy", traits: { type: "crystal", pattern: "crystal fields", atmosphere: "aurora", rings: "none", moons: ["rocky"] } },
];

const LIGHT: Vec3 = { x: -0.75, y: -0.3, z: 0.6 };
const canvas = document.getElementById("sky") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
// Draw at the screen's real pixel density so nothing is upscaled and blurry.
const dpr = Math.max(1, window.devicePixelRatio || 1);
const w = canvas.width, h = canvas.height;
canvas.style.width = `${w}px`;
canvas.width = w * dpr;
canvas.height = h * dpr;
ctx.scale(dpr, dpr);

ctx.fillStyle = "#04050d";
ctx.fillRect(0, 0, w, h);
const rng = makeRng(7);
for (let i = 0; i < 600; i++) {
	ctx.globalAlpha = 0.15 + rng() * 0.6;
	ctx.fillStyle = "#fff";
	const s = rng() < 0.08 ? 1.6 : 1;
	ctx.fillRect(rng() * w, rng() * h, s, s);
}
ctx.globalAlpha = 1;

const slot = w / SAMPLES.length;
SAMPLES.forEach(({ note, traits }, i) => {
	const spec = generatePlanet(hashString(note), traits);
	const cx = slot * (i + 0.5), cy = h * 0.42;
	drawPlanet(ctx, spec, cx, cy, 78, LIGHT);
	ctx.textAlign = "center";
	ctx.fillStyle = "#eef0ff";
	ctx.font = "600 16px sans-serif";
	ctx.fillText(note, cx, h - 70);
	ctx.fillStyle = "rgba(220, 225, 255, 0.6)";
	ctx.font = "12px sans-serif";
	const words = describePlanet(spec).split(" · ");
	ctx.fillText(words.slice(0, 3).join(" · "), cx, h - 48);
	ctx.fillText(words.slice(3).join(" · "), cx, h - 30);
});
