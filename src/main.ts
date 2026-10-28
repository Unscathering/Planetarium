import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, SolarSystemSettings, SolarSystemSettingTab } from "./settings";
import { SolarSystemView, VIEW_TYPE_SOLAR } from "./view";

export default class SolarSystemPlugin extends Plugin {
	settings: SolarSystemSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_SOLAR, (leaf) => new SolarSystemView(leaf, this));

		this.addRibbonIcon("sun", "Open Planetarium", () => this.activateView());
		this.addCommand({
			id: "open-planetarium",
			name: "Open the universe",
			callback: () => this.activateView(),
		});
		this.addCommand({
			id: "locate-current-note",
			name: "Fly to the open note",
			callback: async () => (await this.activateView())?.locateCurrent(),
		});
		this.addCommand({
			id: "random-universe",
			name: "Developer: build a random universe",
			checkCallback: (checking) => {
				if (!this.settings.devMode) return false;
				if (!checking) void this.activateView().then((view) => view?.rollRandom());
				return true;
			},
		});

		this.addSettingTab(new SolarSystemSettingTab(this.app, this));
	}

	async activateView(): Promise<SolarSystemView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_SOLAR)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_SOLAR, active: true });
		}
		workspace.revealLeaf(leaf);
		return leaf.view instanceof SolarSystemView ? leaf.view : null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/** Saves settings and lets open views react; most settings are read every frame anyway. */
	async saveSettings(changed?: keyof SolarSystemSettings) {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SOLAR)) {
			if (leaf.view instanceof SolarSystemView) leaf.view.settingsChanged(changed);
		}
	}
}
