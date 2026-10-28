// Runs in a background worker: paints planet surfaces and star pixels so the
// view's animation never has to wait for them. Bundled into main.js as text
// (see esbuild.config.mjs) and started from a blob URL.

import { computeSphereLayers } from "./planets/pixels";
import { CORONA_REACH, StarSpec, computeCoronaPixels, computeStarPixels } from "./planets/star";
import type { PlanetSpec } from "./planets/types";
import { NebulaJob, computeNebulaPixels } from "./nebula";

export type WorkerJob =
	| { id: number; kind: "sphere"; spec: PlanetSpec; size: number; lumps: number }
	| { id: number; kind: "star"; spec: StarSpec; discSize: number; coronaSize: number }
	| ({ id: number; kind: "nebula" } & NebulaJob);

const post = (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage.bind(self);

self.onmessage = (e: MessageEvent<WorkerJob>) => {
	const job = e.data;
	if (job.kind === "sphere") {
		const layers = computeSphereLayers(job.spec, job.size, job.lumps);
		const transfer: Transferable[] = [layers.day.buffer];
		if (layers.glow) transfer.push(layers.glow.buffer);
		if (layers.lights) transfer.push(layers.lights.buffer);
		post({ id: job.id, ...layers }, transfer);
	} else if (job.kind === "nebula") {
		const pixels = computeNebulaPixels(job);
		post({ id: job.id, pixels }, [pixels.buffer]);
	} else {
		const disc = computeStarPixels(job.spec, job.discSize);
		const corona = computeCoronaPixels(job.spec, job.coronaSize, CORONA_REACH);
		post({ id: job.id, discSize: job.discSize, coronaSize: job.coronaSize, disc, corona }, [disc.buffer, corona.buffer]);
	}
};
