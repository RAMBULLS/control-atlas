// Control Atlas Pulse, Phase 1: what changed in the accepted corpus and the product.
//
// Pulse is an output of trusted lifecycle data, never a crawler:
//   accepted refresh or release -> governed diff -> Pulse artifact -> site build.
// Inputs are the admitted change log (data/source-change-log.json, written only by
// an admitted refresh), the accepted baseline chain (data/source-baselines.json),
// the served relationship sets (maps/*.json) and, for product events, the Git
// history the site is built from (merged pull requests and reachable release
// tags; see product-history.mjs). data/pulse-presentation.json only words those
// events; it never establishes that anything shipped. A quarantined or rejected fetch never reaches
// the change log; an entry that does not match the accepted chain is withheld and
// listed with its reason, so every shown and every withheld item can be audited.
import { createHash } from 'node:crypto';
import { CONTENT_DIFF_BASIS, observeRelationshipSet } from './source-change-evidence.mjs';

export const PULSE_SCHEMA_VERSION = '1.0';
export const PULSE_EVENT_LIMIT = 40;
export const PULSE_HOME_LIMIT = 5;
/** Days without a new event, measured to the source-data build date, after which Home says it is quiet. */
export const PULSE_QUIET_AFTER_DAYS = 14;
/** Decisions the refresh gate returns for an accepted candidate (scripts/lib/source-baseline.mjs), plus adoption of reviewed data. */
export const ACCEPTED_DECISIONS = Object.freeze(['within_band', 'publisher_revision', 'reconciled_change', 'adopted_committed_state']);
export const PULSE_EVENT_TYPES = Object.freeze([
  'publication_updated', 'records_added', 'records_removed', 'records_changed', 'records_superseded',
  'snapshot_changed', 'relationships_changed', 'feature_shipped', 'product_release',
]);
/** Plain labels a reader sees for each event type. */
export const PULSE_TYPE_LABELS = Object.freeze({
  publication_updated: 'Publication updated',
  records_added: 'Records added',
  records_removed: 'Records removed',
  records_changed: 'Records changed',
  records_superseded: 'Records superseded',
  snapshot_changed: 'Record set changed',
  relationships_changed: 'Connections updated',
  feature_shipped: 'New in Control Atlas',
  product_release: 'Release',
});
const RELEASE_VIEWS = new Set(['home', 'atlas-map', 'search', 'catalog-detail', 'matrix', 'templates', 'sources', 'commons', 'start-here', 'about']);
const SUPERSEDING_FIELDS = new Set(['superseded_by', 'replaced_by']);
const SUPERSEDED_STATE = /supersed|withdrawn|deprecat|retired|replaced/i;

const sha12 = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const count = (value) => Number(value).toLocaleString('en-US');
const plural = (value, one, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function utc(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

/**
 * Records moved to a superseded state. One record can move on several lifecycle fields
 * (status and superseded_by), so fields are totalled separately and the largest total is
 * reported: a lower bound that never counts a record twice.
 */
function supersededCount(transitions = []) {
  const byField = new Map();
  for (const move of transitions) {
    const superseding = SUPERSEDING_FIELDS.has(move.field) && move.to !== null && move.to !== false && move.to !== '';
    const state = !SUPERSEDING_FIELDS.has(move.field) && typeof move.to === 'string' && SUPERSEDED_STATE.test(move.to);
    if ((superseding || state) && isCount(move.count)) byField.set(move.field, (byField.get(move.field) || 0) + move.count);
  }
  return Math.max(0, ...byField.values());
}

/** Every normalized snapshot the baseline records as accepted for a catalog. */
function acceptedChain(baseline) {
  const chain = new Set();
  if (baseline?.accepted?.normalized_sha256) chain.add(baseline.accepted.normalized_sha256);
  for (const item of baseline?.history || []) if (item?.normalized_sha256) chain.add(item.normalized_sha256);
  return chain;
}

function sourceEvent(entry, index, { publications, baselines }) {
  const id = entry.catalog_id;
  const pointer = `data/source-change-log.json#catalogs.${id}[${index}]`;
  const withheld = (reason) => ({ withheld: { pointer, catalog_id: id, accepted_at: entry.accepted_at ?? null, reason } });
  if (!ACCEPTED_DECISIONS.includes(entry.decision)) return withheld('decision_not_accepted');
  const timestamp = utc(entry.accepted_at);
  if (!timestamp) return withheld('no_accepted_date');
  const baseline = baselines?.catalogs?.[id];
  if (!baseline) return withheld('no_accepted_baseline');
  if (!acceptedChain(baseline).has(entry.current?.normalized_sha256)) return withheld('not_in_accepted_baseline_chain');
  const publication = publications.get(id);
  if (!publication) return withheld('unknown_publication');

  const previous = entry.previous || {};
  const current = entry.current;
  const trustedRevisions = entry.diff_basis === CONTENT_DIFF_BASIS && isCount(entry.changed_count);
  const counts = {};
  if (isCount(previous.record_count)) counts.previous_records = previous.record_count;
  if (isCount(current.record_count)) counts.current_records = current.record_count;
  if (isCount(entry.added_count)) counts.added = entry.added_count;
  if (isCount(entry.removed_count)) counts.removed = entry.removed_count;
  if (trustedRevisions) counts.revised = entry.changed_count;
  const superseded = supersededCount(entry.lifecycle_transitions);
  if (superseded) counts.superseded = superseded;
  const added = counts.added || 0;
  const removed = counts.removed || 0;
  const revised = counts.revised || 0;
  const versionChanged = entry.version_changed === true && Boolean(current.publisher_version);
  const measured = isCount(entry.added_count);
  const delta = isCount(counts.previous_records) && isCount(counts.current_records) ? counts.current_records - counts.previous_records : 0;

  const { name, publisher } = publication;
  const setSize = isCount(counts.current_records) ? ` The set now holds ${plural(counts.current_records, 'record')}.` : '';
  const itemized = [added && `${count(added)} added`, removed && `${count(removed)} removed`, revised && `${count(revised)} revised`].filter(Boolean);
  const itemizedSentence = itemized.length ? ` ${itemized.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : '';

  let type;
  let title;
  let summary;
  if (versionChanged) {
    type = 'publication_updated';
    title = `${name} updated to ${current.publisher_version}`;
    summary = `Control Atlas accepted ${publisher}'s ${current.publisher_version}${previous.publisher_version ? ` (was ${previous.publisher_version})` : ''}.${itemizedSentence}${setSize}`;
  } else if (superseded) {
    type = 'records_superseded';
    title = `${plural(superseded, `${name} record`)} superseded`;
    summary = `${publisher} marked ${plural(superseded, 'record')} as superseded or withdrawn.${itemizedSentence}${setSize}`;
  } else if (added && !removed && !revised) {
    type = 'records_added';
    title = `${plural(added, `new ${name} record`)}`;
    summary = `Control Atlas accepted ${plural(added, 'new record')} from ${publisher}; none were removed.${setSize}`;
  } else if (removed && !added && !revised) {
    type = 'records_removed';
    title = `${plural(removed, `${name} record`)} removed`;
    summary = `${publisher} no longer publishes ${plural(removed, 'record')} that Control Atlas held.${setSize}`;
  } else if (added || removed || revised) {
    type = 'records_changed';
    title = `${name} records changed`;
    summary = `Control Atlas accepted a change from ${publisher}.${itemizedSentence}${setSize}`;
  } else if (!measured && delta !== 0) {
    type = 'snapshot_changed';
    title = `${name} record set ${delta > 0 ? 'grew' : 'shrank'} to ${count(counts.current_records)}`;
    summary = `A reviewed data update changed the accepted ${name} set from ${count(counts.previous_records)} to ${count(counts.current_records)} records. Individual additions and removals were not itemized for this change.`;
  } else {
    // Only retrieval dates, checksums or other provenance stamps moved, or the
    // change was not measured: nothing a reader could verify happened.
    return withheld(measured ? 'no_verified_content_change' : 'unmeasured_without_count_change');
  }

  const key = `source|${id}|${previous.normalized_sha256 || ''}|${current.normalized_sha256}`;
  return {
    key,
    event: {
      id: `source-${id}-${sha12(key)}`,
      type,
      date: timestamp.slice(0, 10),
      timestamp,
      date_kind: 'accepted',
      title,
      summary,
      subject: { kind: 'publication', id, name, publisher },
      counts,
      destination: { label: `Open ${name}`, view: 'catalog-detail', patch: { catalog: id } },
      identity: {
        previous_sha256: previous.normalized_sha256 ?? null,
        accepted_sha256: current.normalized_sha256,
        previous_publisher_version: previous.publisher_version ?? null,
        publisher_version: current.publisher_version ?? null,
      },
      evidence: {
        basis: 'accepted_source_change',
        pointer,
        decision: entry.decision,
        accepted_chain: `data/source-baselines.json#catalogs.${id}`,
        revisions_basis: trustedRevisions ? CONTENT_DIFF_BASIS : null,
        ...(entry.added_sample?.length ? { added_sample: entry.added_sample.slice(0, 5) } : {}),
      },
    },
  };
}

function relationshipEvent(entry, index, isLatest, { publications, relationshipSets, servedSets }) {
  const setPath = entry.set_path;
  const pointer = `data/source-change-log.json#relationship_sets.${setPath}[${index}]`;
  const withheld = (reason) => ({ withheld: { pointer, set_path: setPath, accepted_at: entry.accepted_at ?? null, reason } });
  const timestamp = utc(entry.accepted_at);
  if (!timestamp) return withheld('no_accepted_date');
  const endpoints = relationshipSets[setPath];
  if (!endpoints) return withheld('unknown_relationship_set');
  if (isLatest) {
    const served = servedSets.get(setPath);
    if (!served || served.relationships_sha256 !== entry.current?.relationships_sha256) return withheld('does_not_match_served_set');
  }
  const [fromId, toId] = endpoints;
  const from = publications.get(fromId);
  const to = publications.get(toId);
  if (!from || !to) return withheld('unknown_publication');
  const counts = {};
  if (isCount(entry.previous?.relationship_count)) counts.previous_connections = entry.previous.relationship_count;
  if (isCount(entry.current?.relationship_count)) counts.current_connections = entry.current.relationship_count;
  if (isCount(entry.added_count)) counts.added = entry.added_count;
  if (isCount(entry.removed_count)) counts.removed = entry.removed_count;
  if (!counts.added && !counts.removed && !entry.version_changed) return withheld('no_verified_content_change');
  const parts = [counts.added && `${plural(counts.added, 'connection')} added`, counts.removed && `${plural(counts.removed, 'connection')} removed`].filter(Boolean);
  const version = entry.version_changed && entry.current?.source_version ? ` Published version ${entry.current.source_version}.` : '';
  const key = `relationships|${setPath}|${entry.previous?.relationships_sha256 || ''}|${entry.current.relationships_sha256}|${entry.current.source_version ?? ''}`;
  return {
    key,
    event: {
      id: `relationships-${sha12(key)}`,
      type: 'relationships_changed',
      date: timestamp.slice(0, 10),
      timestamp,
      date_kind: 'accepted',
      title: `${from.name} to ${to.name} connections updated`,
      summary: `${parts.length ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : 'The published set changed.'}${version}${isCount(counts.current_connections) ? ` The set now holds ${plural(counts.current_connections, 'connection')}.` : ''}`,
      subject: { kind: 'relationship_set', id: setPath, name: `${from.name} to ${to.name}`, publisher: from.publisher, direction: { from: fromId, to: toId } },
      counts,
      destination: {
        label: `Compare ${from.name} and ${to.name}`, view: 'matrix',
        patch: { crosswalk: 'relationships', intent: 'frameworks', source: fromId, target: toId, compareRun: 'true' },
      },
      identity: {
        previous_sha256: entry.previous?.relationships_sha256 ?? null,
        accepted_sha256: entry.current.relationships_sha256,
        previous_publisher_version: entry.previous?.source_version ?? null,
        publisher_version: entry.current.source_version ?? null,
      },
      evidence: { basis: 'accepted_relationship_change', pointer, source_key: entry.source_key ?? null, direction: entry.direction ?? 'source_to_target' },
    },
  };
}

export const PRESENTATION_PATH = 'data/pulse-presentation.json';
const FEATURE_KEYS = ['pull_request', 'title', 'summary', 'destination'];
const RELEASE_KEYS = ['tag', 'title', 'summary', 'destination'];

/**
 * Presentation text is only words and a destination. Any shipping fact (a date, a commit,
 * an issue, a "shipped" flag) is rejected, so authored text can never make an event exist,
 * date it or order it.
 */
export function validatePresentation(document) {
  const problem = (where, message) => { throw new Error(`${PRESENTATION_PATH} ${where}: ${message}`); };
  if (document?.schema_version !== '1.0') problem('', 'schema_version must be 1.0');
  const check = (entry, keys, where) => {
    const extra = Object.keys(entry || {}).filter((key) => !keys.includes(key));
    if (extra.length) problem(where, `only ${keys.join(', ')} are allowed; shipping facts come from Git (${extra.join(', ')})`);
    for (const field of ['title', 'summary']) if (typeof entry[field] !== 'string' || !entry[field].trim()) problem(where, `${field} is required`);
    const destination = entry.destination || {};
    if (typeof destination.label !== 'string' || !destination.label.trim() || !RELEASE_VIEWS.has(destination.view)) problem(where, 'destination needs a label and a known view');
    if (destination.patch !== undefined && (typeof destination.patch !== 'object' || Array.isArray(destination.patch))) problem(where, 'destination patch must be an object');
  };
  const seen = new Set();
  (document.features || []).forEach((entry, index) => {
    check(entry, FEATURE_KEYS, `features[${index}]`);
    if (!Number.isSafeInteger(entry.pull_request) || entry.pull_request < 1) problem(`features[${index}]`, 'pull_request must be a pull request number');
    if (seen.has(`pr-${entry.pull_request}`)) problem(`features[${index}]`, 'duplicate pull request');
    seen.add(`pr-${entry.pull_request}`);
  });
  (document.releases || []).forEach((entry, index) => {
    check(entry, RELEASE_KEYS, `releases[${index}]`);
    if (typeof entry.tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.tag)) problem(`releases[${index}]`, 'tag must be a tag name');
    if (seen.has(`tag-${entry.tag}`)) problem(`releases[${index}]`, 'duplicate tag');
    seen.add(`tag-${entry.tag}`);
  });
  return document;
}

const PRODUCT_SUBJECT = Object.freeze({ kind: 'product', id: 'control-atlas', name: 'Control Atlas', publisher: 'Control Atlas' });

/** Product events: presentation text joined to shipping facts derived from Git. */
function productEvents(presentation, history) {
  if (!presentation) return [];
  validatePresentation(presentation);
  const results = [];
  const withheld = (pointer, reason, extra) => results.push({ withheld: { pointer, reason, ...extra } });
  const destinationOf = (entry) => ({ label: entry.destination.label, view: entry.destination.view, patch: entry.destination.patch || {} });
  (presentation.features || []).forEach((entry, index) => {
    const pointer = `${PRESENTATION_PATH}#features[${index}]`;
    if (!history?.available) return withheld(pointer, 'git_history_unavailable', { pull_request: entry.pull_request });
    const merge = history.merges.get(entry.pull_request);
    if (!merge?.committed_at) return withheld(pointer, 'pull_request_not_merged_on_build_history', { pull_request: entry.pull_request });
    results.push({
      key: `feature|${entry.pull_request}`,
      event: {
        id: `feature-pr-${entry.pull_request}`,
        type: 'feature_shipped',
        date: merge.committed_at.slice(0, 10),
        timestamp: merge.committed_at,
        date_kind: 'shipped',
        title: entry.title,
        summary: entry.summary,
        subject: { ...PRODUCT_SUBJECT },
        counts: {},
        destination: destinationOf(entry),
        identity: { pull_request: entry.pull_request, merge_commit: merge.sha, tag: null, tag_commit: null },
        evidence: {
          basis: 'merged_pull_request', pointer, commit: merge.sha, committed_at: merge.committed_at,
          subject: merge.subject, history: 'first-parent history of the build commit', build_head: history.head,
        },
      },
    });
  });
  (presentation.releases || []).forEach((entry, index) => {
    const pointer = `${PRESENTATION_PATH}#releases[${index}]`;
    if (!history?.available) return withheld(pointer, 'git_history_unavailable', { tag: entry.tag });
    const tag = history.tags.get(entry.tag);
    if (!tag?.found) return withheld(pointer, 'tag_not_found', { tag: entry.tag });
    if (!tag.reachable) return withheld(pointer, 'tag_not_reachable_from_build_history', { tag: entry.tag });
    if (!tag.tagged_at) return withheld(pointer, 'tag_has_no_date', { tag: entry.tag });
    results.push({
      key: `release|${entry.tag}`,
      event: {
        id: `release-${entry.tag.toLowerCase()}`,
        type: 'product_release',
        date: tag.tagged_at.slice(0, 10),
        timestamp: tag.tagged_at,
        date_kind: 'shipped',
        title: entry.title,
        summary: entry.summary,
        subject: { ...PRODUCT_SUBJECT },
        counts: {},
        destination: destinationOf(entry),
        identity: { pull_request: null, merge_commit: null, tag: entry.tag, tag_commit: tag.commit },
        evidence: {
          basis: 'release_tag', pointer, tag: entry.tag, tag_object: tag.tag_object, commit: tag.commit,
          tagged_at: tag.tagged_at, annotated: tag.annotated, build_head: history.head,
        },
      },
    });
  });
  return results;
}

const byRecency = (left, right) => right.date.localeCompare(left.date)
  || (right.timestamp || '').localeCompare(left.timestamp || '')
  || left.id.localeCompare(right.id);

const daysBetween = (fromDate, toDate) => Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);

/**
 * Build the Pulse artifact. Pure and deterministic: the same inputs give the same bytes,
 * and an event keeps its id as long as the underlying accepted change is the same.
 *
 * @param {object} input
 * @param {object|null} input.changeLog data/source-change-log.json
 * @param {object} input.baselines data/source-baselines.json
 * @param {object|null} input.presentation data/pulse-presentation.json (words and destinations only)
 * @param {object|null} input.history readProductHistory(): merged pull requests and release tags on the build history
 * @param {object} input.registry data/source-registry.json (quarantine state is reported, never shown as events)
 * @param {Map<string,{name:string,publisher:string}>} input.publications catalog id -> display identity
 * @param {Record<string,[string,string]>} input.relationshipSets relationship set path -> [from catalog, to catalog]
 * @param {Map<string,object>} input.servedSets relationship set path -> observeRelationshipSet(served document)
 * @param {{dataset_id:string, source_data_generated_at:string}} input.dataset
 * @param {Record<string,string>} input.inputs input file path -> sha256 of its bytes
 */
export function buildPulse({ changeLog, baselines, presentation = null, history = null, registry, publications, relationshipSets, servedSets, dataset, inputs }) {
  const found = new Map();
  const withheld = [];
  const keep = (result) => {
    if (result.withheld) { withheld.push(result.withheld); return; }
    if (!found.has(result.key)) found.set(result.key, result.event);
  };
  for (const [, entries] of Object.entries(changeLog?.catalogs || {}).sort(([a], [b]) => a.localeCompare(b))) {
    entries.forEach((entry, index) => keep(sourceEvent(entry, index, { publications, baselines })));
  }
  for (const [, entries] of Object.entries(changeLog?.relationship_sets || {}).sort(([a], [b]) => a.localeCompare(b))) {
    entries.forEach((entry, index) => keep(relationshipEvent(entry, index, index === entries.length - 1, { publications, relationshipSets, servedSets })));
  }
  for (const result of productEvents(presentation, history)) keep(result);

  const ids = new Set();
  for (const event of found.values()) {
    if (ids.has(event.id)) throw new Error(`Pulse event id collision: ${event.id}`);
    ids.add(event.id);
  }
  const events = [...found.values()].sort(byRecency).slice(0, PULSE_EVENT_LIMIT);
  const latest = events[0]?.date ?? null;
  const builtOn = utc(dataset.source_data_generated_at)?.slice(0, 10) ?? null;
  const quiet = !latest || (builtOn && daysBetween(latest, builtOn) > PULSE_QUIET_AFTER_DAYS);
  withheld.sort((a, b) => a.pointer.localeCompare(b.pointer));
  return {
    schema_version: PULSE_SCHEMA_VERSION,
    description: 'Control Atlas Pulse: accepted source changes and shipped product changes, newest first. Derived at build time; never hand-edited.',
    dataset: { dataset_id: dataset.dataset_id, source_data_generated_at: dataset.source_data_generated_at },
    inputs,
    status: { latest_event_date: latest, source_data_date: builtOn, quiet: Boolean(quiet), quiet_after_days: PULSE_QUIET_AFTER_DAYS },
    product_history: history?.available
      ? { available: true, build_head: history.head, basis: 'merged pull requests on the first-parent history of the build commit; tags reachable from it' }
      : { available: false, reason: history?.reason || 'not_read' },
    events,
    withheld,
    quarantine: (registry?.quarantine || []).map((item) => ({
      id: item.id, refresh_source_id: item.refresh_source_id, attempted_at: item.attempted_at ?? null,
      disposition: item.disposition ?? null, shown_as_event: false,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The bounded slice Home renders: a few newest events and the quiet state. No evidence payload. */
export function pulseHomeSlice(pulse, limit = PULSE_HOME_LIMIT) {
  return {
    dataset_id: pulse.dataset.dataset_id,
    status: pulse.status,
    events: pulse.events.slice(0, limit).map((event) => ({
      id: event.id, type: event.type, date: event.date, date_kind: event.date_kind,
      title: event.title, summary: event.summary, subject: event.subject.name,
      destination: event.destination,
    })),
  };
}
