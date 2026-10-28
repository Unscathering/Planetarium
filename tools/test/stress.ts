import { SolarSystemView } from "../../src/view";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "../../src/settings";
const now = Date.now();
let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const files: TFile[] = [];
const folders: Array<[string, number]> = [["Big", 300], ...Array.from({ length: 40 }, (_, i) => [`Folder ${i}`, 10 + ((i * 37) % 140)] as [string, number])];
folders.forEach(([f, n]) => { for (let i = 0; i < n; i++) files.push(new TFile(`${f}/${f} note ${i}.md`, { ctime: now - rnd() * 900 * 86400e3, mtime: rnd() < 0.2 ? now - rnd() * 5 * 86400e3 : now - 400 * 86400e3 })); });
const links: any = {};
const byFolder = new Map<string, TFile[]>(); files.forEach((f) => { const k = f.path.split("/")[0]; byFolder.set(k, [...(byFolder.get(k) ?? []), f]); });
files.forEach((f) => { links[f.path] = {}; const k = 1 + Math.floor(rnd() * 3); for (let j = 0; j < k; j++) { const pool = rnd() < 0.75 ? byFolder.get(f.path.split("/")[0])! : files; const t = pool[Math.floor(rnd() * pool.length)]; if (t !== f) links[f.path][t.path] = 1; } });
const byPath = new Map(files.map((f) => [f.path, f]));
const app = { vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => byPath.get(p) ?? null, cachedRead: async () => "text" },
  metadataCache: { resolvedLinks: links, on: () => {}, getFileCache: () => ({ tags: [] }) },
  workspace: { getLeaf: () => ({ openFile: async () => {} }), on: () => {}, getActiveFile: () => null } };
const plugin = { settings: { ...DEFAULT_SETTINGS, playIntro: false } };
(window as any).plugin = plugin;
const view = new SolarSystemView({ el: document.getElementById("root")!, app } as any, plugin as any);
(window as any).view = view;
const times: number[] = []; let last = performance.now();
const loop = (t: number) => { times.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
(window as any).frameStats = () => { const a = times.slice(1).sort((x, y) => x - y); times.length = 0; return { fps: Math.round(1000 / (a.reduce((p, c) => p + c, 0) / a.length)), median: Math.round(a[Math.floor(a.length / 2)]), p95: Math.round(a[Math.floor(a.length * 0.95)]), worst: Math.round(a[a.length - 1]) }; };
view.onOpen();
