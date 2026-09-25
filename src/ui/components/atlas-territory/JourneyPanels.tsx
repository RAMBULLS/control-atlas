import type { ReactNode } from "react";
import templateRegistry from "../../../../data/template-registry.json";
import workflowRegistry from "../../../../data/compliance-workflows.json";
import { JOURNEYS, policyForJourney, publicationsCitingPolicy, type Journey } from "../../lib/atlasJourneys";
import type { TerritoryListed } from "../../lib/atlasTerritoryIndex";
import type { TerritoryModel } from "../../lib/atlasTerritoryModel";
import type { ViewState } from "../../lib/viewState";
import { AppLink, type AppNavigate } from "../AppLink";

const TEMPLATE_NAMES = new Map(templateRegistry.templates.map((t) => [t.name, t.display_name]));
const TASK_TITLES = new Map(workflowRegistry.workflows.map((w) => [w.workflow_id, w.title]));

/** Said once on every journey, in the same words. */
export const JOURNEY_NOTE = "Grouped by Control Atlas for navigation. Not a publisher mapping.";
export const POLICY_NOTE = "The laws and directives behind the publications on this map.";

export const LEAD = "Start with what you’re working on";

/** The practitioner entry layer. One row on a desktop, a short list on a phone. */
export function JourneyBar(props: { active: string; onPick: (id: string) => void; policyOpen: boolean; onPolicy: () => void; phone?: boolean }) {
  const { active, onPick, policyOpen, onPolicy, phone } = props;
  const buttons = JOURNEYS.map((j) => (
    <li key={j.id}>
      <button aria-pressed={active === j.id} onClick={() => onPick(active === j.id ? "" : j.id)} title={j.expansion || undefined} type="button">{j.label}</button>
    </li>
  ));
  const policy = <button aria-expanded={policyOpen} className="atl-journeys__policy" onClick={onPolicy} type="button">Policy &amp; directives</button>;
  if (phone) {
    return (
      <section aria-labelledby="atl-journeys-h" className="atl-m-sec">
        <h2 id="atl-journeys-h">{LEAD}</h2>
        <ul className="atl-journeys__list">{buttons}</ul>
        <div className="atl-journeys__more">{policy}</div>
      </section>
    );
  }
  return (
    <nav aria-label={LEAD} className="atl-journeys">
      <span aria-hidden="true" className="atl-journeys__lead">{LEAD}</span>
      <ul className="atl-journeys__list">{buttons}</ul>
      {policy}
    </nav>
  );
}

type PolicyLookup = (id: string) => TerritoryListed | undefined;

function PolicyItem(props: { item: TerritoryListed; model: TerritoryModel; onPublication: (id: string) => void; onNavigate: AppNavigate; cites?: readonly string[]; basis?: string }) {
  const { item, model, onPublication, onNavigate } = props;
  const cites = (props.cites || publicationsCitingPolicy(item.id)).filter((id) => model.publicationById.has(id));
  return (
    <li className="atl-policy__item">
      <b>{item.name}</b>
      <small>{item.title ? `${item.title} · ` : ""}{item.publisher}</small>
      {cites.length ? (
        <div className="atl-policy__cites">
          <span>Cited as the basis for</span>
          <ul className="atl-chips">{cites.map((id) => <li key={id}><button onClick={() => onPublication(id)} type="button">{model.alias(id)}</button></li>)}</ul>
        </div>
      ) : null}
      {props.basis ? <small>{props.basis}</small> : null}
      <div className="atl-policy__links">
        <AppLink onNavigate={onNavigate} patch={{ source: item.id } as Partial<ViewState>} view="sources">Source record</AppLink>
        {item.url ? <a href={item.url} rel="noopener noreferrer" target="_blank">Official text<span className="atl-sr"> for {item.name} (opens in a new tab)</span></a> : null}
      </div>
    </li>
  );
}

/** Policy & directives: kept, grouped as the source register groups them, and explained. */
export function PolicyPanel(props: { items: readonly TerritoryListed[]; model: TerritoryModel; onPublication: (id: string) => void; onNavigate: AppNavigate }) {
  const groups = new Map<string, TerritoryListed[]>();
  for (const item of props.items) groups.set(item.group || "Other policy", [...(groups.get(item.group || "Other policy") || []), item]);
  return (
    <div aria-labelledby="atl-policy-h" className="atl-pop atl-pop--policy" role="region">
      <h2 id="atl-policy-h">Policy &amp; directives · {props.items.length}</h2>
      <p className="atl-note">{POLICY_NOTE}</p>
      {[...groups].map(([group, items]) => (
        <section className="atl-policy__group" key={group}>
          <h3>{group}</h3>
          <ul>{items.map((item) => <PolicyItem item={item} key={item.id} model={props.model} onNavigate={props.onNavigate} onPublication={props.onPublication} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return <section className="atl-journey__sec"><h3>{props.title}</h3>{props.children}</section>;
}

/** One journey: real destinations only, each labelled the way practitioners say it with the official identity beside it. */
export function JourneyCard(props: {
  journey: Journey; model: TerritoryModel; policy: PolicyLookup; onNavigate: AppNavigate;
  onPublication: (id: string) => void; onRecord: (nodeId: string) => void;
}) {
  const { journey: j, model, onNavigate } = props;
  const publications = j.publications.filter((p) => model.publicationById.has(p.id));
  // Compare is offered only where published records already join the two publications.
  const pairs = j.compare.filter(([a, b]) => model.routeByKey.has(a < b ? `${a}|${b}` : `${b}|${a}`));
  const policies = policyForJourney(j).flatMap((entry) => { const item = props.policy(entry.id); return item ? [{ item, entry }] : []; });
  const tasks = j.tasks.filter((id) => TASK_TITLES.has(id));
  const templates = j.templates.filter((name) => TEMPLATE_NAMES.has(name));
  return (
    <div aria-labelledby="atl-journey-h" className="atl-card atl-journey" role="group">
      <p className="atl-eyebrow">Start here</p>
      <h2 id="atl-journey-h">{j.label}</h2>
      {j.expansion ? <p className="atl-journey__exp">{j.expansion}</p> : null}
      <p>{j.summary}</p>
      {j.steps ? (
        <Section title={j.steps.heading}>
          <ol className="atl-journey__steps">
            {j.steps.items.map((s) => <li key={s.nodeId}><button onClick={() => props.onRecord(s.nodeId)} type="button">{s.label}</button></li>)}
          </ol>
        </Section>
      ) : null}
      {publications.length ? (
        <Section title="Publications">
          <ul className="atl-list">
            {publications.map((p) => {
              const pub = model.publicationById.get(p.id)!;
              return (
                <li key={p.id}>
                  <button aria-label={`${p.role}: ${pub.name}. Show it on the map.`} onClick={() => props.onPublication(p.id)} type="button">
                    <b>{p.role}</b>
                    <small><span className="atl-journey__official">{pub.name}</span>{model.alias(p.id) !== pub.name ? ` (${model.alias(p.id)})` : ""} · {pub.publisher}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      {pairs.length ? (
        <Section title="Compare">
          <ul className="atl-plain">
            {pairs.map(([a, b]) => (
              <li key={`${a}|${b}`}>
                <AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "frameworks", source: a, target: b, compareRun: "true" } as Partial<ViewState>} view="matrix">Compare {model.alias(a)} and {model.alias(b)}</AppLink>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {tasks.length || templates.length ? (
        <Section title="Working files">
          <ul className="atl-plain">
            {tasks.map((id) => <li key={id}><AppLink onNavigate={onNavigate} patch={{ buildSection: "tasks", task: id } as Partial<ViewState>} view="templates">{TASK_TITLES.get(id)}</AppLink> <small>Task guide</small></li>)}
            {templates.map((name) => <li key={name}><AppLink onNavigate={onNavigate} patch={{ buildSection: "documents", templateType: name } as Partial<ViewState>} view="templates">{TEMPLATE_NAMES.get(name)}</AppLink> <small>Template</small></li>)}
          </ul>
        </Section>
      ) : null}
      {j.resources.length || j.collections.length ? (
        <Section title="Resources">
          <ul className="atl-plain">
            {j.collections.map((c) => <li key={c.id}><AppLink onNavigate={onNavigate} patch={{ collection: c.id } as Partial<ViewState>} view="commons">{c.label}</AppLink> <small>Collection</small></li>)}
            {j.resources.map((r) => <li key={r.id}><AppLink onNavigate={onNavigate} patch={{ id: r.id } as Partial<ViewState>} view="commons-detail">{r.label}</AppLink></li>)}
          </ul>
        </Section>
      ) : null}
      {j.sources.length ? (
        <Section title="More in Sources">
          <ul className="atl-plain">
            {j.sources.map((s) => <li key={s.id}><AppLink onNavigate={onNavigate} patch={{ source: s.id } as Partial<ViewState>} view="sources">{s.label}</AppLink> <small>{s.role}</small></li>)}
          </ul>
        </Section>
      ) : null}
      {policies.length ? (
        <details className="atl-inline atl-journey__policy">
          <summary>Governing policy · {policies.length}</summary>
          <ul className="atl-policy">
            {policies.map(({ item, entry }) => <PolicyItem basis={entry.basis} cites={entry.cites} item={item} key={item.id} model={model} onNavigate={onNavigate} onPublication={props.onPublication} />)}
          </ul>
        </details>
      ) : null}
      <p className="atl-note atl-journey__note">{JOURNEY_NOTE}</p>
    </div>
  );
}
