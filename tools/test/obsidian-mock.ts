const P = HTMLElement.prototype as any;
P.empty = function(){ this.innerHTML = ""; };
P.addClass = function(c: string){ this.classList.add(c); };
P.removeClass = function(c: string){ this.classList.remove(c); };
P.toggleClass = function(c: string, v: boolean){ this.classList.toggle(c, v); };
P.setText = function(t: string){ this.textContent = t; };
P.createEl = function(tag: string, o: any){ const el = document.createElement(tag); if (o?.cls) el.className = o.cls; this.appendChild(el); return el; };
export class TFile { stat: any; basename: string; constructor(public path: string, stat?: any){ this.stat = stat ?? { ctime: 0, mtime: 0 }; this.basename = path.split("/").pop()!.replace(/\.md$/, ""); } }
export class ItemView { contentEl: HTMLElement; app: any; constructor(public leaf: any){ this.contentEl = leaf.el; this.app = leaf.app; }
  addAction(_i: string, title: string, cb: any){ const b = document.createElement("button"); b.title = title; b.onclick = cb; (window as any).actions = ((window as any).actions || []).concat([b]); return b; }
  registerDomEvent(el: any, t: string, cb: any, o?: any){ el.addEventListener(t, cb, o); } registerEvent(){} }
export class WorkspaceLeaf {}
export class Plugin {} export class PluginSettingTab {} export class Setting {}
export class Notice { constructor(msg: string){ (window as any).notices = ((window as any).notices || []).concat([msg]); } }
export function getAllTags(cache: any){ return (cache.tags || []).map((t: any) => t.tag); }
