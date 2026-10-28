// Builds the web demo into one self-contained file: demo/dist/index.html.
// Run from the repo root: node demo/build.mjs
import esbuild from "esbuild";
import fs from "fs";
const dir = new URL(".", import.meta.url).pathname;
const worker = await esbuild.build({ entryPoints: ["src/worker.ts"], bundle: true, write: false, format: "iife", minify: true, logLevel: "warning" });
const app = await esbuild.build({
	entryPoints: [`${dir}main.ts`],
	bundle: true,
	write: false,
	format: "iife",
	minify: true,
	alias: { obsidian: `${dir}obsidian-shim.ts` },
	define: { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
	logLevel: "warning",
});
const css = fs.readFileSync(`${dir}../styles.css`, "utf8");
// Split on the markers instead of String.replace, whose "$" patterns would mangle the minified code.
const [head, rest] = fs.readFileSync(`${dir}template.html`, "utf8").split("/*STYLES*/");
const [middle, tail] = rest.split("/*SCRIPT*/");
const script = app.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
fs.mkdirSync(`${dir}dist`, { recursive: true });
fs.writeFileSync(`${dir}dist/index.html`, head + css + middle + script + tail);
console.log(`built demo/dist/index.html (${Math.round(fs.statSync(`${dir}dist/index.html`).size / 1024)} KB)`);
