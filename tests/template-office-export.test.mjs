import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import { buildTemplateDocument } from '../src/app/template-engine.mjs';
import { docToDocx, docToXlsx, officeDocumentToSheets, renderOfficeDocument } from '../src/app/office-export.mjs';
import { GENERATED_FILE_NOTICE } from '../src/shared/disclaimer.mjs';
import { STIG_ID, addStigFixture } from './helpers/stig-fixture.mjs';

const dataset = {
  nodes: [
    {
      id: 'nist-800-53:AC-2',
      node_type: 'control',
      label: 'AC-2 Account Management',
      lifecycle_status: 'active',
      metadata: {
        catalog_id: 'nist-800-53',
        item_id: 'AC-2',
        title: 'Account Management',
        control_family: 'Access Control',
      },
    },
  ],
  sources: [{ id: 'nist-oscal', display_name: 'SP 800-53 Rev. 5', version: '2026-06-09' }],
};
addStigFixture(dataset);

function buildDoc(templateType) {
  const { doc } = buildTemplateDocument(
    {
      templateType,
      stig: STIG_ID,
      framework: 'nist-800-53',
      environment: 'Cloud SaaS',
      sourceRefs: ['nist-oscal'],
      sources: dataset.sources,
    },
    dataset,
  );
  return doc;
}

function isZip(bytes) {
  // Local file header magic "PK\x03\x04".
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const spreadsheetTemplateTypes = [
  'implementation_statement_worksheet',
  'evidence_expectation_matrix',
  'stig_evidence_checklist',
  'inheritance_worksheet',
  'reciprocity_checklist',
  'poam_starter',
  'assessment_planning_worksheet',
  'conmon_calendar',
  'hardware_baseline',
  'software_baseline',
  'ppsm_preparation_worksheet',
];

test('every spreadsheet template has one authoritative sheet per logical table and blank working cells', () => {
  for (const templateType of spreadsheetTemplateTypes) {
    const doc = buildDoc(templateType);
    const sheets = officeDocumentToSheets(doc);
    const tableSections = doc.sections.filter((section) => section.type === 'table');
    const dataSheets = sheets.filter((sheet) => sheet.kind === 'data');

    assert.equal(sheets[0].name, 'Read Me', `${templateType}: instructions must open first`);
    assert.equal(sheets.at(-1).name, 'Field Guide', `${templateType}: field guide must remain available`);
    assert.equal(
      dataSheets.length,
      tableSections.length,
      `${templateType}: logical tables must not be split or duplicated`,
    );
    assert.equal(
      new Set(sheets.map((sheet) => sheet.name.toLowerCase())).size,
      sheets.length,
      `${templateType}: worksheet names must be unique`,
    );
    for (const sheet of dataSheets) {
      assert.equal(sheet.rows[0].length, sheet.headers.length, `${templateType}/${sheet.name}: header width`);
      for (const row of sheet.rows.slice(1)) {
        assert.equal(row.length, sheet.headers.length, `${templateType}/${sheet.name}: row width`);
        for (const cell of row) {
          assert.doesNotMatch(
            String(cell?.formula ?? cell),
            /^\[[\s\S]*\]$/,
            `${templateType}/${sheet.name}: placeholders belong in the field guide, not working rows`,
          );
        }
      }
    }
  }
});

test('xlsx export is a valid zip with instructions, one authoritative register, and a field guide', () => {
  const bytes = docToXlsx(buildDoc('poam_starter'));
  assert.ok(isZip(bytes), 'xlsx must be a ZIP package');

  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  assert.ok(names.includes('[Content_Types].xml'), 'missing content types part');
  assert.ok(names.includes('xl/workbook.xml'), 'missing workbook part');
  assert.ok(names.includes('xl/_rels/workbook.xml.rels'), 'missing workbook rels');
  assert.ok(names.includes('xl/worksheets/sheet1.xml'), 'missing first worksheet');

  const workbook = strFromU8(entries['xl/workbook.xml']);
  assert.match(workbook, /<sheet /, 'workbook must declare at least one sheet');
  assert.match(workbook, /<sheet name="Read Me" sheetId="1"/, 'instructions must be the first sheet users see');
  assert.match(workbook, /<sheet name="POA&amp;M Working Register" sheetId="2"/, 'the working register must remain one authoritative sheet');
  assert.match(workbook, /name="Field Guide"/, 'workbook must include a compact field dictionary');
  assert.match(workbook, /name="Read Me"/, 'workbook must include instructions and provenance');

  // The Notes sheet always carries the disclaimer; find it in any worksheet.
  const allSheets = names
    .filter((n) => n.startsWith('xl/worksheets/'))
    .map((n) => strFromU8(entries[n]))
    .join('\n');
  assert.ok(
    allSheets.includes(GENERATED_FILE_NOTICE),
    'the one short notice must be present in the workbook',
  );
  assert.match(allSheets, /inlineStr/, 'cells should be written as inline strings');
});

test('xlsx export enumerates control rows for a tabular template', () => {
  const bytes = docToXlsx(buildDoc('implementation_statement_worksheet'));
  const entries = unzipSync(bytes);
  const sheets = Object.keys(entries)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .map((n) => strFromU8(entries[n]))
    .join('\n');
  assert.match(sheets, /AC-2/, 'control ID must appear as a cell value');
});

test('docx export is a valid zip with a document body, a table, and the disclaimer', () => {
  const bytes = docToDocx(buildDoc('security_plan_starter'));
  assert.ok(isZip(bytes), 'docx must be a ZIP package');

  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  assert.ok(names.includes('[Content_Types].xml'), 'missing content types part');
  assert.ok(names.includes('word/document.xml'), 'missing document part');
  assert.ok(names.includes('_rels/.rels'), 'missing package rels');

  const document = strFromU8(entries['word/document.xml']);
  assert.match(document, /<w:document/, 'document must be wordprocessingml');
  assert.match(document, /<w:tbl>/, 'SSP docx must contain a table');
  assert.match(document, /Account Management|AC-2/, 'control content must be present');
  assert.ok(
    document.includes(GENERATED_FILE_NOTICE),
    'the one short notice must be present',
  );
  assert.match(document, /<w:sectPr>/, 'body must end with section properties');
});

test('renderOfficeDocument returns bytes, mime, and extension per format', () => {
  const doc = buildDoc('poam_starter');
  const xlsx = renderOfficeDocument(doc, 'xlsx');
  assert.equal(xlsx.extension, 'xlsx');
  assert.match(xlsx.mimeType, /spreadsheetml\.sheet$/);
  assert.ok(xlsx.bytes instanceof Uint8Array);

  const docx = renderOfficeDocument(doc, 'docx');
  assert.equal(docx.extension, 'docx');
  assert.match(docx.mimeType, /wordprocessingml\.document$/);

  assert.throws(() => renderOfficeDocument(doc, 'pdf'), /Unsupported office format/);
});

test('xlsx round-trips through a real spreadsheet reader (Excel-compatible)', async () => {
  const bytes = docToXlsx(buildDoc('poam_starter'));
  const dir = mkdtempSync(join(tmpdir(), 'ca-office-'));
  const file = join(dir, 'poam.xlsx');
  try {
    writeFileSync(file, bytes);
    // read-excel-file is an independent OOXML parser; a clean parse proves the
    // workbook is genuinely spreadsheet-readable, not just well-formed XML.
    const parsed = await readXlsxFile(file);
    const rows = parsed.find((sheet) => sheet.sheet === 'POA&M Working Register')?.data || [];
    // The POA&M tracker ships 10 intentionally blank rows; readers drop empty
    // rows, so the contract is that the header row survives the round-trip.
    assert.ok(rows.length >= 1, 'reader must recover the header row');
    assert.ok(
      rows[0].some((cell) => String(cell).includes('externalUid')),
      'header row must survive the round-trip',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('xlsx working registers set bounded widths, freeze row and key column, and distinguish editable cells', () => {
  const bytes = docToXlsx(buildDoc('poam_starter'));
  const entries = unzipSync(bytes);
  const sheet1 = strFromU8(entries['xl/worksheets/sheet2.xml']);

  // Per-column widths, declared before sheetData in schema order.
  assert.match(sheet1, /<cols><col min="1" max="1" width="\d+" customWidth="1"\/>/, 'missing <cols> declaration');
  assert.ok(sheet1.indexOf('<sheetViews>') < sheet1.indexOf('<cols>'), 'sheetViews must precede cols');
  assert.ok(sheet1.indexOf('<cols>') < sheet1.indexOf('<sheetData>'), 'cols must precede sheetData');
  for (const m of sheet1.matchAll(/width="(\d+)"/g)) {
    const w = Number(m[1]);
    assert.ok(w >= 12 && w <= 60, `column width ${w} out of the 12..60 bounds`);
  }

  // Frozen top row.
  assert.match(
    sheet1,
    /<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/>/,
    'header row and the ID and status columns must be frozen',
  );

  // Header cells reference the bold + wrapped cellXf (s="1").
  assert.match(sheet1, /<c r="A1" s="[0-9]+" t="inlineStr">/, 'header cells must use a header style');
  assert.match(sheet1, /<c r="A2" s="5"\/>/, 'blank required cells are empty cells with the required-entry style');
  assert.doesNotMatch(sheet1, /\[Scanner severity\]/, 'instructional placeholders must not masquerade as entered records');
  const fieldGuide = strFromU8(entries['xl/worksheets/sheet4.xml']);
  assert.match(fieldGuide, /\[Scanner severity\]/, "placeholder guidance must remain available once in the field guide");
  assert.match(fieldGuide, /Your stable tracking ID/, "a column help text replaces its placeholder in the field guide");

  // Styles part wired through content types and workbook rels.
  const styles = strFromU8(entries['xl/styles.xml']);
  assert.match(styles, /<b\/>/, 'styles must define a bold header font');
  assert.match(styles, /<alignment vertical="top" wrapText="1"\/>/, 'header style must wrap text');
  assert.match(strFromU8(entries['[Content_Types].xml']), /\/xl\/styles\.xml/, 'styles part must be declared');
  assert.match(strFromU8(entries['xl/_rels/workbook.xml.rels']), /relationships\/styles/, 'workbook must relate to styles');
  assert.match(sheet1, /<showGridLines val="0"\/>/, 'explicit workbook styling should replace default gridlines');
  assert.match(sheet1, /<autoFilter ref=/, 'tracker sheets must expose header filters');
  assert.match(sheet1, /<dataValidations count=/, 'controlled tracker fields must expose dropdown validation');
  assert.match(sheet1, /Use one of the values in the dropdown/, 'POA&M controlled fields must explain a rejected value');
  assert.match(styles, /17365D/, 'header style must use the restrained navy palette');
  assert.match(sheet1, /<pageSetUpPr fitToPage="1"\/>/, 'print scaling must explicitly enable fit-to-page');
  assert.match(sheet1, /<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/, 'worksheets must print one landscape Letter page wide');
  assert.match(sheet1, /Control Atlas reference aid/, 'printed worksheets must identify their provenance in the footer');
  const workbook = strFromU8(entries['xl/workbook.xml']);
  assert.match(workbook, /_xlnm\.Print_Titles/, 'printed worksheets must repeat the header row');
  assert.match(workbook, /\$1:\$1/, 'row 1 must be the repeated print title');
});

test('wide XLSX registers stay on one source-of-truth sheet', () => {
  const bytes = docToXlsx(buildDoc('poam_starter'));
  const entries = unzipSync(bytes);
  const workbook = strFromU8(entries['xl/workbook.xml']);
  const sheetNames = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    sheetNames,
    ['Read Me', 'POA&amp;M Working Register', 'Milestones', 'Field Guide'],
    'POA&M keeps one register plus one milestones sheet, with no duplicated slices',
  );
  const register = strFromU8(entries['xl/worksheets/sheet2.xml']);
  const firstRow = register.match(/<row r="1".*?<\/row>/)?.[0] || '';
  assert.equal(
    [...firstRow.matchAll(/<c r="([A-Z]+)1"/g)].length,
    30,
    'all 30 POA&M fields must remain in the canonical working register',
  );
  assert.match(register, /<c r="AD1" s="\d+"/, 'the final POA&M field must remain present');
});

test('docx tables declare a fixed-width grid and a repeating header row', () => {
  const bytes = docToDocx(buildDoc('security_plan_starter'));
  const document = strFromU8(unzipSync(bytes)['word/document.xml']);

  const tblCount = (document.match(/<w:tbl>/g) || []).length;
  const gridCount = (document.match(/<w:tblGrid>/g) || []).length;
  const headerCount = (document.match(/<w:tblHeader\/>/g) || []).length;
  assert.ok(tblCount > 0, 'SSP docx must contain tables');
  assert.equal(gridCount, tblCount, 'every table must declare a tblGrid');
  assert.equal(headerCount, tblCount, 'every table must repeat its header row across pages');

  assert.match(document, /<w:tblW w:w="9360" w:type="dxa"\/>/, 'tables must use the exact usable page width');
  assert.match(document, /<w:tblLayout w:type="fixed"\/>/, 'tables must use fixed layout');
  assert.match(document, /<w:cantSplit\/>/, 'table rows must not split across pages');
  assert.match(document, /<w:gridCol w:w="\d+"\/>/, 'grid columns must carry explicit widths');
  assert.match(document, /<w:tcW w:w="\d+" w:type="dxa"\/>/, 'cells must carry explicit widths');
  assert.doesNotMatch(document, /<w:tblW w:w="0" w:type="auto"\/>/, 'auto-width tables clip in Word');

  // Every grid must distribute exactly the usable page width (12240 − 2×1440).
  for (const grid of document.match(/<w:tblGrid>.*?<\/w:tblGrid>/g) || []) {
    const sum = [...grid.matchAll(/w:w="(\d+)"/g)].reduce((total, m) => total + Number(m[1]), 0);
    assert.equal(sum, 9360, 'gridCol widths must sum to the usable page width');
  }

  assert.match(document, /w:pStyle w:val="Title"/, 'DOCX must use a real title style');
  assert.match(document, /w:pStyle w:val="Heading1"/, 'DOCX must use a heading hierarchy');
  assert.match(document, /Control Family Index/, 'the compact control scope must remain navigable from the section hierarchy');
  assert.match(document, /w:pStyle w:val="TOC1"/, 'long Word templates must include a static contents map');
  assert.match(document, /Document Purpose/, 'the contents map must name major document sections');
  assert.doesNotMatch(document, /\*\*/, 'DOCX must not expose markdown emphasis markers');

  const entries = unzipSync(bytes);
  assert.ok(entries['word/styles.xml'], 'DOCX must include styles.xml');
  assert.ok(entries['word/numbering.xml'], 'DOCX must include real list numbering');
  assert.ok(entries['word/settings.xml'], 'DOCX must include Word compatibility settings');
  assert.ok(entries['word/header1.xml'], 'DOCX must include a running header');
  assert.ok(entries['word/footer1.xml'], 'DOCX must include a page-number footer');
  const settings = strFromU8(entries['word/settings.xml']);
  assert.match(settings, /w:name="compatibilityMode"/, 'DOCX must declare a modern Word compatibility mode');
  assert.match(settings, /w:val="15"/, 'DOCX must avoid opening in legacy Compatibility Mode');
  assert.doesNotMatch(settings, /<w:updateFields/, 'opening the template must not trigger Word field-update warnings');
  assert.match(document, /<w:numPr>/, 'instruction lists must use native Word bullets');
  assert.doesNotMatch(document, /<w:t[^>]*>• /, 'bullet glyphs must not be embedded as body text');
  assert.match(document, /<w:t[^>]*>Response<\/w:t>/, 'pipe-delimited SSP prompts must render as fillable field tables');
});

test('xml special characters in cell values are escaped, not injected', () => {
  const doc = {
    title: 'Ampersand & <Angle> "Quote"',
    description: 'x',
    sections: [{ type: 'table', heading: 'T', headers: ['A & B'], rows: [['<script>']] }],
  };
  const xlsx = strFromU8(unzipSync(docToXlsx(doc))['xl/worksheets/sheet2.xml']);
  assert.match(xlsx, /A &amp; B/);
  assert.match(xlsx, /&lt;script&gt;/);
  assert.equal(xlsx.indexOf('<script>'), -1);
});
