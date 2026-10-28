// A tiny stand-in for the parts of Obsidian the view uses, so the real view
// can run on a plain web page. Toolbar buttons become real buttons.

const P = HTMLElement.prototype as any;
P.empty = function () { this.innerHTML = ""; };
P.addClass = function (c: string) { this.classList.add(c); };
P.removeClass = function (c: string) { this.classList.remove(c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
P.setText = function (t: string) { this.textContent = t; };
P.createEl = function (tag: string, o: any) {
	const el = document.createElement(tag);
	if (o?.cls) el.className = o.cls;
	if (o?.text) el.textContent = o.text;
	this.appendChild(el);
	return el;
};

// Lucide-style icons, the same set Obsidian uses.
const ICONS: Record<string, string> = {
	maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
	pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
	history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
	"help-circle": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
	"dice-5": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',
	home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
	crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
};

export class TFile {
	stat: any;
	basename: string;
	constructor(public path: string, stat?: any) {
		this.stat = stat ?? { ctime: 0, mtime: 0 };
		this.basename = path.split("/").pop()!.replace(/\.md$/, "");
	}
}

export class ItemView {
	contentEl: HTMLElement;
	app: any;
	constructor(public leaf: any) {
		this.contentEl = leaf.el;
		this.app = leaf.app;
	}
	addAction(icon: string, title: string, cb: () => void) {
		const b = document.createElement("button");
		b.className = "demo-action";
		b.title = b.ariaLabel = title;
		b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] ?? ""}</svg>`;
		b.onclick = cb;
		document.getElementById("demo-actions")?.appendChild(b);
		return b;
	}
	registerDomEvent(el: any, type: string, cb: any, options?: any) {
		el.addEventListener(type, cb, options);
	}
	registerEvent() {}
}

export class WorkspaceLeaf {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}

export class Notice {
	constructor(message: string) {
		const el = document.createElement("div");
		el.className = "demo-notice";
		el.textContent = message;
		document.body.appendChild(el);
		window.setTimeout(() => el.remove(), 3500);
	}
}

export function getAllTags(cache: any) {
	return (cache.tags || []).map((t: any) => t.tag);
}
