import { Fragment, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import {
  missingRequiredRecordFields,
  PAGE_ROLES,
  RELATIONSHIP_TREATMENTS,
  recordPresentationContract,
  relationshipTreatmentFor,
} from "../../shared/record-presentation.mjs";
import authoritySpine from "../../../data/curated/authority-spine.json";
import { AcronymText } from "../components/AccessibleTerm";
import { AppLink } from "../components/AppLink";
import { CanonicalBreadcrumb } from "../components/CanonicalBreadcrumb";
import { Button, ButtonLink } from "../components/lsm";
import {
  publishedSectionsWithContent,
  RecordNativeFacts,
  RecordPublishedText,
} from "../components/RecordPublishedText";
import { TaxonomyContext } from "../components/TaxonomyContext";
import { catalogDisplayNameFor, catalogProfileFor } from "../lib/catalogProfiles";
import {
  buildAtlasTreeModel,
  extendDisplayedAuthorityTrace,
  type AtlasTraceHop,
} from "../lib/atlasTreeModel";
import { serializeHashUrl } from "../lib/hashRoutes";
import {
  officialSourceActionLabel,
  officialSourceFor,
} from "../lib/officialSource";
import {
  Badge,
  copyText,
  formatRelationshipLabel,
} from "../lib/pagePrimitives";
import {
  buildRecordConnectionGroups,
  humanReadableEvidenceLocator,
  recordIdentityPresentationFor,
  recordDisplayTitle,
  recordPublisherName,
} from "../lib/recordTitle";
import { extractGovernedRecordTaxonomy } from "../lib/taxonomyContext";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { runtimeRecordIdentityFor } from "../lib/runtimeRecordIdentity";
import { normalizeViewState, type ViewState } from "../lib/viewState";
import {
  sourceFreshnessPresentation,
  sourceLifecycleDisplayName,
  sourcePublicationTitle,
} from "../lib/sourcePresentation";

/**
 * Lower-case a record-kind label only when it is an ordinary noun phrase.
 * "Control family" becomes "control family"; "CSF category", "RMF step", and
 * "Zero Trust pillar" keep the casing their publishers use.
 */
function sentenceCaseKind(kind: string): string {
  return /[A-Z]/.test(kind.slice(1)) ? kind : kind.toLocaleLowerCase();
}

/**
 * A record id that resolves to nothing. The page used to advise "try another
 * identifier" while offering no field to try one in, which is a dead end at
 * exactly the moment the reader most likely arrived from outside the product -
 * a stale bookmark or a shared link. The search index is already in memory, so
 * the recovery is a search box seeded with what they asked for.
 */
function RecordNotFound(props: {
  attemptedId: string;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const attempted = String(props.attemptedId || "");
  // Records are keyed "<catalog>:<item>"; the reader typed or followed the
  // item, so search for that rather than the internal composite key.
  const seed = attempted.includes(":") ? attempted.split(":").slice(1).join(":") : attempted;
  const [query, setQuery] = useState(seed);
  return (
    <section className="notice">
      <h1>Record not found</h1>
      <p>
        {seed
          ? `Nothing in the Library matches "${seed}". Search for it, or browse from the Library.`
          : "Search for another identifier or keyword, or browse from the Library."}
      </p>
      <form
        className="record-not-found-search"
        onSubmit={(event) => {
          event.preventDefault();
          props.onNavigate("search", { query: query.trim() });
        }}
        role="search"
      >
        <label htmlFor="record-not-found-query">Search Control Atlas</label>
        <input
          id="record-not-found-query"
          name="q"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
      <AppLink onNavigate={props.onNavigate} variant="secondary" view="search">
        Browse the Library
      </AppLink>
    </section>
  );
}

export function ObjectDetailPage(props: {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "library-detail" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenGlossary: (termId?: string) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { bundle, state, onNavigate } = props;
  const node = bundle.runtime.getNode(state.node);
  const document = bundle.runtime.getLibraryDocument(state.node);
  // Show at most this many representative items per connection group.
  // Complete exploration is available via the Atlas link below.
  const RECORD_GROUP_SAMPLE = 5;

  if (!node || !document) {
    return <RecordNotFound attemptedId={state.node} onNavigate={onNavigate} />;
  }

  const source = bundle.runtime.getSource(document.source_id || node.source_id);
  const catalogs = bundle.catalogSummaries?.length
    ? bundle.catalogSummaries
    : bundle.runtime.getCatalogs();
  const catalog = catalogs.find((entry: any) => entry.id === document.catalog_id);
  const catalogName = catalogDisplayNameFor(
    document.catalog_id,
    catalog?.name || document.catalog_name || "",
  );
  const catalogProfile = catalogProfileFor(document.catalog_id, catalogName);
  const area = catalogProfile.area;
  const family = document.control_family || node.metadata?.family || "";
  const itemId = node.metadata?.item_id || document.item_id || node.label || "";
  const objectType = document.object_type || node.node_type || "";
  const publisherName = recordPublisherName(
    document.publisher_name,
    source?.owner,
    source?.publisher,
    catalog?.display_group,
  );
  const sourcePublicationName = sourcePublicationTitle(source, catalogName);
  const sourceFreshness = sourceFreshnessPresentation(source);
  const identityPresentation = recordIdentityPresentationFor({
    publisher: publisherName,
    catalogId: document.catalog_id,
    publicationName: catalogName,
    family,
    itemId,
    title: node.metadata?.title || document.title || "",
    objectType,
    metadata: node.metadata,
  });
  const recordIdentity = identityPresentation.primary;
  const publishedName = identityPresentation.secondary;
  const kind = displayNameFor("object_type", objectType);
  const officialSource = officialSourceFor(source);
  const claimOrigin = node.metadata?.origin || "publisher_normalized";
  const sourceIdentityLabel = claimOrigin === "atlas_editorial"
    ? "Control Atlas context"
    : claimOrigin === "publisher_derived"
      ? "Publisher-derived projection"
      : "Publisher source";
  const lifecycleStatus = String(node.lifecycle_status || "active");
  const edges = bundle.runtime.getEdgesForNode(node.id, {
    publication_status: "published",
  });
  const connectionGroups = buildRecordConnectionGroups(
    node.id,
    document.catalog_id,
    edges,
    bundle.runtime.getNode,
    (catalogId) => {
      const relatedCatalog = catalogs.find((entry: any) => entry.id === catalogId);
      return catalogDisplayNameFor(catalogId, relatedCatalog?.name || "");
    },
  );
  let immediateConnectionsRemaining = 12;
  const immediateConnectionGroups = connectionGroups.flatMap((group) => {
    if (immediateConnectionsRemaining <= 0) return [];
    const items = group.items.slice(0, immediateConnectionsRemaining);
    immediateConnectionsRemaining -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
  // Non-CCI records: use all groups but sample items in render via RECORD_GROUP_SAMPLE.
  const relatedConnectionGroups = document.catalog_id === "disa-cci"
    ? immediateConnectionGroups
    : connectionGroups;
  const displayPath = (node.display_path || []) as Array<{
    id: string;
    label: string;
    node_type: string;
    origin: "authority" | "organizing" | "structural";
  }>;
  const displayedTrace = bundle.atlasSpine
    ? extendDisplayedAuthorityTrace(
        buildAtlasTreeModel(bundle.atlasSpine, authoritySpine),
        [...displayPath, {
          id: node.id,
          label: recordIdentity,
          node_type: node.node_type || document.object_type,
          origin: "structural",
        }] as AtlasTraceHop[],
      )
    : [...displayPath, {
        id: node.id,
      label: recordIdentity,
        node_type: node.node_type || document.object_type,
        origin: "structural" as const,
      }];
  const sourceMetadata = {
    ...node.metadata,
    description: document.description || node.metadata?.description || "",
  };
  const presentation = recordPresentationContract(document.catalog_id, node.node_type || document.object_type);
  const missingSourceFields = missingRequiredRecordFields(presentation, sourceMetadata);
  const hasPublishedSectionContent = publishedSectionsWithContent(
    presentation.sections,
    sourceMetadata,
  ).length > 0;
  const structuralChildren = edges
    .filter((edge: any) => edge.relationship_class === "structural" && edge.source_node_id === node.id)
    .map((edge: any) => bundle.runtime.getNode(edge.target_node_id))
    .filter(Boolean);
  const structuralTrace = displayedTrace.filter((entry) => entry.origin === "structural");
  const governedConnectionGroups = relatedConnectionGroups.map((group) => {
    const firstCounterpart = group.items[0] ? bundle.runtime.getNode(group.items[0].nodeId) : null;
    const counterpartCatalogId = firstCounterpart?.metadata?.catalog_id || group.catalogId;
    const counterpartType = firstCounterpart?.node_type || "catalog";
    const counterpartContract = recordPresentationContract(counterpartCatalogId, counterpartType);
    return {
      ...group,
      treatment: relationshipTreatmentFor({
        recordContract: presentation,
        counterpartContract,
        recordCatalogId: document.catalog_id,
        counterpartCatalogId,
        relationshipType: group.relationshipType,
        relationshipClass: "correlation",
      }),
    };
  });
  const visibleConnectionGroups = governedConnectionGroups.filter(
    (group) => group.treatment !== RELATIONSHIP_TREATMENTS.ATLAS_ONLY,
  );
  const visibleConnectionCount = visibleConnectionGroups.reduce((total, group) => total + group.items.length, 0);
  const governedTaxonomyTags = extractGovernedRecordTaxonomy({
    catalogId: document.catalog_id,
    nodeTaxonomyTags: node.metadata?.taxonomy_tags,
    metadata: node.metadata,
    family,
    relatedCategories: node.metadata?.related_categories,
  });

  return (
    <section className="detail-page record-template" data-page-role={presentation.page_role} data-template="E">
      <CanonicalBreadcrumb bundle={bundle} nodeId={node.id} recordLabel={recordIdentity} />

      <header
        className={`record-title-block${identityPresentation.stableIdIsGenerated ? " record-title-block--generated" : ""}`}
        data-route-primary-header="true"
        data-route-primary-copy="true"
      >
        <h1><AcronymText>{recordIdentity}</AcronymText></h1>
        {publishedName ? (
          <p className="record-official-name"><AcronymText>{publishedName}</AcronymText></p>
        ) : null}
        {identityPresentation.stableIdIsGenerated ? (
          <p className="record-identity-context">
            <AcronymText>{identityPresentation.context}</AcronymText>
          </p>
        ) : null}
        {lifecycleStatus !== "active" ? (
          <p className="record-identity-context" data-record-lifecycle={lifecycleStatus}>
            <Badge tone="warning">{displayNameFor("lifecycle_status", lifecycleStatus)}</Badge>
          </p>
        ) : null}
        <div className="record-title-actions" data-route-primary-support="true">
          {officialSource.url ? (
            <ButtonLink
              href={officialSource.url}
              rel="noopener noreferrer"
              target="_blank"
              variant="primary"
            >
              {claimOrigin === "atlas_editorial"
                ? "View Atlas source"
                : officialSourceActionLabel(officialSource)}
            </ButtonLink>
          ) : null}
          <AppLink
            onNavigate={onNavigate}
            patch={{ node: node.id }}
            variant="secondary"
            view="atlas-map"
          >
            See connections
          </AppLink>
          <details
            className="record-actions-menu"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
            }}
          >
            <summary>More actions</summary>
            <div className="record-actions-popover">
              <AppLink
                onNavigate={onNavigate}
                patch={{ crosswalk: "relationships", intent: "item-mapping", items: document.item_id, source: document.catalog_id }}
                variant="secondary"
                view="matrix"
              >
                Compare frameworks
              </AppLink>
              <AppLink
                onNavigate={onNavigate}
                patch={{ framework: document.catalog_id }}
                variant="secondary"
                view="templates"
              >
                Choose a template
              </AppLink>
              <Button
                onClick={() => {
                  void copyText(
                    `${window.location.origin}${window.location.pathname}${serializeHashUrl(
                      normalizeViewState("library-detail", {
                        view: "library-detail",
                        node: document.id,
                      }),
                    )}`,
                  );
                }}
                type="button"
                variant="secondary"
              >
                Copy link
              </Button>
            </div>
          </details>
        </div>
      </header>

      <div className="record-template-grid">
        <article className="record-template-main">
          {document.catalog_id === "disa-cci" ? (
            <section className="record-context-note" aria-labelledby="cci-context-heading">
              <h2 id="cci-context-heading">Start here</h2>
              <p>
                CCI records deliberately publish a concise requirement, not an
                implementation procedure. Read the official requirement below,
                then use its evidence-backed related records to find the
                applicable STIG, SRG, or control material.
              </p>
              <div className="card-actions">
                <AppLink onNavigate={onNavigate} patch={{ node: node.id }} variant="secondary" view="atlas-map">
                  Explore connections
                </AppLink>
                <AppLink
                  onNavigate={onNavigate}
                  patch={{ crosswalk: "relationships", intent: "item-mapping", items: document.item_id, source: document.catalog_id }}
                  variant="secondary"
                  view="matrix"
                >
                  Compare this CCI
                </AppLink>
              </div>
            </section>
          ) : null}
          {["stig_rule", "srg_requirement"].includes(presentation.record_type) ? (
            <RecordNativeFacts fields={presentation.metadata_facts} metadata={sourceMetadata} title="Overview" />
          ) : null}
          {source ? (
            <p className="support-meta" data-record-source-identity>
              {sourceIdentityLabel} · {sourcePublicationName}
            </p>
          ) : null}
          {!source ? (
            <section className="notice" data-record-source-error role="alert">
              <h2>Source identity unavailable</h2>
              <p>Can't confirm which publisher this came from, so it isn't shown as official yet.</p>
            </section>
          ) : missingSourceFields.length ? (
            <section className="notice" data-record-source-error role="alert">
              <h2>Unable to load published text</h2>
              <p>The published text for this record did not load.</p>
            </section>
          ) : (
            <RecordPublishedText
              claimOrigin={claimOrigin}
              metadata={sourceMetadata}
              sections={presentation.sections}
            />
          )}
          {!missingSourceFields.length && !hasPublishedSectionContent ? (
            <section className="record-source-absence" data-record-section="publisher-absence">
              <h2>Publisher description</h2>
              <p>The publisher did not publish a separate description for this {sentenceCaseKind(kind)}.</p>
            </section>
          ) : null}
          {presentation.metadata_facts.length && !["stig_rule", "srg_requirement"].includes(presentation.record_type) ? (
            <RecordNativeFacts fields={presentation.metadata_facts} metadata={sourceMetadata} title="Published facts" />
          ) : null}
          {structuralTrace.length > 1 ? (
            <section className="record-hierarchy" data-record-section="publisher-hierarchy">
              <h2>Publisher hierarchy</h2>
              <ol>
                {structuralTrace.map((entry) => <li key={entry.id}>{entry.label}</li>)}
              </ol>
            </section>
          ) : null}
          {presentation.page_role === PAGE_ROLES.CONTAINER ? (
            <section className="record-child-inventory" data-record-section="child-inventory">
              <div className="section-header">
                <div>
                  <h2>Contained records</h2>
                  <p>Objects published directly beneath this record.</p>
                </div>
                <Badge tone="info">{structuralChildren.length || sourceMetadata.child_count || 0}</Badge>
              </div>
              {structuralChildren.length ? (
                <ul>
                  {structuralChildren.slice(0, 25).map((child: any) => {
                    // CSF publishes the identifier as the subcategory title, so
                    // "PR.AA-01 — PR.AA-01" is the same fact printed twice.
                    return (
                      <li key={child.id}>
                        <AppLink onNavigate={onNavigate} patch={{ node: child.id }} view="library-detail">
                          {recordDisplayTitle(child)}
                        </AppLink>
                      </li>
                    );
                  })}
                </ul>
              ) : <p>No directly contained records are loaded for this publication object.</p>}
            </section>
          ) : null}
          {visibleConnectionGroups.length > 0 ? (
            <section className="record-connections record-connections--related" data-record-section="related-records">
              <div className="section-header">
                <div>
                  <h2>Related records</h2>
                  <p>Formal published links to other publications.</p>
                </div>
                <Badge tone="info">{visibleConnectionCount}</Badge>
              </div>
              <div className="record-connection-groups">
                {visibleConnectionGroups.map((group) => {
                  const sampleLimit = group.treatment === RELATIONSHIP_TREATMENTS.SUMMARIZE ? 3 : RECORD_GROUP_SAMPLE;
                  const sample = document.catalog_id !== "disa-cci"
                    ? group.items.slice(0, sampleLimit)
                    : group.items;
                  const overflow = group.items.length - sample.length;
                  const content = (
                    <section data-relationship-treatment={group.treatment} key={`${group.catalogId}:${group.relationshipType}`}>
                      <h3>{group.label} · {displayNameFor("relationship_type", group.relationshipType)} · {group.items.length}</h3>
                      <ul>
                        {sample.map((item) => {
                          const relatedIdentity = runtimeRecordIdentityFor(bundle, item.nodeId);
                          const sourceEvidence = item.sourceRefs.map((reference) => {
                            const sourceRecord = reference.sourceId
                              ? bundle.runtime.getSource(reference.sourceId)
                              : null;
                            return {
                              evidenceQuality: reference.evidenceQuality
                                ? displayNameFor("evidence_quality", reference.evidenceQuality)
                                : "",
                              locator: humanReadableEvidenceLocator(reference.locator),
                              source: (
                                reference.sourceName ||
                                sourceRecord?.display_name ||
                                sourceRecord?.name ||
                                ""
                              ),
                              version: reference.sourceVersion || sourceRecord?.version || "",
                            };
                          }).filter((reference) => reference.source);
                          const sourceNames = [...new Set(sourceEvidence.map((reference) => reference.source))];
                          return (
                            <li data-record-connection-id={item.edgeId} key={item.edgeId}>
                              <AppLink
                                aria-label={relatedIdentity.stableIdIsGenerated ? `Open ${relatedIdentity.accessibleName}` : undefined}
                                onNavigate={onNavigate}
                                patch={{ node: item.nodeId }}
                                view="library-detail"
                              >
                                <strong>{relatedIdentity.stableIdIsGenerated ? relatedIdentity.primary : item.itemId}</strong>
                                {relatedIdentity.stableIdIsGenerated && relatedIdentity.context
                                  ? ` — ${relatedIdentity.context}`
                                  : item.title !== item.itemId
                                    ? ` — ${item.title}`
                                    : ""}
                              </AppLink>
                              <span className="relationship-meta">
                                <strong>Published connection</strong>
                                {` · ${formatRelationshipLabel({ relationship_type: item.relationshipType })}`}
                              </span>
                              {sourceNames.length ? <span className="relationship-citation">
                                <strong>Source</strong>
                                {` · ${sourceNames.join(" · ")}`}
                              </span> : null}
                              <details className="mapping-row-details relationship-source-evidence">
                                <summary aria-label={`Source evidence for ${relatedIdentity.primary}`}>Source evidence</summary>
                                <dl className="relationship-source-facts">
                                  <div>
                                    <dt>How the connection was established</dt>
                                    <dd>{displayNameFor("provenance_class", item.provenanceClass)}</dd>
                                  </div>
                                  {sourceEvidence.map((reference, referenceIndex) => (
                                    <Fragment key={`${item.edgeId}:${reference.source}:${referenceIndex}`}>
                                      <div>
                                        <dt>Source record</dt>
                                        <dd>{reference.source}</dd>
                                      </div>
                                      {reference.version ? (
                                        <div>
                                          <dt>Source version</dt>
                                          <dd>{reference.version}</dd>
                                        </div>
                                      ) : null}
                                      {reference.locator ? (
                                        <div>
                                          <dt>Locator</dt>
                                          <dd>{reference.locator}</dd>
                                        </div>
                                      ) : null}
                                      {reference.evidenceQuality ? (
                                        <div>
                                          <dt>Evidence quality</dt>
                                          <dd>{reference.evidenceQuality}</dd>
                                        </div>
                                      ) : null}
                                    </Fragment>
                                  ))}
                                </dl>
                              </details>
                            </li>
                          );
                        })}
                      </ul>
                      {overflow > 0 ? (
                        <AppLink
                          className="record-connections-overflow"
                          onNavigate={onNavigate}
                          patch={{ node: node.id }}
                          view="atlas-map"
                        >
                          +{overflow} more — Explore in Atlas
                        </AppLink>
                      ) : null}
                    </section>
                  );
                  return group.treatment === RELATIONSHIP_TREATMENTS.COLLAPSE ? (
                    <details className="record-relationship-disclosure" key={`${group.catalogId}:${group.relationshipType}`}>
                      <summary>{group.label} · {group.items.length}</summary>
                      {content}
                    </details>
                  ) : content;
                })}
              </div>
              {governedConnectionGroups.some((group) => group.treatment === RELATIONSHIP_TREATMENTS.ATLAS_ONLY) ? (
                <p className="support-meta">Additional valid connections are available in Atlas.</p>
              ) : null}
              <AppLink className="record-connections-explore" onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">
                Explore all connections in Atlas
              </AppLink>
            </section>
          ) : null}
        </article>

        <aside
          className="record-template-sidebar"
          data-displayed-trace={displayedTrace.map((entry) => entry.id).join(">")}
        >
          <TaxonomyContext
            onNavigate={onNavigate}
            tags={governedTaxonomyTags}
          />
          <section>
            <h2>About This Record</h2>
            <dl className="record-source-facts">
              <div>
                <dt>Record type</dt>
                <dd>{kind}</dd>
              </div>
              {node.metadata?.benchmark_title ? (
                <div>
                  <dt>Benchmark</dt>
                  <dd>{node.metadata.benchmark_title}</dd>
                </div>
              ) : null}
              {publisherName ? (
                <div>
                  <dt>Publisher</dt>
                  <dd>{publisherName}</dd>
                </div>
              ) : null}
              <div>
                <dt>Publication</dt>
                <dd>{sourcePublicationName}{source?.version ? ` · ${source.version}` : ""}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{sourceLifecycleDisplayName(source?.lifecycle_status)}</dd>
              </div>
              <div>
                <dt>{sourceFreshness.label}</dt>
                <dd>{sourceFreshness.dateTime ? (
                  <time dateTime={sourceFreshness.dateTime}>{sourceFreshness.value}</time>
                ) : sourceFreshness.value}</dd>
              </div>
            </dl>
            <AppLink
              onNavigate={onNavigate}
              patch={{ source: source?.id || "" }}
              view="sources"
            >
              View source details
            </AppLink>
          </section>
        </aside>

      </div>

    </section>
  );
}
