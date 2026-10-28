// The web demo: the real plugin view, showing random universes.
import { SolarSystemView } from "../src/view";
import { DEFAULT_SETTINGS, SolarSystemSettings } from "../src/settings";
import { NEBULA_STYLES } from "../src/nebula";

/** A good-looking universe to greet first-time visitors. */
const FIRST_UNIVERSE = 761889;

const app = {
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => "" },
	metadataCache: { resolvedLinks: {}, on: () => {}, getFileCache: () => null },
	workspace: { getLeaf: () => ({ openFile: async () => {} }), on: () => {}, getActiveFile: () => null },
};
const settings: SolarSystemSettings = { ...DEFAULT_SETTINGS };
const plugin = { settings, saveSettings: async () => {} };
const el = document.getElementById("demo-view")!;
const view = new SolarSystemView({ el, app } as any, plugin as any);
view.demo = true;
const scale = Number(new URLSearchParams(location.search).get("scale"));
if (scale > 0) view.randomScale = Math.min(4, scale);
(window as any).view = view;
(window as any).plugin = plugin;
void view.onOpen().then(() => {
	const seed = Number(new URLSearchParams(location.search).get("universe"));
	view.rollRandom(Number.isFinite(seed) && seed > 0 ? seed : FIRST_UNIVERSE);
});

// A few of the plugin's settings, so visitors can try them.
const nebula = document.getElementById("demo-nebula") as HTMLSelectElement;
nebula.add(new Option("Surprise me", "random"));
for (const [key, style] of Object.entries(NEBULA_STYLES)) nebula.add(new Option(style.label, key));
nebula.value = settings.nebulaStyle;
nebula.onchange = () => {
	settings.nebulaStyle = nebula.value as SolarSystemSettings["nebulaStyle"];
	view.settingsChanged("nebulaStyle");
};
const size = document.getElementById("demo-size") as HTMLInputElement;
size.value = String(settings.planetScale);
size.oninput = () => {
	settings.planetScale = Number(size.value);
	view.settingsChanged("planetScale");
};
const speed = document.getElementById("demo-speed") as HTMLInputElement;
speed.value = String(settings.orbitSpeed);
speed.oninput = () => {
	settings.orbitSpeed = Number(speed.value);
	view.settingsChanged("orbitSpeed");
};
document.getElementById("demo-hide")!.onclick = () => document.body.classList.toggle("demo-bare");
