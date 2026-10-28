// Small color and math helpers shared by the planet code.

export type RGB = [number, number, number];

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const smoothstep = (a: number, b: number, v: number) => {
	const t = clamp01((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/** fbm values bunch up around 0.5; this spreads them back out. */
export const stretch = (v: number, k: number) => clamp01((v - 0.5) * k + 0.5);

/** 1 on the center line of a noise field, falling off to 0: makes crack and river lines. */
export const ridge = (v: number) => 1 - Math.abs(v - 0.5) * 2;

export function hexToRgb(hex: string): RGB {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** HSL (hue in degrees, saturation and lightness 0..1) to a hex string. */
export function hsl(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = clamp01(s);
	l = clamp01(l);
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(c * 255).toString(16).padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

/** One color stop of a recipe: hue shift, saturation, lightness. */
export type Stop = [number, number, number];

/** Applies a color recipe to a base hue, giving a ramp that keeps the recipe's contrast. */
export function recipe(hue: number, stops: Stop[], satScale = 1): string[] {
	return stops.map(([dh, s, l]) => hsl(hue + dh, s * satScale, l));
}

export function ramp(colors: RGB[], t: number, out: RGB): RGB {
	const pos = clamp01(t) * (colors.length - 1);
	const i = Math.min(Math.floor(pos), colors.length - 2);
	const f = pos - i;
	const a = colors[i], b = colors[i + 1] ?? a;
	out[0] = a[0] + (b[0] - a[0]) * f;
	out[1] = a[1] + (b[1] - a[1]) * f;
	out[2] = a[2] + (b[2] - a[2]) * f;
	return out;
}

export function mix(out: RGB, c: RGB, t: number) {
	out[0] += (c[0] - out[0]) * t;
	out[1] += (c[1] - out[1]) * t;
	out[2] += (c[2] - out[2]) * t;
}

export function scale(out: RGB, f: number) {
	out[0] *= f;
	out[1] *= f;
	out[2] *= f;
}

/** Rotates a color's hue in place (standard luminance-preserving matrix). */
export function hueRotate(c: RGB, degrees: number) {
	const a = (degrees * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
	const [r, g, b] = c;
	c[0] = r * (0.213 + cos * 0.787 - sin * 0.213) + g * (0.715 - cos * 0.715 - sin * 0.715) + b * (0.072 - cos * 0.072 + sin * 0.928);
	c[1] = r * (0.213 - cos * 0.213 + sin * 0.143) + g * (0.715 + cos * 0.285 + sin * 0.14) + b * (0.072 - cos * 0.072 - sin * 0.283);
	c[2] = r * (0.213 - cos * 0.213 - sin * 0.787) + g * (0.715 - cos * 0.715 + sin * 0.715) + b * (0.072 + cos * 0.928 + sin * 0.072);
}
