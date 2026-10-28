import { ItemView, Notice, TFile, WorkspaceLeaf, getAllTags } from "obsidian";
import type SolarSystemPlugin from "./main";
import { STRUCTURAL_SETTINGS, SolarSystemSettings } from "./settings";
import { Body, NoteInput, Position, SQUASH, Universe, bodyPosition, buildUniverse } from "./universe";
import { ImageCache, sizeBucket } from "./sprites";
import { Overlay, SearchResult } from "./overlay";
import { randomVault } from "./dev";
import { WorkerPool } from "./workers";
import { orbitAnomaly, orbitEllipse } from "./planets/orbit";
import { EMITTER_STRIDE, NEBULA_STYLES, NebulaJob, NebulaStyle, computeNebulaPixels } from "./nebula";
import { Starfield, bloomSprite, spikeSprite } from "./space";
import { hashString, makeRng } from "./planets/noise";
import type { RGB } from "./planets/color";
import { SphereLayers, computeSphereLayers } from "./planets/pixels";
import {
	MoonPlacement,
	PlanetSpec,
	SphereImages,
	bodyLumps,
	drawAtmosphereGlow,
	ringReach,
	drawMoons,
	drawRingHalf,
	hasRingLayer,
	layersToImages,
	moonPlacements,
	paintPlaceholder,
	paintSphere,
	setSphereSource,
	describePlanet,
	formatOdds,
	planetRarity,
	rarityTier,
	surfaceKey,
	textureSize,
} from "./planets/planet";
import { CORONA_REACH, SunSpec, describeSun, drawBlackHole, drawStar, drawStarAura, sunRarity, sunTint } from "./planets/star";

export const VIEW_TYPE_SOLAR = "planetarium-view";

const MIN_ZOOM = 0.002;
const MAX_ZOOM = 14;
const MAX_BODY_LABELS = 140;
/** How long image-making may take per frame, in milliseconds. */
const FRAME_BUDGET = 9;
/** Opening animation timing, in seconds. */
const SUN_POP = 0.55;
const PLANET_POP = 0.4;
const CAMERA_PULLBACK = 2.6;
/** History mode plays the whole timeline in this many seconds. */
const HISTORY_SECONDS = 12;
/** Followed planets are framed so they appear about this many pixels in radius. */
const FOLLOW_RADIUS = 26;

interface DragState {
	startX: number;
	startY: number;
	camX: number;
	camY: number;
	moved: boolean;
}

interface Pinch {
	dist: number;
	worldX: number;
	worldY: number;
	zoom: number;
}

interface Flight {
	fromX: number;
	fromY: number;
	fromZoom: number;
	toX: number;
	toY: number;
	toZoom: number;
	t: number;
}

interface Intro {
	/** Clock time the animation started, or null while suns are still being prepared. */
	start: number | null;
	prepStart: number;
	cam: { x: number; y: number; zoom: number };
	total: number;
}

interface History {
	cutoff: number;
	min: number;
	max: number;
	playing: boolean;
}

/** A glowing lane between two systems whose notes link to each other. */
interface Lane {
	a: number;
	b: number;
	weight: number;
	/** How far the lane curves to one side, as a share of its length. */
	bend: number;
	phase: number;
	speed: number;
	pulses: number;
}

/** A label waiting to be placed; the most important ones claim their space first. */
interface LabelItem {
	text: string;
	sub: string | null;
	x: number;
	y: number;
	size: number;
	bold: boolean;
	color: string;
	alpha: number;
	priority: number;
}

interface Nebula {
	img: HTMLCanvasElement;
	/** World rectangle the image covers. */
	x: number;
	y: number;
	w: number;
	h: number;
	born: number;
}

export class SolarSystemView extends ItemView {
	private plugin: SolarSystemPlugin;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private overlay: Overlay | null = null;
	private universe: Universe | null = null;
	private pathIndex = new Map<string, number>();
	/** Each planet's orbit as an ellipse (center, two half-axes) in world units relative to its sun. */
	private ellipses: Array<Float64Array | null> = [];
	private trailPoints = new Float32Array(0);
	/** Where each body's decorative moons sit (worked out once per body). */
	private moonCache = new Map<number, MoonPlacement[]>();
	private cam = { x: 0, y: 0, zoom: 1 };
	private width = 0;
	private height = 0;
	private dpr = 1;
	/** Screen position and radius of each body in the last frame (radius < 0 = not drawn). */
	private screen = { x: new Float32Array(0), y: new Float32Array(0), r: new Float32Array(0) };
	private pos: Position = { x: 0, y: 0, depth: 0 };
	private hovered = -1;
	private hoveredSun = -1;
	/** A body the camera keeps centered as it moves. */
	private follow = -1;
	private currentPath: string | null = null;
	private current = -1;
	private dim = new Uint8Array(0);
	private filterOn = false;
	private history: History | null = null;
	private drag: DragState | null = null;
	private pointers = new Map<number, { x: number; y: number }>();
	private pinch: Pinch | null = null;
	private flight: Flight | null = null;
	private paused = false;
	private time = 0;
	private lastTime = 0;
	private frame = 0;
	private starfield: Starfield | null = null;
	/** Nebula, star layers, lane lines and vignette, redrawn only when the camera or settings change. */
	private backdrop: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; key: string } | null = null;
	private nebula: Nebula | null = null;
	private lanes: Lane[] = [];
	/** Each system's main color, and its size from 0 (fewest notes) to 1 (most). */
	private tints: RGB[] = [];
	private sysSize = new Float32Array(0);
	private labelQueue: LabelItem[] = [];
	private textWidths = new Map<string, number>();
	/** Zoom of the whole-universe view; the backdrop measures zoom against it. */
	private homeZoom = 1;
	/** 2 is everything; lower levels drop the costliest extras when frames run slow. */
	private quality = 2;
	private qualityLock: number | null = null;
	private frameEma = 16;
	private qualityClock = 0;
	private fps = { frames: 0, since: 0, shown: 0 };
	private textures = new ImageCache<SphereImages>(900);
	private ringSprites = new ImageCache<{ back: Sprite | null; front: Sprite | null; size: number }>(300);
	private glowSprites = new Map<number, HTMLCanvasElement>();
	private suns = new ImageCache<HTMLCanvasElement>(60, 60);
	private pool: WorkerPool | null = null;
	private previews = new Map<string, string>();
	private cardTimer: number | null = null;
	private cardFor = -1;
	/** The sun whose card is showing, or -1. */
	private sunCard = -1;
	private sunCardTimer: number | null = null;
	/** When each body or sun was born live (seconds, performance clock); 0 if it was already there. */
	private bornAt = new Float64Array(0);
	private sunBornAt = new Float64Array(0);
	/** What the last build was made from, so a rebuild can tell which notes are new. */
	private builtFrom: "vault" | "random" | null = null;
	private lastFrameAt = 0;
	/** The style "Surprise me" picked for this time the view is open. */
	private surpriseNebula: NebulaStyle = this.pickNebula();
	private rebuildTimer: number | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private needsFit = true;
	private intro: Intro | null = null;
	private wantIntro = true;
	private sunDelay = new Float32Array(0);
	private bodyDelay = new Float32Array(0);
	private introTotal = 0;
	private sunCursor = -1;
	/** "random" shows a made-up universe from the developer tools. */
	private mode: "vault" | "random" = "vault";
	private randomSeed = 0;
	private diceAction: HTMLElement | null = null;
	private locateAction: HTMLElement | null = null;
	/** Running as the web demo, outside Obsidian: random universes only, no real notes. */
	demo = false;
	private backAction: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SolarSystemPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SOLAR;
	}

	getDisplayText(): string {
		return "Planetarium";
	}

	getIcon(): string {
		return "sun";
	}

	private get settings(): SolarSystemSettings {
		return this.plugin.settings;
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("solar-graph-container");
		container.tabIndex = 0;
		const canvas = container.createEl("canvas", { cls: "solar-graph-canvas" });
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			container.setText("Your device does not support canvas drawing.");
			return;
		}
		this.canvas = canvas;
		this.ctx = ctx;
		this.starfield = new Starfield(ctx);
		this.overlay = new Overlay(container, {
			search: (q) => this.search(q),
			pick: (id) => this.focusBody(id),
			filter: (q) => this.applyFilter(q),
			togglePlay: () => this.togglePlay(),
			scrub: (f) => this.scrub(f),
			closeHistory: () => this.setHistory(false),
		});

		// Surface images are painted by background workers when possible, and
		// lit at draw time, so lighting follows the sun without ever snapping.
		this.pool = new WorkerPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)));
		setSphereSource((spec, size, lumps) => this.sphereImages(spec, size, lumps));

		this.addAction("maximize", "Show the whole universe (H)", () => this.flyTo(this.fitAll()));
		this.addAction("pause", "Pause or resume orbits (Space)", () => (this.paused = !this.paused));
		this.locateAction = this.addAction("crosshair", "Fly to the open note (L)", () => this.locateCurrent());
		this.addAction("history", "History: watch notes appear in the order you made them", () => this.setHistory(!this.history));
		this.addAction("help-circle", "Legend: what everything means (?)", () => this.overlay?.toggleLegend());
		this.backAction = this.addAction("home", "Back to my vault", () => this.leaveRandom());
		this.diceAction = this.addAction("dice-5", this.demo ? "Roll a new random universe" : "Developer: build a random universe", () => this.rollRandom());
		this.updateActions();

		this.registerDomEvent(canvas, "pointerdown", (e) => this.onPointerDown(e));
		this.registerDomEvent(canvas, "pointermove", (e) => this.onPointerMove(e));
		this.registerDomEvent(canvas, "pointerup", (e) => this.onPointerUp(e));
		this.registerDomEvent(canvas, "pointercancel", (e) => this.onPointerUp(e, true));
		this.registerDomEvent(canvas, "pointerleave", () => {
			if (!this.drag) this.setHover(-1, -1);
		});
		this.registerDomEvent(canvas, "wheel", (e) => this.onWheel(e), { passive: false });
		this.registerDomEvent(canvas, "dblclick", (e) => this.onDoubleClick(e));
		this.registerDomEvent(container, "keydown", (e) => this.onKey(e));
		// "resolved" fires once links are indexed and again after notes change.
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) this.currentPath = file.path;
				this.current = this.currentPath ? this.pathIndex.get(this.currentPath) ?? -1 : -1;
			})
		);
		this.currentPath = this.app.workspace.getActiveFile()?.path ?? null;

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.rebuild();
		this.lastTime = performance.now();
		this.frame = window.requestAnimationFrame(this.tick);
	}

	async onClose() {
		window.cancelAnimationFrame(this.frame);
		this.resizeObserver?.disconnect();
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
		setSphereSource(null);
		this.pool?.terminate();
		this.pool = null;
		this.textures.clear();
		this.ringSprites.clear();
		this.suns.clear();
	}

	/** A body's surface images at `size` pixels, or the nearest size made so far (null if none yet). */
	private sphereImages(spec: PlanetSpec, size: number, lumps: number): SphereImages | null {
		const base = surfaceKey(spec, lumps);
		const key = `${base}|${size}`;
		const pool = this.pool;
		if (pool?.available) {
			return this.textures.request(key, base, (resolve, cancel) =>
				pool.submit<SphereLayers>({ kind: "sphere", spec, size, lumps }, (layers) => resolve(layersToImages(layers)), cancel)
			);
		}
		return this.textures.get(key, base, () => layersToImages(computeSphereLayers(spec, size, lumps)));
	}

	/** Called by the plugin whenever a setting changes. */
	settingsChanged(key?: keyof SolarSystemSettings) {
		if (key && STRUCTURAL_SETTINGS.includes(key)) this.rebuild();
		if (key === "nebulaStyle" && this.universe) {
			// Picking "Surprise me" again rolls a new one.
			if (this.settings.nebulaStyle === "random") this.surpriseNebula = this.pickNebula();
			this.planBackdrop(this.universe);
		}
		if (key === "devMode") {
			if (!this.settings.devMode && this.mode === "random" && !this.demo) this.leaveRandom();
			this.updateActions();
		}
	}

	private updateActions() {
		this.diceAction?.toggleClass("solar-hidden", !(this.settings.devMode || this.demo));
		this.backAction?.toggleClass("solar-hidden", !(this.mode === "random" && !this.demo));
		this.locateAction?.toggleClass("solar-hidden", this.demo);
	}

	// -------------------------------------------------------------------
	// Building the universe

	private vaultNotes(): { notes: NoteInput[]; links: Record<string, Record<string, number>> } {
		const notes = this.app.vault.getMarkdownFiles().map((file) => {
			const slash = file.path.indexOf("/");
			const cache = this.app.metadataCache.getFileCache(file);
			return {
				path: file.path,
				name: file.basename,
				folder: slash >= 0 ? file.path.slice(0, slash) : "",
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				tags: cache ? [...new Set(getAllTags(cache) ?? [])] : [],
			};
		});
		return { notes, links: this.app.metadataCache.resolvedLinks };
	}

	rebuild() {
		const data = this.mode === "random" ? randomVault(this.randomSeed) : this.vaultNotes();
		const universe = buildUniverse(data.notes, data.links, {
			rogues: this.settings.rogues,
			moons: this.settings.childMoons,
			salt: this.mode === "random" ? `roll${this.randomSeed}:` : "",
		});
		// Live births: when the vault changes, notes and folders that were not there before pop in.
		const old = this.universe;
		const live = !!old && this.builtFrom === "vault" && this.mode === "vault" && !this.wantIntro;
		const oldPaths = live && old ? new Set(old.bodies.map((b) => b.path)) : null;
		const oldSuns = live && old ? new Set(old.systems.map((s) => s.name)) : null;
		const followPath = this.follow >= 0 ? old?.bodies[this.follow]?.path ?? null : null;
		const nowSec = performance.now() / 1000;
		this.bornAt = Float64Array.from(universe.bodies, (b) => (oldPaths && !oldPaths.has(b.path) ? nowSec : 0));
		this.sunBornAt = Float64Array.from(universe.systems, (s) => (oldSuns && !oldSuns.has(s.name) ? nowSec : 0));
		this.builtFrom = this.mode;
		this.universe = universe;
		this.pathIndex = new Map(universe.bodies.map((b, i) => [b.path, i]));
		this.ellipses = universe.bodies.map((b) => {
			if (!b.orbit) return null;
			const e = orbitEllipse(b.orbit, SQUASH);
			return Float64Array.of(e.cx, e.cy, e.ux, e.uy, e.vx, e.vy, e.rx, e.ry, e.rotation, e.t0, e.sign);
		});
		this.moonCache.clear();
		this.planBackdrop(universe);
		const n = universe.bodies.length;
		this.screen = { x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n).fill(-1) };
		this.dim = new Uint8Array(n);
		this.filterOn = false;
		this.hovered = -1;
		this.hoveredSun = -1;
		// Keep following the same note across a live update.
		this.follow = followPath ? this.pathIndex.get(followPath) ?? -1 : -1;
		this.cardFor = -1;
		this.sunCard = -1;
		this.overlay?.hideCard();
		this.current = this.currentPath ? this.pathIndex.get(this.currentPath) ?? -1 : -1;
		if (this.history) this.setHistory(true);
		this.planIntro(universe);
		if (this.needsFit && this.width > 0) {
			Object.assign(this.cam, this.fitAll());
			this.needsFit = false;
		}
		this.overlay?.setBanner(
			this.demo
				? `Universe #${this.randomSeed} · ${universe.systems.length} systems · ${n} planets and moons · 🎲 rolls a new one`
				: this.mode === "random"
				? `Random universe #${this.randomSeed} · ${universe.systems.length} systems · ${n} bodies · dice re-rolls, home goes back`
				: null
		);
	}

	private scheduleRebuild() {
		if (this.mode === "random") return;
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			this.rebuild();
		}, 500);
	}

	/** Developer tool: replace the view with a freshly rolled random universe. */
	rollRandom(seed = Math.floor(Math.random() * 1e6)) {
		this.mode = "random";
		this.randomSeed = seed;
		this.resetForNewUniverse();
	}

	private leaveRandom() {
		this.mode = "vault";
		this.resetForNewUniverse();
	}

	private resetForNewUniverse() {
		this.needsFit = true;
		this.wantIntro = true;
		this.intro = null;
		this.flight = null;
		this.setHistory(false);
		this.textures.clear();
		this.ringSprites.clear();
		this.suns.clear();
		this.rebuild();
		this.updateActions();
	}

	// -------------------------------------------------------------------
	// Opening animation

	/** Suns pop in rippling out from the middle; each system's planets follow, inner orbits first. */
	private planIntro(u: Universe) {
		const n = u.systems.length;
		this.sunDelay = new Float32Array(n);
		this.bodyDelay = new Float32Array(u.bodies.length);
		let total = CAMERA_PULLBACK;
		if (n > 0) {
			const cx = u.systems.reduce((s, sys) => s + sys.x, 0) / n;
			const cy = u.systems.reduce((s, sys) => s + sys.y, 0) / n;
			const order = u.systems.map((_, i) => i).sort((a, b) => {
				const A = u.systems[a], B = u.systems[b];
				return Math.hypot(A.x - cx, A.y - cy) - Math.hypot(B.x - cx, B.y - cy);
			});
			const stagger = Math.min(0.09, 1.3 / n);
			order.forEach((si, rank) => {
				const sys = u.systems[si];
				this.sunDelay[si] = 0.35 + rank * stagger;
				const spread = Math.min(1, 0.04 * sys.bodies.length);
				sys.bodies.forEach((bi, k) => {
					const d = this.sunDelay[si] + 0.3 + (k / Math.max(1, sys.bodies.length - 1)) * spread;
					this.bodyDelay[bi] = d;
					u.bodies[bi].moons.forEach((mi, j) => (this.bodyDelay[mi] = d + 0.12 + j * 0.05));
					total = Math.max(total, d + PLANET_POP + 0.3);
				});
				total = Math.max(total, this.sunDelay[si] + SUN_POP + 0.6);
			});
		}
		// Rogue planets wink in at scattered moments during the show.
		for (const ri of u.rogues) {
			this.bodyDelay[ri] = 0.6 + (u.bodies[ri].phase / 6.283) * Math.max(1, total - 1.2);
		}
		this.introTotal = total;
	}

	private startIntro(now: number) {
		this.wantIntro = false;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		if (!this.settings.playIntro || reduced || !this.universe) return;
		const cam = this.fitAll();
		this.intro = { start: null, prepStart: now, cam, total: this.introTotal };
		this.cam.x = cam.x;
		this.cam.y = cam.y;
		this.cam.zoom = cam.zoom * 1.6;
		// Make every sun's image before the show starts, so nothing pops in blank.
		this.universe.systems.forEach((sys, si) => this.sunImage(si, sys.sunRadius * this.settings.sunScale * this.cam.zoom));
	}

	private endIntro() {
		this.intro = null;
	}

	/** Seconds into the opening animation (Infinity once it is over or skipped). */
	private introTime(seconds: number): number {
		if (!this.intro) return Infinity;
		return this.intro.start === null ? -1 : seconds - this.intro.start;
	}

	// -------------------------------------------------------------------
	// Camera

	private fitAll() {
		const u = this.universe;
		if (!u || u.bodies.length === 0 || this.width === 0) return { x: 0, y: 0, zoom: 1 };
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const ss = this.settings.sunScale;
		for (const s of u.systems) {
			minX = Math.min(minX, s.x - s.extent);
			maxX = Math.max(maxX, s.x + s.extent);
			minY = Math.min(minY, s.y - s.extent * SQUASH - s.sunRadius * ss * 2);
			maxY = Math.max(maxY, s.y + s.extent * SQUASH + s.sunRadius * ss * 2);
		}
		for (const ri of u.rogues) {
			const b = u.bodies[ri];
			minX = Math.min(minX, b.hx - 60);
			maxX = Math.max(maxX, b.hx + 60);
			minY = Math.min(minY, b.hy - 40);
			maxY = Math.max(maxY, b.hy + 40);
		}
		const zoom = Math.min(this.width / (maxX - minX), this.height / (maxY - minY)) * 0.9;
		return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
	}

	private fitSystem(index: number) {
		const s = this.universe?.systems[index];
		if (!s) return { ...this.cam };
		const zoom = Math.min(this.width / (s.extent * 2.2), this.height / (s.extent * SQUASH * 2.2 + s.sunRadius * this.settings.sunScale * 3));
		return { x: s.x, y: s.y, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
	}

	/** Flies the camera to a target; with `follow`, keeps chasing that body as it moves. */
	private flyTo(target: { x: number; y: number; zoom: number }, follow = -1) {
		this.follow = follow;
		this.flight = { fromX: this.cam.x, fromY: this.cam.y, fromZoom: this.cam.zoom, toX: target.x, toY: target.y, toZoom: target.zoom, t: 0 };
	}

	/** Flies to a body and keeps it centered as it moves. */
	focusBody(bi: number) {
		const u = this.universe;
		if (!u || !u.bodies[bi]) return;
		this.endIntro();
		const b = u.bodies[bi];
		bodyPosition(u, bi, this.time, this.pos);
		const zoom = clamp(FOLLOW_RADIUS / (b.radius * this.settings.planetScale), MIN_ZOOM, MAX_ZOOM);
		this.flyTo({ x: this.pos.x, y: this.pos.y, zoom }, bi);
	}

	locateCurrent() {
		if (this.current >= 0) this.focusBody(this.current);
		else new Notice("Open a note first, then its planet can be found.");
	}

	private stopFollowing() {
		this.follow = -1;
	}

	private resize() {
		if (!this.canvas) return;
		const rect = this.contentEl.getBoundingClientRect();
		this.width = rect.width;
		this.height = rect.height;
		this.dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.round(rect.width * this.dpr);
		this.canvas.height = Math.round(rect.height * this.dpr);
		if (this.universe && this.width > 0) this.homeZoom = this.fitAll().zoom;
		if (this.needsFit && this.universe && this.width > 0) {
			Object.assign(this.cam, this.fitAll());
			this.needsFit = false;
		}
	}

	// -------------------------------------------------------------------
	// Frame loop

	private tick = (now: number) => {
		// Battery saver draws at most 30 frames a second.
		if (this.settings.performance === "battery" && now - this.lastFrameAt < 31) {
			this.frame = window.requestAnimationFrame(this.tick);
			return;
		}
		this.lastFrameAt = now;
		const dt = Math.min((now - this.lastTime) / 1000, 0.1);
		this.lastTime = now;
		this.adaptQuality(dt, now);
		const u = this.universe;

		if (this.wantIntro && u && this.width > 0) this.startIntro(now / 1000);
		const intro = this.intro;
		if (intro) {
			if (intro.start === null) {
				// Preparing: wait for sun images (at most 2.5 s), then start the clock.
				if (this.suns.pending === 0 || now / 1000 - intro.prepStart > 2.5) intro.start = now / 1000;
			} else {
				const T = now / 1000 - intro.start;
				// The camera eases back from close in to the whole universe.
				const k = 1 - Math.pow(1 - Math.min(1, T / CAMERA_PULLBACK), 3);
				this.cam.x = intro.cam.x;
				this.cam.y = intro.cam.y;
				this.cam.zoom = intro.cam.zoom * (1.6 - 0.6 * k);
				if (T > intro.total) this.intro = null;
			}
		}

		if (!this.paused && this.hovered < 0 && !this.drag) this.time += dt * this.settings.orbitSpeed * 0.25;

		// Chase a moving body during and after a flight.
		if (u && this.follow >= 0) {
			bodyPosition(u, this.follow, this.time, this.pos);
			if (this.flight) {
				this.flight.toX = this.pos.x;
				this.flight.toY = this.pos.y;
			} else {
				this.cam.x = this.pos.x;
				this.cam.y = this.pos.y;
			}
		}
		if (this.flight) {
			const f = this.flight;
			f.t = Math.min(1, f.t + dt / 1.1);
			const e = f.t < 0.5 ? 4 * f.t * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
			this.cam.x = f.fromX + (f.toX - f.fromX) * e;
			this.cam.y = f.fromY + (f.toY - f.fromY) * e;
			// Zoom eases on a log scale, so the flight feels even.
			this.cam.zoom = Math.exp(Math.log(f.fromZoom) + (Math.log(f.toZoom) - Math.log(f.fromZoom)) * e);
			if (f.t >= 1) this.flight = null;
		}

		if (this.history?.playing) {
			const h = this.history;
			h.cutoff = Math.min(h.max, h.cutoff + ((h.max - h.min) / HISTORY_SECONDS) * dt);
			if (h.cutoff >= h.max) h.playing = false;
		}

		if (this.width > 0 && this.height > 0) this.draw(now / 1000);
		this.textures.process(FRAME_BUDGET);
		this.ringSprites.process(FRAME_BUDGET / 3);
		this.suns.process(this.intro?.start === null ? 30 : FRAME_BUDGET);
		this.frame = window.requestAnimationFrame(this.tick);
	};

	private toScreenX(wx: number) {
		return this.width / 2 + (wx - this.cam.x) * this.cam.zoom;
	}

	private toScreenY(wy: number) {
		return this.height / 2 + (wy - this.cam.y) * this.cam.zoom;
	}

	private draw(seconds: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const { width: w, height: h, dpr } = this;
		const s = this.settings;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		const T = this.introTime(seconds);
		const fadeIn = clamp(T / 0.8, 0, 1);
		this.drawBackdrop(ctx, T, fadeIn);
		if (s.showBackground && this.starfield) {
			ctx.globalAlpha = fadeIn;
			const k = this.homeZoom * 4;
			this.starfield.drawLive(ctx, w, h, this.cam.x * k, this.cam.y * k, seconds, this.quality);
			ctx.globalAlpha = 1;
		}
		if (T < 0) return;

		const u = this.universe;
		if (!u || u.bodies.length === 0) {
			ctx.fillStyle = "rgba(220, 225, 255, 0.7)";
			ctx.font = "14px sans-serif";
			ctx.textAlign = "center";
			ctx.fillText("No notes yet. Your universe is waiting to be born.", w / 2, h / 2);
			return;
		}

		const z = this.cam.zoom;
		const now = Date.now();
		this.screen.r.fill(-1);
		const labels = { count: 0 };
		this.labelQueue.length = 0;
		if (s.showLanes && this.quality > 1) this.drawLanes(ctx, u, T, seconds, "pulses");

		const nowSec = performance.now() / 1000;
		u.systems.forEach((sys, si) => {
			let sunT = (T - this.sunDelay[si]) / SUN_POP;
			// A folder that appeared just now pops in like in the opening animation.
			if (this.sunBornAt[si] > 0) sunT = Math.min(sunT, (nowSec - this.sunBornAt[si]) / SUN_POP);
			if (sunT <= 0) return;
			const sunScale = easeOutBack(Math.min(1, sunT));
			const sx = this.toScreenX(sys.x), sy = this.toScreenY(sys.y);
			const ext = sys.extent * z;
			// Suns never shrink below a few pixels, so the far view still reads as a map of stars.
			const fullR = Math.max(sys.sunRadius * s.sunScale * z, sys.sun.kind === "star" ? 4.5 : 3);
			const sr = fullR * sunScale;
			const settled = clamp((T - this.sunDelay[si] - 0.25) / 0.9, 0, 1);
			const reach = Math.max(ext, sr * 6);
			if (sx + reach < 0 || sx - reach > w || sy + reach < 0 || sy - reach > h) return;
			const showBodies = ext > 14;

			if (s.showPlanes && ext > 40) this.drawPlane(ctx, sys.sun, sx, sy, ext, settled);
			// Far away, planets leave short glowing trails; closer in, full orbit lines take over.
			const trailAlpha = s.showTrails && showBodies ? smoothstep(14, 40, ext) * (1 - smoothstep(320, 800, ext)) * settled : 0;
			if (trailAlpha > 0.01) this.drawTrails(ctx, sys.bodies, si, sx, sy, ext, trailAlpha);
			const orbitAlpha = s.showOrbits ? (s.showTrails ? smoothstep(220, 600, ext) : smoothstep(90, 320, ext)) * 0.13 * s.orbitBrightness * settled : 0;
			if (showBodies && orbitAlpha > 0.004) {
				ctx.strokeStyle = `rgba(200, 210, 255, ${Math.min(0.6, orbitAlpha)})`;
				ctx.lineWidth = 1;
				ctx.beginPath();
				for (const bi of sys.bodies) {
					const e = this.ellipses[bi];
					if (!e || this.hiddenByHistory(bi)) continue;
					const ex = sx + e[0] * z, ey = sy + e[1] * z, rot = e[8];
					ctx.moveTo(ex + Math.cos(rot) * e[6] * z, ey + Math.sin(rot) * e[6] * z);
					ctx.ellipse(ex, ey, e[6] * z, e[7] * z, rot, 0, Math.PI * 2);
				}
				ctx.stroke();
			}

			// Planets behind the sun first, then the sun, then the ones in front. Moons travel with their planet.
			const front: number[] = [];
			if (showBodies) {
				for (const bi of sys.bodies) {
					for (const mi of u.bodies[bi].moons) this.place(u, mi);
					this.place(u, bi);
					if (this.pos.depth < 0) this.drawGroup(ctx, u, bi, sx, sy, T, now);
					else front.push(bi);
				}
			}
			if (sunT < 1.6) this.drawPopFlash(ctx, sx, sy, fullR, sunT);
			this.drawSun(ctx, si, sx, sy, sr, seconds, fullR);
			for (const bi of front) this.drawGroup(ctx, u, bi, sx, sy, T, now);

			if (showBodies) {
				for (const bi of sys.bodies) {
					this.drawLabel(ctx, u, bi, labels);
					for (const mi of u.bodies[bi].moons) this.drawLabel(ctx, u, mi, labels);
				}
			}
			const hot = si === this.hoveredSun;
			const count = sys.bodies.length;
			const size = this.sysSize[si];
			this.labelQueue.push({
				text: sys.name,
				sub: settled > 0.5 && (ext > 70 || size > 0.45) ? `${count} note${count === 1 ? "" : "s"}` : null,
				x: sx,
				y: sy + Math.max(fullR * 1.5, 10) + 14,
				size: 11 + Math.round(size * 4),
				bold: true,
				color: hot ? "255, 255, 255" : "232, 236, 255",
				alpha: hot ? 1 : (0.55 + 0.35 * size) * settled,
				priority: (hot ? 2e9 : 1e9) + count,
			});
		});

		// Rogue planets, lit dimly from far away.
		for (const ri of u.rogues) {
			this.place(u, ri);
			const x = this.screen.x[ri], y = this.screen.y[ri];
			this.drawBody(ctx, u.bodies[ri], ri, x - 900, y - 650, T, now);
			this.drawLabel(ctx, u, ri, labels);
		}
		if (this.intro) {
			for (let bi = 0; bi < u.bodies.length; bi++) if (this.screen.r[bi] >= 0) this.drawSparkle(ctx, (T - this.bodyDelay[bi]) / PLANET_POP, bi, this.screen.r[bi]);
		}
		// New notes: a sparkle as they pop in, and a "new" tag for a few seconds.
		for (let bi = 0; bi < this.bornAt.length; bi++) {
			const born = this.bornAt[bi];
			if (born <= 0 || this.screen.r[bi] < 0) continue;
			const age = nowSec - born;
			if (age > 6) continue;
			this.drawSparkle(ctx, age / 0.7, bi, this.screen.r[bi]);
			this.labelQueue.push({
				text: `✦ new: ${u.bodies[bi].name}`,
				sub: null,
				x: this.screen.x[bi],
				y: this.screen.y[bi] - this.screen.r[bi] - 12,
				size: 12,
				bold: true,
				color: "160, 235, 255",
				alpha: Math.min(1, (6 - age) / 1.5),
				priority: 3e9,
			});
		}

		this.placeLabels(ctx);
		this.drawMarkers(ctx, seconds);
		this.drawHover(ctx, u);
		if (this.sunCard >= 0 && u.systems[this.sunCard]) {
			const sys = u.systems[this.sunCard];
			const r = Math.max(sys.sunRadius * s.sunScale * z, 6);
			this.overlay?.moveCard(this.toScreenX(sys.x) + r, this.toScreenY(sys.y), w, h);
		} else if (this.cardFor >= 0 && this.screen.r[this.cardFor] >= 0) {
			this.overlay?.moveCard(this.screen.x[this.cardFor] + this.screen.r[this.cardFor], this.screen.y[this.cardFor], w, h);
		}
		if (this.history) {
			const hs = this.history;
			const f = hs.max > hs.min ? (hs.cutoff - hs.min) / (hs.max - hs.min) : 1;
			this.overlay?.setHistory(f, new Date(hs.cutoff).toLocaleDateString(), hs.playing);
		}
		if (s.devMode) {
			ctx.textAlign = "left";
			ctx.font = "11px monospace";
			ctx.fillStyle = "rgba(160, 255, 190, 0.85)";
			const jobs = (this.pool?.backlog ?? 0) + this.textures.pending + this.suns.pending;
			ctx.fillText(`${this.fps.shown} fps · quality ${this.quality} · ${u.bodies.length} bodies · ${jobs} images waiting`, 10, h - 10);
		}
	}

	/** Lowers the detail level when frames run slow for a while, and raises it again once there is room. */
	private adaptQuality(dt: number, now: number) {
		this.fps.frames++;
		if (now - this.fps.since >= 1000) {
			this.fps.shown = Math.round((this.fps.frames * 1000) / (now - this.fps.since));
			this.fps.frames = 0;
			this.fps.since = now;
		}
		const preset = this.settings.performance;
		const lock = this.qualityLock ?? (preset === "high" ? 2 : preset === "balanced" ? 1 : preset === "battery" ? 0 : null);
		if (lock !== null) {
			this.quality = lock;
			return;
		}
		// Getting the opening animation ready is slow on purpose; it says nothing about steady frames.
		if (this.intro?.start === null) return;
		this.frameEma += (dt * 1000 - this.frameEma) * 0.05;
		this.qualityClock += dt;
		if (this.frameEma > 26 && this.qualityClock > 2 && this.quality > 0) {
			this.quality--;
			this.qualityClock = 0;
		} else if (this.frameEma < 19 && this.qualityClock > 3 && this.quality < 2) {
			this.quality++;
			this.qualityClock = 0;
		}
	}

	// -------------------------------------------------------------------
	// The backdrop: nebula, lanes between systems, trails and labels

	private pickNebula(): NebulaStyle {
		const keys = Object.keys(NEBULA_STYLES) as NebulaStyle[];
		return keys[Math.floor(Math.random() * keys.length)];
	}

	/** Works out the lanes, tints and sizes for a new universe and starts painting its nebula. */
	private planBackdrop(u: Universe) {
		const n = u.systems.length;
		this.tints = u.systems.map((sys) => sunTint(sys.sun));
		const most = Math.max(1, ...u.systems.map((sys) => sys.bodies.length));
		this.sysSize = Float32Array.from(u.systems, (sys) => Math.sqrt(sys.bodies.length / most));

		const weight = new Map<number, number>();
		for (const [a, b] of u.links) {
			const i = u.bodies[a].system, j = u.bodies[b].system;
			if (i < 0 || j < 0 || i === j) continue;
			const key = i < j ? i * n + j : j * n + i;
			weight.set(key, (weight.get(key) ?? 0) + 1);
		}
		// Only the connections that stand out: each system keeps its few strongest,
		// measured against its size (big folders link to everything a little).
		const strength = (key: number, w: number) =>
			w / Math.sqrt(u.systems[Math.floor(key / n)].bodies.length * u.systems[key % n].bodies.length + 1);
		const ranked = [...weight.entries()].filter(([, w]) => w >= 2 || n < 12).sort((x, y) => strength(y[0], y[1]) - strength(x[0], x[1]));
		const perSystem = new Uint8Array(n);
		const keep: Array<[number, number]> = [];
		for (const [key, w] of ranked) {
			const a = Math.floor(key / n), b = key % n;
			if (perSystem[a] >= 3 && perSystem[b] >= 3) continue;
			if (perSystem[a] >= 4 || perSystem[b] >= 4) continue;
			perSystem[a]++;
			perSystem[b]++;
			keep.push([key, w]);
			if (keep.length >= Math.max(8, n * 1.6)) break;
		}
		this.lanes = keep.map(([key, w]) => {
			const a = Math.floor(key / n), b = key % n;
			const rng = makeRng(hashString(`${u.systems[a].name}~${u.systems[b].name}`));
			return { a, b, weight: w, bend: (rng() - 0.5) * 0.32, phase: rng(), speed: 0.045 + rng() * 0.05, pulses: Math.min(3, 1 + Math.floor(Math.log2(w))) };
		});

		this.nebula = null;
		if (n === 0) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const sys of u.systems) {
			const pad = sys.extent * 2.6 + 600;
			minX = Math.min(minX, sys.x - pad);
			maxX = Math.max(maxX, sys.x + pad);
			minY = Math.min(minY, sys.y - pad);
			maxY = Math.max(maxY, sys.y + pad);
		}
		const bw = maxX - minX, bh = maxY - minY;
		// Clouds are soft, so a small image scaled up looks just as good.
		const long = this.pool?.available ? 720 : 360;
		const scale = long / Math.max(bw, bh);
		const tw = Math.max(64, Math.round(bw * scale)), th = Math.max(64, Math.round(bh * scale));
		const order = u.systems.map((_, i) => i).sort((x, y) => u.systems[y].bodies.length - u.systems[x].bodies.length).slice(0, 120);
		const emitters = new Float32Array(order.length * EMITTER_STRIDE);
		order.forEach((si, k) => {
			const sys = u.systems[si], c = this.tints[si], o = k * EMITTER_STRIDE;
			emitters[o] = (sys.x - minX) * scale;
			emitters[o + 1] = (sys.y - minY) * scale;
			emitters[o + 2] = Math.max(sys.extent * 2.2, 500) * scale;
			emitters[o + 3] = c[0];
			emitters[o + 4] = c[1];
			emitters[o + 5] = c[2];
			emitters[o + 6] = (0.45 + 0.85 * this.sysSize[si]) * (sys.sun.kind === "star" ? 1 : 0.6);
		});
		const chosen = this.settings.nebulaStyle;
		const style = chosen === "random" ? this.surpriseNebula : NEBULA_STYLES[chosen] ? chosen : "classic";
		const job: NebulaJob = { seed: hashString(u.systems.map((sys) => sys.name).join("|")), width: tw, height: th, emitters, look: NEBULA_STYLES[style].look };
		const done = (pixels: Uint8ClampedArray) => {
			if (this.universe !== u) return;
			this.nebula = { img: pixelCanvas(tw, pixels, th), x: minX, y: minY, w: bw, h: bh, born: performance.now() };
		};
		const pool = this.pool;
		if (pool?.available) pool.submit<{ pixels: Uint8ClampedArray }>({ kind: "nebula", ...job }, (res) => done(res.pixels), () => {});
		else window.setTimeout(() => done(computeNebulaPixels(job)), 0);
	}

	/**
	 * Draws everything behind the systems that stays put while the camera does:
	 * from a cached image when nothing has changed, which is most frames.
	 */
	private drawBackdrop(ctx: CanvasRenderingContext2D, T: number, fadeIn: number) {
		const { width: w, height: h, dpr } = this;
		const s = this.settings;
		const nb = this.nebula;
		const nebulaFading = !!nb && performance.now() - nb.born < 1600;
		// Lanes fade in during the opening animation, so the image changes every frame until then.
		const introRunning = !!this.intro;
		const key = [
			this.cam.x, this.cam.y, this.cam.zoom, w, h, dpr, s.showNebula, s.showBackground, s.showLanes, s.sunScale, this.quality,
			nb ? nb.born : 0, nebulaFading ? performance.now() : 0, introRunning ? T : 0, fadeIn,
		].join("|");
		let bd = this.backdrop;
		const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
		if (!bd) {
			const canvas = createEl("canvas");
			bd = this.backdrop = { canvas, ctx: canvas.getContext("2d"), key: "" };
		}
		const bctx = bd.ctx;
		if (!bctx) return;
		if (bd.key !== key) {
			if (bd.canvas.width !== pw || bd.canvas.height !== ph) {
				bd.canvas.width = pw;
				bd.canvas.height = ph;
			}
			bd.key = key;
			bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			bctx.globalCompositeOperation = "source-over";
			bctx.globalAlpha = 1;
			bctx.fillStyle = "#03040a";
			bctx.fillRect(0, 0, w, h);
			if (s.showNebula) this.drawNebula(bctx, fadeIn);
			if (s.showBackground && this.starfield) {
				bctx.globalAlpha = fadeIn;
				const k = this.homeZoom * 4;
				this.starfield.drawLayers(bctx, w, h, this.cam.x * k, this.cam.y * k, this.cam.zoom / this.homeZoom);
				bctx.globalAlpha = 1;
			}
			const u = this.universe;
			if (u && s.showLanes && T >= 0) this.drawLanes(bctx, u, T, 0, "lines");
			if (s.showBackground && this.quality > 0) this.starfield?.drawVignette(bctx, w, h);
		}
		ctx.drawImage(bd.canvas, 0, 0, w, h);
	}

	private drawNebula(ctx: CanvasRenderingContext2D, fadeIn: number) {
		const nb = this.nebula;
		if (!nb) return;
		const z = this.cam.zoom;
		// Fades in once painted, and steps back a little when you are deep inside a system.
		const born = Math.min(1, (performance.now() - nb.born) / 1500);
		const zoomedIn = smoothstep(2, 14, z / this.homeZoom);
		ctx.globalAlpha = fadeIn * born * (0.8 - 0.62 * zoomedIn);
		ctx.imageSmoothingQuality = "high";
		// Added on top of the background, so the image's black edges vanish into it.
		ctx.globalCompositeOperation = "lighter";
		ctx.drawImage(nb.img, this.toScreenX(nb.x), this.toScreenY(nb.y), nb.w * z, nb.h * z);
		ctx.globalCompositeOperation = "source-over";
		ctx.imageSmoothingQuality = "low";
		ctx.globalAlpha = 1;
	}

	/** How far a sun's bloom reaches on screen. */
	private bloomRadius(si: number, fullR: number): number {
		return clamp(fullR * 6, 16, 120) * (0.7 + 0.6 * this.sysSize[si]);
	}

	/** Glowing lanes between linked systems, with pulses of light travelling along them. */
	private drawLanes(ctx: CanvasRenderingContext2D, u: Universe, T: number, seconds: number, part: "lines" | "pulses") {
		if (this.lanes.length === 0) return;
		const z = this.cam.zoom, w = this.width, h = this.height, ss = this.settings.sunScale;
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		ctx.lineCap = "round";
		for (const lane of this.lanes) {
			const A = u.systems[lane.a], B = u.systems[lane.b];
			const settled = Math.min(clamp((T - this.sunDelay[lane.a] - 0.6) / 1.2, 0, 1), clamp((T - this.sunDelay[lane.b] - 0.6) / 1.2, 0, 1));
			// Lanes are for the map view; they fade out as a system fills the screen.
			const fade = settled * (1 - smoothstep(180, 520, Math.max(A.extent, B.extent) * z)) * (1 - 0.5 * smoothstep(1.5, 5, z / this.homeZoom));
			if (fade < 0.01) continue;
			const ax = this.toScreenX(A.x), ay = this.toScreenY(A.y), bx = this.toScreenX(B.x), by = this.toScreenY(B.y);
			const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
			if (len < 6) continue;
			const cx = (ax + bx) / 2 - dy * lane.bend, cy = (ay + by) / 2 + dx * lane.bend;
			if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > w || Math.max(ay, by, cy) < 0 || Math.min(ay, by, cy) > h) continue;
			// Start and end at the edge of each sun's glow, not on top of the sun.
			const ra = this.bloomRadius(lane.a, Math.max(A.sunRadius * ss * z, 4.5)) * 0.3;
			const rb = this.bloomRadius(lane.b, Math.max(B.sunRadius * ss * z, 4.5)) * 0.3;
			const t0 = Math.min(0.4, ra / len), t1 = 1 - Math.min(0.4, rb / len);
			const p0x = bez(ax, cx, bx, t0), p0y = bez(ay, cy, by, t0);
			const p1x = bez(ax, cx, bx, t1), p1y = bez(ay, cy, by, t1);
			const span = t1 - t0;
			const qx = p0x + span * ((1 - t0) * (cx - ax) + t0 * (bx - cx)), qy = p0y + span * ((1 - t0) * (cy - ay) + t0 * (by - cy));
			const ca = this.tints[lane.a], cb = this.tints[lane.b];
			const heavy = Math.min(1, Math.log2(1 + lane.weight) / 4);
			if (part === "pulses") {
				for (let k = 0; k < lane.pulses; k++) {
					let t = (seconds * lane.speed + lane.phase + k / lane.pulses) % 1;
					// Alternate pulses travel the other way: links go both ways.
					if (k % 2 === 1) t = 1 - t;
					const tt = t0 + span * t;
					const px = bez(ax, cx, bx, tt), py = bez(ay, cy, by, tt);
					const c = k % 2 === 0 ? cb : ca;
					const pr = 5 + heavy * 4;
					ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9 * fade;
					ctx.drawImage(bloomSprite(c), px - pr, py - pr, pr * 2, pr * 2);
				}
				ctx.globalAlpha = 1;
				continue;
			}
			ctx.beginPath();
			ctx.moveTo(p0x, p0y);
			ctx.quadraticCurveTo(qx, qy, p1x, p1y);
			if (this.quality > 0) {
				// A wide faint haze under the line.
				const mid = `${((ca[0] + cb[0]) / 2) | 0}, ${((ca[1] + cb[1]) / 2) | 0}, ${((ca[2] + cb[2]) / 2) | 0}`;
				ctx.strokeStyle = `rgba(${mid}, ${(0.05 + 0.05 * heavy) * fade})`;
				ctx.lineWidth = 4 + heavy * 5;
				ctx.stroke();
			}
			const g = ctx.createLinearGradient(p0x, p0y, p1x, p1y);
			const core = (0.16 + 0.22 * heavy) * fade;
			g.addColorStop(0, `rgba(${ca[0] | 0}, ${ca[1] | 0}, ${ca[2] | 0}, ${core})`);
			g.addColorStop(0.5, `rgba(200, 215, 255, ${core * 0.55})`);
			g.addColorStop(1, `rgba(${cb[0] | 0}, ${cb[1] | 0}, ${cb[2] | 0}, ${core})`);
			ctx.strokeStyle = g;
			ctx.lineWidth = 0.8 + heavy * 0.8;
			ctx.stroke();
		}
		ctx.restore();
	}

	/**
	 * Short fading streaks behind each planet, along its orbit. Batched into a
	 * few strokes per system, and made of short straight pieces (at this size
	 * they are indistinguishable from the curve, and much cheaper to draw).
	 */
	private drawTrails(ctx: CanvasRenderingContext2D, bodies: number[], si: number, sx: number, sy: number, ext: number, alpha: number) {
		const u = this.universe;
		if (!u) return;
		const z = this.cam.zoom;
		const segs = this.quality > 0 ? 3 : 2;
		const span = 0.6;
		const c = this.tints[si];
		const col = `${((c[0] + 255) / 2) | 0}, ${((c[1] + 255) / 2) | 0}, ${((c[2] + 255) / 2) | 0}`;
		// Points along each trail, tail first: segs + 1 per planet.
		const n = bodies.length, stride = (segs + 1) * 2;
		const pts = this.trailPoints.length >= n * stride ? this.trailPoints : (this.trailPoints = new Float32Array(n * stride * 2));
		let count = 0;
		for (const bi of bodies) {
			const e = this.ellipses[bi], o = u.bodies[bi].orbit;
			if (!e || !o || this.hiddenByHistory(bi)) continue;
			const E = orbitAnomaly(o, this.time);
			const ex = sx + e[0] * z, ey = sy + e[1] * z;
			const ux = e[2] * z, uy = e[3] * z, vx = e[4] * z, vy = e[5] * z;
			const off = count * stride;
			for (let k = 0; k <= segs; k++) {
				const a = E - (span * (segs - k)) / segs;
				const ca = Math.cos(a), sa = Math.sin(a);
				pts[off + k * 2] = ex + ux * ca + vx * sa;
				pts[off + k * 2 + 1] = ey + uy * ca + vy * sa;
			}
			count++;
		}
		ctx.lineWidth = clamp(ext / 200, 0.8, 1.7);
		ctx.lineCap = "round";
		for (let k = 0; k < segs; k++) {
			ctx.beginPath();
			for (let i = 0; i < count; i++) {
				const off = i * stride + k * 2;
				ctx.moveTo(pts[off], pts[off + 1]);
				ctx.lineTo(pts[off + 2], pts[off + 3]);
			}
			ctx.strokeStyle = `rgba(${col}, ${alpha * (0.05 + (0.35 * (k + 1)) / segs)})`;
			ctx.stroke();
		}
		ctx.lineCap = "butt";
	}

	/** Draws queued labels, most important first, skipping any that would overlap one already placed. */
	private placeLabels(ctx: CanvasRenderingContext2D) {
		const q = this.labelQueue;
		if (q.length === 0) return;
		q.sort((a, b) => b.priority - a.priority);
		const placed: number[] = [];
		const w = this.width, h = this.height;
		ctx.textAlign = "center";
		ctx.lineJoin = "round";
		for (const l of q) {
			if (l.alpha < 0.02) continue;
			const font = `${l.bold ? 600 : 400} ${l.size}px sans-serif`;
			const subFont = "10px sans-serif";
			const tw = this.measure(ctx, font, l.text);
			const sw = l.sub ? this.measure(ctx, subFont, l.sub) : 0;
			const half = Math.max(tw, sw) / 2 + 3;
			const x0 = l.x - half, x1 = l.x + half, y0 = l.y - l.size - 1, y1 = l.y + 4 + (l.sub ? 12 : 0);
			if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) continue;
			let free = true;
			for (let i = 0; i < placed.length && free; i += 4) {
				if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) free = false;
			}
			if (!free) continue;
			placed.push(x0, y0, x1, y1);
			// A dark halo keeps text readable over bright nebula and glows.
			ctx.font = font;
			ctx.lineWidth = 3;
			ctx.strokeStyle = `rgba(3, 4, 12, ${0.7 * l.alpha})`;
			ctx.strokeText(l.text, l.x, l.y);
			ctx.fillStyle = `rgba(${l.color}, ${l.alpha})`;
			ctx.fillText(l.text, l.x, l.y);
			if (l.sub) {
				ctx.font = subFont;
				ctx.strokeText(l.sub, l.x, l.y + 13);
				ctx.fillStyle = `rgba(${l.color}, ${l.alpha * 0.55})`;
				ctx.fillText(l.sub, l.x, l.y + 13);
			}
		}
	}

	private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
		const key = `${font}|${text}`;
		let v = this.textWidths.get(key);
		if (v === undefined) {
			ctx.font = font;
			v = ctx.measureText(text).width;
			this.textWidths.set(key, v);
			if (this.textWidths.size > 4000) this.textWidths.clear();
		}
		return v;
	}

	/** Works out a body's screen position for this frame (and leaves its depth in this.pos). */
	private place(u: Universe, bi: number) {
		bodyPosition(u, bi, this.time, this.pos);
		this.screen.x[bi] = this.toScreenX(this.pos.x);
		this.screen.y[bi] = this.toScreenY(this.pos.y);
	}

	private drawGroup(ctx: CanvasRenderingContext2D, u: Universe, bi: number, sunX: number, sunY: number, T: number, now: number) {
		this.drawBody(ctx, u.bodies[bi], bi, sunX, sunY, T, now);
		for (const mi of u.bodies[bi].moons) this.drawBody(ctx, u.bodies[mi], mi, sunX, sunY, T, now);
	}

	private hiddenByHistory(bi: number): boolean {
		return !!this.history && (this.universe?.bodies[bi].ctime ?? 0) > this.history.cutoff;
	}

	/** Combined pop-in from the opening animation, live births and history mode. */
	private bodyScale(T: number, bi: number): number {
		let scale = this.intro ? this.popScale(T, bi) : 1;
		const born = this.bornAt[bi];
		if (born > 0) {
			const t = (performance.now() / 1000 - born) / 0.7;
			if (t <= 0) return 0;
			scale *= easeOutBack(Math.min(1, t));
		}
		const h = this.history;
		if (h) {
			const b = this.universe?.bodies[bi];
			if (!b || b.ctime > h.cutoff) return 0;
			const window = (h.max - h.min) * 0.02 + 1;
			scale *= easeOutBack(Math.min(1, (h.cutoff - b.ctime) / window));
		}
		return scale;
	}

	/** Draws one body, lit from (sunX, sunY). Too small for detail: a crisp dot. */
	private drawBody(ctx: CanvasRenderingContext2D, b: Body, bi: number, sunX: number, sunY: number, T: number, now: number) {
		const scale = this.bodyScale(T, bi);
		if (scale <= 0) return;
		const x = this.screen.x[bi], y = this.screen.y[bi];
		const r = b.radius * this.cam.zoom * this.settings.planetScale * scale;
		const pad = r * Math.max(4, ringReach(b.spec)) + 6;
		if (x + pad < 0 || x - pad > this.width || y + pad < 0 || y - pad > this.height) return;
		this.screen.r[bi] = Math.max(r, 1);
		const alpha = this.filterOn && this.dim[bi] ? 0.15 : 1;

		if (this.settings.recentGlow) {
			const age = now - b.mtime, span = this.settings.recentDays * 86400e3;
			if (age >= 0 && age < span) {
				const gr = r + Math.max(4, Math.min(r * 1.6, 14));
				ctx.globalAlpha = (1 - age / span) * alpha;
				ctx.drawImage(this.glowSprite((r * 0.9) / gr), x - gr, y - gr, gr * 2, gr * 2);
				ctx.globalAlpha = 1;
			}
		}

		ctx.globalAlpha = alpha;
		if (r < 1.4) {
			const d = 1.6 * Math.min(scale, 1.3);
			ctx.fillStyle = b.color;
			ctx.fillRect(x - d / 2, y - d / 2, d, d);
		} else {
			// The surface never turns; only its shadow follows the sun, exactly.
			const angle = Math.atan2(sunY - y, sunX - x);
			const spec = b.spec;
			drawAtmosphereGlow(ctx, spec, x, y, r);
			const rings = hasRingLayer(spec) ? this.ringImages(b, r) : null;
			if (rings) drawSprite(ctx, rings.back, rings.size, x, y, r);
			else if (hasRingLayer(spec)) drawRingHalf(ctx, spec, x, y, r, "back");
			const lumps = bodyLumps(spec);
			const imgs = this.sphereImages(spec, textureSize(r * 2 * this.dpr, 16, 512), lumps);
			if (imgs) paintSphere(ctx, imgs, x, y, r, angle, spec.pattern === "moon", lumps > 0);
			else paintPlaceholder(ctx, spec, x, y, r, angle);
			if (rings) drawSprite(ctx, rings.front, rings.size, x, y, r);
			else if (hasRingLayer(spec)) drawRingHalf(ctx, spec, x, y, r, "front");
			if (spec.moons.length > 0) {
				let moons = this.moonCache.get(bi);
				if (!moons) this.moonCache.set(bi, (moons = moonPlacements(spec)));
				drawMoons(ctx, moons, x, y, r, angle);
			}
		}
		ctx.globalAlpha = 1;
	}

	/** Cached images of a planet's rings (and debris) behind and in front of it. */
	private ringImages(b: Body, r: number) {
		// Colossal rings are huge, so their cached image stays smaller to save memory.
		const bucket = sizeBucket(r * this.dpr, 8, b.spec.rings === "colossal" ? 96 : 256);
		const base = `${b.spec.seed}|${b.spec.rings}|${b.spec.ringColor}|${b.spec.ringAngle}|${b.spec.axialTilt.toFixed(3)}|${b.spec.features.join(",")}`;
		return this.ringSprites.get(`${base}|${bucket}`, base, () => {
			const make = (half: "back" | "front") => {
				const c = createEl("canvas");
				c.width = c.height = Math.ceil(bucket * ringReach(b.spec) * 2);
				const cctx = c.getContext("2d", { willReadFrequently: true });
				if (!cctx) return null;
				drawRingHalf(cctx, b.spec, c.width / 2, c.height / 2, bucket, half);
				return cropSprite(c, cctx);
			};
			return { back: make("back"), front: make("front"), size: bucket };
		});
	}

	/** A soft ring of light whose inside edge sits at `inner` (0..1) of its radius; a few shapes are cached. */
	private glowSprite(inner: number): HTMLCanvasElement {
		const k = Math.round(clamp(inner, 0, 0.95) * 20);
		let c = this.glowSprites.get(k);
		if (!c) {
			c = createEl("canvas");
			const S = 96;
			c.width = c.height = S;
			const g2 = c.getContext("2d");
			if (g2) {
				const g = g2.createRadialGradient(S / 2, S / 2, (S / 2) * (k / 20), S / 2, S / 2, S / 2);
				g.addColorStop(0, "rgba(255, 226, 150, 0.55)");
				g.addColorStop(1, "rgba(255, 210, 120, 0)");
				g2.fillStyle = g;
				g2.beginPath();
				g2.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
				g2.fill();
			}
			this.glowSprites.set(k, c);
		}
		return c;
	}

	private drawLabel(ctx: CanvasRenderingContext2D, u: Universe, bi: number, labels: { count: number }) {
		const r = this.screen.r[bi];
		if (!this.settings.showLabels || r < 5 || labels.count >= MAX_BODY_LABELS || bi === this.hovered) return;
		if (this.filterOn && this.dim[bi]) return;
		this.labelQueue.push({
			text: u.bodies[bi].name,
			sub: null,
			x: this.screen.x[bi],
			y: this.screen.y[bi] + r * 2.3 + 11,
			size: 11,
			bold: false,
			color: "220, 225, 255",
			alpha: 0.65 * smoothstep(5, 9, r),
			priority: r,
		});
		labels.count++;
	}

	/** A faint disk across a system's plane, tinted by its sun. */
	private drawPlane(ctx: CanvasRenderingContext2D, sun: SunSpec, x: number, y: number, ext: number, alpha: number) {
		const c = sunTint(sun);
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(1, SQUASH);
		const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ext);
		g.addColorStop(0, `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${0.12 * alpha})`);
		g.addColorStop(0.7, `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${0.05 * alpha})`);
		g.addColorStop(1, `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, 0)`);
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(0, 0, ext, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	/** Rings for the open note ("you are here") and the body being followed. */
	private drawMarkers(ctx: CanvasRenderingContext2D, seconds: number) {
		const cur = this.current;
		if (this.settings.highlightCurrent && cur >= 0 && this.screen.r[cur] >= 0) {
			const x = this.screen.x[cur], y = this.screen.y[cur], r = this.screen.r[cur];
			const pulse = 0.5 + 0.5 * Math.sin(seconds * 3.5);
			ctx.strokeStyle = `rgba(110, 230, 255, ${0.55 + 0.4 * pulse})`;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(x, y, r + 5 + pulse * 3, 0, Math.PI * 2);
			ctx.stroke();
			if (cur !== this.hovered) {
				ctx.textAlign = "center";
				ctx.font = "600 11px sans-serif";
				ctx.fillStyle = "rgba(140, 235, 255, 0.95)";
				ctx.fillText("You are here", x, y - r - 12);
			}
		}
		const f = this.follow;
		if (f >= 0 && f !== cur && this.screen.r[f] >= 0) {
			ctx.save();
			ctx.setLineDash([4, 4]);
			ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			ctx.arc(this.screen.x[f], this.screen.y[f], this.screen.r[f] + 7, 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
		}
	}

	/** How far a body has popped in during the intro: 0 before its turn, springing past 1 and settling. */
	private popScale(T: number, bi: number): number {
		const t = (T - this.bodyDelay[bi]) / PLANET_POP;
		return t <= 0 ? 0 : easeOutBack(Math.min(1, t));
	}

	/** A brief sparkle where a body has just appeared; `t` counts pop lengths since it appeared. */
	private drawSparkle(ctx: CanvasRenderingContext2D, t: number, bi: number, r: number) {
		if (t <= 0 || t >= 1.5) return;
		const x = this.screen.x[bi], y = this.screen.y[bi];
		const a = Math.max(0, 1 - t / 1.5);
		const len = Math.max(r * 3, 6) * (0.6 + 0.4 * a);
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		const g = ctx.createRadialGradient(x, y, 0, x, y, len);
		g.addColorStop(0, `rgba(255, 255, 255, ${0.7 * a})`);
		g.addColorStop(1, "rgba(200, 220, 255, 0)");
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, len, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * a})`;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x - len, y);
		ctx.lineTo(x + len, y);
		ctx.moveTo(x, y - len);
		ctx.lineTo(x, y + len);
		ctx.stroke();
		ctx.restore();
	}

	/** A flash and an expanding shockwave ring as a sun pops in. */
	private drawPopFlash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		// Minimum sizes keep the pop visible even when suns are tiny in the far view.
		const flash = Math.max(0, 1 - t) ** 2;
		if (flash > 0) {
			const fr = Math.max(r * 4, 26);
			const g = ctx.createRadialGradient(x, y, 0, x, y, fr);
			g.addColorStop(0, `rgba(255, 250, 235, ${0.85 * flash})`);
			g.addColorStop(1, "rgba(255, 240, 210, 0)");
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(x, y, fr, 0, Math.PI * 2);
			ctx.fill();
		}
		const ring = t / 1.6;
		const reach = Math.max(r * 7, 60);
		ctx.strokeStyle = `rgba(220, 230, 255, ${0.55 * (1 - ring)})`;
		ctx.lineWidth = Math.max(1, Math.max(r * 0.12, 2.2) * (1 - ring));
		ctx.beginPath();
		ctx.arc(x, y, r * 1.2 + ring * reach, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	/** The cached image of a system's sun or black hole, sized for a sun of radius r on screen. */
	private sunImage(si: number, r: number): HTMLCanvasElement | null {
		const sys = this.universe?.systems[si];
		if (!sys) return null;
		const sun = sys.sun;
		const bucket = sizeBucket(r * this.dpr, 8, 128);
		if (sun.kind === "star") {
			// The cached star image covers 3.3 radii; the faint outer aura is drawn live.
			const compose = (layers?: { disc: HTMLCanvasElement; corona: HTMLCanvasElement }) => {
				const c = createEl("canvas");
				c.width = c.height = Math.ceil(bucket * 3.3 * 2);
				const cctx = c.getContext("2d");
				if (cctx) drawStar(cctx, sun.star, c.width / 2, c.height / 2, bucket, false, layers);
				return c;
			};
			const key = `star|${si}|${bucket}`, base = `star|${si}`;
			const pool = this.pool;
			if (!pool?.available) return this.suns.get(key, base, () => compose());
			// The slow pixel work (disc and corona) happens in a worker; the rest is quick.
			return this.suns.request(key, base, (resolve, cancel) => {
				const discSize = Math.max(16, bucket * 2), coronaSize = Math.ceil(bucket * CORONA_REACH * 2);
				pool.submit<{ disc: Uint8ClampedArray; corona: Uint8ClampedArray }>(
					{ kind: "star", spec: sun.star, discSize, coronaSize },
					(res) => resolve(compose({ disc: pixelCanvas(discSize, res.disc), corona: pixelCanvas(coronaSize, res.corona) })),
					cancel
				);
			});
		}
		return this.suns.get(`hole|${si}|${bucket}`, `hole|${si}`, () => {
			const c = createEl("canvas");
			c.width = c.height = Math.ceil(bucket * 6.6 * 2);
			const cctx = c.getContext("2d");
			if (cctx) drawBlackHole(cctx, sun.hole, c.width / 2, c.height / 2, bucket);
			return c;
		});
	}

	/** `fullR` is the sun's settled size; while it pops in, `sr` is smaller but the image stays the same. */
	private drawSun(ctx: CanvasRenderingContext2D, si: number, sx: number, sy: number, sr: number, seconds: number, fullR: number) {
		const sys = this.universe?.systems[si];
		if (!sys) return;
		const sun = sys.sun;
		const img = this.sunImage(si, fullR);
		// From far away a sun is a few pixels, so a bloom (and, for big folders, rays) carries its light.
		const bloom = 1 - smoothstep(16, 70, fullR);
		if (bloom > 0.01) {
			const br = this.bloomRadius(si, fullR) * (sr / fullR);
			ctx.save();
			ctx.globalCompositeOperation = "lighter";
			ctx.globalAlpha = bloom * (sun.kind === "star" ? 0.95 : 0.55);
			ctx.drawImage(bloomSprite(this.tints[si]), sx - br, sy - br, br * 2, br * 2);
			if (sun.kind === "star" && this.sysSize[si] > 0.3 && this.quality > 0) {
				const len = br * (1.1 + 0.5 * this.sysSize[si]) * (0.94 + 0.06 * Math.sin(seconds * 1.1 + si));
				ctx.globalAlpha = 0.55 * (1 - smoothstep(7, 26, fullR));
				ctx.drawImage(spikeSprite(), sx - len, sy - len, len * 2, len * 2);
			}
			ctx.restore();
		}
		if (sun.kind === "star") {
			drawStarAura(ctx, sun.star, sx, sy, sr);
			const half = 3.3;
			if (img) {
				ctx.save();
				ctx.translate(sx, sy);
				// A very slow turn keeps the corona alive.
				ctx.rotate(seconds * 0.015);
				ctx.drawImage(img, -sr * half, -sr * half, sr * half * 2, sr * half * 2);
				ctx.restore();
			} else this.sunPlaceholder(ctx, sx, sy, sr);
		} else {
			const half = 6.6;
			if (img) ctx.drawImage(img, sx - sr * half, sy - sr * half, sr * half * 2, sr * half * 2);
			else this.sunPlaceholder(ctx, sx, sy, sr);
		}
		if (si === this.hoveredSun) {
			ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(sx, sy, sr * 1.25 + 4, 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	private sunPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
		const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
		g.addColorStop(0, "rgba(255, 245, 220, 0.9)");
		g.addColorStop(1, "rgba(255, 220, 160, 0)");
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, r * 2, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawHover(ctx: CanvasRenderingContext2D, u: Universe) {
		const hi = this.hovered;
		if (hi < 0 || this.screen.r[hi] < 0) return;
		const b = u.bodies[hi];
		const x = this.screen.x[hi], y = this.screen.y[hi];
		const r = Math.max(this.screen.r[hi], 2);
		ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(x, y, r + 4, 0, Math.PI * 2);
		ctx.stroke();
		if (this.settings.showLinks) {
			ctx.save();
			ctx.globalCompositeOperation = "lighter";
			ctx.strokeStyle = "rgba(140, 200, 255, 0.55)";
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			for (const other of b.links) {
				if (this.hiddenByHistory(other)) continue;
				// Linked bodies that were not drawn this frame are aimed at where they would be.
				if (this.screen.r[other] < 0) this.place(u, other);
				ctx.moveTo(x, y);
				ctx.lineTo(this.screen.x[other], this.screen.y[other]);
			}
			ctx.stroke();
			ctx.restore();
		}
		ctx.textAlign = "center";
		ctx.font = "600 13px sans-serif";
		ctx.fillStyle = "#ffffff";
		ctx.fillText(b.name, x, y - r - 10);
		if (!this.settings.hoverPreview) {
			ctx.font = "11px sans-serif";
			ctx.fillStyle = "rgba(220, 225, 255, 0.65)";
			ctx.fillText(`${this.where(b)} · ${b.links.length} link${b.links.length === 1 ? "" : "s"}`, x, y + r * 2.3 + 12);
		}
	}

	/** "Projects", "moon of Book Notes" or "rogue planet". */
	private where(b: Body): string {
		const u = this.universe;
		if (b.kind === "rogue") return "rogue planet";
		if (b.kind === "moon" && u) return `moon of ${u.bodies[b.parent].name}`;
		return u?.systems[b.system]?.name ?? b.folder;
	}

	// -------------------------------------------------------------------
	// Search, filter, history and the preview card

	private search(query: string): SearchResult[] {
		const u = this.universe;
		if (!u) return [];
		const q = query.toLowerCase();
		const hits: Array<{ i: number; score: number }> = [];
		u.bodies.forEach((b, i) => {
			const name = b.name.toLowerCase();
			const at = name.indexOf(q);
			if (at >= 0) hits.push({ i, score: (at === 0 ? 0 : 1) + name.length / 1000 });
		});
		hits.sort((a, b) => a.score - b.score);
		return hits.slice(0, 8).map(({ i }) => ({ id: i, label: u.bodies[i].name, sub: this.where(u.bodies[i]) }));
	}

	private applyFilter(query: string) {
		const u = this.universe;
		const q = query.trim().toLowerCase();
		this.filterOn = q.length > 0 && !!u;
		if (!u || !this.filterOn) return;
		u.bodies.forEach((b, i) => {
			const tags = b.tags.map((t) => t.toLowerCase());
			const match = q.startsWith("#")
				? tags.some((t) => t.startsWith(q))
				: b.folder.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || tags.some((t) => t.includes(q));
			this.dim[i] = match ? 0 : 1;
		});
	}

	private setHistory(on: boolean) {
		const u = this.universe;
		if (!on || !u || u.bodies.length === 0) {
			this.history = null;
			this.overlay?.setHistoryVisible(false);
			return;
		}
		let min = Infinity, max = -Infinity;
		for (const b of u.bodies) {
			min = Math.min(min, b.ctime);
			max = Math.max(max, b.ctime);
		}
		this.history = { min, max, cutoff: min, playing: true };
		this.endIntro();
		this.overlay?.setHistoryVisible(true);
	}

	private togglePlay() {
		const h = this.history;
		if (!h) return;
		if (h.cutoff >= h.max) h.cutoff = h.min;
		h.playing = !h.playing;
	}

	private scrub(fraction: number) {
		const h = this.history;
		if (!h) return;
		h.cutoff = h.min + fraction * (h.max - h.min);
		h.playing = false;
	}

	private scheduleCard(bi: number) {
		if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
		this.cardTimer = null;
		this.cardFor = -1;
		this.overlay?.hideCard();
		if (bi < 0 || !this.settings.hoverPreview) return;
		this.cardTimer = window.setTimeout(() => void this.showCard(bi), 250);
	}

	/** The look and rarity line for a planet's card. */
	private rarityFor(b: Body) {
		const oneIn = planetRarity(b.spec);
		return { looks: describePlanet(b.spec), odds: formatOdds(oneIn), tier: rarityTier(b.spec, oneIn) };
	}

	private async showCard(bi: number) {
		const u = this.universe;
		if (!u || this.hovered !== bi) return;
		const b = u.bodies[bi];
		const sub = `${this.where(b)} · ${b.links.length} link${b.links.length === 1 ? "" : "s"} · edited ${new Date(b.mtime).toLocaleDateString()}`;
		this.cardFor = bi;
		this.sunCard = -1;
		const rarity = this.rarityFor(b);
		this.overlay?.showCard(b.name, sub, this.previews.get(b.path) ?? "", b.tags, rarity);
		if (this.previews.has(b.path)) return;
		let text = this.demo
			? "A made-up note in this demo universe. In Obsidian this card shows the start of your note, and clicking the planet opens it."
			: "A made-up note in a random developer universe.";
		if (this.mode === "vault") {
			const file = this.app.vault.getAbstractFileByPath(b.path);
			text = file instanceof TFile ? previewText(await this.app.vault.cachedRead(file)) : "";
		}
		this.previews.set(b.path, text);
		if (this.hovered === bi) this.overlay?.showCard(b.name, sub, text, b.tags, rarity);
	}

	/** A card about a folder's sun: what kind it is and how rare. */
	private showSunCard(si: number) {
		const sys = this.universe?.systems[si];
		if (!sys) return;
		const count = sys.bodies.length;
		this.cardFor = -1;
		this.sunCard = si;
		this.overlay?.showCard(
			sys.name,
			`${count} note${count === 1 ? "" : "s"} · double-click to fly in`,
			"",
			[],
			{ looks: describeSun(sys.sun), odds: formatOdds(sunRarity(sys.sun)), tier: sys.sun.kind === "blackHole" ? "Black hole" : "Star" }
		);
	}

	private scheduleSunCard(si: number) {
		if (this.sunCardTimer !== null) window.clearTimeout(this.sunCardTimer);
		this.sunCardTimer = null;
		if (si < 0) {
			if (this.sunCard >= 0) {
				this.sunCard = -1;
				this.overlay?.hideCard();
			}
			return;
		}
		if (!this.settings.hoverPreview) return;
		this.sunCardTimer = window.setTimeout(() => {
			if (this.hoveredSun === si) this.showSunCard(si);
		}, 250);
	}

	// -------------------------------------------------------------------
	// Input

	private onPointerDown(e: PointerEvent) {
		try {
			this.canvas?.setPointerCapture(e.pointerId);
		} catch {
			// Some pointers (e.g. synthetic or already released) cannot be captured; dragging still works.
		}
		this.contentEl.focus({ preventScroll: true });
		this.endIntro();
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (this.pointers.size === 2) {
			// Two fingers: start a pinch, and cancel any drag so lifting does not click.
			const [a, b] = [...this.pointers.values()];
			const mid = this.localXY((a.x + b.x) / 2, (a.y + b.y) / 2);
			this.pinch = {
				dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
				worldX: this.cam.x + (mid.x - this.width / 2) / this.cam.zoom,
				worldY: this.cam.y + (mid.y - this.height / 2) / this.cam.zoom,
				zoom: this.cam.zoom,
			};
			this.drag = null;
			this.flight = null;
			this.stopFollowing();
			return;
		}
		this.flight = null;
		this.drag = { startX: e.clientX, startY: e.clientY, camX: this.cam.x, camY: this.cam.y, moved: false };
	}

	private onPointerMove(e: PointerEvent) {
		if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const pinch = this.pinch;
		if (pinch && this.pointers.size >= 2) {
			const [a, b] = [...this.pointers.values()];
			const mid = this.localXY((a.x + b.x) / 2, (a.y + b.y) / 2);
			this.cam.zoom = clamp(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), MIN_ZOOM, MAX_ZOOM);
			// Keep the world point that started under the fingers under them.
			this.cam.x = pinch.worldX - (mid.x - this.width / 2) / this.cam.zoom;
			this.cam.y = pinch.worldY - (mid.y - this.height / 2) / this.cam.zoom;
			return;
		}
		const drag = this.drag;
		if (drag) {
			const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
			if (!drag.moved && Math.hypot(dx, dy) > 4) {
				drag.moved = true;
				this.stopFollowing();
				this.setHover(-1, -1);
				this.canvas?.addClass("is-dragging");
			}
			if (drag.moved) {
				this.cam.x = drag.camX - dx / this.cam.zoom;
				this.cam.y = drag.camY - dy / this.cam.zoom;
			}
			return;
		}
		const p = this.localPoint(e);
		const body = this.hitBody(p.x, p.y);
		this.setHover(body, body >= 0 ? -1 : this.hitSun(p.x, p.y));
	}

	private onPointerUp(e: PointerEvent, cancelled = false) {
		this.pointers.delete(e.pointerId);
		if (this.pinch) {
			if (this.pointers.size < 2) this.pinch = null;
			return;
		}
		const drag = this.drag;
		this.drag = null;
		this.canvas?.removeClass("is-dragging");
		if (!drag || drag.moved || cancelled) return;
		const p = this.localPoint(e);
		const body = this.hitBody(p.x, p.y);
		if (body >= 0) {
			this.openNote(body, e.ctrlKey || e.metaKey);
			return;
		}
		// A single click on a sun shows what it is; a double-click flies into its system.
		const sun = this.hitSun(p.x, p.y);
		if (sun >= 0) {
			this.sunCursor = sun;
			this.showSunCard(sun);
		}
	}

	private onDoubleClick(e: MouseEvent) {
		e.preventDefault();
		this.endIntro();
		const p = this.localPoint(e);
		const sun = this.hitSun(p.x, p.y);
		if (sun >= 0) {
			this.sunCursor = sun;
			this.flyTo(this.fitSystem(sun));
			return;
		}
		if (this.hitBody(p.x, p.y) >= 0) return;
		// Empty space: glide in toward that point.
		this.stopFollowing();
		this.flyTo({
			x: this.cam.x + (p.x - this.width / 2) / this.cam.zoom,
			y: this.cam.y + (p.y - this.height / 2) / this.cam.zoom,
			zoom: clamp(this.cam.zoom * 2.5, MIN_ZOOM, MAX_ZOOM),
		});
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		this.endIntro();
		const factor = Math.exp(-e.deltaY * 0.0015);
		if (this.follow >= 0) {
			// Following: zoom around the followed body and keep it centered.
			this.cam.zoom = clamp(this.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
			if (this.flight) this.flight.toZoom = clamp(this.flight.toZoom * factor, MIN_ZOOM, MAX_ZOOM);
			return;
		}
		this.flight = null;
		this.zoomAt(this.localPoint(e), factor);
	}

	private zoomAt(p: { x: number; y: number }, factor: number) {
		const wx = this.cam.x + (p.x - this.width / 2) / this.cam.zoom;
		const wy = this.cam.y + (p.y - this.height / 2) / this.cam.zoom;
		this.cam.zoom = clamp(this.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
		// Keep the point under the cursor fixed while zooming.
		this.cam.x = wx - (p.x - this.width / 2) / this.cam.zoom;
		this.cam.y = wy - (p.y - this.height / 2) / this.cam.zoom;
	}

	private onKey(e: KeyboardEvent) {
		if (this.overlay?.isTyping()) return;
		const u = this.universe;
		const step = 80 / this.cam.zoom;
		const center = { x: this.width / 2, y: this.height / 2 };
		const pan = (dx: number, dy: number) => {
			this.endIntro();
			this.stopFollowing();
			this.flight = null;
			this.cam.x += dx;
			this.cam.y += dy;
		};
		switch (e.key) {
			case "ArrowLeft": pan(-step, 0); break;
			case "ArrowRight": pan(step, 0); break;
			case "ArrowUp": pan(0, -step); break;
			case "ArrowDown": pan(0, step); break;
			case "+": case "=": this.endIntro(); this.zoomAt(center, 1.25); break;
			case "-": case "_": this.endIntro(); this.zoomAt(center, 0.8); break;
			case "Tab": {
				if (!u || u.systems.length === 0) return;
				const n = u.systems.length;
				this.sunCursor = (this.sunCursor + (e.shiftKey ? n - 1 : 1) + n) % n;
				this.endIntro();
				this.flyTo(this.fitSystem(this.sunCursor));
				break;
			}
			case "/": this.overlay?.focusSearch(); break;
			case "h": case "H": this.endIntro(); this.flyTo(this.fitAll()); break;
			case "l": case "L": this.locateCurrent(); break;
			case " ": this.paused = !this.paused; break;
			case "?": this.overlay?.toggleLegend(); break;
			case "Escape": this.stopFollowing(); this.setHover(-1, -1); break;
			default: return;
		}
		e.preventDefault();
	}

	private setHover(body: number, sun: number) {
		if (body !== this.hovered) this.scheduleCard(body);
		if (sun !== this.hoveredSun) this.scheduleSunCard(body >= 0 ? -1 : sun);
		this.hovered = body;
		this.hoveredSun = sun;
		this.canvas?.toggleClass("is-hovering", body >= 0 || sun >= 0);
	}

	private hitBody(x: number, y: number): number {
		let best = -1, bestD = Infinity;
		const { x: sx, y: sy, r: sr } = this.screen;
		for (let i = 0; i < sr.length; i++) {
			if (sr[i] < 0 || (this.filterOn && this.dim[i])) continue;
			const d = Math.hypot(sx[i] - x, sy[i] - y);
			if (d < Math.max(sr[i] * 1.2, 7) && d < bestD) {
				best = i;
				bestD = d;
			}
		}
		return best;
	}

	private hitSun(x: number, y: number): number {
		const u = this.universe;
		if (!u) return -1;
		for (let i = 0; i < u.systems.length; i++) {
			const s = u.systems[i];
			const d = Math.hypot(this.toScreenX(s.x) - x, this.toScreenY(s.y) - y);
			if (d < Math.max(s.sunRadius * this.settings.sunScale * this.cam.zoom * 1.3, 10)) return i;
		}
		return -1;
	}

	private openNote(index: number, newTab: boolean) {
		const path = this.universe?.bodies[index]?.path;
		if (!path) return;
		if (this.demo) {
			// No note to open: follow the planet and show its card (taps on phones cannot hover).
			this.focusBody(index);
			this.setHover(index, -1);
			return;
		}
		if (this.mode === "random") {
			new Notice("This is a random developer universe, so its notes are not real.");
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
	}

	private localPoint(e: MouseEvent) {
		return this.localXY(e.clientX, e.clientY);
	}

	private localXY(clientX: number, clientY: number) {
		const rect = this.canvas?.getBoundingClientRect();
		return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
	}
}

/** The start of a note as plain text: no front matter, heading marks, links or formatting. */
function previewText(markdown: string): string {
	const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
	const plain = body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~=-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > 220 ? `${plain.slice(0, 217)}…` : plain;
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}


/** Eases to 1 with a small springy overshoot, for the pop-ins. */
function easeOutBack(t: number): number {
	const c1 = 1.70158, c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function smoothstep(a: number, b: number, v: number): number {
	const t = clamp((v - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
}

function pixelCanvas(size: number, pixels: Uint8ClampedArray, height = size): HTMLCanvasElement {
	const c = createEl("canvas");
	c.width = size;
	c.height = height;
	const ctx = c.getContext("2d");
	if (ctx) {
		const img = ctx.createImageData(size, height);
		img.data.set(pixels);
		ctx.putImageData(img, 0, 0);
	}
	return c;
}

/** A cropped image and where it sits inside the square it was drawn in (pixels from the center). */
interface Sprite {
	img: HTMLCanvasElement;
	x: number;
	y: number;
}

/** Cuts an image down to the part that is not transparent; rings are mostly empty space. */
function cropSprite(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Sprite | null {
	const { width: w, height: h } = c;
	const data = ctx.getImageData(0, 0, w, h).data;
	let x0 = w, y0 = h, x1 = -1, y1 = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3] === 0) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	if (x1 < 0) return null;
	// One pixel of margin keeps the scaled edges soft.
	x0 = Math.max(0, x0 - 1);
	y0 = Math.max(0, y0 - 1);
	x1 = Math.min(w - 1, x1 + 1);
	y1 = Math.min(h - 1, y1 + 1);
	const out = createEl("canvas");
	out.width = x1 - x0 + 1;
	out.height = y1 - y0 + 1;
	out.getContext("2d")?.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
	return { img: out, x: x0 - w / 2, y: y0 - h / 2 };
}

/** Draws a sprite made for a planet of radius `size` around a planet of radius `r` at (x, y). */
function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite | null, size: number, x: number, y: number, r: number) {
	if (!s) return;
	const k = r / size;
	ctx.drawImage(s.img, x + s.x * k, y + s.y * k, s.img.width * k, s.img.height * k);
}

/** A point on a quadratic curve from a through control c to b. */
function bez(a: number, c: number, b: number, t: number): number {
	const m = 1 - t;
	return m * m * a + 2 * m * t * c + t * t * b;
}
