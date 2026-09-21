import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { docToXlsx, officeDocumentToSheets } from '../src/app/office-export.mjs';
import { buildTemplateDocument, getControlCrossRefIndex } from '../src/app/template-engine.mjs';
import { STIG_ID, addStigFixture } from './helpers/stig-fixture.mjs';

const registry = JSON.parse(readFileSync('data/template-registry.json', 'utf8'));

const control = (id, type = 'control', family = 'Access Control') => ({
  id: `nist-800-53:${id}`,
  node_type: type,
  lifecycle_status: 'active',
  metadata: { catalog_id: 'nist-800-53', item_id: id, title: `${id} title`, control_family: family },
});
const baseline = (id) => ({
  id: `nist-800-53b:${id}`,
  node_type: 'baseline',
  metadata: { catalog_id: 'nist-800-53b', item_id: id, title: id },
});
const selects = (b, c) => ({
  id: `edge:${b}:${c}`,
  source_node_id: `nist-800-53b:${b}`,
  target_node_id: `nist-800-53:${c}`,
  relationship_class: 'applicability',
  relationship_type: 'selects',
});
const cci = (n) => ({ id: `disa-cci:CCI-${n}`, node_type: 'cci', metadata: { item_id: `CCI-${n}` } });
const rule = (n, ruleId) => ({
  id: `disa-stig:V-${n}`,
  node_type: 'stig_rule',
  metadata: { item_id: `V-${n}`, rule_id: ruleId, benchmark_id: 'Example_STIG' },
});
const link = (type, source, target) => ({ id: `${type}:${source}:${target}`, relationship_type: type, source_node_id: source, target_node_id: target });

const assessment = {
  id: 'nist-800-53a:AC-2',
  node_type: 'assessment_procedure',
  metadata: {
    item_id: 'AC-2',
    assessment_methods: ['EXAMINE', 'INTERVIEW', 'TEST'],
    assessment_method_details: [
      { method: 'EXAMINE', objects: ['Access control policy', 'list of active system accounts'] },
      { method: 'INTERVIEW', objects: ['personnel with account management responsibilities'] },
    ],
    assessment_objectives: [
      { id: 'ac-2_obj.a-1', label: 'AC-02a.[01]', prose: 'account types allowed for use within the system are defined and documented;' },
      { id: 'ac-2_obj.b', label: 'AC-02b.', prose: 'account managers are assigned;' },
    ],
  },
};

const dataset = {
  nodes: [
    control('AC-1'), control('AC-2'), control('AC-2.1', 'control_enhancement'), control('AU-2', 'control', 'Audit and Accountability'),
    baseline('LOW'), baseline('MODERATE'), baseline('HIGH'),
    cci('000015'), cci('000016'), rule(1, 'SV-1r1_rule'), rule(2, 'SV-2r1_rule'), rule(3, 'SV-3r2_rule'), assessment,
  ],
  edges: [
    selects('LOW', 'AC-1'),
    selects('MODERATE', 'AC-1'), selects('MODERATE', 'AC-2'), selects('MODERATE', 'AC-2.1'),
    selects('HIGH', 'AC-1'), selects('HIGH', 'AC-2'), selects('HIGH', 'AC-2.1'), selects('HIGH', 'AU-2'),
    link('maps_to', 'disa-cci:CCI-000015', 'nist-800-53:AC-2'),
    link('maps_to', 'disa-cci:CCI-000016', 'nist-800-53:AC-2'),
    link('references', 'disa-cci:CCI-000015', 'disa-stig:V-1'),
    link('references', 'disa-cci:CCI-000016', 'disa-stig:V-2'),
    link('references', 'disa-cci:CCI-000016', 'disa-stig:V-3'),
    { id: 'a1', relationship_type: 'assesses', source_node_id: 'nist-800-53a:AC-2', target_node_id: 'nist-800-53:AC-2' },
  ],
  sources: [{ id: 'nist-800-53', display_name: 'SP 800-53 Rev. 5', version: 'Revision 5' }],
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
const ids = (doc, heading) => table(doc, heading).rows.map((row) => row[0]);
const text = (doc, heading) => doc.sections.find((section) => section.heading === heading)?.content || '';

test('the registry asks for a baseline on the implementation and inheritance worksheets', () => {
  for (const name of ['implementation_statement_worksheet', 'inheritance_worksheet']) {
    const template = registry.templates.find((item) => item.name === name);
    assert.ok(template.input_options.includes('baseline'), `${name} must accept a baseline`);
    assert.ok(template.required_input_options.includes('baseline'), `${name} must require a baseline (All controls is a choice in the page)`);
  }
});

test('implementation and inheritance worksheets contain exactly the controls in the selected baseline, enhancements included', () => {
  for (const name of ['implementation_statement_worksheet', 'inheritance_worksheet']) {
    const heading = name === 'inheritance_worksheet' ? 'Inheritance Decision Log' : 'Implementation Statements';
    assert.deepEqual(ids(build(name, { baseline: 'LOW' }), heading), ['AC-1'], `${name} Low`);
    assert.deepEqual(ids(build(name, { baseline: 'MODERATE' }), heading), ['AC-1', 'AC-2', 'AC-2.1'], `${name} Moderate`);
    assert.deepEqual(ids(build(name, { baseline: 'HIGH' }), heading), ['AC-1', 'AC-2', 'AC-2.1', 'AU-2'], `${name} High`);
  }
});

test('no baseline means base controls only, and the worksheet says so', () => {
  const doc = build('implementation_statement_worksheet');
  assert.deepEqual(ids(doc, 'Implementation Statements'), ['AC-1', 'AC-2', 'AU-2']);
  assert.match(text(doc, 'Scope'), /no baseline selected/i);
  assert.match(text(doc, 'Scope'), /enhancements are not included/i);
});

test('a control baseline is never turned into a statement about the system impact level', () => {
  for (const name of ['implementation_statement_worksheet', 'inheritance_worksheet', 'evidence_expectation_matrix']) {
    const doc = build(name, { baseline: 'MODERATE' });
    const scope = text(doc, 'Scope');
    assert.match(scope, /selected control baseline Moderate/);
    assert.match(scope, /not a statement of your system's impact level/);
    assert.doesNotMatch(JSON.stringify(doc), /FIPS 199|impact level (is|of) moderate|categorized as moderate/i);
  }
});

test('implementation worksheet prefills identity and source counts but never the practitioner decisions', () => {
  const doc = build('implementation_statement_worksheet', { baseline: 'MODERATE' });
  const { headers, rows, columns } = table(doc);
  const at = (header) => headers.indexOf(header);
  const ac2 = rows.find((row) => row[0] === 'AC-2');
  assert.equal(ac2[at('Control Title')], 'AC-2 title');
  assert.equal(ac2[at('Family')], 'Access Control');
  assert.equal(ac2[at('Type')], 'Control');
  assert.equal(rows.find((row) => row[0] === 'AC-2.1')[at('Type')], 'Enhancement');
  assert.equal(ac2[at('CCI Count')], 2);
  assert.equal(ac2[at('STIG/SRG Rule Count')], 3);
  assert.equal(ac2[at('Related CCIs')], 'CCI-000015; CCI-000016');
  const practitioner = ['implementationStatus', 'controlDesignation', 'responsibleEntities', 'implementationNarrative', 'commonControlProvider', 'naJustification', 'Evidence References'];
  for (const header of practitioner) {
    assert.match(ac2[at(header)], /^\[.*\]$/, `${header} must stay a placeholder for the practitioner`);
    assert.equal(columns[at(header)].group === 'From cited sources', false);
  }
});

test('implementation worksheet uses the documented eMASS values for status, designation and monitoring', () => {
  const { columns } = table(build('implementation_statement_worksheet', { baseline: 'LOW' }));
  const list = (header) => columns.find((column) => column.header === header).validation.values;
  assert.deepEqual(list('implementationStatus'), ['Planned', 'Implemented', 'Inherited', 'Not Applicable', 'Manually Inherited']);
  assert.deepEqual(list('controlDesignation'), ['Common', 'System-Specific', 'Hybrid']);
  assert.deepEqual(list('commonControlProvider'), ['DoD', 'Component', 'Enclave']);
  assert.equal(list('slcmFrequency').length, 10);
  assert.deepEqual(list('slcmMethod'), ['Automated', 'Semi-Automated', 'Manual', 'Undetermined']);
});

test('inheritance worksheet prefills only control identity and offers the four decisions', () => {
  const doc = build('inheritance_worksheet', { baseline: 'MODERATE' });
  const { headers, rows, columns } = table(doc);
  const row = rows[1];
  assert.deepEqual(row.slice(0, 4), ['AC-2', 'AC-2 title', 'Access Control', 'Control']);
  for (const header of headers.slice(4)) {
    assert.match(String(row[headers.indexOf(header)]), /^\[.*\]$/, `${header} must not be prefilled`);
  }
  assert.deepEqual(columns.find((column) => column.header === 'Inheritance Decision').validation.values, ['Fully Inherited', 'Hybrid', 'System-Specific', 'Not Applicable']);
});

test('evidence matrix puts 800-53A methods, objects, CCIs and STIG rules in the main table', () => {
  const doc = build('evidence_expectation_matrix', { baseline: 'MODERATE' });
  const { headers, rows } = table(doc, 'Evidence Expectations');
  const at = (header) => headers.indexOf(header);
  const ac2 = rows.find((row) => row[0] === 'AC-2');
  assert.equal(ac2[at('800-53A Methods')], 'Examine; Interview; Test');
  assert.equal(ac2[at('800-53A Objectives')], 2);
  assert.match(ac2[at('Examine Objects (800-53A)')], /Access control policy; list of active system accounts/);
  assert.equal(ac2[at('Related CCIs')], 'CCI-000015; CCI-000016');
  assert.equal(ac2[at('STIG/SRG Rule Count')], 3);
  assert.equal(ac2[at('Related STIG/SRG (V-IDs)')], 'V-1; V-2; V-3');
  assert.equal(ac2[at('Related Rule IDs')], 'SV-1r1_rule; SV-2r1_rule; SV-3r2_rule');
  const ac1 = rows.find((row) => row[0] === 'AC-1');
  assert.equal(ac1[at('800-53A Methods')], '—', 'a control with no assessment record shows a dash, not invented methods');
  assert.equal(ac1[at('800-53A Objectives')], 0);
});

test('evidence matrix keeps publisher objective text on a reference sheet and out of the main table', () => {
  const doc = build('evidence_expectation_matrix', { baseline: 'MODERATE' });
  const objectives = table(doc, 'Assessment Objectives');
  assert.deepEqual(objectives.rows, [
    ['AC-2', 'AC-02a.[01]', 'account types allowed for use within the system are defined and documented;'],
    ['AC-2', 'AC-02b.', 'account managers are assigned;'],
  ]);
  const objects = table(doc, 'Assessment Objects');
  assert.deepEqual(objects.rows.map((row) => row.slice(0, 2)), [['AC-2', 'Examine'], ['AC-2', 'Interview']]);
  const main = JSON.stringify(table(doc, 'Evidence Expectations').rows);
  assert.doesNotMatch(main, /account managers are assigned/, 'objective text must not be crammed into the main table');
  for (const sheet of doc.sections.filter((section) => section.type === 'table')) {
    for (const row of sheet.rows) {
      for (const cell of row) assert.ok(String(cell).length <= 32000, 'no cell may approach the Excel 32,767-character limit');
    }
  }
});

test('evidence matrix labels source-backed and practitioner columns as separate groups', () => {
  const doc = build('evidence_expectation_matrix', { baseline: 'MODERATE' });
  const { headers, columns } = table(doc, 'Evidence Expectations');
  const group = (header) => columns[headers.indexOf(header)].group;
  for (const header of ['Control ID', '800-53A Methods', 'Related CCIs', 'Related Rule IDs']) assert.equal(group(header), 'From cited sources');
  for (const header of ['Evidence Type', 'Artifact Name / ID', 'Evidence Owner', 'Review Status', 'Confidence', 'Assessor Notes']) assert.equal(group(header), 'Your working fields');
  const readMe = officeDocumentToSheets(doc)[0].rows.map((row) => row.join(' ')).join('\n');
  assert.match(readMe, /not evidence requirements|do not show what an assessor will accept/i);
});

test('numbers are written as numbers so they sort and filter as numbers', () => {
  const entries = unzipSync(docToXlsx(build('evidence_expectation_matrix', { baseline: 'MODERATE' })));
  const sheet = strFromU8(entries['xl/worksheets/sheet2.xml']);
  assert.match(sheet, /<c r="E\d+"(?: s="\d+")?><v>2<\/v><\/c>/, 'the objective count is a numeric cell');
});

test('hardware baseline is grouped, keeps its two key columns in view and offers all seven eMASS approval values', () => {
  const doc = build('hardware_baseline');
  const section = table(doc);
  assert.equal(section.freezeColumns, 2);
  const groups = [...new Set(section.columns.map((column) => column.group))];
  assert.deepEqual(groups, ['Core inventory', 'System / boundary', 'Network / exposure', 'Ownership', 'Approval / lifecycle', 'Source / verification']);
  for (const header of ['Asset ID', 'assetName', 'Hostname', 'FQDN', 'assetIpAddress', 'publicFacingFqdn', 'manufacturer', 'modelNumber', 'serialNumber', 'osIosFwVersion', 'location', 'Asset Owner', 'System / Authorization Boundary', 'criticalAsset', 'approvalStatus', 'Discovery Source', 'Last Verified', 'Lifecycle Status', 'Notes']) {
    assert.ok(section.headers.includes(header), `hardware baseline needs ${header}`);
  }
  assert.equal(section.columns.find((column) => column.header === 'approvalStatus').validation.values.length, 7);
  assert.equal(section.columns.find((column) => column.header === 'approvalStatus').validation.strict, false);
  const required = section.columns.filter((column) => column.required).map((column) => column.header);
  assert.deepEqual(required, ['Asset ID', 'assetName', 'componentType']);
});

test('software baseline is grouped and never supplies vendor lifecycle data', () => {
  const doc = build('software_baseline');
  const section = table(doc);
  const groups = [...new Set(section.columns.map((column) => column.group))];
  assert.deepEqual(groups, ['Core software inventory', 'Scope / ownership', 'Approval / lifecycle', 'Source / verification']);
  const required = section.columns.filter((column) => column.required).map((column) => column.header);
  assert.deepEqual(required, ['Software ID', 'softwareVendor', 'softwareName', 'version']);
  const eol = section.headers.indexOf('endOfLifeSupportDate');
  for (const row of section.rows) assert.match(String(row[eol]), /^\[.*\]$/, 'end-of-life dates are entered by the practitioner');
  assert.equal(section.columns.find((column) => column.header === 'softwareType').validation.values.length, 6);
  assert.equal(section.columns.find((column) => column.header === 'approvalStatus').validation.values.length, 7);
});

test('POA&M is grouped by stage with required fields first and milestones on their own sheet', () => {
  const doc = build('poam_starter');
  const register = table(doc, 'POA&M Working Register');
  const groups = [...new Set(register.columns.map((column) => column.group))];
  assert.deepEqual(groups, ['Identity', 'Risk', 'Ownership', 'Remediation', 'Decision / closure']);
  assert.deepEqual(register.headers.slice(0, 4), ['externalUid', 'status', 'vulnerabilityDescription', 'sourceIdentifyingVulnerability']);
  assert.equal(register.freezeColumns, 2);
  const required = register.columns.filter((column) => column.required).map((column) => column.header);
  assert.deepEqual(required, ['externalUid', 'status', 'vulnerabilityDescription', 'sourceIdentifyingVulnerability', 'pocOrganization', 'resources', 'scheduledCompletionDate']);
  assert.ok(!register.headers.includes('Milestones with Completion Dates'), 'milestones are rows, not a text blob');
  for (const header of ['pocFirstName', 'pocLastName', 'pocEmail', 'pocPhoneNumber']) assert.ok(register.headers.includes(header));
  const milestones = table(doc, 'Milestones');
  assert.deepEqual(milestones.headers, ['externalUid', 'Milestone #', 'Milestone description', 'scheduledCompletionDate', 'Completion Date', 'Milestone Status', 'Milestone Owner', 'Notes']);
  assert.equal(milestones.columns[0].validation.kind, 'range');
});

test('POA&M milestone IDs are picked from the register, and the link survives in the workbook', () => {
  const entries = unzipSync(docToXlsx(build('poam_starter')));
  const milestones = strFromU8(entries['xl/worksheets/sheet3.xml']);
  assert.match(milestones, /<formula1>(?:'|&apos;)POA&amp;M Working Register(?:'|&apos;)!\$A\$2:\$A\$\d+<\/formula1>/);
  assert.match(milestones, /errorStyle="warning"/, 'a milestone may be entered before its register row');
});

test('workbooks use at most six column groups and every header color has a group', () => {
  for (const name of ['implementation_statement_worksheet', 'evidence_expectation_matrix', 'inheritance_worksheet', 'poam_starter', 'hardware_baseline', 'software_baseline']) {
    const groups = new Set();
    for (const section of build(name, { baseline: 'MODERATE' }).sections.filter((s) => s.type === 'table')) {
      for (const column of section.columns) if (column.group) groups.add(column.group);
    }
    assert.ok(groups.size >= 1 && groups.size <= 6, `${name} uses ${groups.size} groups`);
  }
});

test('the control to CCI to STIG index is built once per loaded dataset and rebuilt only if the dataset grows', () => {
  const first = getControlCrossRefIndex(dataset);
  assert.equal(getControlCrossRefIndex(dataset), first, 'same dataset, same index');
  const before = build('implementation_statement_worksheet', { baseline: 'MODERATE' });
  const after = build('implementation_statement_worksheet', { baseline: 'MODERATE' });
  assert.deepEqual(after.sections.find((s) => s.type === 'table').rows, before.sections.find((s) => s.type === 'table').rows, 'reuse does not change the output');
  assert.equal(getControlCrossRefIndex({ nodes: [...dataset.nodes], edges: [...dataset.edges] }) === first, false, 'a different dataset gets its own index');
  dataset.nodes.push({ id: 'nist-800-53:ZZ-1', node_type: 'control', metadata: { catalog_id: 'nist-800-53', item_id: 'ZZ-1', title: 'ZZ-1 title', control_family: 'Access Control' } });
  assert.notEqual(getControlCrossRefIndex(dataset), first, 'a dataset that grew is re-indexed');
  dataset.nodes.pop();
});
