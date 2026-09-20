import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { docToXlsx, officeDocumentToSheets } from '../src/app/office-export.mjs';
import {
  CONMON_BASIS_LABELS,
  FEDRAMP_CONMON_RULES,
  STIG_VIEWER_CSV_HEADERS,
  buildTemplateDocument,
} from '../src/app/template-engine.mjs';
import { STIG_ID, addStigFixture } from './helpers/stig-fixture.mjs';

const registry = JSON.parse(readFileSync('data/template-registry.json', 'utf8'));

const control = (id, type = 'control') => ({
  id: `nist-800-53:${id}`,
  node_type: type,
  lifecycle_status: 'active',
  metadata: { catalog_id: 'nist-800-53', item_id: id, title: `${id} title`, control_family: 'Access Control' },
});
const cci = (n) => ({ id: `disa-cci:CCI-${n}`, node_type: 'cci', metadata: { item_id: `CCI-${n}` } });
const link = (type, source, target) => ({ id: `${type}:${source}:${target}`, relationship_type: type, source_node_id: source, target_node_id: target });

const dataset = {
  nodes: [
    control('AC-1'), control('AC-2'), cci('000015'), cci('000016'),
    {
      id: 'nist-800-53a:AC-2',
      node_type: 'assessment_procedure',
      metadata: {
        item_id: 'AC-2',
        assessment_methods: ['EXAMINE', 'INTERVIEW'],
        assessment_method_details: [
          { method: 'EXAMINE', objects: ['Access control policy', 'list of active system accounts'] },
          { method: 'INTERVIEW', objects: ['personnel with account management responsibilities'] },
        ],
        assessment_objectives: [{ id: 'ac-2_obj.b', label: 'AC-02b.', prose: 'account managers are assigned;' }],
      },
    },
  ],
  edges: [
    link('maps_to', 'disa-cci:CCI-000015', 'nist-800-53:AC-2'),
    link('references', 'disa-cci:CCI-000015', 'disa-stig:V-101'),
    link('references', 'disa-cci:CCI-000016', 'disa-stig:V-102'),
    link('maps_to', 'disa-cci:CCI-000016', 'nist-800-53:AC-2'),
    { id: 'a1', relationship_type: 'assesses', source_node_id: 'nist-800-53a:AC-2', target_node_id: 'nist-800-53:AC-2' },
  ],
  sources: [],
};
addStigFixture(dataset);

function build(templateType, extra = {}) {
  const template = registry.templates.find((item) => item.name === templateType);
  return buildTemplateDocument(
    {
      templateType,
      stig: STIG_ID,
      framework: template.input_options.includes('framework') ? 'nist-800-53' : '',
      environment: 'Cloud SaaS',
      sourceRefs: template.source_refs,
      sources: dataset.sources,
      ...extra,
    },
    dataset,
  ).doc;
}
const table = (doc, heading) => doc.sections.find((section) => section.type === 'table' && (!heading || section.heading === heading));
const text = (doc, heading) => doc.sections.find((section) => section.heading === heading)?.content || '';
const readMe = (doc) => officeDocumentToSheets(doc)[0].rows.map((row) => row.join(' ')).join('\n');

// ---------- STIG Viewer CSV worksheet ----------

test('the STIG worksheet fails closed without a STIG, or with one that is not published', () => {
  assert.throws(() => build('stig_evidence_checklist', { stig: '' }), /Choose a STIG/);
  assert.throws(() => build('stig_evidence_checklist', { stig: 'BENCHMARK-NOT-REAL' }), /not a published STIG/);
});

test('the STIG worksheet lists exactly the rules of the chosen STIG, ordered by STIG ID', () => {
  const doc = build('stig_evidence_checklist');
  const rows = table(doc, 'STIG Viewer CSV Import Rows').rows;
  assert.deepEqual(rows.map((row) => row[1]), ['SV-101r1_rule', 'SV-102r1_rule', 'SV-103r2_rule']);
  assert.ok(rows.every((row) => row[0] === 'Example_STIG'), 'Benchmark ID is the STIG\'s published benchmark ID');
  assert.match(text(doc, 'Selected STIG'), /Example Security Technical Implementation Guide, V1R2 \(2026-01-15\)/);
  assert.match(text(doc, 'Selected STIG'), /3 rules: 1 high, 1 medium, 1 low/);
});

test('the STIG import table has exactly the 12 documented headers in the documented order', () => {
  const section = table(build('stig_evidence_checklist'), 'STIG Viewer CSV Import Rows');
  assert.deepEqual(section.headers, [...STIG_VIEWER_CSV_HEADERS]);
  assert.deepEqual(STIG_VIEWER_CSV_HEADERS, ['Benchmark ID', 'Rule ID', 'Status', 'Comments', 'Finding Details', 'Severity Override', 'Severity Override Reason', 'FQDN', 'IP Address', 'MAC Address', 'Host Name', 'Technology Area']);
  for (const contaminant of ['Evidence Artifact', 'Validation Method', 'Evidence Owner', 'Rule Title', 'Severity']) {
    assert.ok(!section.headers.includes(contaminant), `${contaminant} must stay out of the import table`);
  }
});

test('the STIG worksheet never fills in a result', () => {
  const section = table(build('stig_evidence_checklist'), 'STIG Viewer CSV Import Rows');
  const at = (header) => section.headers.indexOf(header);
  for (const row of section.rows) {
    for (const header of ['Status', 'Comments', 'Finding Details', 'Severity Override', 'Severity Override Reason']) {
      assert.equal(row[at(header)], '', `${header} must be blank for the practitioner`);
    }
  }
});

test('the STIG target is entered once and flows into every row of the import table', () => {
  const doc = build('stig_evidence_checklist');
  const target = table(doc, 'Target');
  assert.deepEqual(target.headers, ['FQDN', 'IP Address', 'MAC Address', 'Host Name', 'Technology Area']);
  assert.equal(target.rows.length, 1);
  const section = table(doc, 'STIG Viewer CSV Import Rows');
  for (const row of section.rows) {
    const formulas = row.slice(7).map((cell) => cell.formula);
    assert.deepEqual(formulas, ['A', 'B', 'C', 'D', 'E'].map((c) => `IF(Target!$${c}$2="","",Target!$${c}$2)`));
  }
  assert.equal(target.columns.find((column) => column.header === 'Technology Area').validation.values.length, 21);
  const entries = unzipSync(docToXlsx(doc));
  assert.match(strFromU8(entries['xl/workbook.xml']), /<calcPr [^>]*fullCalcOnLoad="1"/, 'formulas must calculate when the file opens');
  const names = [...strFromU8(entries['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.slice(0, 3), ['Read Me', 'Target', 'STIG Viewer CSV Import Rows']);
});

test('the STIG worksheet keeps evidence notes and rule reference on their own sheets', () => {
  const doc = build('stig_evidence_checklist');
  assert.deepEqual(table(doc, 'Evidence Working Notes').rows.map((row) => row[0]), ['SV-101r1_rule', 'SV-102r1_rule', 'SV-103r2_rule']);
  const reference = table(doc, 'STIG Rule Reference');
  assert.deepEqual(reference.headers, ['Rule ID', 'Vuln ID', 'STIG ID', 'Severity', 'Rule Title', 'CCIs', 'Related NIST 800-53 Controls']);
  const first = reference.rows[0];
  assert.deepEqual(first.slice(0, 4), ['SV-101r1_rule', 'V-101', 'EX-0001', 'High (CAT I)']);
  assert.equal(first[5], 'CCI-000015');
  assert.equal(first[6], 'AC-2');
});

test('the STIG worksheet claims field alignment only and says an import was not tested', () => {
  const template = registry.templates.find((item) => item.name === 'stig_evidence_checklist');
  assert.equal(template.compatibility.classification, 'Field-aligned');
  assert.equal(template.provenance.verified_interchange, false);
  const notes = readMe(build('stig_evidence_checklist'));
  assert.match(notes, /Field-aligned/);
  assert.match(notes, /has not tested an import/i);
  assert.match(notes, /updates a checklist that already exists/i);
  assert.doesNotMatch(notes + JSON.stringify(template), /officially specified|compatible with STIG Viewer/i);
});

// ---------- Assessment planning ----------

test('assessment planning prefills 800-53A methods, objects, objectives, CCIs and STIG counts, and nothing the assessor decides', () => {
  const doc = build('assessment_planning_worksheet', { baseline: '' });
  const { headers, rows } = table(doc, 'Assessment Plan');
  const at = (header) => headers.indexOf(header);
  const ac2 = rows.find((row) => row[0] === 'AC-2');
  assert.equal(ac2[at('Procedure Reference')], 'NIST SP 800-53A AC-2');
  assert.equal(ac2[at('800-53A Methods')], 'Examine; Interview');
  assert.equal(ac2[at('800-53A Objectives')], 1);
  assert.match(ac2[at('Assessment Objects (NIST SP 800-53A)')], /^Examine: Access control policy; list of active system accounts \| Interview: personnel/);
  assert.equal(ac2[at('Related CCIs')], 'CCI-000015; CCI-000016');
  assert.equal(ac2[at('STIG/SRG Rule Count')], 2);
  for (const header of ['Assessment Scope', 'Assessment Method', 'Assessor Role', 'Sampling Approach', 'Target Start', 'Status', 'Result / Test Success', 'Finding / POA&M Reference', 'Evidence Location']) {
    assert.match(ac2[at(header)], /^\[.*\]$/, `${header} stays with the assessor`);
  }
  const ac1 = rows.find((row) => row[0] === 'AC-1');
  assert.equal(ac1[at('800-53A Methods')], '—');
  assert.equal(ac1[at('Procedure Reference')], '—');
});

test('assessment planning labels publisher content and keeps full text on reference sheets', () => {
  const doc = build('assessment_planning_worksheet');
  const sheets = doc.sections.filter((section) => section.type === 'table').map((section) => section.heading);
  assert.deepEqual(sheets, ['Assessment Plan', 'Assessment Objects', 'Assessment Objectives']);
  assert.deepEqual(table(doc, 'Assessment Objectives').rows, [['AC-2', 'AC-02b.', 'account managers are assigned;']]);
  assert.deepEqual(table(doc, 'Assessment Objectives').headers, ['Control ID', 'Objective', 'Assessment objective text (NIST SP 800-53A)']);
  const plan = table(doc, 'Assessment Plan');
  const source = plan.columns.filter((column) => column.group === 'From cited sources').map((column) => column.header);
  assert.ok(source.includes('Assessment Objects (NIST SP 800-53A)') && source.includes('800-53A Methods'));
  assert.ok(!source.includes('Assessment Method'), 'the chosen method is the assessor\'s, not source content');
  assert.match(text(doc, 'How to use'), /does not rewrite them and does not invent procedures/);
});

// ---------- Continuous monitoring ----------

test('no generic monitoring cadence is presented as a requirement', () => {
  const doc = build('conmon_calendar', { framework: 'nist-800-53' });
  const { headers, rows, columns } = table(doc);
  const at = (header) => headers.indexOf(header);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    assert.equal(row[at('Cadence Basis')], CONMON_BASIS_LABELS.planning_default);
    assert.equal(row[at('Source / Program Cadence')], '—', `${row[0]}: no source states this cadence`);
    assert.equal(row[at('Cadence Source')], '—');
    assert.match(row[at('Planning Default (suggestion)')], /^(Weekly|Monthly|Quarterly|Annual)$/);
    assert.match(row[at('Organization-Selected Cadence')], /^\[.*\]$/, 'the organization chooses its own cadence');
  }
  assert.ok(!JSON.stringify(rows).includes(CONMON_BASIS_LABELS.source_required), 'no row may claim a source requirement without a source');
  assert.equal(columns[at('Organization-Selected Cadence')].required, true);
  assert.match(text(doc, 'How to read the cadences'), /No NIST or DoD source used here requires the planning defaults/);
});

test('FedRAMP program cadences appear only when FedRAMP is selected, each with its rule ID', () => {
  const nist = table(build('conmon_calendar', { framework: 'nist-800-53' }));
  assert.ok(!JSON.stringify(nist.rows).includes('CCM-OCR-AVL'));
  dataset.nodes.push({ id: 'fedramp-rev5:AC-2', node_type: 'control', lifecycle_status: 'active', metadata: { catalog_id: 'fedramp-rev5', item_id: 'AC-2', title: 'AC-2 title', control_family: 'Access Control' } });
  const fedramp = table(build('conmon_calendar', { framework: 'fedramp-rev5' }));
  const at = (header) => fedramp.headers.indexOf(header);
  const program = fedramp.rows.filter((row) => row[at('Cadence Basis')] === CONMON_BASIS_LABELS.program_specific);
  assert.deepEqual(program.map((row) => row[at('Cadence Source')]), ['FedRAMP CCM-OCR-AVL', 'FedRAMP VER-TFR-MHR', 'FedRAMP VDR-TFR-NMV', 'FedRAMP IVV-CSF-MCA']);
  assert.equal(program[0][at('Source / Program Cadence')], 'Every 3 months');
  assert.equal(fedramp.rows.length, 14);
  dataset.nodes.pop();
});

test('every FedRAMP cadence we cite still exists in the FedRAMP rules data with that timeframe', () => {
  const data = JSON.parse(readFileSync('data/fedramp-2026-rules.json', 'utf8'));
  const statements = new Map();
  (function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}$/.test(key) && child && typeof child.statement === 'string') statements.set(key, child);
        walk(child);
      }
    }
  })(data.FRR);
  for (const rule of FEDRAMP_CONMON_RULES) {
    const found = statements.get(rule.ruleId);
    assert.ok(found, `${rule.ruleId} must exist in data/fedramp-2026-rules.json`);
    assert.match(found.statement.toLowerCase(), new RegExp(rule.timeframe.replace(/ /g, '\\s+')), `${rule.ruleId} must still state "${rule.timeframe}"`);
    assert.equal(found.force, 'MUST', `${rule.ruleId} must still be a MUST`);
  }
});

// ---------- PPSM ----------

test('the PPSM worksheet has its own working states and never uses registry states', () => {
  const { columns } = table(build('ppsm_preparation_worksheet'));
  const list = (header) => columns.find((column) => column.header === header).validation.values;
  assert.deepEqual(list('Review Status'), ['Collecting', 'In review', 'Ready to enter', 'Entered in registry', 'Needs rework']);
  assert.deepEqual(list('Network'), ['NIPRNet', 'SIPRNet']);
  for (const value of [...list('Review Status'), ...list('Requested Action')]) assert.doesNotMatch(value, /^(Submitted|Approved)$/);
});

test('the PPSM worksheet states its workflow and separates registry information from local context', () => {
  const doc = build('ppsm_preparation_worksheet');
  assert.match(text(doc, 'Workflow'), /Collect here, then review, then enter the data in the authorized PPSM workflow/);
  const section = table(doc);
  const groups = [...new Set(section.columns.map((column) => column.group))];
  assert.deepEqual(groups, ['Registry information', 'Assessment and category', 'Local working context', 'Review']);
  const notes = readMe(doc);
  assert.match(notes, /not a PPSM submission form/i);
  assert.match(text(doc, 'How to use'), /not PPSM Registry fields/);
  const registryFields = section.columns.filter((column) => column.group === 'Registry information').map((column) => column.header);
  assert.deepEqual(registryFields, ['Network', 'PPSM Tracking Identifier', 'Service Name', 'Protocol', 'Transport', 'Port / Range']);
});
