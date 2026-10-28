import { SolarSystemView } from "../../src/view";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "../../src/settings";
const folders: Array<[string, number]> = [["Projects", 42], ["Journal", 60], ["Ideas", 25], ["Reading", 18], ["Work", 30], ["Recipes", 9], ["Travel", 6], ["Archive", 14], ["School", 22]];
const now = Date.now();
let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const files: TFile[] = [];
const tags = new Map<string, string[]>();
folders.forEach(([f, n]) => { for (let i = 0; i < n; i++) { const ct = now - rnd() * 900 * 86400e3; const mt = rnd() < 0.2 ? now - rnd() * 6 * 86400e3 : ct; const file = new TFile(`${f}/${f} note ${i}.md`, { ctime: ct, mtime: mt }); files.push(file); tags.set(file.path, rnd() < 0.4 ? ["#idea"] : rnd() < 0.5 ? ["#todo"] : []); } });
for (let i = 0; i < 6; i++) files.push(new TFile(`Root ${i}.md`, { ctime: now - rnd() * 400 * 86400e3, mtime: now - 40 * 86400e3 }));
const links: any = {};
files.forEach((f) => { links[f.path] = {}; if (rnd() < 0.12) return; const k = 1 + Math.floor(rnd() * 3); for (let j = 0; j < k; j++) {
  const same = rnd() < 0.7; const folder = f.path.split("/")[0];
  const inFolder = files.filter((g) => g.path.startsWith(folder + "/")); const pool = same && inFolder.length ? inFolder : files;
  const t = pool[Math.floor(rnd() * pool.length)]; if (t !== f) links[f.path][t.path] = 1; } });
files.filter((f) => f.path.startsWith("Projects/")).slice(0, 20).forEach((f, i) => { links[f.path][`Work/Work note ${i}.md`] = 1; });
const byPath = new Map(files.map((f) => [f.path, f]));
const app = {
  vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => byPath.get(p) ?? null, cachedRead: async (f: TFile) => `---\ntags: x\n---\n# ${f.basename}\nThis is the start of **${f.basename}**. It links to [[Some Other Note]] and talks about plans, ideas and things to do next week.` },
  metadataCache: { resolvedLinks: links, on: () => {}, getFileCache: (f: TFile) => ({ tags: (tags.get(f.path) ?? []).map((tag) => ({ tag })) }) },
  workspace: { getLeaf: () => ({ openFile: async (f: any) => { (window as any).opened = f.path; } }), on: () => {}, getActiveFile: () => byPath.get("Projects/Projects note 10.md") },
};
const el = document.getElementById("root")!;
const plugin = { settings: { ...DEFAULT_SETTINGS } };
(window as any).plugin = plugin;
const view = new SolarSystemView({ el, app } as any, plugin as any);
(window as any).view = view;
// Adds a note while the view is open, as if it had just been created in the vault.
(window as any).addNote = (path: string, ...linkTo: string[]) => {
  const t = Date.now(); const f = new TFile(path, { ctime: t, mtime: t }); files.push(f); byPath.set(path, f); tags.set(path, []);
  links[path] = {}; for (const to of linkTo) { links[path][to] = 1; links[to][path] = 1; }
};
const times: number[] = []; let last = performance.now();
const loop = (t: number) => { times.push(t - last); last = t; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
(window as any).frameStats = () => { const a = times.slice(-90).sort((x, y) => x - y); times.length = 0; return { median: Math.round(a[Math.floor(a.length / 2)]), p95: Math.round(a[Math.floor(a.length * 0.95)]) }; };
view.onOpen();
