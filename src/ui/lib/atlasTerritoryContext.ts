/**
 * Context narrowing for the territory sheet.
 *
 * Tags are recorded on records, not on publications. Choosing a context therefore answers one
 * question: which publications contain records associated with these choices, and how many. It
 * never says a publication carries a tag, that every record in it matches, or that the material
 * applies to the reader, and it never moves a landmark.
 *
 * Matching is the Library's own rule: a record matches when, for every dimension that has a
 * selection, it carries at least one selected tag of that dimension (OR within a dimension, AND
 * across dimensions).
 */
export const CONTEXT_DIMENSIONS = [
  { id: "program", label: "Program" },
  { id: "product", label: "Product" },
  { id: "asset_class", label: "Asset" },
] as const;

export const MAX_CONTEXT_TAGS = 12;

export type ContextTerm = { id: string; label: string; dimension: string; records: number };
/** One row per distinct combination of context tags on records of one publication. */
export type ContextSignature = { p: string; t: string[]; n: number };
export type ContextIndex = {
  dimensions: { id: string; label: string }[];
  terms: ContextTerm[];
  signatures: ContextSignature[];
};

export type ContextMatch = { records: number; byTag: Record<string, number> };
export type ContextResult = {
  active: boolean;
  /** Matching records across every publication. */
  total: number;
  publications: Map<string, ContextMatch>;
  /** True when a context is chosen and no record matches it. */
  empty: boolean;
};

const TAG_ID = /^[a-z_]+\.[a-z0-9._-]{1,60}$/;

/** Bounded, de-duplicated tag ids from a URL value. Unknown ids are dropped when a term list is supplied. */
export function normalizeContextIds(value: unknown, known?: ReadonlySet<string>): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const ids = raw.map((v) => String(v).trim()).filter((v) => TAG_ID.test(v) && (!known || known.has(v)));
  return [...new Set(ids)].slice(0, MAX_CONTEXT_TAGS);
}

export function termDimensions(index: ContextIndex): Map<string, string> {
  return new Map(index.terms.map((t) => [t.id, t.dimension]));
}

/** Selected ids grouped by dimension, in the shape the Library filter uses. */
export function contextGroups(selected: readonly string[], dimensionOf: ReadonlyMap<string, string>): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of selected) {
    const dimension = dimensionOf.get(id);
    if (dimension) groups.set(dimension, [...(groups.get(dimension) || []), id]);
  }
  return [...groups.values()];
}

export function evaluateContext(index: ContextIndex, selected: readonly string[]): ContextResult {
  const dimensionOf = termDimensions(index);
  const chosen = selected.filter((id) => dimensionOf.has(id));
  const publications = new Map<string, ContextMatch>();
  if (!chosen.length) return { active: false, total: 0, publications, empty: false };
  const groups = contextGroups(chosen, dimensionOf);
  let total = 0;
  for (const sig of index.signatures) {
    const tags = new Set(sig.t);
    if (!groups.every((alternatives) => alternatives.some((id) => tags.has(id)))) continue;
    const entry = publications.get(sig.p) || { records: 0, byTag: {} };
    entry.records += sig.n;
    for (const id of chosen) if (tags.has(id)) entry.byTag[id] = (entry.byTag[id] || 0) + sig.n;
    publications.set(sig.p, entry);
    total += sig.n;
  }
  return { active: true, total, publications, empty: total === 0 };
}

/** Selected tags in a stable, readable order: dimension order, then label. */
export function orderedSelection(index: ContextIndex, selected: readonly string[]): ContextTerm[] {
  const order = new Map(index.dimensions.map((d, i) => [d.id, i]));
  return index.terms.filter((t) => selected.includes(t.id))
    .sort((a, b) => (order.get(a.dimension) ?? 99) - (order.get(b.dimension) ?? 99) || a.label.localeCompare(b.label));
}

/** Toggle one tag; returns the new selection (bounded). */
export function toggleContext(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id].slice(0, MAX_CONTEXT_TAGS);
}
