import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// The background worker is bundled first and inserted into main.js as text,
// so the plugin stays a single file and starts the worker from a blob URL.
const worker = await esbuild.build({
	entryPoints: ["src/worker.ts"],
	bundle: true,
	write: false,
	format: "iife",
	target: "es2018",
	minify: prod,
	logLevel: "warning",
});
const workerSource = worker.outputFiles[0].text;

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
	define: { __WORKER_SOURCE__: JSON.stringify(workerSource) },
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
