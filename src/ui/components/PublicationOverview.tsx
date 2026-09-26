import { IconArrowDown, IconExternalLink } from "@tabler/icons-react";

import { displayNameFor } from "../../app/display-names.mjs";
import { publicationNextActions, type PublicationNextAction } from "../lib/publicationActions";
import { jumpToSection } from "../lib/pagePrimitives";
import {
  publicationTrustFor,
  recordedBasisFor,
  recordedBasisNoteFor,
  type PublicationTrust,
} from "../lib/publicationIdentity";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import { AppLink } from "./AppLink";
import { AtlasTag } from "./AtlasTag";
import { Button, ButtonLink } from "./lsm/Button";
import {
  FreshnessValue,
  inlineLabel,
  LifecycleStatus,
  LimitationList,
  publisherLine,
  SourceDates,
  VersionValue,
} from "./PublicationTrust";

type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;

/** Compare pairs shown inline before pointing at Compare for the rest. */
const COMPARE_LIMIT = 6;

function openInNewTab(name: string) {
  return <span className="visually-hidden"> for {name} (opens in a new tab)</span>;
}

export function PublicationOverview(props: {
  bundle: RuntimeBundle;
  catalog: any;
  trust: PublicationTrust;
  records: any[];
  recordLabel: string;
  tierCount: number;
  tierLabel: string;
  tierLabelPlural: string;
  catalogAtlasTagIds: string[];
  onNavigate: Navigate;
}) {
  const { bundle, catalog, trust, records, recordLabel, onNavigate } = props;
  const recordsReady = bundle.catalogRecordsReady !== false;
  const recordCount = Number(catalog.leaf_record_count ?? catalog.node_count ?? 0);
  const actions = publicationNextActions({ trust, recordLabel, recordCount, mappingSources: bundle.mappingSources || {} });
  const official = actions.find((action) => action.kind === "official");
  const compares = actions.filter((action): action is Extract<PublicationNextAction, { kind: "compare" }> => action.kind === "compare");
  const journeys = actions.filter((action): action is Extract<PublicationNextAction, { kind: "journey" }> => action.kind === "journey");
  const templates = actions.filter((action): action is Extract<PublicationNextAction, { kind: "template" }> => action.kind === "template");

  const kinds = new Map<string, number>();
  for (const record of records) kinds.set(record.node_type || "record", (kinds.get(record.node_type || "record") || 0) + 1);
  const kindRows = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const basis = (trust.catalogId ? recordedBasisFor(trust.catalogId) : [])
    .map((sourceId) => bundle.runtime.getSource(sourceId))
    .filter(Boolean)
    .map((source: any) => publicationTrustFor({ source }));
  const basisNote = trust.catalogId ? recordedBasisNoteFor(trust.catalogId) : "";
  const crossConnected = Number(catalog.cross_catalog_connected_count || 0);

  return (
    <>
      <header className="catalog-detail-hero" data-publication-identity={catalog.id} data-route-primary-header="true">
        <p className="eyebrow" data-route-primary-copy="true">
          Publication{trust.role ? <span className="catalog-role"> · {trust.role}</span> : null}
        </p>
        <h1 data-route-primary-copy="true">{trust.practitionerName}</h1>
        {trust.showsOfficialTitle ? (
          <p className="catalog-official-title" data-official-title="">
            <span className="catalog-official-title__label">Official title</span>{" "}
            <span>{trust.officialTitle}</span>
          </p>
        ) : null}
        {trust.publisher ? (
          <p className="catalog-publisher" data-route-primary-copy="true">
            <span className="catalog-publisher__label">Published by</span> {publisherLine(trust)}
          </p>
        ) : null}
        {trust.summary ? <p className="catalog-synopsis">{trust.summary}</p> : null}
        {props.catalogAtlasTagIds.length > 0 ? (
          <div className="related-in-atlas__tags related-in-atlas__tags--inline">
            {props.catalogAtlasTagIds.map((tagId) => (
              <AtlasTag key={tagId} onNavigate={onNavigate} showIdentity size="sm" tagId={tagId} />
            ))}
          </div>
        ) : null}
        <dl aria-label="Publication status" className="catalog-trust-facts" data-route-primary-support="true">
          <div><dt>Version</dt><dd><VersionValue version={trust.version} /></dd></div>
          <div><dt>Status</dt><dd><LifecycleStatus lifecycle={trust.lifecycle} /></dd></div>
          <div><dt>Source freshness</dt><dd><FreshnessValue freshness={trust.freshness} /></dd></div>
          <div><dt>In Control Atlas</dt><dd>{recordCount.toLocaleString()} {inlineLabel(recordLabel)}</dd></div>
        </dl>
        <div className="catalog-source-actions" data-route-primary-support="true">
          {recordCount > 0 ? (
            <Button className="catalog-browse-action" onClick={() => jumpToSection("catalog-records-title")} type="button" variant="primary">
              <IconArrowDown aria-hidden="true" size={16} />
              {actions.find((action) => action.kind === "browse")?.label}
            </Button>
          ) : null}
          {official && official.kind === "official" ? (
            <ButtonLink className="catalog-source-link" href={official.url} rel="noreferrer" target="_blank" variant="secondary">
              {official.label}
              {openInNewTab(trust.officialTitle)}
              <IconExternalLink aria-hidden="true" size={16} />
            </ButtonLink>
          ) : null}
          {trust.catalogId ? (
            <AppLink onNavigate={onNavigate} patch={{ atlasFramework: trust.catalogId } as Partial<ViewState>} variant="secondary" view="atlas-map">
              See it on the Atlas
            </AppLink>
          ) : null}
          <AppLink onNavigate={onNavigate} patch={{ source: trust.sourceId } as Partial<ViewState>} variant="secondary-quiet" view="sources">
            Source details
          </AppLink>
        </div>
      </header>

      {/* Order is deliberate: what you can do with the publication, then the
          reference facts, then the policy context. These were four equal
          bordered boxes in an auto-fit grid, which put "Work with it" alone on
          a second row at a third of the width while two thirds sat empty, and
          made a two-line panel as loud as an eight-line one. Rules and
          whitespace carry the hierarchy now; nothing here is a card. */}
      <section aria-labelledby="catalog-about-title" className="catalog-about" data-publication-about={catalog.id}>
        <h2 className="visually-hidden" id="catalog-about-title">About {trust.practitionerName}</h2>

        {compares.length || journeys.length || templates.length ? (
          <section aria-labelledby="catalog-next-title" className="catalog-about__work">
            <h3 id="catalog-next-title">Work with it</h3>
            <div className="catalog-work-groups">
              {compares.length ? (
                <div className="catalog-work-group">
                  <h4>Published crosswalks</h4>
                  <ul className="catalog-next-list">
                    {compares.slice(0, COMPARE_LIMIT).map((action) => (
                      <li key={action.target}>
                        <AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "frameworks", source: trust.catalogId, target: action.target, compareRun: "true" } as Partial<ViewState>} view="matrix">{action.label}</AppLink>
                        <small>Evidence: {action.via}</small>
                      </li>
                    ))}
                  </ul>
                  {compares.length > COMPARE_LIMIT ? <p><AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "frameworks", source: trust.catalogId } as Partial<ViewState>} view="matrix">All {compares.length} crosswalks in Compare</AppLink></p> : null}
                </div>
              ) : null}
              {journeys.length ? (
                <div className="catalog-work-group">
                  <h4>Atlas journeys</h4>
                  <ul className="catalog-next-list">
                    {journeys.map((action) => (
                      <li key={action.journeyId}><AppLink onNavigate={onNavigate} patch={{ atlasJourney: action.journeyId } as Partial<ViewState>} view="atlas-map">{action.label}</AppLink></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {templates.length ? (
                <div className="catalog-work-group">
                  <h4>Templates that cite it</h4>
                  <ul className="catalog-next-list">
                    {templates.map((action) => (
                      <li key={action.templateName}><AppLink onNavigate={onNavigate} patch={{ buildSection: "documents", templateType: action.templateName } as Partial<ViewState>} view="templates">{action.label}</AppLink></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="catalog-about__reference">
          <section aria-labelledby="catalog-indexes-title" className="catalog-about__panel">
            <h3 id="catalog-indexes-title">What Control Atlas indexes</h3>
            {recordsReady && kindRows.length ? (
              <ul className="catalog-kind-list">
                {kindRows.map(([kind, count]) => (
                  <li key={kind}><strong>{count.toLocaleString()}</strong> {pluralKind(kind, count)}</li>
                ))}
              </ul>
            ) : (
              <p><strong>{recordCount.toLocaleString()}</strong> {inlineLabel(recordLabel)}</p>
            )}
            {props.tierCount > 1 ? <p>Organized the way the publisher organizes it: {props.tierCount.toLocaleString()} {props.tierLabelPlural}.</p> : null}
            {crossConnected > 0 ? (
              <p>{crossConnected.toLocaleString()} {crossConnected === 1 ? "record connects" : "records connect"} to other publications through published relationships.</p>
            ) : (
              <p>No published relationships connect these records to other publications.</p>
            )}
            {trust.coverageNote ? <p className="catalog-coverage-note">{trust.coverageNote}</p> : null}
          </section>

          <section aria-labelledby="catalog-source-title" className="catalog-about__panel">
            <h3 id="catalog-source-title">Edition and freshness</h3>
            {trust.version.state !== "recorded" && trust.version.detail ? <p className="publication-fact-detail">{trust.version.detail}</p> : null}
            {trust.lifecycle.note ? <p className="publication-fact-detail">{trust.lifecycle.note}</p> : null}
            <SourceDates trust={trust} />
            {trust.limitations.length ? (
              <>
                <h4>Known limitations</h4>
                <LimitationList limitations={trust.limitations} />
              </>
            ) : null}
          </section>
        </div>

        {basis.length || basisNote ? (
          <section aria-labelledby="catalog-basis-title" className="catalog-about__basis">
            <h3 id="catalog-basis-title">Recorded policy basis</h3>
            {/* The intro promises a list. With no policy recorded it promised
                one and delivered a note, which read as a missing section. */}
            {basis.length ? (
              <p className="catalog-basis-intro">Policy that Control Atlas records as the basis for this publication. It does not decide whether the publication applies to you.</p>
            ) : null}
            {basis.length ? (
              <ul className="catalog-basis-list">
                {basis.map((policy) => (
                  <li key={policy.sourceId}>
                    <AppLink onNavigate={onNavigate} patch={{ source: policy.sourceId, layer: "policy" } as Partial<ViewState>} view="sources">{policy.practitionerName}</AppLink>
                    {policy.showsOfficialTitle ? <small>{policy.officialTitle}</small> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {basisNote ? <p>{basisNote}</p> : null}
          </section>
        ) : null}
      </section>
    </>
  );
}

function pluralKind(kind: string, count: number): string {
  const label = inlineLabel(displayNameFor("node_type", kind));
  if (count === 1) return label;
  if (/(s|x|ch|sh)$/.test(label)) return `${label}es`;
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}
