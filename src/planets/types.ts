// The planet catalogue: every type, the patterns and details it can have, and
// its palettes. Palettes come from one tuned color recipe per type applied to
// different base hues, so every palette keeps the contrast its type needs.

import { Stop, hsl, recipe } from "./color";

export type PlanetType =
	| "terran" | "ocean" | "jungle" | "desert"
	| "gas" | "toxic" | "lava" | "scorched"
	| "ice" | "rocky" | "crystal" | "machine"
	| "dead" | "destroyed" | "snow" | "real" | "inspired";
export type Atmosphere = "none" | "thin" | "thick" | "aurora" | "storm" | "rim" | "haze" | "airglow";
export type Rings = "none" | RingStyle;
export type RingStyle = "thin" | "wide" | "double" | "icy" | "belt" | "broken" | "colossal" | "dusty" | "gapped" | "braided" | "halo";
export type CloudStyle = "none" | "wispy" | "banded" | "patchy" | "storms" | "cirrus" | "cumulus";
export type MoonType = "rocky" | "icy" | "lava" | "asteroid" | "ringed" | "dusty" | "verdant" | "crystal";
export type Feature =
	| "cityLights" | "volcanoes" | "stormEye" | "iceCaps"
	| "debris" | "crater"
	| "hurricane" | "wildfires" | "bioluminescence" | "dustStorm" | "canyons" | "craterChain"
	| "geysers" | "polarHex" | "stormChain" | "glowVeins" | "smog" | "ashClouds" | "greatRift";
/** Fine overlay drawn on top of the pattern. */
export type Detail = "plain" | "streaks" | "speckled" | "rifts" | "spots" | "mottled" | "pocked" | "veined" | "ripples";

export const RING_STYLES: RingStyle[] = ["thin", "wide", "double", "icy", "belt", "broken", "colossal", "dusty", "gapped", "braided", "halo"];
/** How often each ring style is chosen: colossal ring systems are rare. */
export const RING_WEIGHTS: Record<RingStyle, number> = { thin: 1, wide: 1, double: 1, icy: 1, belt: 1, broken: 1, colossal: 0.2, dusty: 1, gapped: 1, braided: 0.7, halo: 0.8 };
/** Ring color schemes: match the planet, contrast with it, icy white, dark rock, rusty dust, pale gold. */
export const RING_COLORS = ["match", "contrast", "ice", "dark", "rust", "gold"] as const;
export const CLOUD_STYLES: CloudStyle[] = ["wispy", "banded", "patchy", "storms", "cirrus", "cumulus"];
/** Moons come in three sizes. */
export type MoonSize = "small" | "medium" | "large";
export const MOON_SIZES: MoonSize[] = ["small", "medium", "large"];
/** How open the rings look: nearly edge-on, tilted, or seen steeply from above. */
export type RingAngle = "low" | "tilted" | "steep";
export const RING_ANGLES: RingAngle[] = ["low", "tilted", "steep"];
export const RING_FLAT: Record<RingAngle, number> = { low: 0.14, tilted: 0.3, steep: 0.5 };
/** How far the planet leans: bands, ice caps, storms and rings all turn with it. */
export type TiltClass = "upright" | "tilted" | "sideways";
export const TILT_CLASSES: TiltClass[] = ["upright", "tilted", "sideways"];

/** How big a planet is for its type. */
export type SizeClass = "small" | "standard" | "large";
export const SIZE_CLASSES: SizeClass[] = ["small", "standard", "large"];
export const SIZE_SCALE: Record<SizeClass, number> = { small: 0.8, standard: 1, large: 1.25 };
/** How violent a planet's weather is. Only planets with weather show a difference. */
export type StormLevel = "calm" | "moderate" | "heavy" | "extreme";
export const STORM_LEVELS: StormLevel[] = ["calm", "moderate", "heavy", "extreme"];
/** How much each level scales storm sizes, cloud cover and turbulence. */
export const STORM_STRENGTH: Record<StormLevel, number> = { calm: 0.65, moderate: 1, heavy: 1.35, extreme: 1.75 };

export const MOON_TYPES: MoonType[] = ["rocky", "icy", "lava", "asteroid", "ringed", "dusty", "verdant", "crystal"];
export const MAX_MOONS = 4;
export const MAX_FEATURES = 3;

export interface Palette {
	/** Main color ramp, dark to light. */
	a: string[];
	/** Second ramp: land, glow, water or crack color depending on type. */
	b?: string[];
	atmo: string;
	accent: string;
}

export interface TypeDef {
	label: string;
	patterns: string[];
	details: Detail[];
	palettes: Palette[];
	atmospheres: Atmosphere[];
	/** Features this type can have; a planet gets up to MAX_FEATURES of them. */
	features: Feature[];
	cloudChance: number;
	ringChance: number;
	/** How often this type turns up compared with the others (default 1). */
	weight?: number;
}

const CITY = hsl(42, 1, 0.7);
// Features any type can have: things in orbit rather than on the surface.
const ORBITAL: Feature[] = ["debris"];

// Recipes: [hue shift, saturation, lightness] from dark to light.
const OCEAN_DEEP: Stop[] = [[0, 0.75, 0.13], [0, 0.68, 0.3], [-8, 0.62, 0.48]];
const GAS: Stop[] = [[0, 0.45, 0.2], [6, 0.5, 0.5], [12, 0.4, 0.84], [-12, 0.55, 0.36], [4, 0.35, 0.7]];
const LAVA_ROCK: Stop[] = [[0, 0.25, 0.05], [0, 0.22, 0.1], [0, 0.18, 0.17]];
const LAVA_GLOW: Stop[] = [[0, 1, 0.45], [20, 1, 0.58], [40, 1, 0.8]];
const ICE: Stop[] = [[0, 0.4, 0.42], [0, 0.5, 0.7], [0, 0.6, 0.9], [0, 0.2, 0.98]];
const DESERT: Stop[] = [[0, 0.55, 0.2], [5, 0.55, 0.38], [10, 0.55, 0.56], [15, 0.6, 0.76]];
const ROCK: Stop[] = [[0, 1, 0.14], [0, 1, 0.3], [0, 0.9, 0.48], [0, 0.8, 0.68]];
const TOXIC: Stop[] = [[0, 0.6, 0.14], [0, 0.7, 0.36], [10, 0.75, 0.6], [-8, 0.6, 0.26], [15, 0.8, 0.78]];
const CRYSTAL: Stop[] = [[0, 0.6, 0.14], [0, 0.6, 0.36], [0, 0.7, 0.62], [0, 0.5, 0.88]];
const SEA: Stop[] = [[0, 0.75, 0.12], [0, 0.7, 0.27], [-12, 0.65, 0.45], [-25, 0.6, 0.65]];
const CANOPY: Stop[] = [[0, 0.55, 0.1], [0, 0.6, 0.2], [10, 0.55, 0.32], [20, 0.5, 0.46]];
const METAL: Stop[] = [[0, 0.08, 0.12], [0, 0.1, 0.27], [0, 0.12, 0.45], [0, 0.1, 0.68]];
const ASH: Stop[] = [[0, 0.15, 0.09], [0, 0.16, 0.19], [0, 0.18, 0.32], [0, 0.14, 0.52]];
const DEAD_CRUST: Stop[] = [[0, 0.12, 0.07], [0, 0.12, 0.16], [0, 0.1, 0.28], [0, 0.08, 0.44]];
const RUBBLE: Stop[] = [[0, 0.2, 0.08], [0, 0.22, 0.18], [0, 0.2, 0.32], [0, 0.16, 0.5]];
const SNOWFIELD: Stop[] = [[0, 0.3, 0.6], [0, 0.26, 0.74], [0, 0.2, 0.86], [0, 0.12, 0.95]];

const land = (h: number) => [hsl(h + 30, 0.4, 0.68), hsl(h, 0.5, 0.36), hsl(h - 8, 0.5, 0.24), hsl(h + 15, 0.18, 0.38)];
const islands = (h: number) => [hsl(h + 30, 0.45, 0.72), hsl(h, 0.45, 0.38), hsl(h - 8, 0.45, 0.26)];

type Pair = readonly [number, number];

export const PLANET_TYPES: Record<PlanetType, TypeDef> = {
	terran: {
		label: "Terran",
		patterns: ["continents", "islands", "supercontinent", "lakes", "fjords", "tundra"],
		details: ["plain", "speckled", "rifts", "spots", "mottled", "streaks"],
		// [ocean hue, land hue]
		palettes: ([
			[212, 105], [268, 18], [178, 80], [222, 32], [318, 165], [150, 5], [192, 48], [238, 88], [205, 285], [182, 62],
			[200, 140], [260, 55], [170, 25], [215, 330], [190, 120], [250, 100], [160, 45], [230, 15], [300, 90], [185, 35],
			[195, 75], [245, 40], [175, 140], [210, 60], [280, 110], [165, 20], [230, 350], [200, 90], [255, 70], [190, 10],
		] as Pair[]).map(([o, l]) => ({ a: recipe(o, OCEAN_DEEP), b: land(l), atmo: hsl(o, 0.8, 0.72), accent: CITY })),
		atmospheres: ["thin", "thick", "storm", "rim", "haze"],
		features: ["cityLights", "iceCaps", "hurricane", "wildfires", "greatRift", ...ORBITAL],
		cloudChance: 0.85,
		ringChance: 0.1,
	},
	ocean: {
		label: "Ocean world",
		patterns: ["archipelago", "open seas", "reefs", "maelstrom", "deep trenches", "shelf seas", "abyss"],
		details: ["plain", "streaks", "speckled", "spots", "mottled", "ripples"],
		// [sea hue, island hue]
		palettes: ([
			[208, 100], [190, 60], [222, 40], [175, 90], [242, 20], [160, 120], [265, 320], [196, 30], [150, 45], [230, 80],
			[215, 130], [180, 10], [200, 280], [168, 50], [235, 150], [210, 70], [155, 200], [250, 40], [185, 340], [225, 110],
			[195, 130], [245, 60], [172, 30], [220, 350], [205, 190], [260, 100], [180, 70], [238, 20], [190, 160], [212, 300],
		] as Pair[]).map(([s, i]) => ({ a: recipe(s, SEA), b: islands(i), atmo: hsl(s, 0.8, 0.72), accent: CITY })),
		atmospheres: ["thin", "thick", "storm", "rim", "airglow"],
		features: ["cityLights", "iceCaps", "hurricane", "bioluminescence", "greatRift", ...ORBITAL],
		cloudChance: 0.9,
		ringChance: 0.15,
	},
	jungle: {
		label: "Jungle world",
		patterns: ["rainforest", "rivers", "swamp", "highlands", "deltas", "mangroves"],
		details: ["plain", "speckled", "rifts", "spots", "mottled", "veined"],
		// [canopy hue, water hue]
		palettes: ([
			[110, 205], [95, 200], [130, 210], [80, 195], [150, 215], [165, 230], [60, 200], [290, 170], [15, 190], [140, 30],
			[120, 190], [100, 220], [140, 200], [75, 210], [155, 240], [50, 195], [170, 205], [300, 180], [30, 200], [125, 40],
			[105, 215], [85, 190], [135, 225], [65, 205], [160, 195], [115, 175], [90, 230], [310, 190], [40, 210], [145, 20],
		] as Pair[]).map(([c, w]) => ({ a: recipe(c, CANOPY), b: [hsl(w, 0.5, 0.17), hsl(w, 0.5, 0.33)], atmo: hsl(c + 40, 0.6, 0.75), accent: CITY })),
		atmospheres: ["thin", "thick", "storm", "rim", "haze"],
		features: ["cityLights", "iceCaps", "bioluminescence", "hurricane", "greatRift", ...ORBITAL],
		cloudChance: 0.7,
		ringChance: 0.1,
	},
	desert: {
		label: "Desert world",
		patterns: ["dunes", "cratered", "canyons", "mesas", "salt flats", "badlands"],
		details: ["plain", "streaks", "speckled", "rifts", "ripples", "pocked"],
		// [hue, saturation scale]
		palettes: ([
			[15, 1], [40, 1], [25, 0.35], [32, 0.8], [2, 0.9], [50, 0.7], [280, 0.45], [165, 0.45], [12, 0.7], [22, 0.25],
			[18, 0.8], [45, 0.9], [8, 0.6], [35, 0.5], [55, 0.85], [300, 0.35], [190, 0.35], [28, 1], [0, 0.5], [60, 0.4],
			[5, 0.7], [38, 0.6], [48, 1], [20, 0.45], [30, 0.9], [270, 0.3], [175, 0.3], [12, 1], [42, 0.3], [58, 0.6],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, DESERT, s), atmo: hsl(h + 5, 0.8, 0.75), accent: CITY })),
		atmospheres: ["none", "thin", "rim", "haze"],
		features: ["cityLights", "iceCaps", "volcanoes", "crater", "dustStorm", "canyons", ...ORBITAL],
		cloudChance: 0.2,
		ringChance: 0.2,
	},
	gas: {
		label: "Gas giant",
		patterns: ["bands", "turbulent", "calm", "storms", "marbled", "ribbons"],
		details: ["plain", "streaks", "spots", "rifts", "mottled", "veined"],
		palettes: ([
			[30, 1], [218, 1], [330, 1], [48, 1], [190, 1], [268, 1], [8, 1], [145, 1], [300, 1], [205, 0.4],
			[20, 1], [235, 1], [340, 0.8], [60, 0.8], [175, 1], [285, 0.9], [0, 0.9], [120, 0.8], [315, 1], [40, 0.5],
			[25, 0.7], [210, 0.8], [350, 1], [52, 0.6], [160, 0.8], [275, 0.7], [12, 0.6], [130, 1], [195, 0.6], [320, 0.7],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, GAS, s), atmo: hsl(h, 0.6, 0.75), accent: hsl(h - 25, 0.6 * s, 0.42) })),
		atmospheres: ["thin", "thick", "aurora", "storm", "airglow"],
		features: ["stormEye", "polarHex", "stormChain", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.55,
	},
	toxic: {
		label: "Toxic world",
		patterns: ["swirls", "bands", "bubbling", "acid seas", "sludge", "spore clouds"],
		details: ["plain", "streaks", "spots", "speckled", "mottled", "veined"],
		palettes: [92, 52, 282, 140, 72, 320, 30, 170, 0, 250, 100, 60, 265, 155, 80, 335, 20, 185, 350, 230, 110, 45, 295, 125, 88, 305, 36, 195, 12, 215]
			.map((h) => ({ a: recipe(h, TOXIC), atmo: hsl(h, 0.9, 0.6), accent: hsl(h + 15, 1, 0.65) })),
		atmospheres: ["thick", "aurora", "storm", "haze"],
		features: ["stormEye", "polarHex", "bioluminescence", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.3,
	},
	lava: {
		label: "Lava world",
		patterns: ["cracks", "magma seas", "lava rivers", "volcanic fields", "lava lakes", "cooling crust"],
		details: ["plain", "streaks", "speckled", "rifts", "pocked", "veined"],
		// [rock hue, glow hue]
		palettes: ([
			[10, 18], [230, 205], [100, 120], [270, 285], [0, 2], [30, 45], [190, 175], [320, 320], [220, 25], [40, 55],
			[15, 30], [240, 215], [110, 135], [260, 270], [5, 350], [25, 50], [200, 190], [330, 305], [210, 10], [35, 65],
			[5, 25], [235, 195], [95, 110], [275, 300], [20, 10], [45, 40], [185, 160], [325, 340], [215, 35], [50, 70],
		] as Pair[]).map(([r, g]) => ({ a: recipe(r, LAVA_ROCK), b: recipe(g, LAVA_GLOW), atmo: hsl(g, 1, 0.6), accent: hsl(g + 10, 1, 0.6) })),
		atmospheres: ["none", "thin", "rim", "airglow"],
		features: ["volcanoes", "crater", "craterChain", "ashClouds", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.15,
	},
	scorched: {
		label: "Scorched world",
		patterns: ["ash plains", "cracked crust", "embers", "glassed", "dust bowl", "tectonic"],
		details: ["plain", "streaks", "speckled", "rifts", "pocked", "ripples"],
		// [rock hue, ember hue]
		palettes: ([
			[20, 25], [0, 10], [30, 40], [40, 30], [10, 0], [220, 190], [270, 290], [90, 60], [350, 350], [200, 20],
			[25, 20], [5, 15], [35, 45], [45, 35], [15, 5], [230, 200], [280, 300], [80, 70], [340, 355], [190, 30],
			[30, 15], [10, 25], [40, 50], [50, 40], [0, 5], [215, 180], [260, 280], [100, 55], [345, 10], [195, 40],
		] as Pair[]).map(([r, e]) => ({ a: recipe(r, ASH), atmo: hsl(r, 0.3, 0.5), accent: hsl(e, 1, 0.55) })),
		atmospheres: ["none", "thin", "rim", "haze"],
		features: ["volcanoes", "crater", "canyons", "ashClouds", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.2,
	},
	ice: {
		label: "Ice world",
		patterns: ["glacial", "cracked", "frozen sea", "crevasses", "glacier flows", "cryovolcanic"],
		details: ["plain", "streaks", "speckled", "rifts", "veined", "ripples"],
		palettes: ([
			[210, 1], [170, 1], [250, 1], [192, 1], [228, 1], [280, 0.8], [150, 0.8], [205, 0.35], [320, 0.6], [35, 0.4],
			[215, 0.8], [175, 0.9], [240, 0.9], [185, 1], [200, 0.6], [265, 0.7], [140, 0.6], [220, 0.25], [330, 0.5], [45, 0.35],
			[205, 0.9], [165, 0.7], [255, 0.8], [195, 0.5], [232, 0.6], [290, 0.6], [155, 1], [210, 0.15], [310, 0.5], [25, 0.3],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, ICE, s), b: [hsl(h, 0.55 * s, 0.24)], atmo: hsl(h, 0.8, 0.85), accent: hsl(h + 20, 0.9, 0.75) })),
		atmospheres: ["none", "thin", "aurora", "rim", "airglow"],
		features: ["crater", "geysers", "canyons", ...ORBITAL],
		cloudChance: 0.3,
		ringChance: 0.35,
	},
	rocky: {
		label: "Rocky world",
		patterns: ["cratered", "maria", "fractured", "pitted", "basalt plains", "rayed"],
		details: ["plain", "streaks", "speckled", "rifts", "pocked", "mottled"],
		// [hue, saturation]
		palettes: ([
			[0, 0], [25, 0.25], [220, 0.12], [35, 0.35], [10, 0.3], [200, 0.18], [270, 0.14], [50, 0.22], [150, 0.12], [15, 0.08],
			[20, 0.15], [30, 0.3], [210, 0.2], [40, 0.25], [0, 0.2], [190, 0.1], [260, 0.1], [55, 0.3], [140, 0.18], [10, 0.12],
			[5, 0.15], [28, 0.4], [225, 0.25], [38, 0.15], [12, 0.45], [205, 0.3], [280, 0.2], [48, 0.4], [160, 0.25], [0, 0.05],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, ROCK, s), atmo: hsl(h, 0.2, 0.75), accent: hsl(25, 1, 0.6) })),
		atmospheres: ["none", "rim", "airglow"],
		features: ["volcanoes", "iceCaps", "crater", "canyons", "craterChain", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.15,
	},
	crystal: {
		label: "Crystal world",
		patterns: ["facets", "shards", "geodes", "prism", "crystal fields", "spires", "geode basins", "opal"],
		details: ["plain", "speckled", "rifts", "spots", "veined", "mottled"],
		palettes: ([
			[270, 1], [150, 1], [345, 1], [200, 1], [48, 1], [180, 1], [300, 1], [22, 1], [228, 1], [210, 0.12],
			[260, 1], [160, 1], [355, 1], [190, 1], [40, 1], [170, 0.9], [310, 1], [30, 0.9], [240, 1], [0, 0.1],
			[265, 0.8], [140, 0.9], [340, 0.8], [205, 0.9], [55, 0.9], [185, 0.8], [295, 0.8], [15, 1], [235, 0.8], [120, 0.7],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, CRYSTAL, s), atmo: hsl(h, 0.8 * s, 0.75), accent: hsl(h, s, 0.85) })),
		atmospheres: ["none", "aurora", "rim", "airglow"],
		features: ["crater", "glowVeins", "geysers", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.4,
	},
	machine: {
		label: "Machine world",
		patterns: ["sprawl", "foundry", "garden city", "canals", "metropolis", "ruins"],
		details: ["plain", "streaks", "speckled", "rifts", "mottled", "pocked"],
		// [metal hue, glow hue]
		palettes: ([
			[220, 190], [30, 28], [0, 0], [200, 140], [260, 290], [210, 48], [180, 180], [40, 205], [0, 330], [120, 100],
			[215, 200], [25, 15], [350, 350], [195, 120], [250, 270], [205, 40], [175, 165], [45, 190], [10, 310], [110, 80],
			[225, 180], [35, 40], [5, 10], [205, 150], [265, 300], [215, 55], [185, 195], [45, 215], [355, 340], [125, 90],
		] as Pair[]).map(([m, g]) => ({ a: recipe(m, METAL), atmo: hsl(g, 0.8, 0.6), accent: hsl(g, 1, 0.6) })),
		atmospheres: ["none", "thin", "rim", "haze"],
		features: ["smog", "canyons", "craterChain", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.45,
	},
	dead: {
		label: "Dead world",
		patterns: ["fractured crust", "corruption", "ashen", "petrified", "frozen tomb", "rust plains"],
		details: ["plain", "streaks", "speckled", "rifts", "pocked", "veined"],
		// [crust hue, glow hue]: glows run from lava orange to the sickly colors of corruption.
		palettes: ([
			[20, 25], [0, 15], [30, 40], [220, 190], [260, 285], [100, 120], [340, 330], [200, 20], [40, 55], [10, 0],
			[280, 140], [160, 300], [15, 45], [230, 265], [35, 10], [120, 90], [300, 330], [190, 170], [50, 60], [0, 200],
			[25, 30], [5, 20], [45, 50], [210, 175], [270, 280], [110, 130], [330, 320], [190, 10], [55, 45], [15, 350],
		] as Pair[]).map(([r, g]) => ({ a: recipe(r, DEAD_CRUST), b: recipe(g, LAVA_GLOW), atmo: hsl(g, 0.5, 0.5), accent: hsl(g, 1, 0.55) })),
		atmospheres: ["none", "thin", "rim", "airglow"],
		features: ["volcanoes", "crater", "canyons", "ashClouds", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.2,
		weight: 0.8,
	},
	destroyed: {
		label: "Destroyed world",
		patterns: ["shattered", "molten remnant", "ancient scar", "split", "glassed", "cratered ruin"],
		details: ["plain", "streaks", "speckled", "rifts", "pocked", "mottled"],
		// [rock hue, glow hue]
		palettes: ([
			[25, 20], [0, 10], [35, 45], [210, 30], [250, 15], [15, 40], [190, 25], [45, 50], [5, 0], [220, 200],
			[30, 15], [10, 35], [40, 30], [200, 45], [260, 300], [20, 55], [180, 190], [50, 40], [0, 20], [230, 25],
			[28, 25], [8, 15], [38, 50], [205, 35], [245, 20], [18, 45], [195, 30], [48, 55], [2, 5], [225, 205],
		] as Pair[]).map(([r, g]) => ({ a: recipe(r, RUBBLE), b: recipe(g, LAVA_GLOW), atmo: hsl(g, 0.9, 0.6), accent: hsl(g + 10, 1, 0.6) })),
		atmospheres: ["none", "rim", "haze"],
		features: ["craterChain", "ashClouds", ...ORBITAL],
		cloudChance: 0,
		ringChance: 0.25,
		weight: 0.45,
	},
	snow: {
		label: "Snow world",
		patterns: ["powder", "blizzard", "sastrugi", "buried forests", "glacial valleys", "frost peaks"],
		details: ["plain", "streaks", "speckled", "spots", "ripples", "mottled"],
		// [shadow hue, saturation]: snow in the light, tinted shadows.
		palettes: ([
			[210, 1], [225, 0.8], [195, 0.9], [260, 0.7], [180, 0.7], [240, 0.5], [30, 0.5], [330, 0.45], [200, 0.4], [50, 0.4],
			[215, 0.6], [170, 0.6], [280, 0.5], [190, 0.3], [20, 0.35], [300, 0.4], [150, 0.45], [235, 1], [205, 0.7], [0, 0.25],
			[212, 0.9], [228, 0.6], [190, 0.6], [265, 0.5], [185, 0.5], [245, 0.3], [35, 0.4], [320, 0.35], [160, 0.35], [55, 0.3],
		] as Pair[]).map(([h, s]) => ({ a: recipe(h, SNOWFIELD, s), b: [hsl(h, 0.35 * s, 0.42), hsl(140, 0.25, 0.22)], atmo: hsl(h, 0.7, 0.86), accent: CITY })),
		atmospheres: ["thick", "storm", "aurora", "haze"],
		features: ["cityLights", "geysers", "canyons", "hurricane", ...ORBITAL],
		cloudChance: 0.9,
		ringChance: 0.15,
	},
	real: {
		label: "Real planet",
		// Our own solar system's planets, kept true to life (palette i belongs to pattern i).
		patterns: ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto", "J1407b"],
		details: ["plain"],
		palettes: [
			{ a: ["#2a2622", "#5a524a", "#8a8076", "#b8aea2"], atmo: "#b8aea2", accent: CITY },
			{ a: ["#8a6a3a", "#c9a466", "#e8cf95", "#f6e8c4"], atmo: "#f2d9a0", accent: CITY },
			{ a: ["#061736", "#0c356a", "#1d63a0"], b: ["#d9cfa8", "#4a7a2c", "#2c5a20", "#86704c"], atmo: "#8ec8ff", accent: CITY },
			{ a: ["#3a1408", "#7a2e14", "#b4552a", "#d9885a"], atmo: "#e0a080", accent: CITY },
			{ a: ["#5a3a22", "#a8724a", "#e8d2b0", "#c48a5a", "#f2e8d8"], atmo: "#e8d2b0", accent: "#b8442a" },
			{ a: ["#7a6440", "#c0a070", "#e8d4a0", "#a88a5a", "#f0e4c4"], atmo: "#f0e0b0", accent: "#d8c090" },
			{ a: ["#5aa8b8", "#8ad0da", "#b0e4ea", "#d0f2f4"], atmo: "#bff0f4", accent: "#d0f2f4" },
			{ a: ["#0a1e6a", "#1a3aa8", "#3a66d8", "#7aa0f0"], atmo: "#6a9af0", accent: "#0a1440" },
			{ a: ["#3a2418", "#8a5a3a", "#c8a080", "#f0e0cc"], atmo: "#d8c8b8", accent: CITY },
			{ a: ["#3a2216", "#7a4a2c", "#b8865a", "#8a5a38", "#d8b48a"], atmo: "#d8b48a", accent: CITY },
		],
		atmospheres: ["none"],
		features: [],
		cloudChance: 0,
		ringChance: 0,
		weight: 0.12,
	},
	inspired: {
		label: "Fiction-inspired world",
		// Worlds in the spirit of famous science fiction, under our own names. Fixed looks, like real planets.
		patterns: ["tidal ocean", "dune sea", "frozen waste", "forest moon", "fire world", "storm ocean", "cloud giant"],
		details: ["plain"],
		palettes: [
			{ a: ["#0c3a44", "#1f6a72", "#5aa6a8", "#cfe8e4"], b: ["#d8cfae", "#a89a76"], atmo: "#bfe8e8", accent: CITY },
			{ a: ["#5a3a1c", "#a8743c", "#d8a866", "#f2d6a0"], b: ["#3a2a20", "#5a4232"], atmo: "#f0c890", accent: CITY },
			{ a: ["#3a4a5a", "#8aa0b4", "#d0dcea", "#f4f8fc"], b: ["#2e2c2c", "#58524e"], atmo: "#d8e8f8", accent: CITY },
			{ a: ["#0a2a1c", "#1a4a2a", "#2f6a3a", "#4a8a4a"], b: ["#0a2030", "#1a3a4a"], atmo: "#a8e0c0", accent: "#60f0ff" },
			{ a: ["#0a0808", "#1a1414", "#2a2220", "#403430"], b: ["#ff4a10", "#ff8a20", "#ffd060"], atmo: "#ff7a40", accent: "#ff8a30" },
			{ a: ["#04101c", "#0a2238", "#14385a", "#2a5578"], atmo: "#8aa8c8", accent: CITY },
			{ a: ["#a86a5a", "#e0a088", "#f6d0b8", "#c88a7a", "#fae6d8"], atmo: "#ffd8c0", accent: CITY },
		],
		atmospheres: ["none"],
		features: [],
		cloudChance: 0,
		ringChance: 0,
		weight: 0.15,
	},
};

export const ALL_TYPES = Object.keys(PLANET_TYPES) as PlanetType[];

/**
 * The fixed traits of each real planet: everything but the seed is set, so a
 * "Saturn" always looks like Saturn. Applied by generatePlanet.
 */
export const REAL_PLANETS: Record<string, Partial<PlanetSpec>> = {
	Mercury: { atmosphere: "none", clouds: "none", rings: "none", axialTilt: 0.01 },
	Venus: { atmosphere: "thick", clouds: "none", rings: "none", axialTilt: 0.05 },
	Earth: { atmosphere: "thin", clouds: "wispy", storm: "calm", rings: "none", features: ["cityLights", "iceCaps"], axialTilt: 0.41 },
	Mars: { atmosphere: "thin", clouds: "none", rings: "none", features: ["iceCaps", "canyons"], axialTilt: 0.44 },
	Jupiter: { atmosphere: "thin", clouds: "none", rings: "none", axialTilt: 0.05 },
	Saturn: { atmosphere: "thin", clouds: "none", rings: "wide", ringColor: 0, ringTilt: 0, ringAngle: "tilted", features: ["polarHex"], axialTilt: 0.47 },
	Uranus: { atmosphere: "thin", clouds: "none", rings: "thin", ringColor: 3, ringTilt: 0, ringAngle: "tilted", axialTilt: 1.5 },
	Neptune: { atmosphere: "thin", clouds: "none", rings: "none", axialTilt: 0.49 },
	Pluto: { atmosphere: "none", clouds: "none", rings: "none", axialTilt: 0.2 },
	// A young giant around the star J1407, with a ring system some 200 times wider than Saturn's.
	J1407b: { atmosphere: "thin", clouds: "none", rings: "colossal", ringColor: 0, ringTilt: 0, ringAngle: "tilted", axialTilt: 0.3 },
};

/** Fixed traits of the fiction-inspired worlds (no cosmetics, like real planets). */
export const INSPIRED_PLANETS: Record<string, Partial<PlanetSpec>> = {
	"tidal ocean": { atmosphere: "thin", clouds: "wispy", storm: "calm", rings: "none", axialTilt: 0.1 },
	"dune sea": { atmosphere: "thin", clouds: "none", rings: "none", axialTilt: 0.2 },
	"frozen waste": { atmosphere: "thin", clouds: "wispy", storm: "heavy", rings: "none", axialTilt: 0.15 },
	"forest moon": { atmosphere: "thick", clouds: "patchy", storm: "calm", rings: "none", features: ["bioluminescence"], axialTilt: 0.2 },
	"fire world": { atmosphere: "thin", clouds: "none", rings: "none", features: ["ashClouds"], axialTilt: 0.1 },
	"storm ocean": { atmosphere: "storm", clouds: "storms", storm: "extreme", rings: "none", axialTilt: 0.2 },
	"cloud giant": { atmosphere: "thick", clouds: "none", rings: "none", axialTilt: 0.1 },
};

/** Types whose planets are fixed, recognisable looks rather than rolled traits. */
export function fixedLooks(type: PlanetType): Record<string, Partial<PlanetSpec>> | null {
	return type === "real" ? REAL_PLANETS : type === "inspired" ? INSPIRED_PLANETS : null;
}

export interface PlanetSpec {
	seed: number;
	type: PlanetType;
	pattern: string;
	detail: Detail;
	palette: number;
	atmosphere: Atmosphere;
	clouds: CloudStyle;
	rings: Rings;
	/** Index into RING_COLORS. */
	ringColor: number;
	ringTilt: number;
	/** One entry per moon, sorted so the same set always reads the same. */
	moons: MoonType[];
	/** The size of each moon, matching `moons` one for one. */
	moonSizes: MoonSize[];
	ringAngle: RingAngle;
	tilt: TiltClass;
	/** Up to MAX_FEATURES distinct features. */
	features: Feature[];
	axialTilt: number;
	/** Weather strength; "moderate" on planets without weather. */
	storm: StormLevel;
	/** Small, standard or large for its type (fixed looks are always standard). */
	size: SizeClass;
}

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export function hasFeature(spec: PlanetSpec, feature: Feature): boolean {
	return spec.features.includes(feature);
}

/** Planets whose look depends on their storm strength: anything with clouds, storms or a stormy sky. */
export function hasWeather(spec: Pick<PlanetSpec, "type" | "clouds" | "atmosphere" | "features">): boolean {
	return (
		spec.type === "gas" || spec.type === "toxic" || spec.clouds !== "none" || spec.atmosphere === "storm" ||
		spec.features.some((f) => f === "hurricane" || f === "stormEye" || f === "stormChain" || f === "polarHex" || f === "dustStorm")
	);
}

function choose(n: number, k: number): number {
	let r = 1;
	for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
	return r;
}

/** Number of distinct sets of up to `max` items drawn (with repeats) from `n` kinds. */
function multisets(n: number, max: number): number {
	let total = 0;
	for (let k = 0; k <= max; k++) total += choose(n + k - 1, k);
	return total;
}

/** Counts every distinct planet the generator can make (ring tilt and axial tilt aside). */
export function countPlanetCombinations(): number {
	let total = 0;
	for (const type of ALL_TYPES) {
		const d = PLANET_TYPES[type];
		// Real and fiction-inspired planets are fixed looks: each one counts once.
		if (type === "real" || type === "inspired") {
			total += d.patterns.length;
			continue;
		}
		const bodies = d.patterns.length * d.details.length * d.palettes.length;
		// Storm strength only counts where it shows: always on gas and toxic worlds, otherwise with clouds.
		const always = type === "gas" || type === "toxic";
		const clouds = (d.cloudChance > 0 ? 1 + CLOUD_STYLES.length * (always ? 1 : STORM_LEVELS.length) : 1) * (always ? STORM_LEVELS.length : 1);
		const rings = 1 + RING_STYLES.length * RING_COLORS.length * RING_ANGLES.length;
		// Each moon is one of the moon types in one of three sizes.
		const moons = multisets(MOON_TYPES.length * MOON_SIZES.length, MAX_MOONS);
		let features = 0;
		for (let k = 0; k <= MAX_FEATURES; k++) features += choose(d.features.length, k);
		total += bodies * d.atmospheres.length * clouds * rings * moons * features * SIZE_CLASSES.length * TILT_CLASSES.length;
	}
	return total;
}
