import type { Pt } from "./atlasTerritoryGeography";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Routed = { d: string; pts: Pt[]; mid: Pt; hits: number };

const inRect = (p: Pt, r: Rect, pad = 3) => p[0] > r.x0 - pad && p[0] < r.x1 + pad && p[1] > r.y0 - pad && p[1] < r.y1 + pad;
function samples(pts: readonly Pt[], step = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [a, b] = [pts[i], pts[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
export const hitsRects = (pts: readonly Pt[], rects: readonly Rect[]) => samples(pts).filter((p) => rects.some((r) => inRect(p, r))).length;
export const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Every octilinear way to join a to b with at most one bend. */
export function octilinearVariants(a: Pt, b: Pt): Pt[][] {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const ax = Math.abs(dx); const ay = Math.abs(dy); const d = Math.min(ax, ay);
  const sx = Math.sign(dx); const sy = Math.sign(dy);
  if (ax === 0 || ay === 0 || ax === ay) return [[a, b]];
  return [[a, [b[0] - sx * d, b[1] - sy * d], b], [a, [a[0] + sx * d, a[1] + sy * d], b]];
}

const move = (from: Pt, to: Pt, by: number): Pt => {
  const dx = to[0] - from[0]; const dy = to[1] - from[1]; const l = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / l) * by, from[1] + (dy / l) * by];
};
function trim(pts: readonly Pt[], startClear: number, endClear: number): Pt[] {
  const out = pts.map((p) => [...p] as Pt);
  out[0] = move(pts[0], pts[1], startClear);
  const n = pts.length - 1;
  out[n] = move(pts[n], pts[n - 1], endClear);
  return out;
}
const round1 = (v: number) => Math.round(v * 10) / 10;

export function roundedPath(pts: readonly Pt[], radius: number): string {
  if (pts.length < 3) return `M${pts.map((p) => p.map(round1).join(" ")).join("L")}`;
  let d = `M${round1(pts[0][0])} ${round1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [p0, p1, p2] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const a: Pt = [p1[0] - ((p1[0] - p0[0]) / l1) * r, p1[1] - ((p1[1] - p0[1]) / l1) * r];
    const b: Pt = [p1[0] + ((p2[0] - p1[0]) / l2) * r, p1[1] + ((p2[1] - p1[1]) / l2) * r];
    d += `L${round1(a[0])} ${round1(a[1])}Q${round1(p1[0])} ${round1(p1[1])} ${round1(b[0])} ${round1(b[1])}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${round1(last[0])} ${round1(last[1])}`;
}

const len = (pts: readonly Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** Direct variants first, then variants that step away from either marker before turning. */
function candidates(a: Pt, b: Pt): Pt[][] {
  const out = [...octilinearVariants(a, b)];
  const sx = Math.sign(b[0] - a[0]) || 1; const sy = Math.sign(b[1] - a[1]) || 1;
  for (const k of [46, 92, 150]) {
    for (const step of [[sx * k, 0], [0, sy * k], [sx * k, sy * k], [-sx * k, 0], [0, -sy * k]] as Pt[]) {
      const w: Pt = [a[0] + step[0], a[1] + step[1]];
      for (const v of octilinearVariants(w, b)) out.push([a, ...v]);
      const w2: Pt = [b[0] - step[0], b[1] - step[1]];
      for (const v of octilinearVariants(a, w2)) out.push([...v, b]);
    }
  }
  return out;
}

/**
 * Join two landmarks with a transit-style route: octilinear segments, the variant that crosses
 * the fewest label rectangles (then the shortest), trimmed to clear both markers, with rounded
 * corners. A route is drawn only for a published connection; this function never invents one.
 */
export function routeBetween(a: Pt, b: Pt, avoid: readonly Rect[], clear: number, radius: number): Routed {
  let best: { pts: Pt[]; hits: number; length: number } | null = null;
  for (const v of candidates(a, b)) {
    const t = trim(v, clear, clear);
    const hits = hitsRects(t, avoid);
    const length = len(t);
    if (!best || hits < best.hits || (hits === best.hits && length < best.length)) best = { pts: t, hits, length };
  }
  const pts = best!.pts;
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = lens.reduce((s, l) => s + l, 0) / 2; let mid: Pt = pts[0];
  for (let i = 0; i < lens.length; i += 1) {
    if (half <= lens[i]) { const t = half / lens[i]; mid = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; break; }
    half -= lens[i];
  }
  return { d: roundedPath(pts, radius), pts, mid, hits: best!.hits };
}
