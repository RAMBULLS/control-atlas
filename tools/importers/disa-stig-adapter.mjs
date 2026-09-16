import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse as parseHtml } from 'node-html-parser';
import yauzl from 'yauzl';
import { unzipSync, strFromU8 } from 'fflate';
import { repairKnownSourceEncoding } from '../../src/shared/text-fidelity.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  isArray: (name) => ['Group', 'Rule', 'ident', 'reference', 'check-content', 'plain-text'].includes(name),
});

function checksum(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === 'object') {
    if (value['#text'] !== undefined) return repairKnownSourceEncoding(value['#text']).trim();
    return '';
  }
  return repairKnownSourceEncoding(value).trim();
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stripMarkup(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function preserveSourceText(value = '') {
  const text = parseHtml(repairKnownSourceEncoding(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<\/?(?:p|div|li)\b[^>]*>/gi, '<br>')).textContent
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length || 0);
  const commonIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(commonIndent).replace(/[ \t]+$/g, '')).join('\n').trim();
}

function extractSection(value, tagName) {
  const match = String(value).match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? stripMarkup(match[1]) : '';
}

function cciIds(rule) {
  return asArray(rule.ident)
    .map((ident) => (typeof ident === 'object' ? textValue(ident['#text']) : textValue(ident)))
    .map((value) => value.match(/CCI-\d{6}/)?.[0] || '')
    .filter(Boolean);
}

function parseReferences(rule) {
  return asArray(rule.reference)
    .map((reference) => {
      if (typeof reference === 'string') {
        return { href: '', label: textValue(reference) };
      }
      return {
        href: reference.href || '',
        label: textValue(reference),
      };
    })
    .filter((reference) => reference.href || reference.label);
}

function getCheckText(rule) {
  const content = asArray(rule.check)
    .flatMap((entry) => asArray(entry?.['check-content']))
    .map(textValue)
    .find(Boolean);
  return preserveSourceText(content);
}

function detectCatalogKind(benchmark, hintKind) {
  const probe = `${benchmark.id || ''} ${textValue(benchmark.title)}`.toLowerCase();
  if (probe.includes('security requirements guide')) return 'srg';
  if (probe.includes('security technical implementation guide')) return 'stig';
  if (probe.includes('srg')) return 'srg';
  if (probe.includes('stig')) return 'stig';
  if (hintKind === 'srg' || hintKind === 'stig') return hintKind;
  return null;
}

function classifyCompilationEntry(entryPath, hintKind) {
  const pathLower = entryPath.toLowerCase();
  if (pathLower.includes('srg')) return { kind: 'srg', basis: 'entry-path-srg' };
  if (pathLower.includes('stig')) return { kind: 'stig', basis: 'entry-path-stig' };
  if (hintKind === 'srg' || hintKind === 'stig') return { kind: hintKind, basis: 'explicit-compilation-hint' };
  return { kind: 'stig', basis: 'public-compilation-default' };
}

function composeVersion(benchmark) {
  const majorVersion = textValue(benchmark?.version);
  if (/^V\d+R\d+$/i.test(majorVersion)) return majorVersion;
  const releaseInfo = asArray(benchmark?.['plain-text'])
    .map((entry) => (typeof entry === 'object' ? textValue(entry['#text']) : textValue(entry)))
    .find((text) => /Release:\s*\d+/i.test(text));
  const release = releaseInfo?.match(/Release:\s*(\d+)/i)?.[1];
  if (majorVersion && release) return `V${majorVersion}R${release}`;
  return majorVersion;
}

export function parseDisaXccdf(xml, { sourceKey, artifactUrl, entryPath, hintKind, classificationBasis }) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Invalid DISA XCCDF structure: ${validation.err?.msg || 'malformed XML'}`);
  }

  const parsed = parser.parse(xml);
  const benchmark = parsed.Benchmark || parsed['cdf:Benchmark'];
  const catalogKind = benchmark ? detectCatalogKind(benchmark, hintKind) : null;
  const snapshotDate = benchmark?.status?.date || '';
  const version = benchmark ? composeVersion(benchmark) : '';
  const benchmarkTitle = textValue(benchmark?.title);

  if (!benchmark || !catalogKind || !benchmark.id || !snapshotDate || !version || !benchmarkTitle) {
    throw new Error('DISA XCCDF missing benchmark metadata');
  }

  const benchmarkDescription = stripMarkup(textValue(benchmark.description));
  const records = [];

  for (const group of asArray(benchmark.Group)) {
    const vulnId = group.id || '';
    for (const rule of asArray(group.Rule)) {
      const description = textValue(rule.description) || textValue(group.description);
      const cciReferences = [...new Set(cciIds(rule))];
      const titleVal = textValue(rule.title);
      const discussionVal = extractSection(description, 'VulnDiscussion') || stripMarkup(description);
      records.push({
        id: vulnId,
        type: catalogKind === 'stig' ? 'stig_rule' : 'srg_requirement',
        title: titleVal,
        description: discussionVal,
        severity: rule.severity || '',
        rule_id: rule.id || '',
        vuln_id: vulnId,
        stig_id: textValue(rule.version) || textValue(group.title),
        check_text: getCheckText(rule),
        fix_text: preserveSourceText(textValue(rule.fixtext)),
        references: parseReferences(rule),
        source: {
          key: sourceKey,
          snapshot_date: snapshotDate,
          version,
          locator: `${entryPath}#${vulnId}`,
        },
        metadata: {
          benchmark_id: benchmark.id,
          benchmark_title: benchmarkTitle,
          benchmark_description: benchmarkDescription,
          relationship_catalog: 'disa-cci',
          relationships: cciReferences.map((targetId) => ({
            target_catalog: 'disa-cci',
            target_id: targetId,
            relationship_type: 'references',
          })),
        },
      });
    }
  }

  return {
    catalogKind,
    classification_basis: classificationBasis || (hintKind ? 'explicit-hint' : 'benchmark-metadata'),
    source_key: sourceKey,
    source_artifact: artifactUrl,
    source_version: version,
    snapshot_date: snapshotDate,
    records,
  };
}

// "Supplemental" folders hold an OLDER revision of a benchmark shipped
// alongside its current one for reference (e.g. VMW_vSphere_8-0 ships both
// a current .../ESXi_V2R4_Manual_STIG/ and .../Supplemental/..._V1R1_Manual_STIG/
// — same vuln IDs, different revision). Real, official content, correctly
// excluded from the active catalog rather than colliding with the current
// revision's node/evidence ids.
function shouldIgnoreEntry(entryPath) {
  if (/(^|\/)(CUI_|CUI\/|Sunset|Draft)/i.test(entryPath)) return true;
  // "..._Supplemental/" folders (e.g. U_VMW_vSphere_8-0_Supplemental/) are
  // not their own path segment named exactly "Supplemental" — match the
  // word anywhere within a segment, not just as a whole segment.
  if (/Supplemental\//i.test(entryPath)) return true;
  if (/(^|\/)(Supporting Files|Templates)\//i.test(entryPath)) return true;
  return false;
}

export function isBenchmarkXml(xml) {
  return /<(?:cdf:)?Benchmark\b/i.test(xml);
}

function createDocument(sourceKey, artifactUrl, checksumValue, records, sourceMetadata) {
  return {
    schema_version: '2.0',
    source_key: sourceKey,
    source_artifact: artifactUrl,
    source_version: sourceMetadata.source_version || '',
    snapshot_date: sourceMetadata.snapshot_date || '',
    checksum: checksumValue,
    records,
  };
}

function createRelationshipDocument(artifactUrl, checksumValue, relationshipSeeds, sourceMetadata) {
  const relationships = relationshipSeeds.map((seed) => ({
    ...seed,
    why: `The official DISA ${seed.source_catalog === 'disa-stig' ? 'STIG' : 'SRG'} content references ${seed.target_id}.`,
    evidence_source: 'disa-stig-srg-cci-references',
  }));

  return {
    schema_version: '2.0',
    source_key: 'disa-stig-srg-cci-references',
    source_artifact: artifactUrl,
    source_version: sourceMetadata.source_version || '',
    snapshot_date: sourceMetadata.snapshot_date || '',
    checksum: checksumValue,
    provenance: 'Official DISA public STIG/SRG references to CCIs',
    relationships,
  };
}

function createAccumulator() {
  return {
    records: { stig: [], srg: [] },
    relationshipSeeds: [],
    sourceMetadata: { stig: {}, srg: {} },
  };
}

function appendDocument(accumulator, document) {
  const kind = document.catalogKind;
  const sourceMetadata = accumulator.sourceMetadata[kind];
  if (!sourceMetadata.source_version) {
    sourceMetadata.source_version = document.source_version;
    sourceMetadata.snapshot_date = document.snapshot_date;
  }

  for (const record of document.records) {
    for (const relationship of asArray(record.metadata?.relationships)) {
      accumulator.relationshipSeeds.push({
        source_catalog: record.type === 'stig_rule' ? 'disa-stig' : 'disa-srg',
        source_id: record.id,
        target_catalog: relationship.target_catalog,
        target_id: relationship.target_id,
        relationship_type: relationship.relationship_type,
        source_locator: record.source.locator,
      });
    }
    accumulator.records[kind].push({
      ...record,
      metadata: { ...record.metadata, relationships: [] },
    });
  }
}

function walkArchiveEntries(archive, parentPath = '') {
  const results = [];
  for (const [entryName, entryValue] of Object.entries(archive)) {
    const entryPath = parentPath ? `${parentPath}/${entryName}` : entryName;
    if (/\.zip$/i.test(entryName)) {
      results.push(...walkArchiveEntries(unzipSync(entryValue), entryPath));
      continue;
    }
    results.push({ entryPath, value: entryValue });
  }
  return results;
}

export function parseDisaCompilationArchive(buffer, { artifactUrl, sourceKeys, hintKind }) {
  const archive = unzipSync(buffer);
  const accumulator = createAccumulator();
  const failed = [];

  for (const entry of walkArchiveEntries(archive)) {
    if (shouldIgnoreEntry(entry.entryPath) || !/\.(xml|xccdf)$/i.test(entry.entryPath)) continue;
    const xml = strFromU8(entry.value);
    const classification = classifyCompilationEntry(entry.entryPath, hintKind);
    // A ~2600-entry compilation zip real-world includes non-Benchmark XML
    // (manifests, schemas, malformed one-offs) alongside real STIG/SRG
    // content — spec §6 classifies these as "failed content", not a reason
    // to abort parsing the other 99%+ that IS a valid benchmark.
    try {
      const document = parseDisaXccdf(xml, {
        sourceKey: classification.kind === 'srg' ? sourceKeys.srg : sourceKeys.stig,
        artifactUrl,
        entryPath: entry.entryPath,
        hintKind: classification.kind,
        classificationBasis: classification.basis,
      });
      appendDocument(accumulator, document);
    } catch (error) {
      failed.push({ entryPath: entry.entryPath, reason: error.message });
    }
  }

  const checksumValue = checksum(buffer);
  const stig = createDocument(sourceKeys.stig, artifactUrl, checksumValue, accumulator.records.stig, accumulator.sourceMetadata.stig);
  const srg = createDocument(sourceKeys.srg, artifactUrl, checksumValue, accumulator.records.srg, accumulator.sourceMetadata.srg);
  const relationships = createRelationshipDocument(
    artifactUrl,
    checksumValue,
    accumulator.relationshipSeeds,
    accumulator.sourceMetadata.stig.source_version ? accumulator.sourceMetadata.stig : accumulator.sourceMetadata.srg,
  );

  return { stig, srg, relationships, checksum: checksumValue, failed };
}

function concatU8(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function readStreamU8(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(new Uint8Array(chunk));
  return concatU8(chunks);
}

async function checksumFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

// Streaming equivalent of parseDisaCompilationArchive that never holds the full
// (~352 MB) compilation buffer in memory. yauzl reads the outer archive from its
// central directory and yields one bounded entry stream at a time; each inner
// benchmark ZIP is then unzipped in isolation. Peak memory is one benchmark
// package plus the parser working set. Produces byte-identical records to the
// buffer path and the same file-content sha256.
export async function parseDisaCompilationStream(filePath, { artifactUrl, sourceKeys, hintKind }) {
  const accumulator = createAccumulator();
  const failed = [];
  const inventory = [];

  const handleXccdf = (entryPath, xmlU8) => {
    if (shouldIgnoreEntry(entryPath)) {
      inventory.push({ entryPath, status: 'excluded', reason: 'restricted, sunset, draft, or supplemental content' });
      return;
    }
    if (!/\.(xml|xccdf)$/i.test(entryPath)) {
      inventory.push({ entryPath, status: 'ignored', reason: 'not an XML/XCCDF file' });
      return;
    }
    const xml = strFromU8(xmlU8);
    const classification = classifyCompilationEntry(entryPath, hintKind);
    try {
      const document = parseDisaXccdf(xml, {
        sourceKey: classification.kind === 'srg' ? sourceKeys.srg : sourceKeys.stig,
        artifactUrl,
        entryPath,
        hintKind: classification.kind,
        classificationBasis: classification.basis,
      });
      appendDocument(accumulator, document);
      inventory.push({
        entryPath,
        status: 'ingested',
        catalogKind: document.catalogKind,
        classificationBasis: document.classification_basis,
        benchmarkId: document.records[0]?.metadata?.benchmark_id || null,
        recordCount: document.records.length,
      });
    } catch (error) {
      failed.push({ entryPath, reason: error.message });
      inventory.push({ entryPath, status: 'failed', reason: error.message });
    }
  };

  const handleInnerZip = (entryPath, zipU8) => {
    let inner;
    try {
      inner = unzipSync(zipU8);
    } catch (error) {
      failed.push({ entryPath, reason: `inner unzip failed: ${error.message}` });
      inventory.push({ entryPath, status: 'failed', reason: `inner unzip failed: ${error.message}` });
      return;
    }
    for (const sub of walkArchiveEntries(inner, entryPath)) handleXccdf(sub.entryPath, sub.value);
  };

  const outer = await yauzl.openPromise(filePath, { lazyEntries: true, validateEntrySizes: true });
  try {
    for await (const entry of outer.eachEntry()) {
      if (/\/$/.test(entry.fileName)) continue;
      const isZip = /\.zip$/i.test(entry.fileName);
      const isXml = /\.(xml|xccdf)$/i.test(entry.fileName);
      if (!isZip && !isXml) {
        inventory.push({ entryPath: entry.fileName, status: 'ignored', reason: 'not an XML/XCCDF file' });
        continue;
      }
      try {
        const entryStream = await outer.openReadStreamPromise(entry);
        const value = await readStreamU8(entryStream);
        if (isZip) handleInnerZip(entry.fileName, value);
        else handleXccdf(entry.fileName, value);
        // The complete library is large enough that retaining a completed
        // inner archive until V8 chooses its next collection risks exhausting
        // an 8 GB developer machine. Production CI may expose GC too; this is
        // a memory-pressure hint only and never changes parsed output.
        globalThis.gc?.();
      } catch (error) {
        failed.push({ entryPath: entry.fileName, reason: error.message });
        inventory.push({ entryPath: entry.fileName, status: 'failed', reason: error.message });
      }
    }
  } finally {
    outer.close();
  }

  const checksumValue = await checksumFile(filePath);
  const stig = createDocument(sourceKeys.stig, artifactUrl, checksumValue, accumulator.records.stig, accumulator.sourceMetadata.stig);
  const srg = createDocument(sourceKeys.srg, artifactUrl, checksumValue, accumulator.records.srg, accumulator.sourceMetadata.srg);
  const relationships = createRelationshipDocument(
    artifactUrl,
    checksumValue,
    accumulator.relationshipSeeds,
    accumulator.sourceMetadata.stig.source_version ? accumulator.sourceMetadata.stig : accumulator.sourceMetadata.srg,
  );
  return { stig, srg, relationships, checksum: checksumValue, failed, inventory };
}

export function parseDisaStandalonePackage(buffer, {
  artifactUrl,
  sourceKeys = { stig: 'disa-stig-library', srg: 'disa-srg-library' },
  hintKind,
  publicationFilename = '',
} = {}) {
  const archive = unzipSync(new Uint8Array(buffer));
  const accumulator = createAccumulator();
  const failed = [];
  const inventory = [];

  for (const entry of walkArchiveEntries(archive)) {
    if (shouldIgnoreEntry(entry.entryPath)) {
      inventory.push({ entryPath: entry.entryPath, status: 'excluded', reason: 'restricted, sunset, draft, or supporting content' });
      continue;
    }
    if (!/\.(xml|xccdf)$/i.test(entry.entryPath)) {
      inventory.push({ entryPath: entry.entryPath, status: 'ignored', reason: 'not an XML/XCCDF file' });
      continue;
    }
    const xml = strFromU8(entry.value);
    if (!isBenchmarkXml(xml)) {
      inventory.push({ entryPath: entry.entryPath, status: 'ignored', reason: 'non-benchmark XML file' });
      continue;
    }

    const classification = classifyCompilationEntry(entry.entryPath, hintKind);
    try {
      const document = parseDisaXccdf(xml, {
        sourceKey: classification.kind === 'srg' ? sourceKeys.srg : sourceKeys.stig,
        artifactUrl,
        entryPath: entry.entryPath,
        hintKind: classification.kind,
        classificationBasis: classification.basis,
      });
      appendDocument(accumulator, document);
      inventory.push({
        entryPath: entry.entryPath,
        status: 'ingested',
        catalogKind: document.catalogKind,
        classificationBasis: document.classification_basis,
        benchmarkId: document.records[0]?.metadata?.benchmark_id || null,
        recordCount: document.records.length,
      });
    } catch (error) {
      failed.push({ entryPath: entry.entryPath, reason: error.message });
      inventory.push({ entryPath: entry.entryPath, status: 'failed', reason: error.message });
    }
  }

  const checksumValue = checksum(buffer);
  return {
    stigRecords: accumulator.records.stig,
    srgRecords: accumulator.records.srg,
    relationshipSeeds: accumulator.relationshipSeeds,
    checksum: checksumValue,
    failed,
    inventory,
    publicationFilename,
  };
}

