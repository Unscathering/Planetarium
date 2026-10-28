import { App, PluginSettingTab, Setting } from "obsidian";
import type SolarSystemPlugin from "./main";
import { NEBULA_STYLES, NebulaStyle } from "./nebula";

export interface SolarSystemSettings {
	// Motion
	orbitSpeed: number;
	playIntro: boolean;
	// Look
	planetScale: number;
	sunScale: number;
	showOrbits: boolean;
	orbitBrightness: number;
	showPlanes: boolean;
	showBackground: boolean;
	showNebula: boolean;
	/** A named nebula style, or "random" for a new one each time the view opens. */
	nebulaStyle: NebulaStyle | "random";
	showLanes: boolean;
	showTrails: boolean;
	showLabels: boolean;
	// What notes become
	rogues: boolean;
	childMoons: boolean;
	// Highlights
	recentGlow: boolean;
	recentDays: number;
	highlightCurrent: boolean;
	hoverPreview: boolean;
	showLinks: boolean;
	// Performance
	performance: PerformancePreset;
	// Developer
	devMode: boolean;
}

/** auto adapts detail to the frame rate; the others hold one level (battery also caps at 30 frames a second). */
export type PerformancePreset = "auto" | "high" | "balanced" | "battery";

export const DEFAULT_SETTINGS: SolarSystemSettings = {
	orbitSpeed: 1,
	playIntro: true,
	planetScale: 1,
	sunScale: 1,
	showOrbits: true,
	orbitBrightness: 1,
	showPlanes: false,
	showBackground: true,
	showNebula: true,
	nebulaStyle: "classic",
	showLanes: true,
	showTrails: true,
	showLabels: true,
	rogues: true,
	childMoons: true,
	recentGlow: true,
	recentDays: 7,
	highlightCurrent: true,
	hoverPreview: true,
	showLinks: true,
	performance: "auto",
	devMode: false,
};

/** Settings that change which notes become what, so the universe must be rebuilt. */
export const STRUCTURAL_SETTINGS: Array<keyof SolarSystemSettings> = ["rogues", "childMoons"];

type BoolKey = { [K in keyof SolarSystemSettings]: SolarSystemSettings[K] extends boolean ? K : never }[keyof SolarSystemSettings];
type NumKey = { [K in keyof SolarSystemSettings]: SolarSystemSettings[K] extends number ? K : never }[keyof SolarSystemSettings];

export class SolarSystemSettingTab extends PluginSettingTab {
	plugin: SolarSystemPlugin;

	constructor(app: App, plugin: SolarSystemPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private toggle(el: HTMLElement, key: BoolKey, name: string, desc: string) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings(key);
					// Developer mode shows or hides its own section.
					if (key === "devMode") this.display();
				})
			);
	}

	private slider(el: HTMLElement, key: NumKey, name: string, desc: string, min: number, max: number, step: number) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addSlider((s) =>
				s
					.setLimits(min, max, step)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings(key);
					})
			);
	}

	display(): void {
		const { containerEl: el } = this;
		el.empty();

		new Setting(el).setName("Motion").setHeading();
		this.slider(el, "orbitSpeed", "Orbit speed", "How fast planets travel around their suns. 0 stops them.", 0, 3, 0.1);
		this.toggle(el, "playIntro", "Opening animation", "Suns and planets pop into place when the view opens. Click or scroll to skip.");

		new Setting(el).setName("Look").setHeading();
		this.slider(el, "planetScale", "Planet size", "Realistic sizes are small next to their suns; turn this up to see planets more easily.", 0.5, 3, 0.1);
		this.slider(el, "sunScale", "Sun size", "Make suns and black holes bigger or smaller.", 0.5, 2, 0.1);
		this.toggle(el, "showOrbits", "Orbit lines", "Faint paths of each planet's orbit, shown when you zoom into a system.");
		this.slider(el, "orbitBrightness", "Orbit line brightness", "How visible the orbit lines are.", 0.2, 3, 0.1);
		this.toggle(el, "showPlanes", "Orbital planes", "A faint glowing disk across each system's plane, tinted by its sun.");
		this.toggle(el, "showBackground", "Background stars", "Layers of distant stars that drift as you move, twinkling bright stars and the odd shooting star.");
		this.toggle(el, "showNebula", "Nebula", "Clouds of glowing gas behind the systems, lit and tinted by the suns inside them.");
		const styles: Record<string, string> = { random: "Surprise me (a new one each time the view opens)" };
		for (const [key, s] of Object.entries(NEBULA_STYLES)) styles[key] = s.label;
		new Setting(el)
			.setName("Nebula style")
			.setDesc("The color and shape of the gas clouds behind everything.")
			.addDropdown((d) =>
				d
					.addOptions(styles)
					.setValue(this.plugin.settings.nebulaStyle)
					.onChange(async (value) => {
						this.plugin.settings.nebulaStyle = value as NebulaStyle | "random";
						await this.plugin.saveSettings("nebulaStyle");
					})
			);
		this.toggle(el, "showLanes", "Link lanes", "Glowing lanes between folders whose notes link to each other, brighter for more links.");
		this.toggle(el, "showTrails", "Orbit trails", "From far away, planets leave short glowing trails along their orbits.");
		this.toggle(el, "showLabels", "Note names", "Label planets once they are big enough to read.");

		new Setting(el).setName("What notes become").setHeading();
		this.toggle(el, "rogues", "Rogue planets", "Notes with no links drift alone between systems instead of orbiting a sun.");
		this.toggle(el, "childMoons", "Moons for child notes", "A note whose only link is to one other note orbits that note as a moon.");

		new Setting(el).setName("Highlights").setHeading();
		this.toggle(el, "recentGlow", "Glow for recent edits", "Recently edited notes glow, brighter the more recent.");
		this.slider(el, "recentDays", "Recent means the last … days", "How far back the glow reaches.", 1, 60, 1);
		this.toggle(el, "highlightCurrent", "Highlight the open note", "A pulsing ring marks the note you have open.");
		this.toggle(el, "hoverPreview", "Preview card on hover", "Pause on a planet to see the start of the note and its tags.");
		this.toggle(el, "showLinks", "Link lines on hover", "Draw lines from a planet to the notes it links with.");

		new Setting(el).setName("Performance").setHeading();
		new Setting(el)
			.setName("Quality")
			.setDesc("Automatic lowers detail only when the view starts to stutter. Battery saver keeps detail low and draws at most 30 frames a second.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Automatic", high: "Best looking", balanced: "Balanced", battery: "Battery saver" })
					.setValue(this.plugin.settings.performance)
					.onChange(async (value) => {
						this.plugin.settings.performance = value as PerformancePreset;
						await this.plugin.saveSettings("performance");
					})
			);

		new Setting(el).setName("Developer").setHeading();
		this.toggle(el, "devMode", "Developer mode", "Adds a dice button and command that build a random universe to check how things fill out. Your notes are never changed.");
	}
}
