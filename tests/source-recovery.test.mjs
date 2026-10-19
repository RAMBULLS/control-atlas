import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyAcquiredSource, discoverOfficialRelocations, evaluateSourceRecovery, rediscoverSourceLocation } from '../scripts/lib/source-recovery.mjs';
import { assertOfficialSourceUrl } from '../scripts/lib/source-url-policy.mjs';
import { recordPresentationContract, undeclaredCapturedRecordFields } from '../src/shared/record-presentation.mjs';

const prior = { id: 'source:stable', url: 'https://dodcio.defense.gov/Portals/0/Documents/Library/record.pdf', sha256: `sha256:${'a'.repeat(64)}`, bytes: 100, lifecycle: 'active' };
const inventory = 'https://dowcio.war.gov/Library/';
const target = 'https://dowcio.war.gov/Portals/0/Documents/Library/record.pdf';
const plan = () => discoverOfficialRelocations(`<a href="${target}">Official document</a>`, inventory, [prior])[0];

test('official discovery captures literal URLs, not a substituted hostname or inferred new format', () => {
  assert.equal(plan().candidates[0].url, target); assert.equal(plan().status, 'candidate_locator');
  const absent = discoverOfficialRelocations('<a href="/Portals/0/Documents/Library/replaced.json">New format</a>', inventory, [prior])[0];
  assert.equal(absent.status, 'not_listed'); assert.deepEqual(absent.candidates, []);
  assert.equal(discoverOfficialRelocations(`<a href="${target}">A</a><a href="${target}?edition=2">B</a>`, inventory, [prior])[0].status, 'ambiguous_locator');
  assert.throws(() => discoverOfficialRelocations('<a href="https://unregistered.example/record.pdf">Same filename</a>', inventory, [prior]), /unapproved/);
});

test('moved byte-identical official source preserves identity, editions, records and assertions', () => {
  const result = evaluateSourceRecovery(prior, { url: target, sha256: prior.sha256, bytes: prior.bytes, discovery: plan() });
  assert.equal(result.status, 'verified_relocation'); assert.equal(result.source_id, prior.id); assert.equal(result.accepted_url, target);
  assert.equal(result.mutate_items, false); assert.equal(result.mutate_connections, false); assert.equal(result.lifecycle, 'active');
});

test('changed publisher bytes are candidates; they cannot overwrite the accepted catalog or mappings', () => {
  const result = evaluateSourceRecovery(prior, { url: target, sha256: `sha256:${'b'.repeat(64)}`, bytes: 101, discovery: plan() });
  assert.equal(result.status, 'changed_candidate'); assert.equal(result.accepted_url, undefined); assert.equal(result.retain_last_good, true); assert.match(result.next_action, /reconcile_edition_identity_and_assertions/);
});

test('403, 404 and 410 remain access/removal observations and never infer retirement', () => {
  for (const status of [403, 404, 410]) {
    const result = evaluateSourceRecovery(prior, { http_status: status }); assert.equal(result.lifecycle, 'active'); assert.equal(result.lifecycle_currentness, 'UNKNOWN'); assert.equal(result.retain_last_good, true);
    assert.equal(result.status, status === 403 ? 'access_blocked' : 'removed_unconfirmed');
  }
});

test('a public mirror is not promoted to a new official source merely because a filename or checksum matches', () => {
  const result = evaluateSourceRecovery(prior, { url: 'https://mirror.example/record.pdf', sha256: prior.sha256, bytes: prior.bytes });
  assert.equal(result.status, 'unverified_locator'); assert.equal(result.accepted_url, undefined);
});

test('relocation proof must belong to the same source and resolve one literal candidate', () => {
  for (const discovery of [{ ...plan(), source_id: 'source:other' }, { ...plan(), candidates: [...plan().candidates, { url: `${target}?other` }] }]) {
    assert.equal(evaluateSourceRecovery(prior, { url: target, sha256: prior.sha256, bytes: prior.bytes, discovery }).status, 'unverified_locator');
  }
});

test('first retrieval and retry after failure cannot silently accept changed registered bytes', () => {
  const source = { registered_sha256: prior.sha256, registered_bytes: prior.bytes };
  const changed = { sha256: `sha256:${'b'.repeat(64)}`, bytes: 101 };
  assert.equal(classifyAcquiredSource(source, undefined, changed).status, 'CANDIDATE_CHANGED_BYTES');
  const accepted = { status: 'ACQUIRED', path: 'last-good.bin', sha256: prior.sha256, bytes: prior.bytes };
  const candidate = classifyAcquiredSource(source, accepted, changed);
  assert.equal(candidate.status, 'CANDIDATE_CHANGED_BYTES'); assert.equal(candidate.last_good.path, 'last-good.bin');
  assert.equal(classifyAcquiredSource(source, { status: 'UNKNOWN', last_good: candidate.last_good }, changed).status, 'CANDIDATE_CHANGED_BYTES');
  assert.equal(classifyAcquiredSource(source, accepted, prior).status, 'ACQUIRED');
  assert.throws(() => classifyAcquiredSource(source, accepted, { sha256: 'unknown', bytes: 1 }), /actual byte evidence/);
});

test('a prior retrieval receipt cannot override canonical accepted byte evidence', () => {
  const source = { registered_sha256: prior.sha256, registered_bytes: prior.bytes };
  const changed = { sha256: `sha256:${'b'.repeat(64)}`, bytes: 101 };
  assert.equal(classifyAcquiredSource(source, { status: 'ACQUIRED', ...changed }, changed).status, 'CANDIDATE_CHANGED_BYTES');
  assert.equal(classifyAcquiredSource(source, { status: 'ACQUIRED', ...changed }, prior).status, 'ACQUIRED');
});

test('explicit refresh rediscovers a literal official move and verifies actual bytes without changing records', async () => {
  const bytes = Buffer.from('verified publisher content');
  const previous = { ...prior, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes: bytes.length };
  const requests = [];
  const result = await rediscoverSourceLocation(previous, inventory, async (url, bound) => {
    requests.push([url, bound]); return url === inventory ? Buffer.from(`<a href="${target}">Moved</a>`) : bytes;
  });
  assert.equal(result.recovery.status, 'verified_relocation'); assert.equal(result.recovery.accepted_url, target);
  assert.equal(result.recovery.mutate_connections, false); assert.equal(result.recovery.source_id, previous.id);
  assert.equal(result.recovery.inventory_evidence.bytes, result.inventoryBytes.length);
  assert.deepEqual(requests, [[inventory, 512 * 1024], [target, 32 * 1024 * 1024]]);
});

test('rediscovery cannot accept a changed file even when its publisher name is unchanged', async () => {
  const result = await rediscoverSourceLocation(prior, inventory, async (url) => url === inventory ? Buffer.from(`<a href="${target}">Moved</a>`) : Buffer.from('new format or edition'));
  assert.equal(result.recovery.status, 'changed_candidate'); assert.equal(result.recovery.accepted_url, undefined);
  assert.equal(result.recovery.retain_last_good, true); assert.equal(result.recovery.mutate_items, false);
});

test('absent, ambiguous or unchanged failed locators do not trigger guessed downloads or repeat the failed URL', async () => {
  for (const html of ['', `<a href="${target}">A</a><a href="${target}?edition=2">B</a>`, `<a href="${prior.url}">Unchanged</a>`]) {
    let requests = 0;
    const result = await rediscoverSourceLocation(prior, inventory, async () => { requests += 1; return Buffer.from(html || '<p>No document listed</p>'); });
    assert.equal(requests, 1); assert.equal(result.bytes, undefined); assert.equal(result.recovery.retain_last_good, true);
    assert.equal(result.recovery.lifecycle_currentness, 'UNKNOWN');
  }
});

test('failed, empty and oversized discovery snapshots stop recovery visibly', async () => {
  await assert.rejects(rediscoverSourceLocation(prior, inventory, async () => { throw new Error('HTTP 403'); }), /HTTP 403/);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(512 * 1024 + 1)]) {
    await assert.rejects(rediscoverSourceLocation(prior, inventory, async () => bytes), /byte bound or is empty/);
  }
});

test('deprecation and replacement require explicit publisher evidence and registered replacement identity', () => {
  const event = { status: 'superseded', replacement_source_id: 'source:new', source_url: inventory, locator: 'publisher release notice#replacement', publisher_text: 'Edition B replaces edition A.', evidence_sha256: `sha256:${'c'.repeat(64)}` };
  assert.throws(() => evaluateSourceRecovery(prior, { publisher_lifecycle: event }), /registered source/);
  assert.throws(() => evaluateSourceRecovery(prior, { publisher_lifecycle: { ...event, publisher_text: '' }, known_source_ids: ['source:new'] }), /explicit evidence/);
  const result = evaluateSourceRecovery(prior, { publisher_lifecycle: event, known_source_ids: ['source:new'] });
  assert.equal(result.lifecycle, 'superseded'); assert.equal(result.retain_last_good, true); assert.equal(result.mutate_connections, false);
});

test('CIO relocation admits only the actual new public library scope', () => {
  assert.equal(assertOfficialSourceUrl(target).href, target); assert.equal(assertOfficialSourceUrl(inventory).href, inventory);
  assert.throws(() => assertOfficialSourceUrl('https://dowcio.war.gov/administration/'), /unapproved/);
  assert.throws(() => assertOfficialSourceUrl('https://dowcio.war.gov.unregistered.example/Library/'), /unapproved/);
});

test('DISA snapshot presence and full prior editions have explicit source-metadata presentation contracts', () => {
  for (const [catalog, type] of [['disa-stig', 'stig_rule'], ['disa-srg', 'srg_requirement']]) {
    const profile = recordPresentationContract(catalog, type);
    assert.equal(profile.field_dispositions.current_snapshot_presence.disposition, 'source_metadata');
    assert.equal(profile.field_dispositions.previous_editions.disposition, 'source_metadata');
    assert.deepEqual(undeclaredCapturedRecordFields(profile, { current_snapshot_presence: false, previous_editions: [{ source: { version: 'V1R1' } }] }), []);
  }
});
