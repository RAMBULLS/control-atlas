import {
  IconAlertTriangle,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconFlag,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import "../../../styles/resources.css";
import { ResourceIdentityMark } from "../components/CommonsResourceCard";
import { AppLink } from "../components/AppLink";
import type { CommonsResource } from "../lib/commonsTypes";
import { resourceDateLabel } from "../lib/commonsPresentation.mjs";
import { serializeHashLocation } from "../lib/hashRoutes";
import { resourceAccessLabel, resourceFieldLabel, resourceTypeLabel } from "../lib/resourceBrands.mjs";
import { taxonomyTagsForResource } from "../../shared/record-taxonomy.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { normalizeViewState, type ViewState } from "../lib/viewState";

type Props = {
  bundle: RuntimeBundle | null;
  viewState: Extract<ViewState, { view: "commons-detail" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
};

function EvidenceCopy({ section }: { section?: { status: string; text: string; sourceUrl: string } }) {
  if (!section) return null;
  return (
    <div className={`resource-evidence-copy resource-evidence-copy--${section.status}`}>
      <p>{section.text}</p>
      {section.sourceUrl ? (
        <p className="resource-detail-evidence">
          <a href={section.sourceUrl} rel="noopener noreferrer" target="_blank">
            Evidence <IconExternalLink aria-hidden="true" size={14} />
          </a>
        </p>
      ) : null}
    </div>
  );
}

function ResourceDate({ value, fallback }: { value?: string | null; fallback: string }) {
  const label = resourceDateLabel(value);
  return value && label ? <time dateTime={value}>{label}</time> : fallback;
}

export function CommonsDetailPage({ bundle, viewState, onNavigate }: Props) {
  const id = viewState.id;
  const [copied, setCopied] = useState(false);
  const dataset = bundle?.commonsDataset;
  const resource = useMemo(() => dataset?.resources.find((entry) => entry.id === id) as CommonsResource | undefined, [dataset, id]);

  if (!resource) {
    return (
      <div className="resource-detail-page">
        <section className="empty-state">
          <IconAlertTriangle aria-hidden="true" size={36} />
          <h1>Resource not found</h1>
          <p>This directory does not contain “{id}”.</p>
        </section>
      </div>
    );
  }

  const parent = resource.parentEcosystemId ? dataset?.resources.find((entry) => entry.id === resource.parentEcosystemId) : null;
  const children = dataset?.resources.filter((entry) => resource.childResourceIds?.includes(entry.id)) || [];
  const collections = dataset?.collections.filter((collection) => resource.featuredCollections?.includes(collection.id)) || [];
  const usefulFor = [...resource.lifecycleStages, ...(resource.technologyScopes || []), ...resource.audiences].filter(Boolean);
  const taxonomyTags = taxonomyTagsForResource(resource);
  const warning = resource.resourceType === "community_forum"
    ? "Do not post CUI, credentials, system details, assessment evidence, or other non-public organizational information."
    : resource.warnings?.[0];

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${serializeHashLocation(normalizeViewState("commons-detail", { id }))}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="resource-detail-page">
      <div className="ca-content-container resource-detail-shell">
        <nav aria-label="Resource detail actions" className="resource-detail-nav">
          <div>
            <button onClick={copyLink} type="button">
              {copied ? <IconCheck aria-hidden="true" size={15} /> : <IconCopy aria-hidden="true" size={15} />}
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a href="https://github.com/BackslashBryant/control-atlas/issues/new?template=report-broken-link.yml" rel="noopener noreferrer" target="_blank">
              <IconFlag aria-hidden="true" size={15} />Report a problem
            </a>
          </div>
        </nav>

        <header className="resource-detail-hero">
          <ResourceIdentityMark resource={resource} />
          <div>
            <p className="eyebrow">{resourceTypeLabel(resource.resourceType)}</p>
            <h1>{resource.name}</h1>
            <p className="resource-detail-owner">
              Published by <strong>{resource.publisher}</strong>
              {resource.maintainer && resource.maintainer !== resource.publisher ? ` · Maintained by ${resource.maintainer}` : ""}
            </p>
            <p className="resource-detail-summary">{resource.cardPurpose || resource.summary}</p>
            <div className="resource-detail-actions">
              <a className="resource-primary-link" href={resource.canonicalUrl} rel="noopener noreferrer" target="_blank">
                Open resource <IconExternalLink aria-hidden="true" size={16} />
              </a>
              {resource.repositoryUrl ? (
                <a href={resource.repositoryUrl} rel="noopener noreferrer" target="_blank">
                  Source repository <IconExternalLink aria-hidden="true" size={15} />
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {warning ? (
          <aside className="resource-detail-warning">
            <IconAlertTriangle aria-hidden="true" size={20} />
            <p>{warning}</p>
          </aside>
        ) : null}

        <div className="resource-detail-grid">
          <article className="resource-detail-main">
            {/* 1. What it is */}
            <section className="resource-detail-prose-section">
              <h2>What This Is</h2>
              <p>{resource.overview?.text || resource.summary}</p>
              {resource.presentationProfile?.whatItDoes?.text ? (
                <div className="resource-subblock">
                  <h3>What It Does</h3>
                  <EvidenceCopy section={resource.presentationProfile.whatItDoes} />
                </div>
              ) : null}
              {resource.whyIncluded ? (
                <div className="resource-subblock">
                  <h3>Why It Is Listed</h3>
                  <p>{resource.whyIncluded}</p>
                </div>
              ) : null}
              {resource.overview?.sourceUrl ? (
                <p className="resource-detail-evidence">
                  <a href={resource.overview.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {resource.overview.sourceType === "repository_readme" ? "Repository README" : "Publisher source"} <IconExternalLink aria-hidden="true" size={14} />
                  </a>
                </p>
              ) : null}
            </section>

            {/* 2. Who it's for */}
            {(resource.presentationProfile?.whoItIsFor?.text || usefulFor.length > 0) ? (
              <section className="resource-detail-prose-section">
                <h2>Who It Is For</h2>
                {resource.presentationProfile?.whoItIsFor?.text ? (
                  <EvidenceCopy section={resource.presentationProfile.whoItIsFor} />
                ) : null}
                {usefulFor.length ? (
                  <div className="resource-detail-tags">
                    {usefulFor.map((item) => (
                      <span key={item}>{resourceFieldLabel(item)}</span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* 3. How to use or access */}
            <section className="resource-detail-prose-section">
              <h2>How to Use or Access</h2>
              <dl className="resource-detail-facts">
                <div><dt>Access type</dt><dd>{resourceAccessLabel(resource)}</dd></div>
                <div><dt>Cost</dt><dd>{resourceFieldLabel(resource.costType)}</dd></div>
                <div><dt>Status</dt><dd>{resourceFieldLabel(resource.officialStatus || resource.resourceLane)}</dd></div>
              </dl>
              {resource.publicAccessNotes ? <p>{resource.publicAccessNotes}</p> : null}

              {resource.toolProfile ? (
                <>
                  <div className="resource-tool-profile-grid">
                    <section><h3>Installation</h3><EvidenceCopy section={resource.toolProfile.installation} /></section>
                    <section><h3>Usage</h3><EvidenceCopy section={resource.toolProfile.usage} /></section>
                  </div>
                  <div className="resource-tool-profile-grid">
                    <section><h3>Inputs</h3><EvidenceCopy section={resource.toolProfile.inputs} /></section>
                    <section><h3>Outputs</h3><EvidenceCopy section={resource.toolProfile.outputs} /></section>
                    <section><h3>Formats</h3><EvidenceCopy section={resource.toolProfile.formats} /></section>
                    <section><h3>Integrations</h3><EvidenceCopy section={resource.toolProfile.integrations} /></section>
                  </div>
                </>
              ) : null}

              <div className="resource-subblock">
                <h3>Compatibility</h3>
                {resource.compatibility?.status === "documented" ? (
                  <div className="resource-detail-tags">
                    {[...resource.compatibility.operatingSystems, ...resource.compatibility.environments].map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                ) : null}
                <p>{resource.compatibility?.note || "The publisher did not state compatibility."}</p>
              </div>

              <div className="resource-subblock">
                <h3>Links</h3>
                <ul className="resource-link-list">
                  <li><a href={resource.canonicalUrl} rel="noopener noreferrer" target="_blank">Canonical resource <IconExternalLink aria-hidden="true" size={14} /></a></li>
                  {resource.downloadLinks?.map((url) => <li key={url}><a href={url} rel="noopener noreferrer" target="_blank">Publisher download <IconExternalLink aria-hidden="true" size={14} /></a></li>)}
                  {resource.alternateUrls?.map((url) => <li key={url}><a href={url} rel="noopener noreferrer" target="_blank">Publisher alternate <IconExternalLink aria-hidden="true" size={14} /></a></li>)}
                </ul>
              </div>
            </section>

            {/* 4. Screenshots */}
            {resource.media?.status === "available" ? (
              <section className="resource-detail-prose-section">
                <h2>Screenshots</h2>
                <div className="resource-detail-media">
                  {resource.media.items.map((item) => (
                    <figure key={`${item.url}-${item.sha256}`}>
                      <img alt={item.alt} height={item.height} loading="lazy" src={item.url} width={item.width} />
                      <figcaption>
                        {item.alt || "Publisher screenshot"} · {item.width}×{item.height}{item.license ? ` · ${item.license}` : ""}. <a href={item.sourceUrl} rel="noopener noreferrer" target="_blank">Source image</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ) : resource.resourceType === "tool" ? (
              <section className="resource-detail-prose-section">
                <h2>Screenshots</h2>
                <p>{resource.media?.reason || "No publisher screenshot found."}</p>
              </section>
            ) : null}

            {/* 5. Limitations */}
            {resource.presentationProfile?.limitations ? (
              <section className="resource-detail-prose-section">
                <h2>Limitations</h2>
                <EvidenceCopy section={resource.presentationProfile.limitations} />
              </section>
            ) : null}

            {/* 6. Related topics (renamed from Governed discovery tags) */}
            {taxonomyTags.length ? (
              <section className="resource-detail-prose-section">
                <h2>Related topics</h2>
                <p>These topics link to related Library records. They do not imply a compliance mandate.</p>
                <div className="resource-detail-tags">
                  {taxonomyTags.map((tag) => (
                    <AppLink key={tag.id} onNavigate={onNavigate} patch={{ tags: [tag.id] }} view="search">{tag.label}</AppLink>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 7. Source & maintenance details (Disclosure) */}
            <section className="resource-detail-prose-section resource-maintenance-section">
              <details className="resource-maintenance-disclosure">
                <summary className="resource-maintenance-disclosure__summary">
                  <span className="resource-maintenance-disclosure__title">Source &amp; maintenance details</span>
                  <IconChevronDown aria-hidden="true" className="disclosure-chevron" size={16} />
                </summary>
                <div className="resource-maintenance-disclosure__body">
                  <h2 className="visually-hidden">Maintenance</h2>
                  <dl className="resource-detail-facts stacked">
                    <div><dt>Release</dt><dd>{resource.currentVersion || (resource.toolProfile?.release.status === "not_published" ? "No published GitHub release" : "Not documented")}</dd></div>
                    <div><dt>Maintenance</dt><dd>{resourceFieldLabel(resource.maintenanceStatus)}</dd></div>
                    <div><dt>License</dt><dd>{resource.license || "Not documented"}</dd></div>
                    <div><dt>Last repository activity</dt><dd><ResourceDate fallback="Not documented" value={resource.lastCommitAt} /></dd></div>
                    {resource.publisherUpdatedAt ? <div><dt>Publisher updated</dt><dd><ResourceDate fallback="Not documented" value={resource.publisherUpdatedAt} /></dd></div> : null}
                    <div><dt>Last checked</dt><dd><ResourceDate fallback="Not documented" value={resource.lastCheckedAt} /></dd></div>
                    <div><dt>Next review</dt><dd><ResourceDate fallback="Not scheduled" value={resource.nextCheckAt} /></dd></div>
                    <div><dt>Method</dt><dd>{resourceFieldLabel(resource.verificationMethod || "manual_review")}</dd></div>
                  </dl>
                  {resource.repositoryEvidence ? (
                    <p className="resource-detail-evidence">
                      <a href={resource.repositoryEvidence.commitUrl} rel="noopener noreferrer" target="_blank">
                        Evidence commit {resource.repositoryEvidence.commitSha.slice(0, 7)} <IconExternalLink aria-hidden="true" size={14} />
                      </a>
                    </p>
                  ) : null}
                  {resource.compatibility?.sourceUrl ? (
                    <p className="resource-detail-evidence">
                      <a href={resource.compatibility.sourceUrl} rel="noopener noreferrer" target="_blank">
                        Compatibility evidence <IconExternalLink aria-hidden="true" size={14} />
                      </a>
                    </p>
                  ) : null}
                  {resource.repositoryEvidence?.readmeUrl ? (
                    <p className="resource-detail-evidence">
                      <a href={resource.repositoryEvidence.readmeUrl} rel="noopener noreferrer" target="_blank">
                        Inspected README <IconExternalLink aria-hidden="true" size={14} />
                      </a>
                    </p>
                  ) : null}
                  {resource.toolProfile?.release?.url ? (
                    <p className="resource-detail-evidence">
                      <a href={resource.toolProfile.release.url} rel="noopener noreferrer" target="_blank">
                        Release evidence <IconExternalLink aria-hidden="true" size={14} />
                      </a>
                    </p>
                  ) : null}
                </div>
              </details>
            </section>
          </article>

          <aside className="resource-detail-side">
            {parent || children.length > 0 || collections.length > 0 ? (
              <section className="resource-detail-section">
                <h2>Related Resources</h2>
                {parent ? <AppLink className="resource-context-link" onNavigate={onNavigate} patch={{ ...viewState, id: parent.id }} view="commons-detail"><span>Part of</span><strong>{parent.name}</strong></AppLink> : null}
                {children.map((child) => <AppLink className="resource-context-link" key={child.id} onNavigate={onNavigate} patch={{ ...viewState, id: child.id }} view="commons-detail"><span>Related service</span><strong>{child.name}</strong></AppLink>)}
                {collections.map((collection) => <AppLink className="resource-context-link" key={collection.id} onNavigate={onNavigate} patch={{ collection: collection.id, showAll: "true" }} view="commons"><span>Collection</span><strong>{collection.title}</strong></AppLink>)}
              </section>
            ) : null}
            <section className="resource-detail-section">
              <h2>Related Publications</h2>
              <p>Search the Library for publications related to this resource.</p>
              <AppLink className="resource-library-search" onNavigate={onNavigate} patch={{ query: resource.frameworks[0] || resource.programs?.[0] || resource.shortName }} view="search">
                <IconBook2 aria-hidden="true" size={16} />Search the Library
              </AppLink>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
