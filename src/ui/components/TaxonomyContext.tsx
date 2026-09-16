import { TAXONOMY_TAG_BY_ID } from "../../shared/taxonomy-contract.mjs";
import {
  formatPlainLanguageProvenance,
  groupTaxonomyByDimension,
  type GovernedTaxonomyTag,
} from "../lib/taxonomyContext";
import type { ViewState } from "../lib/viewState";
import { AppLink } from "./AppLink";
import { AtlasTag } from "./AtlasTag";

export function TaxonomyContext(props: {
  tags?: GovernedTaxonomyTag[];
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  heading?: string;
  description?: string;
  showProvenance?: boolean;
  className?: string;
}) {
  const {
    tags,
    onNavigate,
    heading = "Find more like this",
    description,
    showProvenance = true,
    className,
  } = props;

  const grouped = groupTaxonomyByDimension(tags);
  if (grouped.length === 0) {
    return null;
  }

  // Collect unique tags that carry explanation or provenance
  const seenExplanationIds = new Set<string>();
  const tagsWithProvenance: GovernedTaxonomyTag[] = [];
  for (const group of grouped) {
    for (const tag of group.tags) {
      if (seenExplanationIds.has(tag.id)) continue;
      seenExplanationIds.add(tag.id);
      if (tag.provenance === "publisher" || tag.basis || tag.origin_tag_id) {
        tagsWithProvenance.push(tag);
      }
    }
  }

  return (
    <section
      aria-labelledby="taxonomy-context-heading"
      className={`record-taxonomy-context${className ? ` ${className}` : ""}`}
      data-record-section="taxonomy-context"
    >
      <div className="section-header">
        <div>
          <h2 id="taxonomy-context-heading">{heading}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <dl className="taxonomy-dimension-list">
        {grouped.map((group) => (
          <div className="taxonomy-dimension-row" key={group.dimensionId}>
            <dt className="taxonomy-dimension-label">{group.label}</dt>
            <dd className="taxonomy-dimension-values">
              {group.tags.map((tag) =>
                TAXONOMY_TAG_BY_ID.has(tag.id) ? (
                  <AtlasTag
                    ariaLabel={`Filter the Library by ${tag.label}`}
                    key={tag.id}
                    onNavigate={onNavigate}
                    size="sm"
                    tagId={tag.id}
                  />
                ) : (
                  <AppLink
                    aria-label={`Filter the Library by ${tag.label}`}
                    className="record-taxonomy-link"
                    key={tag.id}
                    onNavigate={onNavigate}
                    patch={{ query: tag.label }}
                    view="search"
                  >
                    <span className="atlas-tag atlas-tag--sm">
                      <span className="atlas-tag__label">{tag.label}</span>
                    </span>
                  </AppLink>
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
      {showProvenance && tagsWithProvenance.length > 0 ? (
        <details className="taxonomy-provenance-disclosure">
          <summary>Why these are shown</summary>
          <ul>
            {tagsWithProvenance.map((tag) => (
              <li key={tag.id}>{formatPlainLanguageProvenance(tag)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
