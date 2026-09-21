import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { docToDocx, docToXlsx } from '../src/app/office-export.mjs';
import { buildTemplateDocument } from '../src/app/template-engine.mjs';
import { GENERATED_FILE_NOTICE } from '../src/shared/disclaimer.mjs';

const registry = JSON.parse(readFileSync('data/template-registry.json', 'utf8'));
const workflows = JSON.parse(readFileSync('data/compliance-workflows.json', 'utf8'));
const workflowList = workflows.workflows || workflows;

const families = ['Access Control', 'Audit and Accountability', 'Configuration Management'];
const control = (catalog, id, family) => ({
  id: `${catalog}:${id}`,
  node_type: 'control',
  lifecycle_status: 'active',
  metadata: { catalog_id: catalog, item_id: id, title: `${id} title`, control_family: family },
});
// 90 controls in three families: a control table would be long; a family index is not.
const bigNodes = [];
for (let n = 1; n <= 30; n += 1) {
  families.forEach((family, index) => bigNodes.push(control('nist-800-53', `${['AC', 'AU', 'CM'][index]}-${n}`, family)));
}
const dataset = {
  nodes: [
    ...bigNodes,
    control('fedramp-rev5', 'AC-2', 'Access Control'),
    { id: 'nist-800-53b:MODERATE', node_type: 'baseline', metadata: { catalog_id: 'nist-800-53b', item_id: 'MODERATE', title: 'Moderate' } },
  ],
  edges: bigNodes.slice(0, 6).map((node) => ({
    id: `s:${node.id}`, source_node_id: 'nist-800-53b:MODERATE', target_node_id: node.id, relationship_class: 'applicability', relationship_type: 'selects',
  })),
  sources: [{ id: 'nist-800-53', display_name: 'SP 800-53 Rev. 5', version: 'Revision 5' }],
};

function build(templateType, extra = {}) {
  const template = registry.templates.find((item) => item.name === templateType);
  return buildTemplateDocument(
    { templateType, framework: template.input_options.includes('framework') ? 'nist-800-53' : '', environment: 'Cloud SaaS', sourceRefs: template.source_refs, sources: dataset.sources, ...extra },
    dataset,
  ).doc;
}
const table = (doc, heading) => doc.sections.find((section) => section.type === 'table' && (!heading || section.heading === heading));
const text = (doc, heading) => doc.sections.find((section) => section.heading === heading)?.content || '';
const documentXml = (doc) => strFromU8(unzipSync(docToDocx(doc))['word/document.xml']);
const plain = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)/g)].map((m) => m[1]).join(' ');

// ---------- Security plan starter ----------

test('the security plan never states an impact level for the system, whatever baseline is chosen', () => {
  for (const baseline of ['', 'MODERATE']) {
    const doc = build('security_plan_starter', { baseline });
    const all = JSON.stringify(doc);
    assert.doesNotMatch(all, /impact level (is|of)\s+(low|moderate|high)|categorized as (low|moderate|high)|moderate[- ]impact system/i);
    assert.match(text(doc, 'System Categorization'), /Categorization is your decision/);
    assert.match(text(doc, 'System Categorization'), /does not state your system's impact level/);
    const overall = text(doc, 'Overall Categorization');
    assert.match(overall, /Overall system categorization \(your determination\)/);
    assert.doesNotMatch(overall, /\b(Low|Moderate|High)\b(?! \|)/, 'the categorization prompt offers no value');
  }
  const context = text(build('security_plan_starter', { baseline: 'MODERATE' }), 'System and Authorization Context');
  assert.doesNotMatch(context, /Impact level/i, 'the old impact-level prompt moved into the categorization section');
});

test('the security plan offers a table for information types with impact values left to the practitioner', () => {
  const info = table(build('security_plan_starter'), 'Information Types');
  assert.deepEqual(info.headers, ['Information Type', 'Confidentiality Impact', 'Integrity Impact', 'Availability Impact', 'Basis for the Impact Value']);
  assert.equal(info.rows.length, 6);
  for (const row of info.rows) for (const cell of row) assert.match(cell, /^\[.*\]$/);
});

test('the security plan names the selected framework, baseline and family on its cover', () => {
  const doc = build('security_plan_starter', { baseline: 'MODERATE', controlFamily: 'Access Control' });
  assert.deepEqual(doc.cover.facts, [
    ['Control source', 'SP 800-53 Rev. 5'],
    ['Selected control baseline', 'Moderate'],
    ['Control family', 'Access Control'],
    ['Environment', 'Cloud SaaS'],
  ]);
  const xml = plain(documentXml(doc));
  assert.match(xml, /Selected for this file/);
  assert.match(xml, /Selected control baseline\s+Moderate/);
  assert.equal(build('security_plan_starter').cover.facts[1][1], 'None selected (base controls only)');
});

test('the security plan stays a compact family index however large the control set is', () => {
  const doc = build('security_plan_starter');
  const index = table(doc, 'Control Family Index');
  assert.equal(index.rows.length, 3, 'one row per family, not one per control');
  assert.match(text(doc, 'Selected Control Scope'), /90 controls/);
  const xml = documentXml(doc);
  assert.ok((xml.match(/<w:tr[ >]/g) || []).length < 80, 'the Word file must not grow with the control count');
  assert.doesNotMatch(JSON.stringify(doc), /Control Baseline"/);
});

test('the security plan carries FedRAMP text only when FedRAMP is selected', () => {
  assert.doesNotMatch(JSON.stringify(build('security_plan_starter')), /FedRAMP/);
  const fedramp = build('security_plan_starter', { framework: 'fedramp-rev5' });
  assert.match(JSON.stringify(fedramp), /Certification Package Overview/);
});

test('the security plan Word file has one notice, real properties and a heading structure', () => {
  const entries = unzipSync(docToDocx(build('security_plan_starter')));
  const xml = strFromU8(entries['word/document.xml']);
  assert.equal(xml.split(GENERATED_FILE_NOTICE).length - 1, 1);
  const core = strFromU8(entries['docProps/core.xml']);
  assert.match(core, /<dc:title>System Security Plan \(SSP\) Starter<\/dc:title>/);
  assert.match(core, /<dc:creator>Control Atlas<\/dc:creator>/);
  assert.ok((xml.match(/w:pStyle w:val="Heading1"/g) || []).length >= 10, 'sections are real headings');
  assert.match(xml, /<w:tblHeader\/>/, 'table header rows repeat across pages');
});

// ---------- Reciprocity ----------

test('reciprocity states that the receiving organization decides and offers only a recommendation', () => {
  const doc = build('reciprocity_checklist');
  assert.match(text(doc, 'Who decides'), /receiving Authorizing Official decides/);
  assert.match(text(doc, 'Who decides'), /never automatic/);
  const review = table(doc, 'Reciprocity Review');
  assert.ok(review.headers.includes('Recommended Disposition'));
  assert.ok(!review.headers.includes('Decision / Disposition'));
  const help = review.columns.find((column) => column.header === 'Recommended Disposition');
  assert.deepEqual(help.validation.values, ['Accept', 'Accept with Conditions', 'Supplement', 'Reassess', 'Reject']);
});

test('reciprocity keeps package context and the decision record as fillable sheets, not prose', () => {
  const doc = build('reciprocity_checklist');
  const sheets = doc.sections.filter((section) => section.type === 'table').map((section) => section.heading);
  assert.deepEqual(sheets, ['Package Context', 'Reciprocity Review', 'Decision Record']);
  assert.equal(table(doc, 'Package Context').rows.length, 1);
  assert.equal(table(doc, 'Decision Record').columns.find((column) => column.header === 'Decision').validation.values.length, 5);
  assert.equal(table(doc, 'Decision Record').columns.find((column) => column.header === 'Decision Date').validation.kind, 'date');
  const groups = [...new Set(table(doc, 'Reciprocity Review').columns.map((column) => column.group))];
  assert.deepEqual(groups, ['Package', 'Review', 'Action and disposition']);
});

test('reciprocity workbook uses its own status list and carries no FedRAMP text for a NIST context', () => {
  const entries = unzipSync(docToXlsx(build('reciprocity_checklist')));
  const all = Object.keys(entries).filter((n) => n.startsWith('xl/worksheets/')).map((n) => strFromU8(entries[n])).join('\n');
  assert.match(all, /Not Started,In Review,Sufficient,Gap,Not Applicable/);
  assert.doesNotMatch(all, /FedRAMP/);
});

// ---------- Tasks, files and what each is for ----------

test('every task links only to templates that exist, and every template is reachable from a task', () => {
  const ids = new Set(registry.templates.map((template) => template.template_id));
  const linked = new Set();
  for (const workflow of workflowList) {
    for (const id of workflow.companion_template_ids || []) {
      assert.ok(ids.has(id), `${workflow.workflow_id} links to unknown template ${id}`);
      linked.add(id);
    }
  }
  for (const id of ids) assert.ok(linked.has(id), `${id} is not reachable from any task`);
});

test('workflow companion links reflect the ten remaining working files', () => {
  const companions = (workflowId) => workflowList.find((workflow) => workflow.workflow_id === workflowId).companion_template_ids;
  assert.deepEqual(companions('establish-system-baselines'), ['tpl-hw-baseline', 'tpl-sw-baseline']);
  assert.deepEqual(companions('prepare-ppsm-information'), []);
  assert.deepEqual(companions('run-stig-assessment'), []);
  assert.deepEqual(companions('prepare-reciprocity-review'), ['tpl-reciprocity']);
});

test('every template says what it is for and what it does not replace', () => {
  for (const template of registry.templates) {
    assert.ok(template.usage.use_for.length >= 20, `${template.name} use_for`);
    assert.ok(template.usage.not_for.length >= 10, `${template.name} not_for`);
    assert.doesNotMatch(JSON.stringify(template.usage), /unofficial|unsafe|not safe/i, 'a boundary, not a warning about safety');
  }
  const not = (name) => registry.templates.find((template) => template.name === name).usage.not_for;
  assert.match(not('poam_starter'), /eMASS/);
  assert.match(not('reciprocity_checklist'), /Authorizing Official/);
});

test('the job groups on the Templates page cover all ten files exactly once', async () => {
  const { TEMPLATE_CATEGORIES } = await import('../src/ui/lib/catalogGroups.mjs');
  const all = Object.values(TEMPLATE_CATEGORIES).flat();
  assert.equal(all.length, 10);
  assert.deepEqual([...new Set(all)].sort(), registry.templates.map((template) => template.name).sort());
  for (const heading of Object.keys(TEMPLATE_CATEGORIES)) {
    assert.doesNotMatch(heading, /^(Plan|Implement|Assess|Remediate|Monitor)$/, 'groups name the job, not an RMF stage');
  }
});
