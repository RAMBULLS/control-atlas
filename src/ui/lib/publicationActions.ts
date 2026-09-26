import templateRegistry from "../../../data/template-registry.json" with { type: "json" };
import { JOURNEYS } from "./atlasJourneys";
import { officialSourceActionLabel, OFFICIAL_PUBLICATION_VERBS } from "./officialSource";
import { practitionerNameForCatalog, type PublicationTrust } from "./publicationIdentity";

/** Structural containers a publication page browses into rather than lists as records. */
export const PUBLICATION_NON_LEAF_NODE_TYPES: ReadonlySet<string> = new Set([
  "catalog",
  "family",
  "benchmark",
  "function",
  "category",
  "tactic",
  "group",
]);

/** A label used mid-sentence: "Controls" reads "controls", but "STIG rules" keeps its acronym. */
export function inlineLabel(label: string): string {
  const first = label.split(/\s+/)[0] || "";
  if (/[A-Z].*[A-Z]/.test(first) || /\d/.test(first)) return label;
  return label.charAt(0).toLocaleLowerCase() + label.slice(1);
}

export type PublicationNextAction =
  | { kind: "browse"; label: string }
  | { kind: "official"; label: string; url: string }
  | { kind: "atlas"; label: string; catalogId: string }
  | { kind: "sources"; label: string; sourceId: string }
  | { kind: "compare"; label: string; target: string; via: string }
  | { kind: "journey"; label: string; journeyId: string }
  | { kind: "template"; label: string; templateName: string };

/**
 * The next-action contract for a publication page. Each action exists only
 * where governed data supports it: Compare only for a pair with a published
 * crosswalk, a template only where its registry entry cites this exact
 * publication, a journey only where Atlas lists the publication in it.
 */
export function publicationNextActions(input: {
  trust: PublicationTrust;
  recordLabel: string;
  recordCount: number;
  mappingSources: Record<string, Array<{ value: string; label: string }>>;
}): PublicationNextAction[] {
  const { trust } = input;
  const catalogId = trust.catalogId || "";
  const actions: PublicationNextAction[] = [];
  if (input.recordCount > 0) actions.push({ kind: "browse", label: `Browse ${input.recordCount.toLocaleString()} ${inlineLabel(input.recordLabel)}` });
  if (trust.official.url) actions.push({ kind: "official", label: officialSourceActionLabel(trust.official, OFFICIAL_PUBLICATION_VERBS), url: trust.official.url });
  if (catalogId) actions.push({ kind: "atlas", label: "See it on the Atlas", catalogId });
  if (trust.sourceId) actions.push({ kind: "sources", label: "Source details", sourceId: trust.sourceId });
  for (const [key, via] of Object.entries(input.mappingSources || {})) {
    const [from, to] = key.split("|");
    if (from !== catalogId || !to || !via?.length) continue;
    actions.push({ kind: "compare", label: `Compare with ${practitionerNameForCatalog(to)}`, target: to, via: via.map((entry) => entry.label).join(", ") });
  }
  for (const journey of JOURNEYS) {
    if (journey.publications.some((entry) => entry.id === catalogId)) {
      actions.push({ kind: "journey", label: journey.label, journeyId: journey.id });
    }
  }
  for (const template of templateRegistry.templates) {
    if (trust.sourceId && template.source_refs.includes(trust.sourceId)) {
      actions.push({ kind: "template", label: template.display_name, templateName: template.name });
    }
  }
  return actions;
}
