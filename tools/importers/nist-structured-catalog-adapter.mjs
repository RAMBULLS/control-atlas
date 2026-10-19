import { createHash } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';
import csf11 from '../../data/csf-1.1.json' with { type: 'json' };
import referenceManifest from '../../data/curated/reference-catalogs/source-manifest.json' with { type: 'json' };
import { rejectInvalidPublisherIdentifier } from './reference-dispositions.mjs';

const csf11Ids = new Set(csf11.records.map((record) => record.id));
export function iotMappingDisposition(record) {
  const unresolved = (record.publisher_mappings || []).filter((mapping) => mapping.target_catalog === 'nist-csf-1.1' && !csf11Ids.has(mapping.target_id));
  return {
    relationships: (record.publisher_mappings || []).filter((mapping) => !unresolved.includes(mapping)),
    ...(unresolved.length ? { unresolved_mappings: unresolved.map((mapping) => ({ ...mapping,
      reason: 'Publisher mapping target is absent from the complete official CSF 1.1 Core; the original citation is retained without an inferred correction.',
      source_disposition: rejectInvalidPublisherIdentifier(mapping, csf11Ids, {
        source_url: referenceManifest.sources.find((entry) => entry.id === 'nist-csf-1.1').url,
        source_sha256: referenceManifest.sources.find((entry) => entry.id === 'nist-csf-1.1').sha256,
        record_ids: referenceManifest.catalogs.csf11.record_ids,
      }) })) } : {}),
  };
}

function text(value) {
  return value == null ? '' : String(value).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function stableId(prefix, ...parts) {
  const identity = parts.map((part) => text(part).replace(/[.,;:!?]+(?=\)?[.,;:!?]*$)/g, '')).join('\0');
  const readable = identity.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 54);
  return `${prefix}-${readable}-${createHash('sha256').update(identity).digest('hex').slice(0, 10).toUpperCase()}`;
}
export { stableId as iotUnitId };

function columnName(index) {
  let number = index + 1;
  let output = '';
  while (number > 0) {
    number -= 1;
    output = String.fromCharCode(65 + (number % 26)) + output;
    number = Math.floor(number / 26);
  }
  return output;
}

function cellFragment(sourceKey, sheet, rowIndex, columnIndex, field, value) {
  const normalized = text(value);
  return {
    field,
    source_key: sourceKey,
    sheet,
    cell: `${columnName(columnIndex)}${rowIndex + 1}`,
    text: normalized,
    checksum: sha256(normalized),
    extraction_method: 'read-excel-file-9.2.0-cell',
  };
}

function mappingIds(value, kind) {
  const pattern = kind === 'sp_800_53'
    ? /\b[A-Z]{2,3}-0*(\d+)\b/g
    : /\b[A-Z]{2}\.[A-Z]{2}-\d+\b/g;
  return [...new Set([...text(value).matchAll(pattern)].map((match) => {
    if (kind !== 'sp_800_53') return match[0];
    return match[0].replace(/-0+(\d+)/, '-$1');
  }))];
}

function addRecord(records, record) {
  const existing = records.get(record.id);
  if (!existing) {
    records.set(record.id, record);
    return record;
  }
  for (const fragment of record.source_fragments || []) {
    if (!existing.source_fragments.some((entry) => entry.source_key === fragment.source_key && entry.cell === fragment.cell)) {
      existing.source_fragments.push(fragment);
    }
  }
  return existing;
}

async function parseIoTWorkbook(bytes, source) {
  const workbook = await readXlsxFile(bytes);
  const records = new Map();
  const reconciliation = [];
  for (const worksheet of workbook) {
    const isTechnical = /^Technical\b/i.test(worksheet.sheet);
    const domainTitle = isTechnical ? 'Technical Capabilities' : 'Non-Technical Manufacturer Capabilities';
    const domainId = stableId('DOMAIN', domainTitle);
    addRecord(records, {
      id: domainId,
      type: 'iot_capability_domain',
      title: domainTitle,
      parent_id: 'CATALOG',
      source_fragments: [cellFragment(source.source_key, worksheet.sheet, 0, 0, 'domain', worksheet.sheet)],
    });
    let capability = '';
    let subcapability = '';
    let element = '';
    let parsedRows = 0;
    for (let rowIndex = 1; rowIndex < worksheet.data.length; rowIndex += 1) {
      const row = worksheet.data[rowIndex];
      if (text(row[0])) capability = text(row[0]);
      if (text(row[1])) subcapability = text(row[1]);
      if (!isTechnical && text(row[2])) element = text(row[2]);
      const leaf = text(row[isTechnical ? 3 : 3]) || (!isTechnical ? element : '');
      const mapping = text(row[4]);
      if (!capability || !subcapability || !leaf) continue;
      parsedRows += 1;
      const capabilityId = stableId('CAPABILITY', domainTitle, capability);
      const subcapabilityId = stableId('SUBCAPABILITY', domainTitle, capability, subcapability);
      addRecord(records, {
      id: capabilityId,
      type: 'iot_capability',
      title: capability,
      parent_id: domainId,
        source_fragments: [cellFragment(source.source_key, worksheet.sheet, rowIndex, 0, 'capability', capability)],
      });
      addRecord(records, {
      id: subcapabilityId,
      type: 'iot_subcapability',
      title: subcapability,
      ...(isTechnical && text(row[2]) && text(row[2]) !== subcapability ? { description: text(row[2]) } : {}),
        parent_id: capabilityId,
        source_fragments: [
          cellFragment(source.source_key, worksheet.sheet, rowIndex, 1, 'subcapability', subcapability),
          ...(isTechnical && text(row[2]) ? [cellFragment(source.source_key, worksheet.sheet, rowIndex, 2, 'description', row[2])] : []),
        ],
      });
      let parentId = subcapabilityId;
      if (!isTechnical && text(row[3])) {
        const elementId = stableId('ELEMENT', domainTitle, capability, subcapability, element);
        addRecord(records, {
          id: elementId,
          type: 'iot_capability_element',
          title: element,
          parent_id: subcapabilityId,
          source_fragments: [cellFragment(source.source_key, worksheet.sheet, rowIndex, 2, 'element', element)],
        });
        parentId = elementId;
      }
      const leafId = stableId(isTechnical ? 'ELEMENT' : (text(row[3]) ? 'SUBELEMENT' : 'ELEMENT'), domainTitle, capability, subcapability, leaf);
      const mappingKind = source.mapping_kind;
      const targetIds = mappingIds(mapping, mappingKind);
      addRecord(records, {
        id: leafId,
        type: text(row[3]) && !isTechnical ? 'iot_capability_subelement' : 'iot_capability_element',
        title: leaf,
        parent_id: parentId,
        publisher_mappings: targetIds.map((targetId) => ({
          target_catalog: mappingKind === 'sp_800_53' ? 'nist-800-53' : 'nist-csf-1.1',
          target_id: targetId,
          relationship_type: 'maps_to',
          source_id: source.source_key,
          source_locator: `${source.url}#sheet=${encodeURIComponent(worksheet.sheet)}&row=${rowIndex + 1}`,
          raw_mapping: mapping,
        })),
        source_fragments: [
          cellFragment(source.source_key, worksheet.sheet, rowIndex, isTechnical ? 3 : (text(row[3]) ? 3 : 2), 'requirement', leaf),
          ...(mapping ? [cellFragment(source.source_key, worksheet.sheet, rowIndex, 4, 'mapping', mapping)] : []),
        ],
      });
    }
    reconciliation.push({ worksheet: worksheet.sheet, source_rows: worksheet.data.length - 1, parsed_rows: parsedRows });
  }
  return { records, reconciliation };
}

export async function parseNistIoTRequirementWorkbooks(sp80053Bytes, csfBytes, sources) {
  const primary = await parseIoTWorkbook(sp80053Bytes, sources.sp80053);
  const supplemental = await parseIoTWorkbook(csfBytes, sources.csf);
  const records = primary.records;
  const unmatched = [];
  const supplementalIds = new Set(supplemental.records.keys());
  const primaryOnly = [...records.keys()].filter((id) => !supplementalIds.has(id));
  for (const [id, incoming] of supplemental.records) {
    const existing = records.get(id);
    if (!existing) {
      unmatched.push(id);
      addRecord(records, incoming);
      continue;
    }
    addRecord(records, incoming);
    existing.publisher_mappings = [...(existing.publisher_mappings || []), ...(incoming.publisher_mappings || [])];
  }
  const output = [...records.values()].map((record) => ({
    ...record,
    publisher_mappings: record.publisher_mappings || [],
    ...iotMappingDisposition(record),
  }));
  return {
    records: output,
    reconciliation: {
      workbooks_discovered: 2,
      workbooks_ingested: 2,
      workbooks_failed: 0,
      primary_worksheets: primary.reconciliation,
      supplemental_worksheets: supplemental.reconciliation,
      primary_only_records: primaryOnly.length,
      supplemental_only_records: unmatched.length,
      records: output.length,
      mapped_records: output.filter((record) => record.publisher_mappings.length).length,
      published_mapping_assertions: output.reduce((sum, record) => sum + record.publisher_mappings.length, 0),
      published_csf11_relationships: output.reduce((sum, record) => sum + record.publisher_mappings.filter((mapping) => mapping.target_catalog === 'nist-csf-1.1').length, 0),
      unresolved_mapping_assertions: output.reduce((sum, record) => sum + (record.unresolved_mappings || []).length, 0),
      graph_eligible_80053_relationships: output.reduce((sum, record) => sum + record.relationships.filter((mapping) => mapping.target_catalog === 'nist-800-53').length, 0),
      graph_eligible_csf11_relationships: output.reduce((sum, record) => sum + record.relationships.filter((mapping) => mapping.target_catalog === 'nist-csf-1.1').length, 0),
      synthetic_records: 0,
    },
  };
}

const MTC_ACTORS = new Set(['Enterprise', 'Mobile App Developer', 'Mobile Device User', 'Mobile OS Developer', 'Network Operator']);

function normalizeCountermeasure(entry) {
  if (!Array.isArray(entry) || entry.length !== 2) return { actors: ['Unspecified'], actions: [text(entry)] };
  const [first, second] = entry;
  if (MTC_ACTORS.has(text(first)) && Array.isArray(second)) {
    return { actors: [text(first)], actions: second.map(text).filter(Boolean) };
  }
  if (Array.isArray(second) && second.every((actor) => MTC_ACTORS.has(text(actor)))) {
    return { actors: second.map(text), actions: [text(first)].filter(Boolean) };
  }
  return { actors: ['Unspecified'], actions: [text(first), ...(Array.isArray(second) ? second.map(text) : [text(second)])].filter(Boolean) };
}

export function parseNistMobileThreatCatalogue(jsonBytes, csvBytes, sources) {
  const raw = JSON.parse(jsonBytes.toString('utf8'));
  if (!Array.isArray(raw)) throw new Error('NIST Mobile Threat Catalogue JSON is not an array');
  const rows = raw.filter((entry) => text(entry.ThreatID) || text(entry.Threat));
  const ids = new Set();
  const categories = new Map();
  const threats = [];
  for (const [rawIndex, entry] of raw.entries()) {
    const threatId = text(entry.ThreatID);
    if (!threatId && !text(entry.Threat)) continue;
    if (!threatId || ids.has(threatId)) throw new Error(`Invalid or duplicate Mobile Threat ID at JSON index ${rawIndex}`);
    ids.add(threatId);
    const category = text(entry.ThreatCategory) || 'Uncategorized';
    const categoryId = stableId('CATEGORY', category);
    if (!categories.has(categoryId)) {
      categories.set(categoryId, {
        id: categoryId,
        type: 'mobile_threat_category',
        title: category,
        description: `${category} threats in the NIST Mobile Threat Catalogue.`,
        parent_id: 'CATALOG',
        source_fragments: [],
      });
    }
    const cves = [...new Set((Array.isArray(entry.CVEExample) ? entry.CVEExample : [entry.CVEExample])
      .flatMap((value) => text(value).match(/CVE-\d{4}-\d+/g) || []))];
    const countermeasures = (Array.isArray(entry.PossibleCountermeasures) ? entry.PossibleCountermeasures : [])
      .map(normalizeCountermeasure)
      .filter((group) => group.actions.length);
    const locator = `${sources.json.url}#/${rawIndex}`;
    threats.push({
      id: threatId,
      type: 'mobile_threat',
      title: text(entry.Threat),
      // The Mobile Threat Catalogue publishes a title and separate structured
      // fields, not a narrative description for every entry. Do not turn an
      // absent ThreatOrigin into Control Atlas prose and then present it as
      // publisher content.
      description: '',
      parent_id: categoryId,
      category,
      threat_origin: entry.ThreatOrigin,
      exploit_examples: Array.isArray(entry.ExploitExample) ? entry.ExploitExample.map(text).filter(Boolean) : [text(entry.ExploitExample)].filter(Boolean),
      cve_examples: cves,
      countermeasures,
      locator,
      source_fragments: Object.entries(entry).map(([field, value]) => ({
        field,
        source_key: sources.json.source_key,
        locator: `${locator}/${field}`,
        text: JSON.stringify(value),
        checksum: sha256(JSON.stringify(value)),
        extraction_method: 'json-pointer',
      })),
    });
  }
  const csvCves = csvBytes.toString('utf8').split(/\r?\n/).map(text).filter((value) => /^CVE-\d{4}-\d+$/.test(value));
  const jsonCves = [...new Set(threats.flatMap((threat) => threat.cve_examples))].sort();
  const uniqueCsvCves = [...new Set(csvCves)].sort();
  if (JSON.stringify(jsonCves) !== JSON.stringify(uniqueCsvCves)) {
    throw new Error('Mobile Threat Catalogue JSON and CVE CSV do not reconcile');
  }
  return {
    records: [...categories.values(), ...threats],
    reconciliation: {
      json_rows_discovered: raw.length,
      blank_rows_excluded: raw.length - rows.length,
      threats_ingested: threats.length,
      categories_ingested: categories.size,
      total_records: categories.size + threats.length,
      expected_records: raw.length + categories.size,
      csv_rows_discovered: csvBytes.toString('utf8').trim().split(/\r?\n/).length - 1,
      unique_cves_reconciled: jsonCves.length,
      synthetic_records: 0,
    },
  };
}

export const nistStructuredSha256 = sha256;
