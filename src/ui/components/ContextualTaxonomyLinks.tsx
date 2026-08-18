import { useMemo } from "react";

import { TAXONOMY_TAG_BY_ID } from "../../shared/taxonomy-contract.mjs";
import { AppLink } from "./AppLink";

import type { ViewState } from "../lib/viewState";

type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;

export function TaxonomyTagLinks(props: {
  onNavigate: Navigate;
  tagIds: string[];
}) {
  const tags = [...new Set(props.tagIds)]
    .map((id) => TAXONOMY_TAG_BY_ID.get(id))
    .filter(Boolean);
  if (!tags.length) return null;
  return (
    <div className="ca-contextual-tag-links">
      {tags.map((tag) => (
        <AppLink key={tag.id} onNavigate={props.onNavigate} patch={{ tags: [tag.id] }} view="search">
          {tag.label}
        </AppLink>
      ))}
    </div>
  );
}

export function ContextualTaxonomyLinks(props: {
  catalogIds: string[];
  contextLabel: string;
  onNavigate: Navigate;
  runtime: any;
  subjectLabel: string;
}) {
  const catalogKey = props.catalogIds.join("\u0000");
  const tagIds = useMemo(() => {
    if (!catalogKey || !props.runtime?.getLibraryTagContext) return [];
    const context = props.runtime.getLibraryTagContext("", { catalog_ids: catalogKey.split("\u0000") });
    return Object.entries(context.tags || {})
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([id]) => id);
  }, [catalogKey, props.runtime]);
  if (!tagIds.length) return null;
  return (
    <section className="ca-contextual-taxonomy" aria-label={`Related topics for ${props.contextLabel}`}>
      <h3>Related topics</h3>
      <p>
        These tags summarize reviewed structured fields on records in the referenced publication.
        They help search the Library; they do not classify this {props.subjectLabel}.
      </p>
      <TaxonomyTagLinks onNavigate={props.onNavigate} tagIds={tagIds} />
    </section>
  );
}
