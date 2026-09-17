import { useId } from "react";

import "../../../styles/record-detail.css";
import {
  extractOrderedRecordDiscoveryTags,
  formatPlainLanguageProvenance,
  type GovernedTaxonomyTag,
} from "../lib/taxonomyContext";
import type { ViewState } from "../lib/viewState";
import { AppLink } from "./AppLink";
import { DimensionGlyph } from "./DimensionGlyph";

/** Additional explanation is useful for derived context, not every self-evident tag. */
export function TagExplanations({ tags }: { tags?: GovernedTaxonomyTag[] }) {
  const explanations = extractOrderedRecordDiscoveryTags(tags)
    .filter((tag) => tag.assignment === "derived" || tag.origin_tag_id || tag.provenance === "referenced")
    .map((tag) => ({ id: tag.id, text: formatPlainLanguageProvenance(tag) }))
    .filter((entry) => entry.text);
  if (!explanations.length) return null;
  return (
    <details className="ca-tag-explanations">
      <summary>Why these are shown</summary>
      <ul>{explanations.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>
    </details>
  );
}

/** A shared wrapping tag strip. Dimensions govern behavior without becoming a visible table. */
export function TaxonomyContext(props: {
  tags?: GovernedTaxonomyTag[];
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  showProvenance?: boolean;
  className?: string;
}) {
  const id = useId();
  const tags = extractOrderedRecordDiscoveryTags(props.tags);
  if (!tags.length) return null;
  return (
    <div className={`ca-record-tags${props.className ? ` ${props.className}` : ""}`} data-record-section="taxonomy-context">
      <nav aria-label="Browse by tag" className="record-discovery-tags" data-discovery-tags>
        {tags.map((tag) => {
          const explanation = formatPlainLanguageProvenance(tag);
          const explanationId = `${id}-${tag.id}`;
          return (
            <AppLink
              aria-describedby={explanation ? explanationId : undefined}
              aria-label={`Filter the Library by ${tag.label}`}
              className="record-discovery-tag"
              key={tag.id}
              onNavigate={props.onNavigate}
              patch={{ tags: [tag.id] }}
              view="search"
            >
              <DimensionGlyph decorative dimension={tag.kind} size={16} />
              <span className="record-discovery-tag__label">{tag.label}</span>
              {explanation ? <span className="visually-hidden" id={explanationId}>{explanation}</span> : null}
            </AppLink>
          );
        })}
      </nav>
      {props.showProvenance !== false ? <TagExplanations tags={tags} /> : null}
    </div>
  );
}
