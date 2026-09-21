import assert from 'node:assert/strict';
import test from 'node:test';
import { backoffDelayMs, classifyFailure, retryAfterMs } from '../scripts/lib/retry-policy.mjs';

test('temporary failures are transient and publisher answers are not', () => {
  for (const message of [
    'ETIMEDOUT', 'read ECONNRESET', 'getaddrinfo ENOTFOUND csrc.nist.gov', 'request to https://x timed out',
    'HTTP 503 fetching https://x', 'OLIR catalog fetch failed (503)', 'Fetch failed (429) for https://x', 'fetch failed',
    'DISA range body length 10 did not match 20 requested bytes', 'Unexpected end of JSON input',
  ]) assert.equal(classifyFailure(new Error(message)), 'transient', message);
  for (const message of [
    'Fetch failed (404) for https://x', 'HTTP 403 fetching https://x', 'OLIR catalog fetch failed (410)',
    'nist-800-53: uncorroborated_count_change', 'Catalog identities must be nonempty and unique',
    'Source transaction validation rejected output', 'source URL policy rejected host', 'Publisher reconciliation does not match catalog identities',
  ]) assert.equal(classifyFailure(new Error(message)), 'permanent', message);
  assert.equal(classifyFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' })), 'transient');
  assert.equal(classifyFailure(Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), 'transient');
  assert.equal(classifyFailure(Object.assign(new Error('x'), { status: 502 })), 'transient');
  assert.equal(classifyFailure(Object.assign(new Error('HTTP 503'), { transient: false })), 'permanent');
  assert.equal(classifyFailure(null), 'permanent');
});

test('backoff doubles, is capped and is deterministic', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt, { baseMs: 1000, maxMs: 8000 })), [1000, 2000, 4000, 8000, 8000]);
  assert.equal(backoffDelayMs(1), 1000);
  assert.throws(() => backoffDelayMs(0), /positive integer/);
});

test('Retry-After is honored but bounded and ignored when unusable', () => {
  assert.equal(retryAfterMs('5', 15000), 5000);
  assert.equal(retryAfterMs('3600', 15000), 15000);
  assert.equal(retryAfterMs('soon', 15000), null);
  assert.equal(retryAfterMs(null, 15000), null);
  assert.equal(retryAfterMs('-3', 15000), null);
});
