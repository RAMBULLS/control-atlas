import { Fragment, useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";

import { displayNameFor } from "../../app/display-names.mjs";
import {
  missingRequiredRecordFields,
  recordPresentationProfile,
} from "../../shared/record-presentation.mjs";
import {
  isValidSourceTextPresentation,
} from "../../shared/source-text-presentation.mjs";
import authoritySpine from "../../../data/curated/authority-spine.json";
import { AcronymText } from "../components/AccessibleTerm";
import { AppLink } from "../components/AppLink";
import { CanonicalBreadcrumb } from "../components/CanonicalBreadcrumb";
import { Button, ButtonLink } from "../components/lsm";
import { BucketTag, LineTag } from "../components/TaxonomyTag";
import { catalogDisplayNameFor, catalogProfileFor } from "../lib/catalogProfiles";
import {
  buildAtlasTreeModel,
  extendDisplayedAuthorityTrace,
  type AtlasTraceHop,
} from "../lib/atlasTreeModel";
import { serializeHashUrl } from "../lib/hashRoutes";
import {
  Badge,
  copyText,
  formatRelationshipLabel,
} from "../lib/pagePrimitives";
import {
  buildRecordConnectionGroups,
  humanReadableEvidenceLocator,
  recordIdentityPresentationFor,
  recordPublisherName,
} from "../lib/recordTitle";
import { recordTagsFor, tagProvenanceExplanation } from "../lib/recordTags";
import { TAXONOMY_TAG_BY_ID } from "../../shared/taxonomy-contract.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { runtimeRecordIdentityFor } from "../lib/runtimeRecordIdentity";
import { normalizeViewState, type ViewState } from "../lib/viewState";

const ODP_PATTERN = /\[(?:Assignment|Selection)[^\]]*\]/g;

function renderOdpText(text: string): ReactNode {
  if (!text) return text;
  const parts = text.split(ODP_PATTERN);
  const matches = text.match(ODP_PATTERN) || [];
  if (matches.length === 0) return text;
  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (part) nodes.push(<Fragment key={`t-${index}`}>{part}</Fragment>);
    if (index < matches.length) {
      nodes.push(
        <span className="odp-param" key={`m-${index}`}>
          {matches[index]}
        </span>,
      );
    }
  });
  return nodes;
}

function CopyableCodeSnippet(props: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="source-code-snippet" data-source-code-snippet>
      <div className="source-code-snippet__header">
        <span>Command or configuration</span>
        <Button
          onClick={() => {
            void copyText(props.value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            });
          }}
          type="button"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <span aria-live="polite" className="visually-hidden">
          {copied ? "Snippet copied to clipboard" : ""}
        </span>
      </div>
      <pre><code>{props.value}</code></pre>
    </div>
  );
}

function SourceTextBlocks(props: { value: string; presentation?: any }) {
  const text = String(props.value || "");
  const resolvedPresentation = isValidSourceTextPresentation(text, props.presentation)
    ? props.presentation
    : { version: 1, blocks: [{ kind: "paragraph", start: 0, end: text.length }] };
  const blocks = resolvedPresentation.blocks;
  const rendered: ReactNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === "code") {
      rendered.push(
        <CopyableCodeSnippet
          key={`code-${block.start}-${index}`}
          value={text.slice(block.start, block.end)}
        />,
      );
      continue;
    }
    if (block.kind === "list") {
      const List = block.ordered ? "ol" : "ul";
      const followingCode = blocks[index + 1]?.kind === "code"
        ? blocks[index + 1]
        : null;
      rendered.push(
        <List
          className={`source-procedure-list${followingCode ? " source-procedure-list--with-code" : ""}`}
          key={`list-${index}`}
        >
          {block.items.map((item: any, itemIndex: number) => {
            const isCodeStep = Boolean(followingCode) && itemIndex === block.items.length - 1;
            return (
              <li className={isCodeStep ? "source-procedure-list__code-step" : undefined} key={`${item.start}-${itemIndex}`}>
                <span>{renderOdpText(text.slice(item.start, item.end))}</span>
                {isCodeStep && followingCode ? (
                  <CopyableCodeSnippet value={text.slice(followingCode.start, followingCode.end)} />
                ) : null}
              </li>
            );
          })}
        </List>,
      );
      if (followingCode) index += 1;
      continue;
    }
    rendered.push(
      <p key={`paragraph-${block.start}-${index}`}>{renderOdpText(text.slice(block.start, block.end))}</p>,
    );
  }

  return (
    <div className="source-text-blocks">{rendered}</div>
  );
}

function StructuredPublisherSections(props: { value: any[] }) {
  return (
    <div className="publisher-structured-sections">
      {props.value.map((section, sectionIndex) => (
        <section key={section.id || section.locator || sectionIndex}>
          {section.title ? <h3>{section.title}</h3> : null}
          {(section.structured_content || []).map((block: any, blockIndex: number) => {
            const key = `${section.id || sectionIndex}-${blockIndex}`;
            if (block.type === "ordered_list" || block.type === "unordered_list") {
              const List = block.type === "ordered_list" ? "ol" : "ul";
              return (
                <List className="source-structured-list" key={key}>
                  {(block.items || []).map((item: string, itemIndex: number) => (
                    <li key={`${key}-${itemIndex}`}>{renderOdpText(item)}</li>
                  ))}
                </List>
              );
            }
            if (block.type === "code") {
              return <CopyableCodeSnippet key={key} value={String(block.text || "")} />;
            }
            return <p key={key}>{renderOdpText(String(block.text || ""))}</p>;
          })}
        </section>
      ))}
    </div>
  );
}

function SourceSectionContent(props: { kind: string; value: any; presentation?: any }) {
  if (props.kind === "structured") {
    return <StructuredPublisherSections value={props.value} />;
  }
  if (props.kind === "list") {
    return <ul className="source-structured-list">{props.value.map((item: string) => <li key={item}>{renderOdpText(item)}</li>)}</ul>;
  }
  if (props.kind === "references") {
    return (
      <ul className="source-structured-list">
        {props.value.map((reference: any, index: number) => {
          const parts = [reference.creator, reference.title, reference.version ? `Version ${reference.version}` : "", reference.index]
            .filter(Boolean);
          const label = parts.join(" · ");
          return (
            <li key={`${label}-${index}`}>
              {reference.location ? (
                <a href={reference.location} rel="noopener noreferrer" target="_blank">{label}</a>
              ) : label}
            </li>
          );
        })}
      </ul>
    );
  }
  if (props.kind === "publisher_mappings") {
    return (
      <ul className="source-structured-list">
        {props.value.map((mapping: any, index: number) => (
          <li key={`${mapping.target_catalog}:${mapping.target_id}:${index}`}>
            <strong>{mapping.target_catalog}</strong>{mapping.target_id ? ` · ${mapping.target_id}` : ""}
            {mapping.relationship_type ? ` · ${formatRelationshipLabel({ relationship_type: mapping.relationship_type })}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "mapping_targets") {
    return (
      <ul className="source-structured-list">
        {props.value.map((mapping: any, index: number) => (
          <li key={`${mapping.kind}:${mapping.target_id}:${index}`}>
            <strong>{mapping.kind}</strong>{mapping.target_id ? ` · ${mapping.target_id}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "objectives") {
    return (
      <ul className="assessment-objectives">
        {props.value.map((objective: any, index: number) => (
          <li key={objective.id || objective.label || index}>
            {objective.label ? <strong>{objective.label}</strong> : null}{" "}
            {renderOdpText(objective.prose)}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "methods") {
    return (
      <ul className="assessment-methods">
        {props.value.map((method: any, index: number) => (
          <li key={method.id || method.method || index}>
            <strong>{method.method}</strong>
            {method.objects?.length ? `: ${method.objects.join("; ")}` : null}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "countermeasures") {
    return (
      <div className="publisher-structured-sections">
        {props.value.map((group: any, index: number) => (
          <section key={`${(group.actors || []).join("-")}-${index}`}>
            <h3>{(group.actors || ["Unspecified"]).join(" · ")}</h3>
            <ul className="source-structured-list">
              {(group.actions || []).map((action: string, actionIndex: number) => (
                <li key={`${index}-${actionIndex}`}>{renderOdpText(action)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }
  return <SourceTextBlocks value={String(props.value)} presentation={props.presentation} />;
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
  const [visibleConnectionCount, setVisibleConnectionCount] = useState(50);
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  useEffect(() => {
    setVisibleConnectionCount(50);
    setConnectionsOpen(false);
  }, [state.node]);

  if (!node) {
    return (
      <section className="notice">
        <h1>Record not found</h1>
        <p>Try another identifier or keyword.</p>
        <AppLink onNavigate={onNavigate} variant="primary" view="search">
          Back to Library
        </AppLink>
      </section>
    );
  }

  if (!document) {
    return (
      <section className="notice">
        <h1>Record not found</h1>
        <p>Try another identifier or keyword.</p>
        <AppLink onNavigate={onNavigate} variant="primary" view="search">
          Back to Library
        </AppLink>
      </section>
    );
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
  const officialSourceUrl = source?.artifact_url || source?.catalog_browse_url || "";
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
  const connectionCount = connectionGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  let remainingConnections = visibleConnectionCount;
  const visibleConnectionGroups = connectionGroups.flatMap((group) => {
    if (remainingConnections <= 0) return [];
    const items = group.items.slice(0, remainingConnections);
    remainingConnections -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
  let immediateConnectionsRemaining = 12;
  const immediateConnectionGroups = connectionGroups.flatMap((group) => {
    if (immediateConnectionsRemaining <= 0) return [];
    const items = group.items.slice(0, immediateConnectionsRemaining);
    immediateConnectionsRemaining -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
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
  const presentation = recordPresentationProfile(document.catalog_id, node.node_type || document.object_type);
  const missingSourceFields = missingRequiredRecordFields(presentation, sourceMetadata);
  const recordTags = recordTagsFor({
    area,
    category: family,
    kind,
    publication: catalogName,
    relatedCategories: node.metadata?.related_categories,
    taxonomyTags: node.metadata?.taxonomy_tags,
  });

  return (
    <section className="detail-page record-template" data-template="E">
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
        <div className="record-title-actions" data-route-primary-support="true">
          {officialSourceUrl ? (
            <ButtonLink
              href={officialSourceUrl}
              rel="noopener noreferrer"
              target="_blank"
              variant="primary"
            >
              View official source
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
                Choose a document
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
          {source ? (
            <p className="support-meta" data-record-source-identity>
              Source excerpt from {source.display_name || source.name}
            </p>
          ) : null}
          {!source ? (
            <section className="notice" data-record-source-error role="alert">
              <h2>Source identity unavailable</h2>
              <p>Can't confirm which publisher this came from, so it isn't shown as official yet.</p>
            </section>
          ) : missingSourceFields.length ? (
            <section className="notice" data-record-source-error role="alert">
              <h2>Record data unavailable</h2>
              <p>The published text for this record did not load.</p>
            </section>
          ) : (
            <div className="record-official-text" data-record-section="official-text" data-source-text="published">
              {presentation.sections.map((section) => {
                const value = sourceMetadata[section.field as keyof typeof sourceMetadata];
                if (Array.isArray(value) ? value.length === 0 : !String(value || "").trim()) return null;
                return (
                  <section data-source-field={section.field} key={section.field}>
                    <h2>{section.heading}</h2>
                    <SourceSectionContent
                      kind={section.kind}
                      value={value}
                      presentation={sourceMetadata.source_text_presentation?.[section.field]}
                    />
                  </section>
                );
              })}
            </div>
          )}
          {document.catalog_id === "disa-cci" && immediateConnectionGroups.length ? (
            <section className="record-connections record-connections--inline" data-record-section="related-records">
              <div className="section-header">
                <div>
                  <h2>Related records</h2>
                  <p>Start with these {immediateConnectionGroups.reduce((total, group) => total + group.items.length, 0)} of {connectionCount} published links.</p>
                </div>
                <Badge tone="info">{connectionCount}</Badge>
              </div>
              <div className="record-connection-groups">
                {immediateConnectionGroups.map((group) => (
                  <section key={`${group.catalogId}:${group.relationshipType}`}>
                    <h3>{group.label} · {displayNameFor("relationship_type", group.relationshipType)} · {group.items.length}</h3>
                    <ul>
                      {group.items.map((item) => {
                        const relatedIdentity = runtimeRecordIdentityFor(bundle, item.nodeId);
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
                        </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              <AppLink onNavigate={onNavigate} patch={{ node: node.id }} variant="secondary" view="atlas-map">
                Explore all connections in Atlas
              </AppLink>
            </section>
          ) : null}

        </article>

        <aside
          className="record-template-sidebar"
          data-displayed-trace={displayedTrace.map((entry) => entry.id).join(">")}
        >
          <section>
            <h2>About This Record</h2>
            <div className="record-classification-tags">
              {recordTags.map((tag) => {
                const content = tag.kind === "area" ? (
                  <BucketTag
                    area={tag.label}
                    explanation={tagProvenanceExplanation(tag.provenance)}
                  >
                    {tag.label}
                  </BucketTag>
                ) : (
                  <LineTag explanation={tagProvenanceExplanation(tag.provenance)}>
                    <AcronymText>{tag.label}</AcronymText>
                  </LineTag>
                );
                // Prefer a governed taxonomy id (precise Library filter) even
                // when the visible chip came from a publisher category with the
                // same label; fall back to the area filter, then a plain search.
                const governedId = TAXONOMY_TAG_BY_ID.has(tag.id)
                  ? tag.id
                  : (node.metadata?.taxonomy_tags || []).find(
                      (candidate: { id?: string; label?: string }) => candidate.label === tag.label,
                    )?.id;
                const tagPatch = governedId
                  ? { tags: [governedId] }
                  : tag.kind === "area"
                    ? { area: tag.id.replace(/^area:/, "") }
                    : { query: tag.label };
                return (
                  <AppLink
                    aria-label={`Filter the Library by ${tag.label}`}
                    className="record-taxonomy-link"
                    key={tag.id}
                    onNavigate={onNavigate}
                    patch={tagPatch}
                    view="search"
                  >
                    {content}
                  </AppLink>
                );
              })}
            </div>
            <dl className="record-source-facts">
              <div>
                <dt>Publisher</dt>
                <dd>{publisherName || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Publication</dt>
                <dd>{catalogName}{source?.version ? ` · ${source.version}` : ""}</dd>
              </div>
              {source?.last_checked ? (
                <div>
                  <dt>Current as of</dt>
                  <dd>{source.last_checked}</dd>
                </div>
              ) : null}
            </dl>
            {document.catalog_id !== "disa-cci" && connectionGroups.length ? (
              <button className="record-connections-trigger" onClick={() => setConnectionsOpen(true)} type="button">
                <span>Related records</span>
                <span className="record-connections-trigger__count">{connectionCount}</span>
              </button>
            ) : null}
            <AppLink
              onNavigate={onNavigate}
              patch={{ source: source?.id || "" }}
              view="sources"
            >
              View source details
            </AppLink>
          </section>
        </aside>

        {document.catalog_id !== "disa-cci" && connectionGroups.length ? (
          <Dialog.Root onOpenChange={setConnectionsOpen} open={connectionsOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="drawer-overlay" />
              <Dialog.Content className="drawer-content record-connections-dialog" data-record-section="related-records">
                <div className="drawer-header">
                  <div>
                    <Dialog.Title>Related records</Dialog.Title>
                    <Dialog.Description>Published links from this record to other requirements and controls.</Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button aria-label="Close related records" className="icon-button" type="button">
                      <IconX aria-hidden="true" size={18} stroke={1.8} />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="drawer-list">
                  <div className="record-connection-groups">
              {visibleConnectionGroups.map((group) => (
                <section key={`${group.catalogId}:${group.relationshipType}`}>
                  <h3>{group.label} · {displayNameFor("relationship_type", group.relationshipType)} · {group.items.length}</h3>
                  <ul>
                    {group.items.map((item) => {
                      const relatedIdentity = runtimeRecordIdentityFor(bundle, item.nodeId);
                      const sourceLabels = [...new Set(
                        item.sourceRefs
                          .map((reference) => {
                            const sourceRecord = reference.sourceId
                              ? bundle.runtime.getSource(reference.sourceId)
                              : null;
                            const sourceLabel = (
                              reference.sourceName ||
                              sourceRecord?.display_name ||
                              sourceRecord?.name ||
                              ""
                            );
                            const safeLocator = humanReadableEvidenceLocator(reference.locator);
                            return [
                              sourceLabel,
                              reference.sourceVersion,
                              safeLocator,
                              reference.evidenceQuality,
                            ].filter(Boolean).join(" · ");
                          })
                          .filter(Boolean),
                      )];
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
                            {[
                              formatRelationshipLabel({ relationship_type: item.relationshipType }),
                              "Published connection",
                            ].filter(Boolean).join(" · ")}
                          </span>
                          {sourceLabels.length ? (
                            <details className="relationship-citation-details">
                              <summary>Source evidence</summary>
                              <div className="relationship-citation">{sourceLabels.join(" · ")}</div>
                            </details>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
                  {visibleConnectionCount < connectionCount ? (
                    <button
                      className="atlas-spatial-more"
                      onClick={() =>
                        setVisibleConnectionCount((count) =>
                          Math.min(count + 50, connectionCount),
                        )
                      }
                      type="button"
                    >
                      Show 50 more · {connectionCount - visibleConnectionCount} remaining
                    </button>
                  ) : null}
                  <AppLink className="record-connections-explore" onNavigate={onNavigate} patch={{ node: node.id }} view="atlas-map">
                    Explore all connections in Atlas
                  </AppLink>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : null}
      </div>

    </section>
  );
}
