import assert from 'node:assert/strict';
import test from 'node:test';
import { publisherReadingModel, publisherFactRows, publisherSection, publisherTextModel, type PublisherNode } from '../../src/shared/publisher-text-model';
import { atlasHashForId, recordHashForId, recordIdFromHash, recordIdFromPath } from '../../src/shared/record-route-identity';
import { recordPresentationContract } from '../../src/shared/record-presentation.mjs';
import { CONTROL_CONTEXT_RELATIONSHIP_TYPE } from '../../src/shared/record-control-context.mjs';

function text(value: PublisherNode): string {
  return typeof value === 'string' ? value : value.tag === 'snippet' ? value.attributes.value : value.children.map(text).join('');
}

test('publisher parameters, citations and inline code retain their source content and resolved references', () => {
  const source = 'Allow [Assignment: account types] and `root`. (Citation: publisher_ref)';
  const model = publisherSection('text', source, undefined, { publisher_ref: { title: 'Publisher reference', url: 'https://example.org/reference' } });
  assert.equal(model.map(text).join(''), 'Allow [Assignment: account types] and root. [1]');
  const serialized = JSON.stringify(model);
  assert.match(serialized, /odp-param/);
  assert.match(serialized, /https:\/\/example.org\/reference/);
  assert.doesNotMatch(serialized, /publisher_ref/);
  assert.match(JSON.stringify(publisherSection('text', '(Citation: unresolved)')), /Publisher cited a source here/);
});

test('invalid presentation cannot omit publisher prose; code following a procedure remains attached to its step', () => {
  const source = 'Run this command:\nwhoami';
  assert.equal(publisherSection('text', source, { version: 1, blocks: [] }).map(text).join(''), source);
  const model = publisherSection('structured', [{ title: 'Procedure', structured_content: [
    { type: 'ordered_list', items: ['First step', 'Second step'] }, { type: 'code', text: 'whoami' },
  ] }]);
  assert.equal(model.map(text).join(''), 'ProcedureFirst stepSecond stepwhoami');
});

test('complete declared sections retain contract order, structured assessment content and references', () => {
  const model = publisherTextModel([
    { field: 'description', heading: 'Statement', kind: 'text' },
    { field: 'objectives', heading: 'Objectives', kind: 'objectives' },
    { field: 'methods', heading: 'Methods', kind: 'methods' },
    { field: 'references', heading: 'References', kind: 'references' },
  ], { description: 'Complete statement.', objectives: [{ label: 'a', prose: 'Determine [Selection: yes; no].' }],
    methods: [{ method: 'EXAMINE', objects: ['policy', 'records'] }], references: [{ creator: 'Publisher', title: 'Source', version: '1', location: 'https://example.org/source' }] });
  assert.equal(text(model), 'StatementComplete statement.Objectivesa Determine [Selection: yes; no].MethodsEXAMINE: policy; recordsReferencesPublisher · Source · Version 1');
});

test('canonical record identity handles encoded publisher identifiers without accepting malformed paths', () => {
  assert.equal(recordIdFromHash('#/record/nist-800-53/AC-2?view=detail'), 'nist-800-53:AC-2');
  assert.equal(recordIdFromPath('/record/catalog/identifier%2Fpart'), 'catalog:identifier/part');
  assert.equal(recordIdFromPath('/record/catalog/%ZZ'), null);
  assert.equal(recordIdFromHash('#/resources/example'), null);
  assert.equal(recordIdFromHash(recordHashForId('catalog:identifier/part')), 'catalog:identifier/part');
  assert.equal(atlasHashForId('catalog:identifier/part'), '#/atlas/catalog:identifier%2Fpart');
});

test('every publisher section kind preserves its distinct content and link targets', () => {
  const cases: Array<[string, unknown, string[]]> = [
    ['list', ['First item', 'Second item'], ['First item', 'Second item']],
    ['publisher_mappings', [{ target_catalog: 'NIST', target_id: 'AC-2', relationship_type: 'related_to' }], ['NIST', 'AC-2']],
    ['mapping_targets', [{ kind: 'activity', target_id: '1.1', relationship_parse_status: 'unresolved' }], ['1.1', 'Relationship not specified in the source cell.']],
    ['countermeasures', [{ actors: ['Administrator'], actions: ['Retain [Assignment: records].'] }], ['Administrator', 'Retain [Assignment: records].']],
    ['control_parameters', 'Publisher guidance without parameter notation.', ['Publisher guidance without parameter notation.']],
  ];
  for (const [kind, value, fragments] of cases) {
    const rendered = publisherSection(kind, value).map(text).join('');
    for (const fragment of fragments) assert.ok(rendered.includes(fragment), `${kind}: ${fragment}`);
  }
  const reference = publisherSection('references', [{ title: 'Official catalog', location: 'https://example.org/catalog' }]);
  assert.match(JSON.stringify(reference), /https:\/\/example.org\/catalog/);
});

test('native reading includes bounded, deduplicated published selection sets and canonical overflow links', () => {
  const contract = recordPresentationContract('nist-800-53b', 'baseline');
  assert.ok(contract.selections.length > 0);
  const center = { id: 'nist-800-53b:low', node_type: 'baseline', metadata: { catalog_id: 'nist-800-53b', item_id: 'low' } };
  const targets = Array.from({ length: 26 }, (_, i) => ({ id: `nist-800-53:AC-${i + 1}`, label: `AC-${i + 1}`, node_type: 'control', metadata: { catalog_id: 'nist-800-53', item_id: `AC-${i + 1}`, title: `Published title ${i + 1}` } }));
  const edges = targets.map(target => ({ source_node_id: center.id, target_node_id: target.id, relationship_type: contract.selections[0].relationship_type, publication_status: 'published' }));
  const record = { center_node: center, nodes: [center, ...targets], edges: [...edges, edges[0], { ...edges[0], target_node_id: 'missing', publication_status: 'candidate' }], structural_path: [] };
  const rendered = publisherReadingModel(contract, record, { name: 'Publisher' }, 'Low');
  assert.match(text(rendered), /26/);
  assert.match(text(rendered), /\+1 more \u2014 Explore in Atlas/);
  const serialized = JSON.stringify(rendered);
  assert.match(serialized, /#\/atlas\/nist-800-53b:low/);
  assert.match(serialized, /#\/record\/nist-800-53\/AC-25/);
  assert.doesNotMatch(serialized, /Published title 26/);
});

test('source origins and absent facts remain explicit rather than invented', () => {
  const contract = recordPresentationContract('nist-800-53', 'control');
  const metadata = { catalog_id: 'nist-800-53', item_id: 'AC-2', description: 'Publisher text.', origin: 'publisher_derived' };
  const center = { id: 'nist-800-53:AC-2', node_type: 'control', metadata };
  const record = { center_node: center, nodes: [center], edges: [], structural_path: [] };
  assert.match(text(publisherReadingModel(contract, record, { name: 'Official publication' }, 'AC-2')), /Publisher-derived projection · Official publication/);
  assert.match(text(publisherReadingModel(contract, { ...record, center_node: { ...center, metadata: { ...metadata, origin: 'atlas_editorial' } } }, { name: 'Atlas' }, 'AC-2')), /Control Atlas context · Atlas/);
  assert.deepEqual(publisherFactRows(['priority', 'withdrawn'], { withdrawn: false, field_absence_reasons: { priority: 'Publisher leaves this field empty.' } }), [
    { field: 'priority', displayValue: 'Not published \u2014 Publisher leaves this field empty.' }, { field: 'withdrawn', displayValue: 'No' },
  ]);
});

test('FedRAMP guidance folds only from a published context edge and retains parameter identity and order', () => {
  const contract = recordPresentationContract('nist-800-53', 'control');
  const center = { id: 'nist-800-53:AC-2', node_type: 'control', metadata: { catalog_id: 'nist-800-53', item_id: 'AC-2', description: 'Publisher statement.' } };
  const context = { id: 'fedramp-2026:CTL-AC-02', node_type: 'control_context', metadata: { item_id: 'CTL-AC-02', description: 'Lead-in guidance.\n\nac-02_odp.01: the organization-defined value\n\nClosing guidance.' } };
  const edge = { source_node_id: context.id, target_node_id: center.id, relationship_type: CONTROL_CONTEXT_RELATIONSHIP_TYPE, publication_status: 'published' };
  const record = { center_node: center, nodes: [center, context], edges: [edge], structural_path: [] };
  const rendered = publisherReadingModel(contract, record, { name: 'NIST' }, 'AC-2');
  assert.match(text(rendered), /Lead-in guidance\.AC-2 parameter 1.*the organization-defined value.*ac-02_odp\.01Closing guidance\./);
  assert.match(JSON.stringify(rendered), /section-fedramp-context-CTL-AC-02/);
  assert.doesNotMatch(text(publisherReadingModel(contract, { ...record, edges: [{ ...edge, publication_status: 'candidate' }] }, { name: 'NIST' }, 'AC-2')), /Lead-in guidance/);
});
