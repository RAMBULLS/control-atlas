// Independent source-side traversals. These never read normalized Atlas records.
import { parse } from 'node-html-parser';
import ExcelJS from 'exceljs';
import { iotUnitId } from './nist-structured-catalog-adapter.mjs';
import { referenceUnitId } from './framework-adapters.mjs';

const unique = (values) => [...new Set(values)].sort();
export function sourceUnitInventory(units, scope, exclusions = []) {
  const ids = units.map((unit) => unit.id);
  if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Missing native unit identity');
  return { scope, record_count: unique(ids).length, record_ids: unique(ids), native_units: units, exclusions };
}
export function controlId(value) {
  const match = String(value).trim().match(/^([A-Z]{2})-0*(\d+)(?:\s*\(0*(\d+)\)|\.0*(\d+))?$/);
  return match ? `${match[1]}-${Number(match[2])}${match[3] || match[4] ? `.${Number(match[3] || match[4])}` : ''}` : null;
}
const text = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('');
    if (value.text !== undefined) return text(value.text);
    if (value.result !== undefined) return text(value.result);
    return '';
  }
  return String(value).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
};
async function workbook(bytes) { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes); return book; }

export function cmmcInventory(xml) {
  const section = xml.match(/<DIV8\b[^>]*N="170\.14"[^>]*>([\s\S]*?)<\/DIV8>/i)?.[1];
  if (!section) throw new Error('CMMC level section170.14 missing');
  return sourceUnitInventory(unique([...section.matchAll(/\bLevel\s+(\d+)\b/g)].map((match) => match[1])).map((number) => ({ id: `LEVEL-${number}`, locator: `32-cfr-170.14#level-${number}` })), 'All native CMMC levels defined in32CFR170.14. This catalog models program levels, not the full assessment-objective or security-requirement catalogs.');
}

export function raiInventory(html) {
  const root = parse(html);
  const list = root.querySelectorAll('ol').find((element) => /Modular and Tailorable/.test(element.text));
  const shield = root.querySelectorAll('ul').find((element) => /Set Foundations|S\s+et Foundations/.test(element.text));
  if (!list || !shield) throw new Error('RAI executive-summary native lists missing');
  const principles = { modular: 'MODULAR', aligned: 'RASCI', holistic: 'HOLISTIC', dod: 'ETHICS', dow: 'ETHICS', tools: 'TOOLS' };
  const units = list.querySelectorAll('li').map((entry) => {
    const title = entry.text.trim(); const prefix = title.toLowerCase().match(/^\w+/)?.[0];
    if (!principles[prefix]) throw new Error(`Unsupported publisher toolkit principle: ${title.slice(0,80)}`);
    return { id: `PRINCIPLE-${principles[prefix]}`, title, locator: 'executive-summary#principles' };
  });
  for (const entry of shield.querySelectorAll('li')) {
    const title = entry.text.trim().replace(/^([A-Z])\s+(?=[a-z])/, '$1');
    const word = title.match(/^\w+/)?.[0]?.toUpperCase();
    if (!['SET','HONE','IMPROVE','EVALUATE','LOG','DETECT'].includes(word)) throw new Error('Unsupported SHIELD activity');
    units.push({ id: `SHIELD-${word}`, title, locator: 'executive-summary#shield' });
  }
  if (unique(units.map((entry) => entry.id)).length !== units.length) throw new Error('Duplicate toolkit unit');
  return sourceUnitInventory(units, 'All five executive-summary design principles and six SHIELD activities in the retained toolkit edition.', ['The separately linked70+tools, full assessment questionnaire and governance prose are outside this executive-summary reference catalog; no claim of full Toolkit ingestion.']);
}

export function fips199Inventory(pdfText) {
  return sourceUnitInventory(unique([...pdfText.matchAll(/The potential impact is\s+(LOW|MODERATE|HIGH)\s+if/g)].map((match) => match[1])).map((level) => ({ id: `FIPS-199-${level}`, locator: `FIPS199#potential-impact-${level.toLowerCase()}` })), 'All native FIPS199 potential-impact levels; not every paragraph or every confidentiality/integrity/availability combination.');
}
export function fips200Inventory(pdfText) {
  return sourceUnitInventory(unique([...pdfText.matchAll(/\(([A-Z]{2})\):\s*Organizations must/g)].map((match) => match[1])).map((id) => ({ id, locator: `FIPS200#${id}` })), 'All native minimum-security-requirement areas in FIPS200.');
}
export function rmfInventory(pdfText) {
  const matches = [...pdfText.matchAll(/^3\.([1-9]\d*)\s+([A-Z][A-Z ]*)/gm)];
  return sourceUnitInventory(unique(matches.map((match) => match[2].trim().split(/\s+/)[0])).map((step) => ({ id: `RMF-${step}`, locator: `SP80037r2#${step.toLowerCase()}` })), 'All seven named RMF steps in chapter3 of SP800-37Rev2.', ['Detailed tasks, roles and tables remain source prose; the existing catalog is explicitly an RMF-step catalog, not a task-by-task RMF transcription.']);
}
export function assessmentInventory(payload) {
  const units = []; const exclusions = [];
  const walk = (entries) => { for (const node of entries || []) {
    if (node.controls) walk(node.controls);
    if (node.groups) walk(node.groups);
    if (!node.class?.startsWith('SP800-53')) continue;
    if (node.parts?.some((part) => part.name === 'assessment-objective')) units.push({ id: node.id.toUpperCase(), locator: `catalog#${node.id}` });
    else exclusions.push({ id: node.id, reason: 'No publisher assessment-objective part in this control unit.' });
  } };
  walk(payload.catalog.groups); walk(payload.catalog.controls);
  return sourceUnitInventory(units, 'All SP800-53 controls/enhancements carrying native assessment-objective parts in the retained NIST OSCAL release.', exclusions);
}

export async function fedrampInventory(bytes) {
  const book = await workbook(bytes); const units = []; const memberships = {};
  for (const sheet of book.worksheets) {
    if (!/^(Low|Moderate|High|LI-SaaS) Baseline$/.test(sheet.name)) continue;
    const id = sheet.name.replace(/ Baseline$/, '').toUpperCase();
    const ids = []; sheet.eachRow((row) => { const candidate = controlId(text(row.getCell(id === 'LI-SAAS' ? 2 : 3).value)); if (candidate) ids.push(candidate); });
    if (!ids.length) throw new Error(`Empty native FedRAMP baseline ${sheet.name}`);
    memberships[id] = unique(ids); units.push({ id, locator: `sheet=${sheet.name}`, member_count: memberships[id].length });
  }
  if (!units.length) throw new Error('No native FedRAMP baseline worksheets');
  return { ...sourceUnitInventory(units, 'All four native baselines and their explicitly listed control memberships in the retained LEGACY FedRAMP Rev5 workbook.', ['Coversheet, LI-SaaS key and NIST comparison catalog are supporting worksheets, not additional FedRAMP baselines.']), memberships };
}
export function baselineProfileInventory(profiles) {
  const units = []; const memberships = {};
  for (const { id, payload, url } of profiles) {
    const profile = payload.profile; const title = profile?.metadata?.title;
    if (!title || !profile.imports?.length || !profile.metadata.version) throw new Error('Invalid native NIST baseline profile');
    const ids = profile.imports.flatMap((entry) => entry['include-controls'] || []).flatMap((entry) => entry['with-ids'] || []);
    if (!ids.length || ids.some((entry) => !controlId(entry.toUpperCase()))) throw new Error('Unsupported NIST baseline selection form');
    memberships[id] = unique(ids.map((entry) => controlId(entry.toUpperCase())));
    units.push({ id, title, edition: profile.metadata.version, locator: url, member_count: memberships[id].length });
  }
  return { ...sourceUnitInventory(units, 'All LOW, MODERATE, HIGH and PRIVACY baseline profiles from the retained NIST release; native include-control memberships, not inferred applicability.'), memberships };
}
export async function microsoftInventory(bytes) {
  const book = await workbook(bytes); const units = [];
  for (const sheet of book.worksheets) {
    const pillar = sheet.name.match(/^(\d+)-/)?.[1]; if (!pillar) continue;
    let column;
    sheet.eachRow((row, number) => {
      for (let index = 1; index <= row.cellCount; index += 1) if (text(row.getCell(index).value) === 'Question') column = index;
      if (!column) return;
      const label = text(row.getCell(column).value);
      const id = Array.from({ length: column - 1 }, (_, index) => text(row.getCell(index + 1).value)).find((value) => /^\d+$/.test(value)) || '';
      if (/^\d+$/.test(id) && label) units.push({ id: `MSZT-${pillar}-${id}`, title: label, locator: `${sheet.name}!${row.getCell(column).address}`, row: number });
    });
  }
  if (!units.length || unique(units.map((unit) => unit.id)).length !== units.length) throw new Error('Empty/duplicate native questionnaire identity');
  return sourceUnitInventory(units, 'Every numbered native question in all numbered pillar worksheets.', ['Introduction, Results and AnswersList are workbook guidance/scoring/choice sheets, not additional assessment questions. Example filled responses and formulas are not organization evidence and are not ingested.']);
}
export function mobileInventory(payload) {
  if (!Array.isArray(payload)) throw new Error('Expected publisher mobile-threat array');
  const units = []; const excluded = [];
  const categories = new Set();
  payload.forEach((entry, index) => {
    if (!Object.values(entry).some((value) => text(value))) { excluded.push({ locator: `/${index}`, reason: 'Fully blank publisher row.' }); return; }
    const id = text(entry.ThreatID); if (!id) throw new Error(`Publisher threat row${index} has content without an ID`);
    units.push({ id, locator: `/${index}` });
    const category = text(entry.ThreatCategory); if (!category) throw new Error(`Threat ${id} has no native category`);
    categories.add(category);
  });
  if (unique(units.map((unit) => unit.id)).length !== units.length) throw new Error('Duplicate mobile-threat identity');
  for (const category of categories) units.push({ id: iotUnitId('CATEGORY', category), title: category, locator: 'ThreatCategory' });
  return { ...sourceUnitInventory(units, 'All nonblank native ThreatID entries and distinct publisher ThreatCategory grouping values in the official mobile-threat JSON; no generated CVE items or inferred CVE mappings.', excluded), source_rows: payload.length, category_units: categories.size };
}

export async function iotInventory(workbooks) {
  const units = new Map(); const worksheets = [];
  const add = (id, title, parent, location) => {
    const prior = units.get(id); if (prior && prior.parent !== parent) throw new Error(`Native IoT unit collides across different parents: ${id}; ${prior.parent} versus ${parent}`);
    if (prior && prior.title !== title) prior.native_titles = unique([...(prior.native_titles || [prior.title]), title]);
    if (!prior) units.set(id, { id, title, parent, locator: location });
  };
  for (const { bytes, id } of workbooks) for (const sheet of (await workbook(bytes)).worksheets) {
    const technical = /^Technical\b/i.test(sheet.name);
    if (!technical && !/^Non.?Technical\b/i.test(sheet.name)) throw new Error(`Unsupported IoT worksheet ${sheet.name}`);
    const domain = technical ? 'Technical Capabilities' : 'Non-Technical Manufacturer Capabilities';
    const domainId = iotUnitId('DOMAIN', domain); add(domainId, domain, 'CATALOG', `${id}#${sheet.name}`);
    let capability = ''; let subcapability = ''; let element = '';
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const cells = [1,2,3,4].map((index) => text(row.getCell(index).value));
      if (cells[0]) capability = cells[0]; if (cells[1]) subcapability = cells[1]; if (!technical && cells[2]) element = cells[2];
      if (!capability) return;
      const capId = iotUnitId('CAPABILITY', domain, capability); const locator = `${id}#${sheet.name}!A${number}`; add(capId, capability, domainId, locator);
      if (!subcapability) return;
      const subId = iotUnitId('SUBCAPABILITY', domain, capability, subcapability); add(subId, subcapability, capId, locator);
      if (!technical && element) add(iotUnitId('ELEMENT', domain, capability, subcapability, element), element, subId, locator);
      const leaf = cells[3]; if (!leaf) return;
      const parent = technical ? subId : iotUnitId('ELEMENT', domain, capability, subcapability, element);
      const leafId = iotUnitId(technical ? 'ELEMENT' : 'SUBELEMENT', domain, capability, subcapability, leaf); add(leafId, leaf, parent, `${id}#${sheet.name}!D${number}`);
    });
    worksheets.push({ source_id: id, name: sheet.name, native_rows: sheet.rowCount - 1 });
  }
  return { ...sourceUnitInventory([...units.values()], 'Every native technical/nontechnical capability, subcapability, element and subelement in both retained mapping workbooks, including units without mapping cells.'),
    evidence_class: 'publisher_mapping_inventory', primary_extraction_status: 'not_performed', worksheets };
}

export async function nistZeroTrustInventory(inputs) {
  const units = []; const exclusions = []; const pdf = inputs.coreText; const html = parse(inputs.overviewHtml);
  for (const id of ['SP800-207', 'SP800-207A', 'SP1800-35']) units.push({ id, locator: 'defining publication' });
  const tenetStart = pdf.search(/^1\.\s+All data sources/m);
  const tenetEnd = pdf.slice(tenetStart).search(/^2\.2\b/m);
  if (tenetStart < 0 || tenetEnd < 0) throw new Error('Native NIST tenet section boundary missing');
  const tenets = [...pdf.slice(tenetStart, tenetStart + tenetEnd).matchAll(/^(\d+)\.\s+(.+)/gm)];
  for (const match of tenets) units.push({ id: `SP800207-TENET-${match[1]}`, title: match[2], locator: `SP800207#tenet-${match[1]}` });
  const componentStart = pdf.indexOf('The component descriptions:'); const componentEnd = pdf.slice(componentStart).search(/^3\.1\b/m);
  if (componentStart < 0 || componentEnd < 0) throw new Error('Native NIST logical-component section missing');
  for (const match of pdf.slice(componentStart, componentStart + componentEnd).matchAll(/^\s*•\s*([^:\n]+):/gm)) {
    const title = match[1].trim(); const slug = title.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    units.push({ id: `SP800207-COMPONENT-${slug}`, title, locator: 'SP800207#logical-components' });
  }
  for (const id of unique([...inputs.cloudText.matchAll(/^\s*•\s*([A-Z][A-Z-]+-\d+):/gm)].map((match) => match[1]))) units.push({ id: `SP800207A-${id}`, locator: `SP800207A#${id}` });
  const builds = unique(html.querySelectorAll('a').map((link) => (link.getAttribute('href') || '').match(/VolumeB\/appendices\/Appendix-(E\d+B\d+)\.html/)?.[1]).filter(Boolean));
  for (const code of builds) {
    if (!inputs.htmlSources.some((entry) => entry.id === `SP180035-${code}-architecture`) || !inputs.htmlSources.some((entry) => entry.id === `SP180035-${code}-implementation_guide`)) throw new Error(`Build ${code} lacks acquired architecture or implementation source`);
    units.push({ id: `SP180035-${code}`, locator: `VolumeB/appendices/Appendix-${code}.html` });
  }
  const roster = html.querySelectorAll('table').find((table) => /Technology Partners\/Collaborators/.test(table.querySelector('caption')?.text || ''));
  if (!roster) throw new Error('Native technology collaborator table missing');
  for (const cell of roster.querySelectorAll('td')) { const title = cell.text.trim(); if (title) units.push({ id: referenceUnitId('COLLABORATOR', title), title, locator: 'Technology Partners/Collaborators' }); }
  const literal = (cell) => cell == null ? '' : typeof cell === 'object' ? (cell.richText ? cell.richText.map((part) => part.text).join('') : literal(cell.text ?? cell.result)) : String(cell).replace(/\r/g, '').trim();
  const components = new Map(); const contributors = new Set();
  for (const input of inputs.mappingWorkbooks) {
    units.push({ id: referenceUnitId('MAPPING-DOCUMENT', input.id), locator: input.id });
    for (const sheet of (await workbook(input.bytes)).worksheets) {
      let columns; let component = ''; let product = ''; let fn = '';
      sheet.eachRow((row, number) => {
        const values = Array.from({ length: row.cellCount }, (_, index) => literal(row.getCell(index + 1).value));
        if (!columns) {
          const c = values.findIndex((value) => /zta .*architecture component/i.test(value));
          if (c < 0) return;
          columns = { component: c, product: values.findIndex((value) => /^product$/i.test(value)), fn: values.findIndex((value) => /component.s function/i.test(value)), relationship: values.findIndex((value) => /relationship/i.test(value) && !/explanation/i.test(value)) };
          if (columns.fn < 0 || columns.relationship < 0) throw new Error(`Unsupported mapping worksheet schema: ${sheet.name}`); return;
        }
        if (/^ZTA .*architecture component$/i.test(values[columns.component] || '') && /component.s function/i.test(values[columns.fn] || '')) {
          exclusions.push({ locator: `${input.id}#${sheet.name}!row=${number}`, reason: 'Repeated publisher column header, not an architecture component.' }); return;
        }
        if (/^Note\b/.test(values[columns.component] || '') && values.filter(Boolean).length === 1) {
          exclusions.push({ locator: `${input.id}#${sheet.name}!row=${number}`, reason: 'Publisher footnote, not an architecture component or relationship.', publisher_text: values[columns.component] }); return;
        }
        if (values[columns.component]) component = values[columns.component];
        if (values[columns.product]) product = values[columns.product];
        if (values[columns.fn]) fn = values[columns.fn];
        if (!component || !fn || !values.some((value) => value)) return;
        const collaborator = columns.product >= 0 ? sheet.name : null;
        if (collaborator) contributors.add(collaborator);
        const key = `${collaborator || 'reference'}\0${product || ''}\0${component}\0${fn}`;
        const id = referenceUnitId(collaborator ? 'PRODUCT-COMPONENT' : 'REFERENCE-COMPONENT', key);
        if (!components.has(id)) components.set(id, { id, title: product || component, locator: `${input.id}#${sheet.name}!row=${number}` });
      });
      if (!columns) throw new Error(`Mapping worksheet lacks native context headers: ${sheet.name}`);
    }
  }
  for (const title of contributors) units.push({ id: referenceUnitId('MAPPING-CONTRIBUTOR', title), title, locator: 'native workbook worksheet title' });
  units.push(...components.values());
  return sourceUnitInventory(units, 'All retained NIST SP800-207 tenets/logical components, SP800-207A native requirement codes, SP1800-35 publications/builds/collaborators and every native component context in all four mapping workbooks, including unmapped component contexts.', [...exclusions, { reason: 'Build guide sections, code/configuration blocks and media are supporting captured content within build records, not separate control items.' }]);
}

export function dodZeroTrustInventory(captures, documents) {
  const units = []; const evidence = []; const excludedSources = [];
  for (const document of documents) {
    const capture = captures.find((entry) => entry.document_key === document.source_key);
    if (!capture || capture.pages.length !== document.pages || capture.reconciliation.pages_extracted !== document.pages || new Set(capture.pages.map((page) => page.page)).size !== document.pages) throw new Error(`Missing or incomplete full-page capture: ${document.source_key}`);
    if (capture.source.sha256 !== document.checksum || capture.source.byte_length !== document.byte_length) throw new Error(`DoD capture source attestation differs: ${document.source_key}`);
    const recovery = document.source_recovery;
    if (recovery?.status === 'verified_relocation' && (recovery.byte_evidence?.sha256 !== document.checksum || recovery.byte_evidence?.bytes !== document.byte_length)) throw new Error(`DoD recovered source byte identity differs: ${document.source_key}`);
    evidence.push({ source_id: document.source_key, url: recovery?.accepted_url || document.source_url, sha256: document.checksum, byte_length: document.byte_length,
      retrieved_at: recovery?.retrieved_at || document.retrieved_at,
      ...(recovery?.status === 'verified_relocation' ? { evidence_kind: 'downloaded_publisher_bytes', acquisition_method: 'native_browser_download_from_observed_official_library_link' }
        : { evidence_kind: 'complete_retained_publisher_page_capture', binary_reverification: 'UNKNOWN: original official binary is unavailable at its old and migrated endpoints (browser404). The public archive has different bytes but all383page texts independently match the retained capture.', ...(recovery?.archival_corroboration ? { archival_corroboration: recovery.archival_corroboration } : {}) }) });
    if (document.atlas_role === 'supporting_resource') excludedSources.push({ source_id: document.source_key, reason: 'Registered supporting reference resource; no canonical catalog item is manufactured.' });
  }
  const ra = captures.find((entry) => entry.document_key === 'dod-zt-reference-architecture-v2').pages.map((page) => page.text).join('\n');
  const start = ra.indexOf('ZT has five major tenets.'); const end = ra.indexOf('2.3 Pillars', start);
  if (start < 0 || end < 0) throw new Error('DoD native tenet boundaries missing');
  [...ra.slice(start, end).matchAll(/^•\s*([^.]+)\./gm)].forEach((match, index) => units.push({ id: `TENET-${index + 1}`, title: match[1], locator: 'RA2.0#section2.2' }));
  const pillarsStart = ra.indexOf('The seven Pillars in the DoD ZT Architecture include:'); const pillarsEnd = ra.indexOf('2.4 Reference Architecture Principles', pillarsStart);
  if (pillarsStart < 0 || pillarsEnd < 0) throw new Error('DoD native pillar boundaries missing');
  [...ra.slice(ra.indexOf(':', pillarsStart) + 1, pillarsEnd).matchAll(/^([A-Z][A-Za-z /]+):/gm)].forEach((match, index) => units.push({ id: `PILLAR-${index + 1}`, title: match[1], locator: 'RA2.0#section2.3' }));
  const docIds = { 'dod-zt-reference-architecture-v2': 'DOC-RA', 'dod-zt-strategy': 'DOC-STRATEGY', 'dod-zt-capabilities': 'DOC-CAPABILITIES', 'dod-zt-execution-roadmap': 'DOC-ROADMAP', 'dod-zt-overlays-2024': 'DOC-OVERLAYS', 'dod-zt-operational-technology': 'DOC-OT' };
  for (const document of documents.filter((entry) => entry.atlas_role === 'primary_publication')) { if (!docIds[document.source_key]) throw new Error('Unclassified DoD publication'); units.push({ id: docIds[document.source_key], locator: document.source_url }); }
  for (const key of ['dod-zt-capabilities', 'dod-zt-operational-technology']) {
    const capture = captures.find((entry) => entry.document_key === key);
    for (const page of capture.pages) for (const table of page.tables) {
      const header = table.rows[0]?.map((cell) => cell?.text || '').join('|') || '';
      if (!/ID\s*#|OT Activity ID/.test(header)) continue;
      for (const [index, row] of table.rows.slice(1).entries()) {
        const id = (row[0]?.text || '').replace(/\s/g, ''); if (!id) continue;
        const pattern = /^\d+\.\d+$/; const activity = /^\d+\.\d+\.\d+(?:\.OT)?$/;
        if (!pattern.test(id) && !activity.test(id)) throw new Error(`Unrecognized DoD native table identity: ${id}`);
        const prefix = pattern.test(id) ? 'CAP' : 'ACT'; units.push({ id: `${prefix}-${id.replace(/\./g, '-')}`, title: row[1]?.text || '', locator: `${key}#page=${page.page}&table=${table.id}&row=${index + 1}` });
      }
    }
  }
  return { ...sourceUnitInventory(units, 'All native DoD ZT RA tenets/pillars, six registered primary documents, capability/activity rows and OT activity rows in complete retained official-source page captures. Seven source PDFs are freshly byte-identical at the current official CIO library. Overlay content has independent383-page archival corroboration; its current official hosting/replacement/lifecycle remains UNKNOWN.', excludedSources), source_evidence: evidence };
}
