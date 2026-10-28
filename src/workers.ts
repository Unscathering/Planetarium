// A small pool of background workers for the slow pixel work. Newest requests
// are served first (they are what is on screen now) and old ones are dropped
// when too many pile up. If workers cannot start, `available` is false and the
// view falls back to doing the work itself, a little at a time.

/** The bundled worker code, inserted at build time by esbuild.config.mjs. */
declare const __WORKER_SOURCE__: string | undefined;

interface Queued {
	job: Record<string, unknown>;
	done: (result: never) => void;
	drop: () => void;
}

export class WorkerPool {
	private workers: Worker[] = [];
	private idle: Worker[] = [];
	private queue: Queued[] = [];
	private running = new Map<Worker, { id: number; item: Queued }>();
	private nextId = 1;
	private url: string | null = null;

	constructor(count: number, private readonly maxQueue = 300) {
		const source = typeof __WORKER_SOURCE__ === "string" ? __WORKER_SOURCE__ : null;
		if (!source || typeof Worker === "undefined") return;
		try {
			this.url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
			for (let i = 0; i < count; i++) {
				const w = new Worker(this.url);
				w.onmessage = (e) => this.finish(w, e.data);
				w.onerror = (e) => {
					// A job that throws is dropped; the worker carries on with the next one.
					e.preventDefault();
					const run = this.running.get(w);
					this.running.delete(w);
					run?.item.drop();
					this.idle.push(w);
					this.pump();
				};
				this.workers.push(w);
				this.idle.push(w);
			}
		} catch {
			this.terminate();
		}
	}

	get available(): boolean {
		return this.workers.length > 0;
	}

	/** Jobs waiting or running. */
	get backlog(): number {
		return this.queue.length + this.running.size;
	}

	submit<R>(job: Record<string, unknown>, done: (result: R) => void, drop: () => void) {
		this.queue.push({ job, done: done as (r: never) => void, drop });
		while (this.queue.length > this.maxQueue) this.queue.shift()?.drop();
		this.pump();
	}

	private pump() {
		while (this.idle.length > 0 && this.queue.length > 0) {
			const w = this.idle.pop();
			const item = this.queue.pop();
			if (!w || !item) break;
			const id = this.nextId++;
			this.running.set(w, { id, item });
			w.postMessage({ ...item.job, id });
		}
	}

	private finish(w: Worker, data: { id: number }) {
		const run = this.running.get(w);
		this.running.delete(w);
		this.idle.push(w);
		if (run && run.id === data.id) run.item.done(data as never);
		this.pump();
	}

	terminate() {
		for (const w of this.workers) w.terminate();
		for (const item of this.queue) item.drop();
		this.workers = [];
		this.idle = [];
		this.queue = [];
		this.running.clear();
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}
}
