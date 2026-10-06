#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { verifyDependencyPatches } from './dependency-patches.mjs';

const severityRank = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
]);

export function assertAuditReport(report, status) {
  assert.ok(status === 0 || status === 1, 'npm audit did not complete normally');
  assert.ok(report && !report.error, 'npm audit returned a scanner error');
  assert.ok(report.vulnerabilities && typeof report.vulnerabilities === 'object' && !Array.isArray(report.vulnerabilities), 'npm audit vulnerability report is missing');
  assert.ok(report.metadata?.vulnerabilities, 'npm audit summary is missing');
}

export function evaluateAuditPolicy(report, config, today = new Date().toISOString().slice(0, 10)) {
  assert.equal(config.version, 1, 'unsupported audit exception schema version');
  const threshold = config.threshold || 'high';
  const exceptions = new Map((config.exceptions || []).map((entry) => [`${entry.package}:${entry.id}`, entry]));
  const usedExceptions = new Set();
  const remaining = [];

  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const advisory of vulnerability.via || []) {
      if (typeof advisory === 'string') continue;
      if ((severityRank.get(advisory.severity) || 0) < (severityRank.get(threshold) || 0)) continue;
      const key = `${vulnerability.name}:${advisory.source}`;
      if (!exceptions.has(key)) {
        remaining.push({
          package: vulnerability.name,
          id: advisory.source,
          severity: advisory.severity,
          title: advisory.title,
          url: advisory.url,
        });
        continue;
      }
      usedExceptions.add(key);
    }
  }

  return {
    remaining,
    expired: (config.exceptions || []).filter((entry) => !entry.reviewBy || entry.reviewBy < today),
    stale: (config.exceptions || []).filter((entry) => !usedExceptions.has(`${entry.package}:${entry.id}`)),
    activeExceptionCount: usedExceptions.size,
  };
}

function reportFailures(result) {
  if (result.remaining.length) {
    console.error('Unapproved dependency vulnerabilities found:');
    for (const advisory of result.remaining) {
      console.error(`- ${advisory.package} ${advisory.id} [${advisory.severity}] ${advisory.title}`);
      if (advisory.url) console.error(`  ${advisory.url}`);
    }
  }
  if (result.expired.length) {
    console.error('Expired dependency vulnerability exceptions found:');
    for (const exception of result.expired) {
      console.error(`- ${exception.package} ${exception.id} reviewBy=${exception.reviewBy || 'missing'}`);
    }
  }
  if (result.stale.length) {
    console.error('Stale dependency vulnerability exceptions found:');
    for (const exception of result.stale) console.error(`- ${exception.package} ${exception.id}`);
  }
}

function main() {
  verifyDependencyPatches();
  const config = JSON.parse(readFileSync(new URL('../../security/npm-audit-exceptions.json', import.meta.url), 'utf8'));
  const threshold = config.threshold || 'high';
  const npmExecPath = process.env.npm_execpath;
  const auditCommand = npmExecPath ? process.execPath : 'npm';
  const auditArgs = npmExecPath
    ? [npmExecPath, 'audit', '--json', '--audit-level', threshold]
    : ['audit', '--json', '--audit-level', threshold];
  const audit = spawnSync(auditCommand, auditArgs, { encoding: 'utf8', shell: false });
  if (audit.error) throw audit.error;

  let report;
  try {
    report = JSON.parse(audit.stdout || audit.stderr || '{}');
  } catch (error) {
    console.error('Failed to parse npm audit output.');
    console.error(audit.stdout || audit.stderr);
    throw error;
  }

  assertAuditReport(report, audit.status);
  const result = evaluateAuditPolicy(report, config);
  if (result.remaining.length || result.expired.length || result.stale.length) {
    reportFailures(result);
    process.exitCode = 1;
    return;
  }

  console.log(
    result.activeExceptionCount
      ? `npm audit passed with ${result.activeExceptionCount} active documented exception(s).`
      : 'npm audit passed with no exceptions.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
