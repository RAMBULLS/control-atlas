import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { docToDocx, docToXlsx } from '../src/app/office-export.mjs';
import { INTEROPERABILITY, buildTemplateDocument } from '../src/app/template-engine.mjs';
import {
  DATE_MAX_SERIAL,
  DATE_MIN_SERIAL,
  TEMPLATE_VOCAB,
  TRUE_FALSE,
  defineColumns,
  listOf,
} from '../src/app/template-columns.mjs';
import { GENERATED_FILE_NOTICE, PRODUCT_DISCLAIMER, STARTER_DOCUMENT_REVIEW_NOTICE } from '../src/shared/disclaimer.mjs';
import { STIG_ID, addStigFixture } from './helpers/stig-fixture.mjs';

const registry = JSON.parse(readFileSync('data/template-registry.json', 'utf8'));
const control = (catalog) => ({
  id: `${catalog}:AC-2`,
  node_type: 'control',
  lifecycle_status: 'active',
  metadata: { catalog_id: catalog, item_id: 'AC-2', title: 'Account Management', control_family: 'Access Control' },
});
const dataset = { nodes: [control('nist-800-53'), control('fedramp-rev5')], edges: [], sources: [] };
addStigFixture(dataset);

function build(templateType, framework = 'nist-800-53') {
  const template = registry.templates.find((item) => item.name === templateType);
  return buildTemplateDocument(
    {
      templateType,
      stig: STIG_ID,
      framework: template.input_options.includes('framework') ? framework : '',
      environment: 'Cloud SaaS',
      sourceRefs: template.source_refs,
    },
    dataset,
  ).doc;
}

const xlsxTypes = registry.templates.filter((t) => t.supported_formats.includes('xlsx')).map((t) => t.name);

/** Read every data sheet's validations: { sheet: { header: {type, values|range, ...} } } */
function readValidations(templateType) {
  const bytes = docToXlsx(build(templateType));
  const entries = unzipSync(bytes);
  const workbook = strFromU8(entries['xl/workbook.xml']);
  const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const lists = entries['xl/worksheets/sheet' + (names.length) + '.xml'];
  const listColumns = [];
  if (workbook.includes('state="hidden"') && lists) {
    const xml = strFromU8(lists);
    for (const cell of xml.matchAll(/<c r="([A-Z]+)(\d+)" t="inlineStr"><is><t>([^<]*)<\/t>/g)) {
      const col = cell[1].charCodeAt(0) - 65;
      (listColumns[col] ||= [])[Number(cell[2]) - 1] = cell[3];
    }
  }
  const result = {};
  names.forEach((name, i) => {
    if (name === '_Lists') return;
    const xml = strFromU8(entries[`xl/worksheets/sheet${i + 1}.xml`]);
    const header = [...xml.matchAll(/<c r="([A-Z]+)1"[^>]*><is><t[^>]*>([^<]*)/g)].map((m) => m[2].replaceAll('&amp;', '&'));
    const out = {};
    for (const match of xml.matchAll(/<dataValidation ([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
      const attrs = match[1];
      const col = /sqref="([A-Z]+)2:/.exec(attrs)[1];
      const index = col.length === 1 ? col.charCodeAt(0) - 65 : (col.charCodeAt(0) - 64) * 26 + col.charCodeAt(1) - 65;
      const type = /type="(\w+)"/.exec(attrs)?.[1] || 'none';
      const f1 = /<formula1>([\s\S]*?)<\/formula1>/.exec(match[2] || '')?.[1] || '';
      let values = null;
      if (type === 'list' && f1.startsWith('&quot;')) values = f1.slice(6, -6).split(',');
      if (type === 'list' && f1.startsWith("'")) values = null;
      if (type === 'list' && f1.startsWith('_Lists!')) {
        const column = f1.match(/\$([A-Z]+)\$1/)[1].charCodeAt(0) - 65;
        values = listColumns[column];
      }
      out[header[index]] = { type, values, f1, f2: /<formula2>(\d+)</.exec(match[2] || '')?.[1], attrs };
    }
    result[name] = out;
  });
  return result;
}

// One entry per header across sheets; a rule that lists values wins over a prompt-only entry.
const flat = (templateType) => {
  const merged = {};
  for (const sheet of Object.values(readValidations(templateType))) {
    for (const [header, rule] of Object.entries(sheet)) {
      if (!merged[header] || (rule.values && !merged[header].values)) merged[header] = rule;
    }
  }
  return merged;
};

test('STIG worksheet dropdowns use only the values in the STIG Viewer V1R7 guide', () => {
  const v = flat('stig_evidence_checklist');
  assert.deepEqual(v.Status.values, ['Not Reviewed', 'Open', 'Not a Finding', 'Not Applicable']);
  assert.deepEqual(v['Severity Override'].values, ['Low', 'Medium', 'High']);
  assert.equal(v['Technology Area'].values.length, 21);
  assert.ok(v['Technology Area'].values.includes('Domain Name System (DNS)'));
  assert.ok(!v.Status.values.includes('Draft'), 'no generic status values may reach the STIG sheet');
});

test('a long controlled list is stored on a hidden sheet, not inline past the 255-character limit', () => {
  const v = flat('stig_evidence_checklist');
  assert.match(v['Technology Area'].f1, /^_Lists!\$[A-Z]+\$1:\$[A-Z]+\$21$/);
  assert.ok(v.Status.f1.startsWith('&quot;'), 'short lists stay inline');
  for (const templateType of xlsxTypes) {
    for (const [header, rule] of Object.entries(flat(templateType))) {
      if (rule.type === 'list' && rule.f1.startsWith('&quot;')) {
        assert.ok(rule.f1.length - 12 <= 255, `${templateType} ${header}: inline list exceeds Excel's 255-character limit`);
      }
    }
  }
});

test('reciprocity, PPSM, POA&M and hardware status lists are each their own worksheet vocabulary', () => {
  assert.deepEqual(flat('reciprocity_checklist').Status.values, ['Not Started', 'In Review', 'Sufficient', 'Gap', 'Not Applicable']);
  assert.deepEqual(flat('reciprocity_checklist')['Recommended Disposition'].values, ['Accept', 'Accept with Conditions', 'Supplement', 'Reassess', 'Reject']);
  assert.deepEqual(flat('ppsm_preparation_worksheet')['Review Status'].values, ['Collecting', 'In review', 'Ready to enter', 'Entered in registry', 'Needs rework']);
  assert.deepEqual(flat('poam_starter').status.values, ['Ongoing', 'Risk Accepted', 'Completed', 'Not Applicable']);
  assert.deepEqual(flat('poam_starter').likelihood.values, ['Very Low', 'Low', 'Moderate', 'High', 'Very High']);
  assert.deepEqual(flat('implementation_statement_worksheet').implementationStatus.values, ['Planned', 'Implemented', 'Inherited', 'Not Applicable', 'Manually Inherited']);
  assert.deepEqual(flat('evidence_expectation_matrix')['Review Status'].values, ['Needed', 'Requested', 'Received', 'Reviewed', 'Accepted', 'Gap']);
});

test('eMASS hardware approval status offers the documented values and allows custom ones', () => {
  const rule = flat('hardware_baseline').approvalStatus;
  assert.equal(rule.values.length, 7);
  assert.ok(rule.values.includes('Approved - NSA CSfC'));
  assert.match(rule.attrs, /errorStyle="warning"/, 'eMASS allows custom approval values, so this must warn, not block');
});

test('no dropdown can carry a value from another artifact: every list value is declared by its own artifact', () => {
  for (const templateType of xlsxTypes) {
    const vocab = TEMPLATE_VOCAB[templateType] || {};
    const allowed = new Set([...TRUE_FALSE, ...Object.values(vocab).flat()]);
    for (const [sheet, columns] of Object.entries(readValidations(templateType))) {
      for (const [header, rule] of Object.entries(columns)) {
        if (rule.type !== 'list') continue;
        if (!rule.values) continue; // a list read from another sheet
        for (const value of rule.values) {
          assert.ok(allowed.has(value), `${templateType} / ${sheet} / ${header}: "${value}" is not in this artifact's own vocabulary`);
        }
      }
    }
  }
});

test('the same header name gets different lists in different artifacts', () => {
  const statuses = new Map();
  for (const templateType of xlsxTypes) {
    const status = Object.entries(flat(templateType)).find(([header]) => /^(status|review status)$/i.test(header));
    if (status) statuses.set(templateType, status[1].values.join('|'));
  }
  assert.ok(new Set(statuses.values()).size >= 5, 'status vocabularies must be defined per artifact');
});

test('real date fields validate as dates; period and range fields do not', () => {
  const dateFields = {
    poam_starter: ['Original Detection Date', 'scheduledCompletionDate', 'completionDate'],
    hardware_baseline: ['Last Verified'],
    software_baseline: ['approvalDate', 'releaseDate', 'maintenanceDate', 'retirementDate', 'endOfLifeSupportDate', 'Last Verified'],
    inheritance_worksheet: ['Review Date'],
    conmon_calendar: ['Next Due', 'Completed Date'],
    reciprocity_checklist: ['Due Date', 'Granting Decision Date', 'Target Decision Date', 'Decision Date'],
    assessment_planning_worksheet: ['Target Start', 'Target Complete'],
    ppsm_preparation_worksheet: ['Last Verified'],
    implementation_statement_worksheet: ['estimatedCompletionDate'],
  };
  for (const [templateType, headers] of Object.entries(dateFields)) {
    const v = flat(templateType);
    for (const header of headers) {
      assert.equal(v[header]?.type, 'date', `${templateType} / ${header} must validate as a date`);
      assert.equal(v[header].f1, String(DATE_MIN_SERIAL));
      assert.equal(v[header].f2, String(DATE_MAX_SERIAL));
    }
  }
  const textFields = {
    evidence_expectation_matrix: ['Evidence Date / Period'],
    inheritance_worksheet: ['Evidence Version / Date'],
    reciprocity_checklist: ['Version / Date'],
  };
  for (const [templateType, headers] of Object.entries(textFields)) {
    const v = flat(templateType);
    for (const header of headers) {
      assert.notEqual(v[header]?.type, 'date', `${templateType} / ${header} allows periods and versions, so it must stay text`);
    }
  }
  assert.equal(DATE_MIN_SERIAL, 36526, '2000-01-01 is Excel serial 36526');
});

test('date columns carry a yyyy-mm-dd format and blank cells stay empty', () => {
  const entries = unzipSync(docToXlsx(build('poam_starter')));
  const styles = strFromU8(entries['xl/styles.xml']);
  assert.match(styles, /numFmtId="164" formatCode="yyyy\\-mm\\-dd"/);
  const sheet = strFromU8(entries['xl/worksheets/sheet2.xml']);
  assert.match(sheet, /<col min="8" max="8" [^>]*style="6"\/>/, 'the detection-date column defaults to the date style');
  assert.doesNotMatch(sheet, /<c r="H2"[^>]*t="inlineStr"/, 'an empty date cell must not hold an empty string');
});

test('column definitions fail closed on a header they do not own', () => {
  assert.throws(() => defineColumns(['A', 'B'], { C: {} }), /not a header/);
  assert.throws(() => listOf(['Open', 'Open']), /unique/);
  assert.throws(() => listOf([]), /unique/);
});

test('FedRAMP text is absent from a NIST workbook and present when FedRAMP is selected', () => {
  const readMe = (framework) => {
    const entries = unzipSync(docToXlsx(build('conmon_calendar', framework)));
    return strFromU8(entries['xl/worksheets/sheet1.xml']);
  };
  assert.doesNotMatch(readMe('nist-800-53'), /FedRAMP/);
  assert.match(readMe('fedramp-rev5'), /FedRAMP 2026 Context|Ongoing Certification Report/);
});

test('a workbook carries one short notice, not the two long notices', () => {
  for (const templateType of xlsxTypes) {
    const entries = unzipSync(docToXlsx(build(templateType)));
    const all = Object.keys(entries).filter((n) => n.startsWith('xl/worksheets/')).map((n) => strFromU8(entries[n])).join('\n');
    assert.equal(all.split(GENERATED_FILE_NOTICE).length - 1, 1, `${templateType}: notice must appear exactly once`);
    assert.ok(!all.includes(PRODUCT_DISCLAIMER), `${templateType}: long disclaimer must not repeat inside the file`);
    assert.ok(!all.includes(STARTER_DOCUMENT_REVIEW_NOTICE), `${templateType}: review notice must not repeat inside the file`);
  }
  const document = strFromU8(unzipSync(docToDocx(build('security_plan_starter')))['word/document.xml']);
  assert.equal(document.split(GENERATED_FILE_NOTICE).length - 1, 1);
});

test('workbooks and documents carry title and author properties', () => {
  for (const [bytes, title] of [
    [docToXlsx(build('hardware_baseline')), 'Hardware Baseline'],
    [docToDocx(build('security_plan_starter')), 'System Security Plan (SSP) Starter'],
  ]) {
    const entries = unzipSync(bytes);
    const core = strFromU8(entries['docProps/core.xml']);
    assert.ok(core.includes(`<dc:title>${title}</dc:title>`), 'document title property');
    assert.match(core, /<dc:creator>Control Atlas<\/dc:creator>/);
    assert.match(strFromU8(entries['[Content_Types].xml']), /core-properties\+xml/);
    assert.match(strFromU8(entries['_rels/.rels']), /metadata\/core-properties/);
  }
});

test('interoperability uses only the three public labels and matches the registry', () => {
  const allowed = new Set(['Verified interchange', 'Field-aligned', 'Concept-aligned']);
  for (const template of registry.templates) {
    const level = INTEROPERABILITY[template.artifact_type]?.level;
    assert.ok(allowed.has(level), `${template.name}: "${level}" is not an allowed label`);
    assert.equal(template.compatibility.classification, level, `${template.name}: registry and workbook labels must agree`);
    assert.equal(template.provenance.verified_interchange, level === 'Verified interchange');
    const publicCopy = JSON.stringify([template.description, template.compatibility, INTEROPERABILITY[template.artifact_type]]);
    assert.doesNotMatch(publicCopy, /officially specified|\bcompatible\b|schema-aligned/i, `${template.name}: overstated interoperability wording`);
  }
  assert.equal(INTEROPERABILITY.stig_evidence_checklist.level, 'Field-aligned');
});

test('a Field-aligned artifact names the destination and says import is not verified', () => {
  for (const [type, info] of Object.entries(INTEROPERABILITY)) {
    if (info.level !== 'Field-aligned') continue;
    assert.match(info.summary, /not verified/i, `${type}: must say import is not verified`);
  }
});

test('the Field Guide lists group, required flag and allowed values per column', () => {
  const entries = unzipSync(docToXlsx(build('stig_evidence_checklist')));
  const names = [...strFromU8(entries['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const guide = strFromU8(entries[`xl/worksheets/sheet${names.indexOf('Field Guide') + 1}.xml`]);
  assert.match(guide, /Choose one: Not Reviewed \| Open \| Not a Finding \| Not Applicable/);
  assert.match(guide, /Choose one: Low \| Medium \| High/);
});
