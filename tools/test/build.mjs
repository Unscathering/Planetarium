// Builds the test pages: a sample vault (vault.html) and a 3,300-note stress vault (stress.html),
// both running the real view against a small mock of Obsidian. Run from the repo root:
//   node tools/test/build.mjs
import esbuild from "esbuild";
import fs from "fs";
const dir = new URL(".", import.meta.url).pathname;
const worker = await esbuild.build({ entryPoints: ["src/worker.ts"], bundle: true, write: false, format: "iife", logLevel: "warning" });
const define = { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) };
for (const name of ["vault", "stress"]) {
	await esbuild.build({
		entryPoints: [`${dir}${name}.ts`],
		bundle: true,
		outfile: `${dir}${name}.js`,
		format: "iife",
		alias: { obsidian: `${dir}obsidian-mock.ts` },
		define,
		logLevel: "warning",
	});
	fs.writeFileSync(
		`${dir}${name}.html`,
		`<html><head><link rel="stylesheet" href="../../styles.css"><style>body{margin:0;background:#000}#root{width:1400px;height:850px;position:relative}</style></head>` +
			`<body><div id="root" class="view-content"></div><script src="${name}.js"></script></body></html>`
	);
}
console.log("built tools/test/vault.html and tools/test/stress.html");
