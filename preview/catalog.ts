// A labelled catalogue of every planet trait, one section per category.
// Build with `npm run preview`, then open preview/catalog.html?part=planets,
// ?part=extras or ?part=stars.
import "./dom";
import {
	ALL_TYPES,
	Atmosphere,
	CLOUD_STYLES,
	CloudStyle,
	MAX_FEATURES,
	MAX_MOONS,
	MOON_TYPES,
	RING_COLORS,
	RING_STYLES,
	RingStyle,
	countPlanetCombinations,
	Detail,
	Feature,
	PLANET_TYPES,
	PlanetSpec,
	PlanetType,
	Vec3,
	drawPlanet,
	generatePlanet,
} from "../src/planets/planet";
import {
	BLACK_HOLE_VARIATIONS,
	CORONAS,
	DISK_COLORS,
	STAR_SURFACES,
	STAR_TYPES,
	STAR_VARIATIONS,
	StarSpec,
	StarType,
	drawBlackHole,
	drawStar,
	generateBlackHole,
	generateStar,
} from "../src/planets/star";

interface Item {
	/** A planet to draw, or a custom draw function (stars, black holes). */
	spec?: PlanetSpec;
	draw?: (cx: number, cy: number) => void;
	/** Light for this planet, if not the usual one (night-side features). */
	light?: Vec3;
	label: string;
	note?: string;
}

interface Section {
	title: string;
	subtitle?: string;
	items: Item[];
}

const LIGHT: Vec3 = { x: -0.75, y: -0.3, z: 0.6 };
const COLS = 8;
const CELL_W = 230, CELL_H = 215, RADIUS = 50, HEADER_H = 64;

/** A planet with no extras, so only the trait being shown stands out. */
function base(type: PlanetType, overrides: Partial<PlanetSpec> = {}): PlanetSpec {
	return generatePlanet(4242, {
		type,
		pattern: PLANET_TYPES[type].patterns[0],
		detail: "plain",
		palette: 0,
		atmosphere: "none",
		clouds: "none",
		rings: "none",
		ringTilt: -0.25,
		moons: [],
		features: [],
		axialTilt: 0.15,
		...overrides,
	});
}

/** "terran, ocean, jungle" for the types whose lists include a value. */
function allowedOn(test: (type: PlanetType) => boolean): string {
	const names = ALL_TYPES.filter(test).map((t) => PLANET_TYPES[t].label.replace(/ (world|giant)$/, "").toLowerCase());
	return names.length === ALL_TYPES.length ? "all types" : names.join(", ");
}

function planetSections(): Section[] {
	const types: Section = {
		title: `Planet types (${ALL_TYPES.length})`,
		items: ALL_TYPES.map((t) => ({ spec: base(t), label: PLANET_TYPES[t].label })),
	};
	const patterns: Section = {
		title: `Patterns (${ALL_TYPES.length * 4}, 4 per type)`,
		items: ALL_TYPES.flatMap((t) =>
			PLANET_TYPES[t].patterns.map((p, i) => ({
				spec: base(t, { pattern: p, palette: (i * 3) % 10 }),
				label: p,
				note: PLANET_TYPES[t].label,
			}))
		),
	};
	// Each detail shown on a type that can have it, so it looks the way it really will.
	const detailShowcase: Array<[Detail, PlanetType]> = [
		["plain", "desert"], ["streaks", "desert"], ["speckled", "desert"], ["rifts", "desert"], ["spots", "gas"],
	];
	const details: Section = {
		title: "Surface details (each type gets 4 of these 5)",
		items: detailShowcase.map(([d, t]) => ({
			spec: base(t, { detail: d, pattern: t === "gas" ? "calm" : "dunes" }),
			label: d,
			note: allowedOn((type) => PLANET_TYPES[type].details.includes(d)),
		})),
	};
	return [types, patterns, details];
}

function extrasSections(): Section[] {
	const atmospheres: Section = {
		title: "Atmospheres (8)",
		subtitle: "All shown on the same terran world (airglow lit from behind); each type only gets the ones that suit it",
		items: (["none", "thin", "thick", "aurora", "storm", "rim", "haze", "airglow"] as Atmosphere[]).map((a) => ({
			light: a === "airglow" ? ({ x: 0.95, y: 0.1, z: 0.3 } as Vec3) : undefined,
			spec: base("terran", { atmosphere: a, palette: 2 }),
			label: a === "rim" ? "colored rim" : a,
			note: allowedOn((t) => PLANET_TYPES[t].atmospheres.includes(a)),
		})),
	};
	const clouds: Section = {
		title: `Cloud styles (none + ${CLOUD_STYLES.length})`,
		subtitle: `Only on ${allowedOn((t) => PLANET_TYPES[t].cloudChance > 0)} worlds`,
		items: (["none", ...CLOUD_STYLES] as CloudStyle[]).map((c) => ({
			spec: base("ocean", { clouds: c, atmosphere: "thin" }),
			label: c === "none" ? "no clouds" : c,
		})),
	};
	const ringStyles: Section = {
		title: `Ring styles (${RING_STYLES.length})`,
		subtitle: "Any type can have rings; gas giants get them most often",
		items: RING_STYLES.map((r) => ({ spec: base("gas", { rings: r, pattern: "calm", palette: 3 }), label: r })),
	};
	const ringColors: Section = {
		title: `Ring colors (${RING_COLORS.length} for every style)`,
		items: (["wide", "gapped", "belt"] as RingStyle[]).flatMap((r) =>
			RING_COLORS.map((c, i) => ({ spec: base("ice", { rings: r, ringColor: i, palette: 4 }), label: `${r} · ${c}` }))
		).slice(0, 16),
	};
	const moons: Section = {
		title: `Moon types (${MOON_TYPES.length}); 0 to ${MAX_MOONS} moons, any mix`,
		subtitle: "Each planet below has 2 moons of one type",
		items: MOON_TYPES.map((m) => ({ spec: base("desert", { moons: [m, m], seed: 77 }), label: `${m} moons` })),
	};
	const moonFamilies: Section = {
		title: "Moon families",
		subtitle: "1 to 4 moons, mixed types and sizes",
		items: [
			["rocky"], ["icy", "verdant"], ["asteroid", "dusty", "lava"], ["crystal", "icy", "ringed", "rocky"],
			["dusty", "dusty"], ["verdant", "crystal", "asteroid"], ["lava", "ringed", "icy", "asteroid"], ["crystal"],
		].map((m, i) => ({ spec: base(i % 2 ? "ocean" : "gas", { moons: m as PlanetSpec["moons"], seed: 300 + i * 17, pattern: i % 2 ? "archipelago" : "calm" }), label: `${m.length} moon${m.length > 1 ? "s" : ""}`, note: m.join(", ") })),
	};
	const NIGHT: Vec3 = { x: 0.95, y: 0.1, z: 0.3 };
	const featureList: Feature[] = [
		"cityLights", "volcanoes", "stormEye", "iceCaps", "crater", "debris",
		"hurricane", "wildfires", "bioluminescence", "dustStorm", "canyons", "craterChain",
		"geysers", "polarHex", "stormChain", "glowVeins", "smog", "ashClouds",
	];
	const showcase: Record<Feature, [PlanetType, Partial<PlanetSpec>, Vec3?]> = {
		cityLights: ["terran", { atmosphere: "thin" }, NIGHT],
		volcanoes: ["rocky", {}],
		stormEye: ["gas", { pattern: "calm" }],
		iceCaps: ["desert", { axialTilt: 0 }],
		crater: ["rocky", { pattern: "maria" }],
		debris: ["scorched", {}],
		hurricane: ["ocean", { pattern: "open seas", clouds: "wispy" }],
		wildfires: ["terran", { pattern: "supercontinent" }, NIGHT],
		bioluminescence: ["ocean", { pattern: "open seas" }, NIGHT],
		dustStorm: ["desert", { pattern: "dunes" }],
		canyons: ["rocky", { pattern: "cratered", palette: 3 }],
		craterChain: ["rocky", { pattern: "maria" }],
		geysers: ["ice", { pattern: "glacial" }],
		polarHex: ["gas", { pattern: "bands", palette: 3 }],
		stormChain: ["gas", { pattern: "bands", palette: 1 }],
		glowVeins: ["crystal", { pattern: "crystal fields" }],
		smog: ["machine", { pattern: "sprawl", palette: 1 }],
		ashClouds: ["lava", { pattern: "cracks" }],
	};
	const features: Section = {
		title: `Special features (${featureList.length}); up to ${MAX_FEATURES} per planet`,
		subtitle: "City lights and bioluminescence are shown lit from behind, since they only show at night",
		items: featureList.map((f) => {
			const [t, extra, light] = showcase[f];
			return {
				spec: base(t, { features: [f], ...extra }),
				light,
				label: f.replace(/([A-Z])/g, " $1").toLowerCase(),
				note: allowedOn((type) => PLANET_TYPES[type].features.includes(f)),
			};
		}),
	};
	const combos: Section = {
		title: `Everything combined: ${countPlanetCombinations().toLocaleString()} possible planets`,
		subtitle: "16 fully random planets",
		items: Array.from({ length: 16 }, (_, i) => {
			const spec = generatePlanet(9000 + i * 7919);
			return { spec, label: PLANET_TYPES[spec.type].label, note: `${spec.rings !== "none" ? spec.rings + " rings · " : ""}${spec.moons.length} moon${spec.moons.length === 1 ? "" : "s"} · ${spec.features.join(", ") || "no features"}` };
		}),
	};
	const shape: Section = {
		title: "Tilt, ring angle and moon sizes",
		subtitle: "Planets lean upright, tilted or sideways (rings follow the equator); rings are seen low, tilted or steep; moons come small, medium or large",
		items: [
			...(["upright", "tilted", "sideways"] as const).map((tilt, i) => ({
				spec: base("gas", { rings: "wide", pattern: "bands", palette: 3, tilt, axialTilt: [0.05, 0.45, -1.45][i] }),
				label: `${tilt} planet`,
			})),
			...(["low", "tilted", "steep"] as const).map((ringAngle) => ({ spec: base("ice", { rings: "wide", ringColor: 4, ringAngle, axialTilt: 0.15 }), label: `${ringAngle} rings` })),
			...(["small", "large"] as const).map((sz) => ({
				spec: base("ocean", { moons: ["rocky", "icy", "lava"], moonSizes: [sz, sz, sz], seed: 77 }),
				label: `${sz} moons`,
			})),
		],
	};
	return [atmospheres, clouds, ringStyles, ringColors, shape, moons, moonFamilies, features, combos];
}

const STAR_R = 34;

function star(type: StarType, overrides: Partial<StarSpec> = {}) {
	const spec = generateStar(99, { type, tint: 0, surface: "granulated", corona: "soft", ...overrides });
	// True relative sizes, capped so giants still fit their cell.
	const r = STAR_R * Math.min(STAR_TYPES[spec.type].size, 1.35);
	return (cx: number, cy: number) => drawStar(ctx, spec, cx, cy, r);
}

function starSections(): Section[] {
	const types = Object.keys(STAR_TYPES) as StarType[];
	return [
		{
			title: `Star types (${types.length})`,
			subtitle: "Shown at their real relative sizes (giants capped to fit)",
			items: types.map((t) => ({ draw: star(t), label: STAR_TYPES[t].label })),
		},
		{
			title: "Tints (4 per type)",
			subtitle: "Small color shifts within each type; shown on a yellow dwarf and a violet star",
			items: (["yellowDwarf", "violet"] as StarType[]).flatMap((t) =>
				[0, 1, 2, 3].map((tint) => ({ draw: star(t, { tint }), label: `tint ${tint + 1}`, note: STAR_TYPES[t].label }))
			),
		},
		{
			title: `Surfaces (${STAR_SURFACES.length})`,
			items: STAR_SURFACES.map((surface) => ({ draw: star("yellowDwarf", { surface }), label: surface })),
		},
		{
			title: `Coronas (${CORONAS.length})`,
			subtitle: "The glow and shapes around the star",
			items: CORONAS.flatMap((corona) => [
				{ draw: star("yellowDwarf", { corona }), label: corona, note: "Yellow dwarf" },
			]).concat(CORONAS.slice(1).map((corona) => ({ draw: star("blueGiant", { corona }), label: corona, note: "Blue giant" }))).slice(0, 8),
		},
		{
			title: `${STAR_VARIATIONS.toLocaleString()} star combinations: 16 random ones`,
			items: Array.from({ length: 16 }, (_, i) => {
				const spec = generateStar(500 + i * 7919);
				const r = STAR_R * Math.min(STAR_TYPES[spec.type].size, 1.35);
				return { draw: (cx: number, cy: number) => drawStar(ctx, spec, cx, cy, r), label: STAR_TYPES[spec.type].label, note: `${spec.surface} · ${spec.corona}` };
			}),
		},
		{
			title: `Black holes (${BLACK_HOLE_VARIATIONS} combinations): disk colors`,
			items: DISK_COLORS.map((disk) => ({
				draw: (cx: number, cy: number) => drawBlackHole(ctx, generateBlackHole(7, { disk, width: "medium", tilt: 1, jets: false, brightSide: "left" }), cx, cy, 18),
				label: disk,
			})),
		},
		{
			title: "Black holes: disk width, tilt, jets",
			subtitle: "The bright side shows which way the disk spins toward you",
			items: [
				...(["thin", "medium", "wide"] as const).map((width) => ({
					draw: (cx: number, cy: number) => drawBlackHole(ctx, generateBlackHole(7, { disk: "ember", width, tilt: 1, jets: false, brightSide: "left" }), cx, cy, 18),
					label: `${width} disk`,
				})),
				...([0, 1, 2] as const).map((tilt) => ({
					draw: (cx: number, cy: number) => drawBlackHole(ctx, generateBlackHole(7, { disk: "ice", width: "medium", tilt, jets: false, brightSide: "right" }), cx, cy, 18),
					label: ["edge-on", "tilted", "steep"][tilt],
				})),
				...[false, true].map((jets) => ({
					draw: (cx: number, cy: number) => drawBlackHole(ctx, generateBlackHole(7, { disk: "violet", width: "medium", tilt: 1, jets, brightSide: "left" }), cx, cy, 18),
					label: jets ? "with jets" : "no jets",
				})),
			],
		},
	];
}

const part = new URLSearchParams(location.search).get("part") ?? "planets";
const sections = part === "extras" ? extrasSections() : part === "stars" ? starSections() : planetSections();

const canvas = document.getElementById("catalog") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const dpr = Math.max(1, window.devicePixelRatio || 1);
const w = COLS * CELL_W;
const h = sections.reduce((sum, s) => sum + HEADER_H + Math.ceil(s.items.length / COLS) * CELL_H, 0) + 20;
canvas.style.width = `${w}px`;
canvas.width = w * dpr;
canvas.height = h * dpr;
ctx.scale(dpr, dpr);
ctx.fillStyle = "#04050d";
ctx.fillRect(0, 0, w, h);

/** Splits text into lines that fit the given width. */
function wrap(text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		const next = line ? `${line} ${word}` : word;
		if (ctx.measureText(next).width > maxWidth && line) {
			lines.push(line);
			line = word;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

let y = 0;
for (const section of sections) {
	ctx.textAlign = "left";
	ctx.fillStyle = "#eef0ff";
	ctx.font = "600 20px sans-serif";
	ctx.fillText(section.title, 24, y + 34);
	if (section.subtitle) {
		ctx.fillStyle = "rgba(220, 225, 255, 0.55)";
		ctx.font = "13px sans-serif";
		ctx.fillText(section.subtitle, 24, y + 54);
	}
	ctx.fillStyle = "rgba(220, 225, 255, 0.12)";
	ctx.fillRect(24, y + 8, w - 48, 1);
	y += HEADER_H;
	section.items.forEach((item, i) => {
		const cx = (i % COLS) * CELL_W + CELL_W / 2;
		const cy = y + Math.floor(i / COLS) * CELL_H + 80;
		if (item.draw) item.draw(cx, cy);
		else if (item.spec) drawPlanet(ctx, item.spec, cx, cy, RADIUS, item.light ?? LIGHT);
		ctx.textAlign = "center";
		ctx.fillStyle = "#eef0ff";
		ctx.font = "600 13px sans-serif";
		ctx.fillText(item.label, cx, cy + RADIUS + 38);
		if (item.note) {
			ctx.fillStyle = "rgba(220, 225, 255, 0.55)";
			ctx.font = "11px sans-serif";
			wrap(item.note, CELL_W - 20).forEach((line, li) => ctx.fillText(line, cx, cy + RADIUS + 55 + li * 14));
		}
	});
	y += Math.ceil(section.items.length / COLS) * CELL_H;
}

(window as unknown as { __report: unknown[] }).__report = [];
document.title = "done";
