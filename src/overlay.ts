// The on-screen controls drawn over the universe: search with results, a
// filter box, the history timeline, the hover preview card, a banner and the
// legend that explains what everything means.
// Plain DOM so it stays light; the view decides what each control does.

export interface SearchResult {
	id: number;
	label: string;
	sub: string;
}

/** A trait line on the card, e.g. the planet's look and how rare it is. */
export interface CardRarity {
	looks: string;
	odds: string;
	tier: string;
}

export interface OverlayHandlers {
	search(query: string): SearchResult[];
	pick(id: number): void;
	filter(query: string): void;
	togglePlay(): void;
	scrub(fraction: number): void;
	closeHistory(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
	return parent.createEl(tag, { cls });
}

/** Shows or hides an element with the `solar-hidden` class (see styles.css). */
function show(node: HTMLElement, visible: boolean) {
	node.toggleClass("solar-hidden", !visible);
}

const isShown = (node: HTMLElement) => !node.hasClass("solar-hidden");

export class Overlay {
	readonly root: HTMLElement;
	private search: HTMLInputElement;
	private results: HTMLElement;
	private filter: HTMLInputElement;
	private history: HTMLElement;
	private playButton: HTMLButtonElement;
	private range: HTMLInputElement;
	private dateLabel: HTMLElement;
	private card: HTMLElement;
	private banner: HTMLElement;
	private legend: HTMLElement;
	private items: SearchResult[] = [];
	private active = 0;

	constructor(container: HTMLElement, private handlers: OverlayHandlers) {
		this.root = el("div", "solar-overlay", container);

		const bar = el("div", "solar-toolbar", this.root);
		this.search = el("input", "solar-input solar-search", bar);
		this.search.type = "search";
		this.search.placeholder = "Search notes  ( / )";
		this.filter = el("input", "solar-input solar-filter", bar);
		this.filter.type = "search";
		this.filter.placeholder = "Filter: #tag, folder or name";
		this.results = el("div", "solar-results", this.root);
		show(this.results, false);

		this.search.addEventListener("input", () => this.refreshResults());
		this.search.addEventListener("keydown", (e) => this.onSearchKey(e));
		this.search.addEventListener("blur", () => window.setTimeout(() => this.hideResults(), 150));
		this.filter.addEventListener("input", () => this.handlers.filter(this.filter.value));
		this.filter.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.filter.value = "";
				this.handlers.filter("");
				this.filter.blur();
			}
			e.stopPropagation();
		});

		this.history = el("div", "solar-history", this.root);
		this.playButton = el("button", "solar-button", this.history);
		this.playButton.textContent = "▶";
		this.playButton.title = "Play the vault's history";
		this.playButton.addEventListener("click", () => this.handlers.togglePlay());
		this.range = el("input", "solar-range", this.history);
		this.range.type = "range";
		this.range.min = "0";
		this.range.max = "1000";
		this.range.addEventListener("input", () => this.handlers.scrub(Number(this.range.value) / 1000));
		this.dateLabel = el("span", "solar-date", this.history);
		const close = el("button", "solar-button", this.history);
		close.textContent = "✕";
		close.title = "Leave history mode";
		close.addEventListener("click", () => this.handlers.closeHistory());
		show(this.history, false);

		this.card = el("div", "solar-card", this.root);
		show(this.card, false);
		this.banner = el("div", "solar-banner", this.root);
		show(this.banner, false);
		this.legend = this.buildLegend();
	}

	private buildLegend(): HTMLElement {
		const box = el("div", "solar-legend", this.root);
		show(box, false);
		const head = el("div", "solar-legend-head", box);
		el("span", "solar-legend-title", head).textContent = "What you are looking at";
		const close = el("button", "solar-button", head);
		close.textContent = "✕";
		close.title = "Close (?)";
		close.addEventListener("click", () => this.toggleLegend(false));
		const rows: Array<[string, string, string]> = [
			["sun", "Suns", "Each top-level folder is a sun. More notes, bigger sun. About 1 folder in 12 becomes a black hole."],
			["planet", "Planets", "Each note is a planet with a look all its own. Hover one to see its traits and how rare it is."],
			["moon", "Note moons", "A note that links only to one other note orbits that note as a moon."],
			["rogue", "Rogue planets", "Notes with no links at all drift alone between the systems."],
			["glow", "Golden glow", "Recently edited notes glow, brighter the more recent."],
			["lane", "Glowing lanes", "Folders whose notes link to each other are joined by lanes; pulses travel along them."],
			["here", "Blue ring", "The note you have open. A dashed ring marks the planet you are following."],
			["birth", "Sparkle", "A new note just appeared."],
		];
		for (const [kind, name, text] of rows) {
			const row = el("div", "solar-legend-row", box);
			el("span", `solar-legend-icon is-${kind}`, row);
			const words = el("div", "solar-legend-text", row);
			el("div", "solar-legend-name", words).textContent = name;
			el("div", "solar-legend-desc", words).textContent = text;
		}
		el("div", "solar-legend-sub", box).textContent = "Rarity";
		el("div", "solar-legend-desc", box).textContent =
			"Common, uncommon, rare, epic and legendary come from the odds of rolling a planet's exact traits. Real planets and fiction icons are special finds.";
		el("div", "solar-legend-sub", box).textContent = "Controls";
		const keys: Array<[string, string]> = [
			["Drag / scroll", "Move around / zoom"],
			["Click a planet", "Open the note (Ctrl or Cmd: new tab)"],
			["Click a sun", "About this folder's sun"],
			["Double-click a sun", "Fly into its system"],
			["Double-click space", "Zoom in there"],
			["/", "Search"],
			["H / L / Tab", "Whole universe / open note / next system"],
			["Space / ?", "Pause orbits / this legend"],
		];
		for (const [k, v] of keys) {
			const row = el("div", "solar-legend-key", box);
			el("kbd", "", row).textContent = k;
			el("span", "", row).textContent = v;
		}
		return box;
	}

	toggleLegend(visible?: boolean) {
		show(this.legend, visible ?? !isShown(this.legend));
	}

	/** True while the person is typing in one of the boxes, so keyboard shortcuts stay out of the way. */
	isTyping(): boolean {
		const a = document.activeElement;
		return a === this.search || a === this.filter;
	}

	focusSearch() {
		this.search.focus();
		this.search.select();
	}

	private refreshResults() {
		const q = this.search.value.trim();
		this.items = q ? this.handlers.search(q) : [];
		this.active = 0;
		this.renderResults();
	}

	private renderResults() {
		this.results.empty();
		show(this.results, this.items.length > 0);
		if (this.items.length === 0) return;
		this.items.forEach((item, i) => {
			const row = el("div", i === this.active ? "solar-result is-active" : "solar-result", this.results);
			el("div", "solar-result-label", row).textContent = item.label;
			el("div", "solar-result-sub", row).textContent = item.sub;
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.choose(i);
			});
		});
	}

	private onSearchKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (this.items.length === 0) return;
			this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.items.length) % this.items.length;
			this.renderResults();
		} else if (e.key === "Enter") {
			this.choose(this.active);
		} else if (e.key === "Escape") {
			this.search.value = "";
			this.hideResults();
			this.search.blur();
		}
	}

	private choose(i: number) {
		const item = this.items[i];
		if (!item) return;
		this.handlers.pick(item.id);
		this.hideResults();
		this.search.blur();
	}

	private hideResults() {
		show(this.results, false);
	}

	setHistoryVisible(visible: boolean) {
		show(this.history, visible);
	}

	setHistory(fraction: number, label: string, playing: boolean) {
		this.range.value = String(Math.round(fraction * 1000));
		this.dateLabel.textContent = label;
		this.playButton.textContent = playing ? "❚❚" : "▶";
	}

	showCard(title: string, sub: string, body: string, tags: string[], rarity?: CardRarity) {
		this.card.empty();
		el("div", "solar-card-title", this.card).textContent = title;
		el("div", "solar-card-sub", this.card).textContent = sub;
		if (rarity) {
			const row = el("div", "solar-card-rarity", this.card);
			el("span", `solar-tier is-${rarity.tier.toLowerCase().replace(/ /g, "-")}`, row).textContent = rarity.tier;
			el("span", "solar-odds", row).textContent = rarity.odds;
			el("div", "solar-card-looks", this.card).textContent = rarity.looks;
		}
		if (body) el("div", "solar-card-body", this.card).textContent = body;
		if (tags.length > 0) {
			const row = el("div", "solar-card-tags", this.card);
			for (const t of tags) el("span", "solar-tag", row).textContent = t;
		}
		show(this.card, true);
	}

	/** Keeps the card next to a moving planet, inside the view. */
	moveCard(x: number, y: number, width: number, height: number) {
		if (!isShown(this.card)) return;
		const w = this.card.offsetWidth || 240, h = this.card.offsetHeight || 80;
		const left = x + 18 + w > width ? x - 18 - w : x + 18;
		const top = Math.min(Math.max(8, y - h / 2), height - h - 8);
		this.card.setCssProps({ "--solar-card-left": `${Math.max(8, left)}px`, "--solar-card-top": `${top}px` });
	}

	hideCard() {
		show(this.card, false);
	}

	setBanner(text: string | null) {
		show(this.banner, !!text);
		this.banner.textContent = text ?? "";
	}
}
