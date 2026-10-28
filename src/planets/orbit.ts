// Realistic-looking orbits. Each system rolls its own: spacing grows outward,
// orbits are slightly oval with the sun at one focus, each is tilted a little
// differently, planets start at random points, and inner planets move faster
// (Kepler's third law), so planets never line up.

import { makeRng } from "./noise";

export interface Orbit {
	/** Semi-major axis: the orbit's average distance from the sun. */
	a: number;
	/** Eccentricity: 0 is a circle, higher is more oval. */
	e: number;
	/** Tilt of this orbit against the system's plane, in radians. */
	inc: number;
	/** Direction the tilt leans and the direction of the closest approach. */
	node: number;
	peri: number;
	/** Where on the orbit the planet starts. */
	phase: number;
	/** Time for one lap, in arbitrary units; grows as a^1.5. */
	period: number;
}

export interface OrbitPoint {
	x: number;
	y: number;
	/** Positive is in front of the sun (toward the viewer). */
	depth: number;
}

/**
 * Rolls `count` orbits for a system. `inner` is the first orbit's distance
 * (keep it outside the sun's glow); `growth` is the average spacing ratio.
 * Left out, growth is chosen so big folders stay a sensible size: the
 * outermost orbit lands at roughly 1.2 * sqrt(count) + 1.3 times the first.
 */
export function generateOrbits(seed: number, count: number, inner: number, growth?: number): Orbit[] {
	const rng = makeRng(seed ^ 0x0b17);
	const orbits: Orbit[] = [];
	const g = growth ?? (count <= 8 ? 1.28 : Math.pow(1.2 * Math.sqrt(count) + 1.3, 1 / (count - 1)));
	// Crowded systems get rounder, flatter orbits so they do not cross.
	const crowd = Math.min(1, 10 / Math.max(1, count));
	let a = inner * (0.95 + rng() * 0.2);
	for (let i = 0; i < count; i++) {
		const e = Math.pow(rng(), 2) * 0.18 * crowd;
		orbits.push({
			a,
			e,
			inc: (rng() - 0.5) * 2 * ((10 * Math.PI) / 180) * Math.max(0.4, crowd),
			node: rng() * Math.PI * 2,
			peri: rng() * Math.PI * 2,
			phase: rng() * Math.PI * 2,
			period: Math.pow(a / inner, 1.5),
		});
		// Spread out unevenly; the next orbit must clear this one's farthest point.
		a = Math.max(a * Math.pow(g, 0.6 + rng() * 0.8), a * (1 + e * 1.15 + 0.012));
	}
	return orbits;
}

/** Projects a 3D point in the system onto the screen. `squash` is how flat the system looks (1 = face-on). */
function project(x: number, y: number, z: number, squash: number): OrbitPoint {
	const lean = Math.sqrt(1 - squash * squash);
	return { x, y: y * squash - z * lean, depth: y * lean + z * squash };
}

function pointAt(o: Orbit, eccentricAnomaly: number, squash: number): OrbitPoint {
	const E = eccentricAnomaly;
	// Position in the orbit's own plane, with the sun at a focus.
	const px = o.a * (Math.cos(E) - o.e);
	const py = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
	// Rotate to the closest-approach direction, tilt, then turn to the node direction.
	const cp = Math.cos(o.peri), sp = Math.sin(o.peri);
	const x1 = px * cp - py * sp, y1 = px * sp + py * cp;
	const ci = Math.cos(o.inc), si = Math.sin(o.inc);
	const y2 = y1 * ci, z2 = y1 * si;
	const cn = Math.cos(o.node), sn = Math.sin(o.node);
	return project(x1 * cn - y2 * sn, x1 * sn + y2 * cn, z2, squash);
}

/**
 * Everything about an orbit's shape on screen that does not change over time:
 * the projected point is center + u·cos E + v·sin E (and the same for depth),
 * so each frame only needs one sine and cosine. Cached per orbit.
 */
const frames = new WeakMap<Orbit, { squash: number; f: Float64Array }>();

function orbitFrame(o: Orbit, squash: number): Float64Array {
	const hit = frames.get(o);
	if (hit && hit.squash === squash) return hit.f;
	const p0 = pointAt(o, 0, squash), p1 = pointAt(o, Math.PI, squash), pq = pointAt(o, Math.PI / 2, squash);
	const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2, cd = (p0.depth + p1.depth) / 2;
	const f = Float64Array.of(cx, cy, cd, p0.x - cx, p0.y - cy, p0.depth - cd, pq.x - cx, pq.y - cy, pq.depth - cd);
	frames.set(o, { squash, f });
	return f;
}

/**
 * How far round its ellipse the planet is at `time` (the eccentric anomaly:
 * the angle t in orbitEllipse's center + u·cos t + v·sin t).
 */
export function orbitAnomaly(o: Orbit, time: number): number {
	// Kepler's equation, M = E - e sin E. Orbits are nearly round (e < 0.2), so
	// a good first guess and two Newton steps are already exact to the pixel.
	const M = o.phase + time / o.period;
	let E = M + o.e * Math.sin(M);
	for (let i = 0; i < 2; i++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
	return E;
}

/** Where the planet is at `time`. One lap of the innermost orbit takes about 2*PI time units. */
export function orbitPosition(o: Orbit, time: number, squash: number, out?: OrbitPoint): OrbitPoint {
	const E = orbitAnomaly(o, time);
	const f = orbitFrame(o, squash);
	const c = Math.cos(E), s = Math.sin(E);
	const p = out ?? { x: 0, y: 0, depth: 0 };
	p.x = f[0] + f[3] * c + f[6] * s;
	p.y = f[1] + f[4] * c + f[7] * s;
	p.depth = f[2] + f[5] * c + f[8] * s;
	return p;
}

/** Points along the whole orbit, for drawing its path. */
export function orbitPath(o: Orbit, squash: number, steps = 96): OrbitPoint[] {
	return Array.from({ length: steps + 1 }, (_, i) => pointAt(o, (i / steps) * Math.PI * 2, squash));
}

/**
 * A tilted orbit seen from an angle is still an ellipse. This gives its center
 * and two conjugate half-axes (u, v): the path is center + u·cos t + v·sin t,
 * so it can be drawn in one go instead of point by point.
 */
export function orbitEllipse(o: Orbit, squash: number): OrbitEllipse {
	const f = orbitFrame(o, squash);
	const ux = f[3], uy = f[4], vx = f[6], vy = f[7];
	// Turn the two half-axes into the ellipse's own axes, for canvas ellipse():
	// the point at t is center + a·cos(t - t0) + b·sin(t - t0), with a and b at right angles.
	const t0 = 0.5 * Math.atan2(2 * (ux * vx + uy * vy), ux * ux + uy * uy - vx * vx - vy * vy);
	const c = Math.cos(t0), s = Math.sin(t0);
	const ax = ux * c + vx * s, ay = uy * c + vy * s;
	const bx = -ux * s + vx * c, by = -uy * s + vy * c;
	const rotation = Math.atan2(ay, ax);
	// b points 90 degrees one way or the other from a; that decides which way t runs.
	const sign = ax * by - ay * bx >= 0 ? 1 : -1;
	return { cx: f[0], cy: f[1], ux, uy, vx, vy, rx: Math.hypot(ax, ay), ry: Math.hypot(bx, by), rotation, t0, sign };
}

export interface OrbitEllipse {
	cx: number;
	cy: number;
	/** Conjugate half-axes: the point at t is center + u·cos t + v·sin t. */
	ux: number;
	uy: number;
	vx: number;
	vy: number;
	/** The same ellipse as canvas ellipse() wants it: radii and rotation; angle = sign·(t - t0). */
	rx: number;
	ry: number;
	rotation: number;
	t0: number;
	sign: number;
}
