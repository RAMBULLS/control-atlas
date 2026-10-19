import { createHash } from 'node:crypto';
import { createReadStream, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { sourceUnitInventory } from './native-unit-inventories.mjs';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  isArray: (name) => ['Group', 'Rule', 'ident', 'plain-text'].includes(name) });
const text = (value) => typeof value === 'object' ? String(value?.['#text'] || '') : String(value || '');
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const excluded = (path) => /(^|\/)(CUI_|CUI\/|Sunset|Draft)/i.test(path) || /Supplemental\//i.test(path) || /(^|\/)(Supporting Files|Templates)\//i.test(path);

export function nativeDisaUnits(xml, locator, hint) {
  if (!/<(?:\w+:)?Benchmark\b/.test(xml)) return [];
  const valid = XMLValidator.validate(xml); if (valid !== true) throw new Error(`Malformed native XCCDF: ${locator}`);
  const benchmark = xmlParser.parse(xml).Benchmark; if (!benchmark) throw new Error('Missing native Benchmark');
  const title = text(benchmark.title); const probe = `${benchmark['@_id']} ${title}`;
  const kind = /security requirements guide|\bsrg\b/i.test(probe) ? 'srg' : /security technical implementation guide|\bstig\b/i.test(probe) ? 'stig' : /srg/i.test(locator) ? 'srg' : hint || 'stig';
  const release = array(benchmark['plain-text']).map(text).join(' ').match(/Release:\s*(\d+)/i)?.[1];
  const major = text(benchmark.version); const version = /^V\d+R\d+$/i.test(major) ? major : release ? `V${major}R${release}` : major;
  if (!benchmark['@_id'] || !version || !title) throw new Error(`Missing native benchmark identity: ${locator}`);
  const units = [];
  const walk = (groups) => { for (const group of array(groups)) {
    if (group.Group) walk(group.Group);
    for (const rule of array(group.Rule)) {
      if (!group['@_id'] || !rule['@_id']) throw new Error('Native XCCDF unit lacks a Group/Rule ID');
      units.push({ id: group['@_id'], kind, benchmark_id: benchmark['@_id'], edition: version, rule_id: rule['@_id'],
        locator: `${locator}#${group['@_id']}`, cci_ids: [...new Set(array(rule.ident).map(text).filter((entry) => /^CCI-\d{6}$/.test(entry)))].sort() });
    }
  } };
  walk(benchmark.Group); return units;
}
async function bytes(stream, maximum) {
  const chunks = []; let count = 0;
  for await (const chunk of stream) { count += chunk.length; if (count > maximum) throw new Error('Native archive entry exceeds its64MiB bound'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function fileHash(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return `sha256:${hash.digest('hex')}`; }

/** Streaming independent XML identity traversal, not a second normalized importer. */
export async function disaNativeInventories(root, manifest, progress = () => {}) {
  const occurrences = { stig: [], srg: [] }; const exclusions = []; const files = []; const sourceEvidence = [];
  let sourceUrl = manifest.compilation_url;
  let sourceChecksum;
  async function visit(archive, parent, hint, depth = 0) {
    if (depth > 4) throw new Error('Unexpected native archive nesting depth');
    try {
      for await (const entry of archive.eachEntry()) {
        if (entry.fileName.endsWith('/')) continue;
        const locator = parent ? `${parent}/${entry.fileName}` : entry.fileName;
        if (excluded(locator)) { exclusions.push({ locator, reason: 'Restricted CUI, sunset, draft, supplemental older edition, supporting file or template content outside the active public manual catalog.' }); continue; }
        if (!/\.(zip|xml|xccdf)$/i.test(entry.fileName)) continue;
        if (entry.uncompressedSize > 64 * 1024 * 1024) throw new Error(`Oversized native source entry: ${locator}`);
        const content = await bytes(await archive.openReadStreamPromise(entry), 64 * 1024 * 1024);
        if (/\.zip$/i.test(entry.fileName)) { const inner = await yauzl.fromBufferPromise(content, { lazyEntries: true, validateEntrySizes: true }); await visit(inner, locator, hint, depth + 1); }
        else {
          const units = nativeDisaUnits(content.toString('utf8'), locator, hint);
          if (!units.length) { exclusions.push({ locator, reason: 'XML has no native Benchmark rule units.' }); continue; }
          for (const unit of units) occurrences[unit.kind].push({ ...unit, source_url: sourceUrl, source_checksum: sourceChecksum });
          files.push({ locator, source_url: sourceUrl, sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`, byte_length: content.length, native_rules: units.length });
        }
      }
    } finally { archive.close(); }
  }
  const compilation = join(root, 'tmp/disa-cache/compilation.zip');
  const sha = await fileHash(compilation);
  sourceChecksum = sha;
  if (sha !== manifest.checksum || statSync(compilation).size !== manifest.byte_length) throw new Error('Cached DISA compilation differs from accepted source bytes');
  sourceEvidence.push({ source_id: 'artifact-disa-compilation-zip', url: manifest.compilation_url, sha256: sha, byte_length: statSync(compilation).size, evidence_kind: 'downloaded_publisher_bytes', retrieved_at: manifest.retrieval_timestamp });
  await visit(await yauzl.openPromise(compilation, { lazyEntries: true, validateEntrySizes: true }), ''); progress(`Native DISA compilation: ${files.length} XCCDF files`);
  for (const pkg of manifest.reconciliation.standalone_packages) {
    sourceUrl = `${manifest.discovery_source}${pkg.filename}`;
    let path = join(root, 'tmp/disa-cache/standalone', pkg.filename);
    if (!existsSync(path)) {
      const acquired = JSON.parse(readFileSync(join(root, '.local-agent/reference-export/inventory-acquisition.json'), 'utf8')).sources.find((entry) => entry.status === 'ACQUIRED' && entry.url === `${manifest.discovery_source}${pkg.filename}`);
      if (!acquired) throw new Error(`Missing official source package: ${pkg.filename}`);
      path = join(root, acquired.path);
    }
    const sha256 = await fileHash(path);
    sourceChecksum = sha256;
    if (sha256 !== pkg.checksum) throw new Error(`Standalone source bytes differ: ${pkg.filename}`);
    sourceEvidence.push({ source_id: `disa-package:${pkg.filename}`, url: `${manifest.discovery_source}${pkg.filename}`, sha256, byte_length: statSync(path).size, evidence_kind: 'downloaded_publisher_bytes', retrieved_at: manifest.retrieval_timestamp });
    await visit(await yauzl.openPromise(path, { lazyEntries: true, validateEntrySizes: true }), '', pkg.kind);
  }
  progress(`Native DISA total: ${files.length} XCCDF files across compilation and${manifest.reconciliation.standalone_packages.length} standalone packages`);
  return Object.fromEntries(['stig', 'srg'].map((kind) => [kind, {
    ...sourceUnitInventory(occurrences[kind], 'All eligible native public manual XCCDF rule identities in the retained compilation plus separately acquired selected publications. Atlas uses the publisher vulnerability ID as its requirement key and retains the latest observed revision for repeated IDs; every native edition occurrence is inventoried here.', exclusions),
    source_evidence: sourceEvidence, native_files: files, native_occurrences: occurrences[kind].length,
  }]));
}
