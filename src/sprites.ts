// A cache for expensive images (planet surfaces, suns, rings). Images are made
// either a few at a time each frame (`get`) or by background workers
// (`request`); until one is ready, the last version made for the same thing is
// used instead, so nothing flickers while zooming.

export class ImageCache<T> {
	private ready = new Map<string, T>();
	/** Most recent image per "base" key, used while a new variant is being made. */
	private latest = new Map<string, T>();
	private queue: Array<{ key: string; base: string; make: () => T }> = [];
	private queued = new Set<string>();

	constructor(private readonly max: number, private readonly maxQueue = 400) {}

	private hit(key: string): T | undefined {
		const hit = this.ready.get(key);
		if (hit !== undefined) {
			// Re-insert so the map's order tracks recent use.
			this.ready.delete(key);
			this.ready.set(key, hit);
		}
		return hit;
	}

	private store(key: string, base: string, image: T) {
		this.ready.set(key, image);
		this.latest.delete(base);
		this.latest.set(base, image);
		trim(this.ready, this.max);
		trim(this.latest, this.max);
	}

	/** Returns the image if ready; otherwise queues `make` to run during `process`. */
	get(key: string, base: string, make: () => T): T | null {
		const hit = this.hit(key);
		if (hit !== undefined) return hit;
		if (!this.queued.has(key)) {
			this.queued.add(key);
			this.queue.push({ key, base, make });
			// Requests for things that scrolled away pile up at the front; drop them.
			while (this.queue.length > this.maxQueue) {
				const stale = this.queue.shift();
				if (stale) this.queued.delete(stale.key);
			}
		}
		return this.latest.get(base) ?? null;
	}

	/** Returns the image if ready; otherwise starts it elsewhere (a worker) via `start`. */
	request(key: string, base: string, start: (resolve: (image: T) => void, cancel: () => void) => void): T | null {
		const hit = this.hit(key);
		if (hit !== undefined) return hit;
		if (!this.queued.has(key)) {
			this.queued.add(key);
			start(
				(image) => {
					this.queued.delete(key);
					this.store(key, base, image);
				},
				() => this.queued.delete(key)
			);
		}
		return this.latest.get(base) ?? null;
	}

	/** Makes queued images until the time budget runs out. */
	process(budgetMs: number) {
		const end = performance.now() + budgetMs;
		while (this.queue.length > 0 && performance.now() < end) {
			const job = this.queue.pop();
			if (!job) break;
			this.queued.delete(job.key);
			if (!this.ready.has(job.key)) this.store(job.key, job.base, job.make());
		}
	}

	/** Images still waiting to be made. */
	get pending(): number {
		return this.queued.size;
	}

	clear() {
		this.ready.clear();
		this.latest.clear();
		this.queue = [];
		this.queued.clear();
	}
}

function trim<T>(map: Map<string, T>, max: number) {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

/** Rounds a pixel size up to a power of two, so nearby zoom levels share images. */
export function sizeBucket(px: number, min: number, max: number): number {
	let b = min;
	while (b < px && b < max) b *= 2;
	return b;
}
