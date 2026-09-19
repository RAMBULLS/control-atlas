/**
 * Progressive relationship reveal for a focused publication.
 *
 * A hub such as SP 800-53 has many direct routes. Drawing all of them at once produces a
 * fan nobody can read, so the map shows a bounded, deterministic set first and summarizes
 * the rest. The rule is source-neutral: it orders by the number of published connections
 * (then by route key) and never ranks publications by "importance". The complete set is
 * always reachable through `all`, the type choices, or `showAll`.
 */
export type TerritoryRoute = {
  readonly key: string;
  readonly a: string;
  readonly b: string;
  readonly from: string;
  readonly to: string;
  readonly bidirectional: boolean;
  readonly total: number;
  readonly types: readonly string[];
};

export const INITIAL_ROUTE_LIMIT = 4;

export type RouteReveal = {
  /** Every route touching the publication, in deterministic order. Always complete. */
  readonly all: readonly TerritoryRoute[];
  /** Routes matching the chosen relationship types (all of them when none are chosen). */
  readonly matching: readonly TerritoryRoute[];
  /** What the map draws now. */
  readonly visible: readonly TerritoryRoute[];
  readonly hiddenCount: number;
  readonly typeCounts: readonly { readonly type: string; readonly count: number }[];
  readonly expanded: boolean;
};

export const orderRoutes = (routes: readonly TerritoryRoute[]): TerritoryRoute[] =>
  [...routes].sort((x, y) => y.total - x.total || x.key.localeCompare(y.key));

export function revealRoutes(
  routes: readonly TerritoryRoute[],
  options: { readonly limit?: number; readonly types?: readonly string[]; readonly showAll?: boolean } = {},
): RouteReveal {
  const limit = Math.max(1, options.limit ?? INITIAL_ROUTE_LIMIT);
  const chosen = new Set(options.types || []);
  const all = orderRoutes(routes);
  const matching = chosen.size ? all.filter((r) => r.types.some((t) => chosen.has(t))) : all;
  const expanded = !!options.showAll || matching.length <= limit;
  const visible = expanded ? matching : matching.slice(0, limit);
  const counts = new Map<string, number>();
  for (const r of all) for (const t of new Set(r.types)) counts.set(t, (counts.get(t) || 0) + 1);
  const typeCounts = [...counts].map(([type, count]) => ({ type, count })).sort((x, y) => y.count - x.count || x.type.localeCompare(y.type));
  return { all, matching, visible, hiddenCount: matching.length - visible.length, typeCounts, expanded };
}
