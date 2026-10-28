// Renders a planet sheet in a headless browser, saves a screenshot and prints
// the automatic check results. Needs Playwright (`npm i -D playwright`).
//   node preview/capture.cjs "mode=bodies&type=ice" out.png [pixel scale, default 2]
const path = require("path");
const { chromium } = require("playwright");

(async () => {
	const query = process.argv[2] ?? "mode=bodies";
	const out = process.argv[3] ?? "sheet.png";
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.argv[4] ?? 2) });
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	// The query may name another page, e.g. "catalog.html?part=extras".
	const [file, q] = query.includes(".html") ? query.split("?") : ["sheet.html", query];
	await page.goto(`file://${path.join(__dirname, file)}?${q ?? ""}`);
	await page.waitForFunction(() => document.title.startsWith("done") || window.__failed, null, { timeout: 120000 });
	await page.locator("canvas").screenshot({ path: out });
	const report = await page.evaluate(() => window.__report);
	const flagged = report.filter((r) => r.flags.length > 0);
	console.log(`${report.length} planets, ${flagged.length} flagged`);
	for (const r of report) {
		const nums = `bright ${r.brightness.toFixed(0)} contrast ${r.contrast.toFixed(1)} detail ${r.detail.toFixed(2)} sharp ${r.sharpness.toFixed(1)} clipped ${(r.clipped * 100).toFixed(0)}%`;
		console.log(`${r.flags.length ? "⚠" : " "} ${r.label.padEnd(44)} ${nums}${r.flags.length ? "  <- " + r.flags.join(", ") : ""}`);
	}
	if (errors.length) console.log("page errors:", errors);
	await browser.close();
})();
