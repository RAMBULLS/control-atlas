import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { readVerifiedExecution, reportDigest } from './lib/assurance-execution.mjs';
import { collectBrowserEvidence } from './lib/assurance-results.mjs';
import { assessEvidence } from './lib/assurance-contract.mjs';

const value = key => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? undefined : process.argv[i + 1]; };
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
const request = url => fetch(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
const identity = { runId: value('run'), artifactId: value('result-artifact'), sha: value('sha'), artifactDigest: value('site-digest'), browser: value('browser'), phase: value('phase'), request };
try {
  const execution = await readVerifiedExecution(identity);
  // The provider's authenticated endpoint returns a signed object URL. Do not
  // send repository authorization headers to that object-storage destination.
  const response = await fetch(execution.download_url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (response.status !== 302) throw new Error('Expected provider artifact redirect');
  const destination = new URL(response.headers.get('location'));
  if (destination.protocol !== 'https:') throw new Error('Unsafe artifact redirect');
  const bytesResponse = await fetch(destination, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!bytesResponse.ok || Number(bytesResponse.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('Result archive unavailable or oversized');
  const bytes = new Uint8Array(await bytesResponse.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== execution.archive_digest) throw new Error('Provider artifact digest mismatch');
  const files = unzipSync(bytes, { filter: entry => entry.name === 'report.json' && entry.originalSize <= 32 * 1024 * 1024 });
  if (!files['report.json']) throw new Error('No bounded actual runner report');
  const report = JSON.parse(strFromU8(files['report.json']));
  if (report.metadata?.code_sha !== identity.sha || report.metadata?.artifact_digest !== identity.artifactDigest || report.metadata?.phase !== identity.phase) throw new Error('Report does not bind candidate identity');
  const contract = JSON.parse(readFileSync('config/assurance/promises.json', 'utf8'));
  const evidence = collectBrowserEvidence(contract, report, { ...identity, runId: execution.run_id, resultLocator: execution.result_locator, origin: identity.phase === 'live' ? 'https://atlas.rambulls.dev' : undefined });
  execution.report_sha256 = reportDigest(report);
  execution.assertions = evidence.results.flatMap(row => row.assertions.map(assertion => ({ ...assertion, check_id: row.check_id })));
  const result = assessEvidence(contract, evidence, { phase: identity.phase, sha: identity.sha, artifactDigest: identity.artifactDigest, origin: identity.phase === 'live' ? 'https://atlas.rambulls.dev' : undefined, execution });
  console.log(JSON.stringify({ ...result, evidence }, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
