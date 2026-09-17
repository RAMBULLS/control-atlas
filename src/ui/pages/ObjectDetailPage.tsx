import { Fragment, useEffect, useRef, useState } from "react";
import { IconBolt, IconBook2, IconCompass, IconExternalLink, IconInfoCircle } from "@tabler/icons-react";

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
import { publishedSectionsWithContent, RecordNativeFacts, RecordPublishedText } from "../components/RecordPublishedText";
import { RecordJumpButton, RecordRailSection, RecordSectionNavigation } from "../components/RecordDetailSupport";
import { TagExplanations, TaxonomyContext } from "../components/TaxonomyContext";
import { catalogDisplayNameFor, catalogProfileFor } from "../lib/catalogProfiles";
import { buildAtlasTreeModel, extendDisplayedAuthorityTrace, type AtlasTraceHop } from "../lib/atlasTreeModel";
import { serializeHashUrl } from "../lib/hashRoutes";
import { officialSourceActionLabel, officialSourceFor } from "../lib/officialSource";
import { Badge, copyText, formatRelationshipLabel } from "../lib/pagePrimitives";
import {
  buildRecordConnectionGroups,
  humanReadableEvidenceLocator,
  recordIdentityPresentationFor,
  recordDisplayTitle,
  recordPublisherName,
} from "../lib/recordTitle";
import { extractGovernedRecordTaxonomy, buildExploreRelatedPivots } from "../lib/taxonomyContext";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { runtimeRecordIdentityFor } from "../lib/runtimeRecordIdentity";
import { normalizeViewState, type ViewState } from "../lib/viewState";
import { sourceFreshnessPresentation, sourceLifecycleDisplayName, sourcePublicationTitle } from "../lib/sourcePresentation";

function sentenceCaseKind(kind: string): string {
  return /[A-Z]/.test(kind.slice(1)) ? kind : kind.toLocaleLowerCase();
}

function RecordNotFound(props: {
  attemptedId: string;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const attempted = String(props.attemptedId || "");
  const seed = attempted.includes(":") ? attempted.split(":").slice(1).join(":") : attempted;
  const [query, setQuery] = useState(seed);
  return (
    <section className="notice">
      <h1>Record not found</h1>
      <p>{seed
        ? `Nothing in the Library matches "${seed}". Search for it, or browse from the Library.`
        : "Search for another identifier or keyword, or browse from the Library."}</p>
      <form className="record-not-found-search" onSubmit={(event) => {
        event.preventDefault();
        props.onNavigate("search", { query: query.trim() });
      }} role="search">
        <label htmlFor="record-not-found-query">Search Control Atlas</label>
        <input id="record-not-found-query" name="q" onChange={(event) => setQuery(event.target.value)} type="search" value={query} />
        <Button type="submit" variant="primary">Search</Button>
      </form>
      <AppLink onNavigate={props.onNavigate} variant="secondary" view="search">Browse the Library</AppLink>
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
  const RECORD_GROUP_SAMPLE = 5;
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setShareStatus("idle");
    return () => { if (shareTimer.current) clearTimeout(shareTimer.current); };
  }, [state.node]);

  if (!node || !document) return <RecordNotFound attemptedId={state.node} onNavigate={onNavigate} />;

  const source = bundle.runtime.getSource(document.source_id || node.source_id);
  const catalogs = bundle.catalogSummaries?.length ? bundle.catalogSummaries : bundle.runtime.getCatalogs();
  const catalog = catalogs.find((entry: any) => entry.id === document.catalog_id);
  const catalogName = catalogDisplayNameFor(document.catalog_id, catalog?.name || document.catalog_name || "");
  const catalogProfile = catalogProfileFor(document.catalog_id, catalogName);
  const family = document.control_family || node.metadata?.family || "";
  const itemId = node.metadata?.item_id || document.item_id || node.label || "";
  const objectType = document.object_type || node.node_type || "";
  const publisherName = recordPublisherName(document.publisher_name, source?.owner, source?.publisher, catalog?.display_group);
  const sourcePublicationName = sourcePublicationTitle(source, catalogName);
  const sourceFreshness = sourceFreshnessPresentation(source);
  const identityPresentation = recordIdentityPresentationFor({
    publisher: publisherName, catalogId: document.catalog_id, publicationName: catalogName,
    family, itemId, title: node.metadata?.title || document.title || "", objectType, metadata: node.metadata,
  });
  const recordIdentity = identityPresentation.primary;
  const publishedName = identityPresentation.secondary;
  const kind = displayNameFor("object_type", objectType);
  const officialSource = officialSourceFor(source);
  const claimOrigin = node.metadata?.origin || "publisher_normalized";
  const sourceIdentityLabel = claimOrigin === "atlas_editorial" ? "Control Atlas context"
    : claimOrigin === "publisher_derived" ? "Publisher-derived projection" : "Publisher source";
  const lifecycleStatus = String(node.lifecycle_status || "active");
  const edges = bundle.runtime.getEdgesForNode(node.id, { publication_status: "published" });
  const connectionGroups = buildRecordConnectionGroups(node.id, document.catalog_id, edges, bundle.runtime.getNode, (catalogId) => {
    const relatedCatalog = catalogs.find((entry: any) => entry.id === catalogId);
    return catalogDisplayNameFor(catalogId, relatedCatalog?.name || "");
  });
  let immediateConnectionsRemaining = 12;
  const immediateConnectionGroups = connectionGroups.flatMap((group) => {
    if (immediateConnectionsRemaining <= 0) return [];
    const items = group.items.slice(0, immediateConnectionsRemaining);
    immediateConnectionsRemaining -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
  const relatedConnectionGroups = document.catalog_id === "disa-cci" ? immediateConnectionGroups : connectionGroups;
  const displayPath = (node.display_path || []) as Array<{
    id: string; label: string; node_type: string; origin: "authority" | "organizing" | "structural";
  }>;
  const trace = [...displayPath, { id: node.id, label: recordIdentity,
    node_type: node.node_type || document.object_type, origin: "structural" as const }];
  const displayedTrace = bundle.atlasSpine
    ? extendDisplayedAuthorityTrace(buildAtlasTreeModel(bundle.atlasSpine, authoritySpine), trace as AtlasTraceHop[])
    : trace;
  const sourceMetadata = { ...node.metadata, description: document.description || node.metadata?.description || "" };
  const presentation = recordPresentationContract(document.catalog_id, node.node_type || document.object_type);
  const missingSourceFields = missingRequiredRecordFields(presentation, sourceMetadata);
  const publishedSections = publishedSectionsWithContent(presentation.sections, sourceMetadata);
  const hasPublishedSectionContent = publishedSections.length > 0;
  const structuralChildren = edges
    .filter((edge: any) => edge.relationship_class === "structural" && edge.source_node_id === node.id)
    .sort((left: any, right: any) => (left.publisher_order ?? Number.MAX_SAFE_INTEGER) - (right.publisher_order ?? Number.MAX_SAFE_INTEGER))
    .map((edge: any) => bundle.runtime.getNode(edge.target_node_id)).filter(Boolean);
  const showChildInventory = presentation.page_role === PAGE_ROLES.CONTAINER
    || (presentation.page_role === PAGE_ROLES.PUBLICATION_DOCUMENT && structuralChildren.length > 0);
  const childHeading = presentation.page_role === PAGE_ROLES.PUBLICATION_DOCUMENT ? "Contents" : "Contained records";
  const structuralTrace = displayedTrace.filter((entry) => entry.origin === "structural");
  const governedConnectionGroups = relatedConnectionGroups.map((group) => {
    const counterpart = group.items[0] ? bundle.runtime.getNode(group.items[0].nodeId) : null;
    const counterpartCatalogId = counterpart?.metadata?.catalog_id || group.catalogId;
    return { ...group, treatment: relationshipTreatmentFor({
      recordContract: presentation,
      counterpartContract: recordPresentationContract(counterpartCatalogId, counterpart?.node_type || "catalog"),
      recordCatalogId: document.catalog_id, counterpartCatalogId,
      relationshipType: group.relationshipType, relationshipClass: "correlation",
    }) };
  });
  const visibleConnectionGroups = governedConnectionGroups.filter((group) => group.treatment !== RELATIONSHIP_TREATMENTS.ATLAS_ONLY);
  const visibleConnectionCount = visibleConnectionGroups.reduce((total, group) => total + group.items.length, 0);
  const governedTaxonomyTags = extractGovernedRecordTaxonomy({
    catalogId: document.catalog_id, nodeTaxonomyTags: node.metadata?.taxonomy_tags,
    metadata: node.metadata, family, relatedCategories: node.metadata?.related_categories,
  });
  const exploreRelatedItems = buildExploreRelatedPivots({ tags: governedTaxonomyTags, connectionGroups: visibleConnectionGroups });
  const isTechnicalRule = ["stig_rule", "srg_requirement"].includes(presentation.record_type);
  // The benchmark and publisher already frame a finding. Keep its H1 to the
  // native identifier without changing qualified identities in search/Atlas.
  const recordHeading = isTechnicalRule && !identityPresentation.stableIdIsGenerated
    ? String(node.metadata?.publisher_item_id || itemId).trim() || recordIdentity
    : recordIdentity;
  // Publication metadata belongs to the rail. Keep the publisher fields intact in the data.
  const overviewFields = presentation.metadata_facts.filter((field: string) => !field.startsWith("benchmark_"));
  const sectionNavItems: Array<{ id: string; label: string }> = [];
  if (isTechnicalRule && overviewFields.length) sectionNavItems.push({ id: "section-overview", label: "Overview" });
  if (source && !missingSourceFields.length) {
    for (const section of publishedSections) sectionNavItems.push({ id: `section-${section.field}`, label: section.heading });
  }
  if (showChildInventory) sectionNavItems.push({ id: "section-children", label: childHeading });
  if (visibleConnectionGroups.length) sectionNavItems.push({ id: "section-related-records", label: "Related records" });

  const benchmarkTitle = String(node.metadata?.benchmark_title || "");
  const deferPublicationFacts = isTechnicalRule && Boolean(benchmarkTitle);
  const publicationLabel = String(node.metadata?.benchmark_short_title || benchmarkTitle || sourcePublicationName)
    .replace(/Security Technical Implementation Guide/g, "STIG");
  const benchmarkParent = [...displayPath].reverse().find((entry) => entry.node_type === "benchmark" && bundle.runtime.getNode(entry.id));
  const publicationScope = { catalog: document.catalog_id, ...(benchmarkTitle && family ? { family } : {}) };
  const canCompare = Boolean(itemId) && [PAGE_ROLES.ATOMIC_RECORD, PAGE_ROLES.ASSESSMENT_QUESTION, PAGE_ROLES.IMPLEMENTATION_ARTIFACT].includes(presentation.page_role);
  const canonicalRecordUrl = () => `${window.location.origin}${window.location.pathname}${serializeHashUrl(
    normalizeViewState("library-detail", { view: "library-detail", node: document.id }),
  )}`;

  return (
    <section className="detail-page record-template ca-record-page" data-page-role={presentation.page_role} data-template="E">
      <CanonicalBreadcrumb bundle={bundle} nodeId={node.id} recordLabel={recordHeading} />
      <div className="record-template-grid ca-record-layout">
        <header className={`record-title-block${identityPresentation.stableIdIsGenerated ? " record-title-block--generated" : ""}`}
          data-route-primary-header="true" data-route-primary-copy="true">
          <div className="ca-record-heading">
            <h1><AcronymText>{recordHeading}</AcronymText></h1>
            {publishedName ? <p className="record-official-name"><AcronymText>{publishedName}</AcronymText></p> : null}
            {identityPresentation.stableIdIsGenerated ? <p className="record-identity-context"><AcronymText>{identityPresentation.context}</AcronymText></p> : null}
            {lifecycleStatus !== "active" ? <p className="record-identity-context" data-record-lifecycle={lifecycleStatus}>
              <Badge tone="warning">{displayNameFor("lifecycle_status", lifecycleStatus)}</Badge>
            </p> : null}
          </div>
          <TaxonomyContext onNavigate={onNavigate} showProvenance={false} tags={governedTaxonomyTags} />
          <div className="record-title-actions" data-route-primary-support="true">
            {officialSource.url ? <ButtonLink className="normal-case font-medium tracking-normal" href={officialSource.url} rel="noopener noreferrer" target="_blank" variant="primary">
              {claimOrigin === "atlas_editorial" ? "View Atlas source" : officialSourceActionLabel(officialSource)}
            </ButtonLink> : null}
            <AppLink className="normal-case font-medium tracking-normal" onNavigate={onNavigate} patch={{ node: node.id }} variant="secondary" view="atlas-map">See connections</AppLink>
            <details className="record-actions-menu" onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.preventDefault(); event.currentTarget.open = false;
              event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
            }}>
              <summary>More actions</summary>
              <div className="record-actions-popover">
                <AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "item-mapping", items: document.item_id, source: document.catalog_id }} variant="secondary" view="matrix">Compare frameworks</AppLink>
                <AppLink onNavigate={onNavigate} patch={{ framework: document.catalog_id }} variant="secondary" view="templates">Choose a template</AppLink>
                <Button onClick={() => { void copyText(canonicalRecordUrl()); }} type="button" variant="secondary">Copy link</Button>
              </div>
            </details>
          </div>
        </header>

        <article className="record-template-main">
          <RecordSectionNavigation items={sectionNavItems} />
          {document.catalog_id === "disa-cci" ? (
            <section className="record-context-note" aria-labelledby="cci-context-heading">
              <h2 id="cci-context-heading">Start here</h2>
              <p>CCI records deliberately publish a concise requirement, not an implementation procedure. Read the official requirement below, then use its evidence-backed related records to find the applicable STIG, SRG, or control material.</p>
              <div className="card-actions">
                <AppLink onNavigate={onNavigate} patch={{ node: node.id }} variant="secondary" view="atlas-map">Explore connections</AppLink>
                <AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "item-mapping", items: document.item_id, source: document.catalog_id }} variant="secondary" view="matrix">Compare this CCI</AppLink>
              </div>
            </section>
          ) : null}
          {isTechnicalRule && overviewFields.length ? <div id="section-overview">
            <RecordNativeFacts fields={overviewFields} metadata={sourceMetadata} title="Overview" />
          </div> : null}
          {source && claimOrigin !== "publisher_normalized" ? <p className="support-meta" data-record-source-identity>{sourceIdentityLabel} · {sourcePublicationName}</p> : null}
          {!source ? <section className="notice" data-record-source-error role="alert">
            <h2>Source identity unavailable</h2><p>Can't confirm which publisher this came from, so it isn't shown as official yet.</p>
          </section> : missingSourceFields.length ? <section className="notice" data-record-source-error role="alert">
            <h2>Unable to load published text</h2><p>The published text for this record did not load.</p>
          </section> : <RecordPublishedText claimOrigin={claimOrigin} metadata={sourceMetadata} sections={presentation.sections} />}
          {!missingSourceFields.length && !hasPublishedSectionContent ? <section className="record-source-absence" data-record-section="publisher-absence">
            <h2>Publisher description</h2><p>The publisher did not publish a separate description for this {sentenceCaseKind(kind)}.</p>
          </section> : null}
          {presentation.metadata_facts.length && !isTechnicalRule ? <RecordNativeFacts fields={presentation.metadata_facts} metadata={sourceMetadata} title="Published facts" /> : null}
          {structuralTrace.length > 1 ? <section className="record-hierarchy" data-record-section="publisher-hierarchy">
            <h2>Publisher hierarchy</h2><ol>{structuralTrace.map((entry) => <li key={entry.id}>{entry.label}</li>)}</ol>
          </section> : null}
          {showChildInventory ? <section className="record-child-inventory" data-record-section="child-inventory" id="section-children">
            <div className="section-header"><div><h2>{childHeading}</h2><p>Objects published directly beneath this record.</p></div>
              <Badge tone="info">{structuralChildren.length || sourceMetadata.child_count || 0}</Badge>
            </div>
            {structuralChildren.length ? <ul>{structuralChildren.slice(0, 25).map((child: any) => <li key={child.id}>
              <AppLink onNavigate={onNavigate} patch={{ node: child.id }} view="library-detail">{recordDisplayTitle(child)}</AppLink>
            </li>)}</ul> : <p>No directly contained records are loaded for this publication object.</p>}
            {structuralChildren.length > 25 ? <AppLink onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">Browse all contents in Atlas</AppLink> : null}
          </section> : null}
          {visibleConnectionGroups.length > 0 ? (
            <section className="record-connections record-connections--related" data-record-section="related-records" id="section-related-records">
              <div className="section-header"><div><h2>Related records</h2><p>Formal published links to other publications.</p></div><Badge tone="info">{visibleConnectionCount}</Badge></div>
              <div className="record-connection-groups">
                {visibleConnectionGroups.map((group) => {
                  const sampleLimit = group.treatment === RELATIONSHIP_TREATMENTS.SUMMARIZE ? 3 : RECORD_GROUP_SAMPLE;
                  const sample = document.catalog_id !== "disa-cci" ? group.items.slice(0, sampleLimit) : group.items;
                  const overflow = group.items.length - sample.length;
                  const content = (
                    <section data-relationship-treatment={group.treatment} key={`${group.catalogId}:${group.relationshipType}`}>
                      <h3>{group.label} · {displayNameFor("relationship_type", group.relationshipType)} · {group.items.length}</h3>
                      <ul>{sample.map((item) => {
                        const relatedIdentity = runtimeRecordIdentityFor(bundle, item.nodeId);
                        const sourceEvidence = item.sourceRefs.map((reference) => {
                          const sourceRecord = reference.sourceId ? bundle.runtime.getSource(reference.sourceId) : null;
                          return {
                            evidenceQuality: reference.evidenceQuality ? displayNameFor("evidence_quality", reference.evidenceQuality) : "",
                            locator: humanReadableEvidenceLocator(reference.locator),
                            source: reference.sourceName || sourceRecord?.display_name || sourceRecord?.name || "",
                            version: reference.sourceVersion || sourceRecord?.version || "",
                          };
                        }).filter((reference) => reference.source);
                        const sourceNames = [...new Set(sourceEvidence.map((reference) => reference.source))];
                        return <li data-record-connection-id={item.edgeId} key={item.edgeId}>
                          <AppLink aria-label={relatedIdentity.stableIdIsGenerated ? `Open ${relatedIdentity.accessibleName}` : undefined}
                            onNavigate={onNavigate} patch={{ node: item.nodeId }} view="library-detail">
                            <strong>{relatedIdentity.stableIdIsGenerated ? relatedIdentity.primary : item.itemId}</strong>
                            {relatedIdentity.stableIdIsGenerated && relatedIdentity.context ? ` — ${relatedIdentity.context}`
                              : item.title !== item.itemId ? ` — ${item.title}` : ""}
                          </AppLink>
                          <span className="relationship-meta"><strong>Published connection</strong>{` · ${formatRelationshipLabel({ relationship_type: item.relationshipType })}`}</span>
                          {sourceNames.length ? <span className="relationship-citation"><strong>Source</strong>{` · ${sourceNames.join(" · ")}`}</span> : null}
                          <details className="mapping-row-details relationship-source-evidence">
                            <summary aria-label={`Source evidence for ${relatedIdentity.primary}`}>Source evidence</summary>
                            <dl className="relationship-source-facts">
                              <div><dt>How the connection was established</dt><dd>{displayNameFor("provenance_class", item.provenanceClass)}</dd></div>
                              {sourceEvidence.map((reference, referenceIndex) => <Fragment key={`${item.edgeId}:${reference.source}:${referenceIndex}`}>
                                <div><dt>Source record</dt><dd>{reference.source}</dd></div>
                                {reference.version ? <div><dt>Source version</dt><dd>{reference.version}</dd></div> : null}
                                {reference.locator ? <div><dt>Locator</dt><dd>{reference.locator}</dd></div> : null}
                                {reference.evidenceQuality ? <div><dt>Evidence quality</dt><dd>{reference.evidenceQuality}</dd></div> : null}
                              </Fragment>)}
                            </dl>
                          </details>
                        </li>;
                      })}</ul>
                      {overflow > 0 ? <AppLink className="record-connections-overflow" onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">+{overflow} more — Explore in Atlas</AppLink> : null}
                    </section>
                  );
                  return group.treatment === RELATIONSHIP_TREATMENTS.COLLAPSE ? <details className="record-relationship-disclosure" key={`${group.catalogId}:${group.relationshipType}`}>
                    <summary>{group.label} · {group.items.length}</summary>{content}
                  </details> : content;
                })}
              </div>
              {governedConnectionGroups.some((group) => group.treatment === RELATIONSHIP_TREATMENTS.ATLAS_ONLY) ? <p className="support-meta">Additional valid connections are available in Atlas.</p> : null}
              <AppLink className="record-connections-explore" onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">Explore all connections in Atlas</AppLink>
            </section>
          ) : null}
        </article>

        <aside className="record-template-sidebar" data-displayed-trace={displayedTrace.map((entry) => entry.id).join(">")}>
          <RecordRailSection icon={<IconInfoCircle size={20} />} id="about-this-record" key={`${node.id}:about`} title="About this record">
            <dl className="record-source-facts">
              <div><dt>Record type</dt><dd>{kind}</dd></div>
              {publisherName ? <div><dt>Publisher</dt><dd>{publisherName}</dd></div> : null}
              {benchmarkTitle ? <div><dt>Benchmark</dt><dd>{benchmarkTitle}</dd></div> : null}
              {node.metadata?.benchmark_version ? <div><dt>Version</dt><dd>{node.metadata.benchmark_version}</dd></div> : null}
              {!deferPublicationFacts && node.metadata?.benchmark_status_date ? <div><dt>Benchmark date</dt><dd>{node.metadata.benchmark_status_date}</dd></div> : null}
              {!deferPublicationFacts ? <div><dt>Publication</dt><dd>{sourcePublicationName}{source?.version ? ` · ${source.version}` : ""}</dd></div> : null}
              <div><dt>Status</dt><dd>{sourceLifecycleDisplayName(source?.lifecycle_status)}</dd></div>
              <div><dt>{sourceFreshness.label}</dt><dd>{sourceFreshness.dateTime ? <time dateTime={sourceFreshness.dateTime}>{sourceFreshness.value}</time> : sourceFreshness.value}</dd></div>
            </dl>
            {deferPublicationFacts ? (
              <details className="ca-tag-explanations ca-record-source-details" key={`${node.id}:source-details`} data-record-source-details>
                <summary>View source details</summary>
                <dl className="record-source-detail-facts">
                  {node.metadata?.benchmark_status_date ? <div><dt>Benchmark date</dt><dd>{node.metadata.benchmark_status_date}</dd></div> : null}
                  <div><dt>Publication</dt><dd>{sourcePublicationName}{source?.version ? ` · ${source.version}` : ""}</dd></div>
                </dl>
                {source?.id ? <AppLink className="ca-record-source-details__link" onNavigate={onNavigate} patch={{ source: source.id }} view="sources">Open source record</AppLink> : null}
              </details>
            ) : source?.id ? <AppLink onNavigate={onNavigate} patch={{ source: source.id }} view="sources">View source details</AppLink> : null}
            <TagExplanations tags={governedTaxonomyTags} />
          </RecordRailSection>
          {catalog ? <RecordRailSection icon={<IconBook2 size={20} />} id="in-this-publication" key={`${node.id}:publication`} title="In this publication">
            <p className="record-rail-publication-name">{publicationLabel}</p>
            <ul className="record-rail-nav-list">
              <li>{benchmarkParent ? <AppLink onNavigate={onNavigate} patch={{ node: benchmarkParent.id }} view="library-detail">View publication</AppLink>
                : <AppLink onNavigate={onNavigate} patch={publicationScope} view="catalog-detail">View publication</AppLink>}</li>
              <li><AppLink onNavigate={onNavigate} patch={{ ...publicationScope, browseAll: "true" }} view="catalog-detail">Browse all {catalogProfile.recordLabel || "records"}</AppLink></li>
            </ul>
          </RecordRailSection> : null}
          {exploreRelatedItems.length ? <RecordRailSection icon={<IconCompass size={20} />} id="explore-related" key={`${node.id}:explore`} title="Explore related">
            <ul className="record-rail-nav-list">{exploreRelatedItems.map((item) => <li key={item.key}>
              {item.href ? <RecordJumpButton targetId={item.href.slice(1)}>{item.label}</RecordJumpButton>
                : <AppLink onNavigate={onNavigate} patch={item.patch} view="search">{item.label}</AppLink>}
            </li>)}</ul>
          </RecordRailSection> : null}
          <RecordRailSection accent icon={<IconBolt size={20} />} id="do-more" key={`${node.id}:actions`} title="Do more">
            <ul className="record-rail-nav-list">
              <li><AppLink onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">View in Atlas</AppLink></li>
              {canCompare ? <li><AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "item-mapping", items: document.item_id, source: document.catalog_id }} view="matrix">Compare this record</AppLink></li> : null}
              <li><button onClick={async () => {
                try {
                  await navigator.clipboard.writeText(canonicalRecordUrl());
                  setShareStatus("copied");
                  if (shareTimer.current) clearTimeout(shareTimer.current);
                  shareTimer.current = setTimeout(() => setShareStatus("idle"), 1800);
                } catch { setShareStatus("error"); }
              }} type="button">{shareStatus === "copied" ? "Link copied" : "Share this record"}</button></li>
              <li><a href="https://github.com/rambulls/control-atlas/issues/new?template=report-broken-link.yml" rel="noopener noreferrer" target="_blank">Report an issue <IconExternalLink aria-hidden="true" size={13} /></a></li>
            </ul>
            <span aria-live="polite" className={shareStatus === "error" ? "support-meta" : "visually-hidden"}>
              {shareStatus === "copied" ? "Link copied" : shareStatus === "error" ? "Copy failed. Use your browser’s share menu." : ""}
            </span>
          </RecordRailSection>
        </aside>
      </div>
    </section>
  );
}
