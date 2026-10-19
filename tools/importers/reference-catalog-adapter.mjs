import { createHash } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';
import { parse } from 'node-html-parser';

export const REFERENCE_CATALOG_SOURCES = Object.freeze([
  { id: 'nist-csf-1.1', inventoryKey: 'csf11', file: 'csf-1.1.json', raw: 'csf-1.1.xlsx',
    name: 'NIST Cybersecurity Framework 1.1', version: '1.1', lifecycle: 'superseded',
    landing: 'https://www.nist.gov/cyberframework/csf-11-archive',
    url: 'https://www.nist.gov/system/files/documents/2018/04/17/2018-04-16_framework_v1.1_core1.xlsx',
    format: 'spreadsheet', parser: 'nist-csf11-core-xlsx', publicationDate: '2018-04-16' },
  { id: 'nist-critical-software', inventoryKey: 'critical_software', file: 'critical-software.json', raw: 'critical-software.html',
    name: 'NIST Security Measures for EO-Critical Software Use', version: '2021 guidance', lifecycle: 'active',
    landing: 'https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/securing-critical-software/security',
    url: 'https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/securing-critical-software/security',
    format: 'html', parser: 'nist-critical-software-html', publicationDate: '2021-07-08' },
]);

export const referenceSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const text = (value) => String(value ?? '').replace(/\r/g, '').trim();
const fragment = (field, value, locator, source) => ({
  field, text: value, locator, source_key: source.id, checksum: referenceSha256(value),
  extraction_method: source.parser,
});

export async function parseCsf11Core(bytes, source = REFERENCE_CATALOG_SOURCES[0]) {
  const sheets = await readXlsxFile(bytes);
  const sheet = sheets.find((entry) => entry.data.some((row) => text(row[0]) === 'Function' && text(row[2]) === 'Subcategory'));
  if (!sheet) throw new Error('CSF 1.1 Core columns not found');
  const records = [];
  let functionCell = ''; let categoryCell = ''; let current = null;
  for (const [index, row] of sheet.data.entries()) {
    const cells = row.map(text);
    if (/\([A-Z]{2}\)/.test(cells[0])) functionCell = cells[0];
    if (/\([A-Z]{2}\.[A-Z]{2}\)/.test(cells[1])) categoryCell = cells[1];
    const match = cells[2]?.match(/^([A-Z]{2}\.[A-Z]{2}-\d+):\s*([\s\S]+)$/);
    const locator = `${source.url}#sheet=${encodeURIComponent(sheet.sheet)}&row=${index + 1}`;
    if (match) {
      const functionId = functionCell.match(/\(([A-Z]{2})\)/)?.[1];
      const categoryId = categoryCell.match(/\(([A-Z]{2}\.[A-Z]{2})\)/)?.[1];
      if (!functionId || !categoryId || !match[1].startsWith(`${categoryId}-`)) throw new Error(`CSF 1.1 hierarchy missing at ${locator}`);
      current = {
        id: match[1], type: 'requirement', framework: source.id, title: match[2], description: match[2],
        family: categoryCell, function_id: functionId, function: functionCell,
        category_id: categoryId, category: categoryCell, locator,
        metadata: { publisher_item_id: match[1], source_fragments: [
          fragment('function', functionCell, locator, source), fragment('category', categoryCell, locator, source),
          fragment('description', cells[2], locator, source),
        ], informative_references: [] },
      };
      records.push(current);
    }
    if (current && cells[3]) {
      current.metadata.informative_references.push(cells[3]);
      current.metadata.source_fragments.push(fragment('informative_references', cells[3], locator, source));
    }
  }
  const inventory = {
    functions: new Set(records.map((r) => r.function_id)).size,
    categories: new Set(records.map((r) => r.category_id)).size,
    records: records.length,
    record_ids: records.map((r) => r.id).sort(),
  };
  if (new Set(inventory.record_ids).size !== records.length) throw new Error('Duplicate CSF 1.1 subcategory');
  return { records, inventory };
}

export function parseCriticalSoftware(bytes, source = REFERENCE_CATALOG_SOURCES[1]) {
  const root = parse(bytes.toString('utf8'));
  const table = root.querySelectorAll('table').find((entry) => /Security Measure \(SM\)/.test(entry.text) && /Federal Government Informative References/.test(entry.text));
  if (!table) throw new Error('NIST critical-software security-measure table not found');
  const records = []; let objective = null;
  for (const [index, row] of table.querySelectorAll('tr').entries()) {
    const cells = row.querySelectorAll('td');
    if (!cells.length) continue;
    const value = text(cells[0].structuredText);
    const heading = value.match(/^Objective\s+(\d+)\s*:\s*([\s\S]+)$/);
    if (heading) { objective = { id: heading[1], text: value }; continue; }
    const measure = value.match(/^SM\s+(\d+\.\d+)\s*:\s*([\s\S]+)$/);
    if (!measure) throw new Error(`Unrecognized security-measure row ${index + 1}`);
    if (!objective || !measure[1].startsWith(`${objective.id}.`)) throw new Error(`Missing objective for SM ${measure[1]}`);
    const locator = `${source.url}#table-row=${index + 1}`;
    records.push({
      id: `SM-${measure[1]}`, type: 'requirement', framework: source.id,
      title: measure[2], description: measure[2], family: objective.text, locator,
      metadata: {
        publisher_item_id: `SM ${measure[1]}`, category: objective.id,
        informative_references: cells[1]?.querySelectorAll('li').map((li) => ({
          text: text(li.structuredText), links: li.querySelectorAll('a').map((a) => ({ title: text(a.text), url: new URL(a.getAttribute('href'), source.url).href })),
        })) || [],
        source_fragments: [fragment('description', value, locator, source), fragment('objective', objective.text, locator, source),
          ...(cells[1] ? [fragment('informative_references', text(cells[1].structuredText), locator, source)] : [])],
      },
    });
  }
  const inventory = { objectives: new Set(records.map((r) => r.metadata.category)).size, records: records.length, record_ids: records.map((r) => r.id).sort() };
  if (new Set(inventory.record_ids).size !== records.length) throw new Error('Duplicate critical-software measure');
  return { records, inventory };
}
