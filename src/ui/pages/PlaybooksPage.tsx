import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconArrowRight,
  IconArrowsExchange,
  IconChecklist,
  IconCloud,
  IconExternalLink,
  IconFiles,
  IconFlag,
  IconHierarchy3,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";

import {
  learnArticleById,
  practitionerGuides,
} from "../../app/learn-content.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { AppLink } from "../components/AppLink";
import { BucketTag } from "../components/TaxonomyTag";
import { TaxonomyTagLinks } from "../components/ContextualTaxonomyLinks";
import { PageHeader } from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

const GUIDE_PRESENTATION: Record<
  string,
  { area: string; Icon: typeof IconFlag; tagIds?: string[] }
> = Object.freeze({
  "starting-an-authorization": { area: "Governance", Icon: IconFlag },
  "understanding-rmf": { area: "Governance", Icon: IconRoute },
  "selecting-controls": { area: "Compliance", Icon: IconChecklist },
  "implementing-controls": { area: "Implementation", Icon: IconSettings },
  "preparing-evidence": { area: "Assessment", Icon: IconFiles },
  "conducting-assessments": { area: "Assessment", Icon: IconSearch },
  "managing-findings": { area: "Operations", Icon: IconAlertTriangle },
  "continuous-monitoring": { area: "Operations", Icon: IconActivityHeartbeat },
  "inheritance-and-common-controls": { area: "Architecture", Icon: IconHierarchy3 },
  reciprocity: { area: "Governance", Icon: IconArrowsExchange },
  "cloud-and-shared-responsibility": { area: "Architecture", Icon: IconCloud, tagIds: ["environment.cloud"] },
  "stig-lifecycle": { area: "Implementation", Icon: IconShieldCheck },
});

export function PlaybooksPage(props: {
  bundle: RuntimeBundle | null;
  state: Extract<ViewState, { view: "patterns" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNodeByItemId: (itemId: string) => void;
  onOpenGlossary: (termId?: string) => void;
}) {
  const { state, onNavigate } = props;
  const selected = learnArticleById(state.pattern);
  const selectedPresentation = selected ? GUIDE_PRESENTATION[selected.id] : null;

  if (!selected) {
    return (
      <section
        aria-labelledby="guides-title"
        className="ca-page guides-directory"
        data-page-template="directory"
        data-template="F"
        data-visual-identity="practitioner-field-manual"
      >
        <PageHeader
          eyebrow="PRACTITIONER FIELD MANUAL / 12 GUIDES"
          primary
          summary={SITE_COPY.routes.guides.purpose}
          title={<span id="guides-title">Guides</span>}
        />
        <section aria-label="Practitioner guides" className="learn-article-grid">
          {practitionerGuides.map((article, index) => {
            const presentation = GUIDE_PRESENTATION[article.id];
            if (!presentation) {
              throw new Error(`Missing Guide presentation for ${article.id}.`);
            }
            const { Icon } = presentation;
            return (
              <AppLink
                className="guide-card"
                data-guide-area={presentation.area}
                data-guide-step={index + 1}
                key={article.id}
                onNavigate={onNavigate}
                patch={{ pattern: article.id }}
                view="patterns"
              >
                <span aria-hidden="true" className="guide-card__icon">
                  <Icon size={22} stroke={1.8} />
                </span>
                <span className="guide-card__body">
                  <span className="guide-card__meta">
                    <span className="guide-card__step">Step {String(index + 1).padStart(2, "0")}</span>
                    <BucketTag area={presentation.area}>{presentation.area}</BucketTag>
                  </span>
                  <strong>{article.title}</strong>
                  <small>{article.summary}</small>
                </span>
                <IconArrowRight aria-hidden="true" className="guide-card__arrow" size={18} />
              </AppLink>
            );
          })}
        </section>

        <div className="card-actions">
          <AppLink onNavigate={onNavigate} variant="secondary" view="about">
            How to use Control Atlas
          </AppLink>
        </div>
      </section>
    );
  }

  const guideIndex = practitionerGuides.findIndex((g) => g.id === selected.id);
  const guideNumber = guideIndex >= 0 ? String(guideIndex + 1).padStart(2, "0") : "01";
  const eyebrowText =
    selected.kind === "practitioner"
      ? `Guide ${guideNumber} / ${selectedPresentation?.area || "Practitioner guide"}`
      : "Control Atlas explanation";

  return (
    <div className="guide-page ca-mission-page" data-visual-identity="practitioner-field-manual">
      <PageHeader
        action={
          <AppLink onNavigate={onNavigate} patch={{ pattern: "" }} variant="secondary" view="patterns">
            Back to Guides
          </AppLink>
        }
        eyebrow={eyebrowText}
        summary={selected.summary}
        title={selected.title}
      />

      <div className="doc-shell">
        <nav aria-label="Guides navigation" className="doc-nav">
          <span className="doc-nav-heading">All Guides</span>
          <AppLink className="doc-nav-back" onNavigate={onNavigate} patch={{ pattern: "" }} view="patterns">
            ← All Guides
          </AppLink>
          {practitionerGuides.map((guide, idx) => {
            const isCurrent = guide.id === selected.id;
            return (
              <AppLink
                aria-current={isCurrent ? "page" : undefined}
                className="doc-nav-link"
                key={guide.id}
                onNavigate={onNavigate}
                patch={{ pattern: guide.id }}
                view="patterns"
              >
                <span className="doc-nav-link-step">Step {String(idx + 1).padStart(2, "0")}</span>
                <span className="doc-nav-link-title">{guide.title}</span>
              </AppLink>
            );
          })}
        </nav>

        <article className="guide-article prose">
          <p className="guide-article-lead">{selected.summary}</p>

          {selected.whenItMatters ? (
            <section className="guide-section" id="when-it-matters">
              <h3>When it matters</h3>
              <p>{selected.whenItMatters}</p>
            </section>
          ) : null}

          {selected.whereItSits ? (
            <section className="guide-section" id="where-it-sits">
              <h3>Where it sits</h3>
              <p>{selected.whereItSits}</p>
            </section>
          ) : null}

          <section className="guide-section" id="what-this-means">
            <h3>What this means</h3>
            <p>{selected.explanation}</p>
          </section>

          <div className="callout guide-limitations-callout" id="limitations">
            <strong>Operating limitation / Limitations</strong>
            <p>{selected.limitations}</p>
          </div>

          <section aria-labelledby="learn-citations" className="guide-citations-section" id="official-references">
            <h3 id="learn-citations">Official references</h3>
            <ul className="guide-citations-list">
              {selected.citations.map((citation) => (
                <li key={citation.url}>
                  <a href={citation.url} rel="noopener noreferrer" target="_blank" className="citation-link">
                    <span>{citation.label}</span>
                    <IconExternalLink aria-hidden="true" size={14} />
                  </a>
                  <p>
                    <strong>Supports:</strong> {citation.supports}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {selectedPresentation?.tagIds?.length ? (
            <section className="ca-contextual-taxonomy" aria-label={`Related Library tags for ${selected.title}`} id="related-records">
              <h3>Explore related Library records</h3>
              <p>
                These tags link to related records for this topic. They don't mean every one applies to your system.
              </p>
              <TaxonomyTagLinks onNavigate={onNavigate} tagIds={selectedPresentation.tagIds} />
            </section>
          ) : null}

          <div className="actions guide-actions" id="next-action">
            <AppLink
              onNavigate={onNavigate}
              patch={selected.nextAction.patch as Partial<ViewState> | undefined}
              variant="primary"
              view={selected.nextAction.view as ViewState["view"]}
            >
              {selected.nextAction.label}
            </AppLink>
            <AppLink
              onNavigate={onNavigate}
              patch={{ pattern: "" }}
              variant="secondary"
              view="patterns"
            >
              All guides
            </AppLink>
          </div>
        </article>

        <aside aria-label="On this page" className="toc guide-source-rail">
          <strong className="toc-heading">On this page</strong>
          <nav aria-label="Article sections" className="toc-links">
            {selected.whenItMatters ? <a href="#when-it-matters">When it matters</a> : null}
            {selected.whereItSits ? <a href="#where-it-sits">Where it sits</a> : null}
            <a href="#what-this-means">What this means</a>
            <a href="#limitations">Limitations</a>
            <a href="#official-references">Official references</a>
            {selectedPresentation?.tagIds?.length ? <a href="#related-records">Related records</a> : null}
            <a href="#next-action">Next action</a>
          </nav>
          <div className="toc-meta" style={{ marginTop: 16, borderTop: "1px solid var(--ca-border)", paddingTop: 12 }}>
            <strong className="toc-heading">Guide Context</strong>
            <div className="system-stat">
              <span>Area</span>
              <strong>{selectedPresentation?.area || "General"}</strong>
            </div>
            <div className="system-stat">
              <span>Sequence</span>
              <strong>Step {guideNumber} of {practitionerGuides.length}</strong>
            </div>
            <div className="system-stat">
              <span>Citations</span>
              <strong>{selected.citations.length} source{selected.citations.length === 1 ? "" : "s"}</strong>
            </div>
            <div className="system-stat">
              <span>Audience</span>
              <strong>Practitioner</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
