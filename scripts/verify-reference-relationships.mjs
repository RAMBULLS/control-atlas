#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { generatedRecords } from './lib/compact-reference.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { reconcileReferenceRelationships } from './lib/reference-reconciliation.mjs';
import { CATALOGS, MAPS } from './build-framework-data.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = new Map();
const graph = Object.fromEntries(['nodes', 'edges'].map((name) => [name, [...generatedRecords(root, name, inputs)]]));
const report = reconcileReferenceRelationships(root, graph, { catalogs: CATALOGS, maps: MAPS });
report.graph_inputs = Object.fromEntries([...inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
// Per-assertion diagnostics are local verification evidence, not browser data.
// Preserve every row while keeping the static artifact within its existing budget.
writeJsonAtomically(join(root, '.local-agent/reference-export/reference-reconciliation.json'), report);
const { rows, ...summary } = report;
const detailBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
writeJsonAtomically(join(root, 'data/generated/reference-reconciliation.json'), { ...summary,
  verification_detail: { row_count: rows.length, byte_length: detailBytes.length,
    sha256: `sha256:${createHash('sha256').update(detailBytes).digest('hex')}`,
    disposition: 'Every per-assertion result is retained in the local verification output; this static summary contains counts, dispositions and errors.' } });
console.log(JSON.stringify({ status: report.status, ...report.counts, zero_trust_workbooks: report.zero_trust_workbooks, iot_workbooks: report.iot_workbooks, errors: report.errors.slice(0, 20) }, null, 2));
if (report.errors.length) process.exitCode = 1;
