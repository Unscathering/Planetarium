// Obsidian gives plugins a global `createEl`; the generators use it for their
// canvases. Plain pages (these previews) don't have it, so this fills it in.
const g = globalThis as unknown as { createEl?: unknown };
if (typeof g.createEl !== "function") g.createEl = (tag: string) => document.createElement(tag);
