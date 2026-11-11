import assert from 'node:assert/strict';
import test from 'node:test';
import { readVerifiedExecution } from '../tools/lib/assurance-execution.mjs';
const sha = 'a'.repeat(40), artifactDigest = 'b'.repeat(64);
function provider(mutate = () => {}) {
  const data = {
    run: { repository: { full_name: 'RAMBULLS/control-atlas' }, head_sha: sha, status: 'completed', conclusion: 'success', run_attempt: 2 },
    site: { artifacts: [{ name: 'site-build', expired: false, digest: `sha256:${artifactDigest}`, workflow_run: { head_sha: sha } }] },
    artifact: { name: `assurance-results-candidate-chromium-${sha}-2`, expired: false, workflow_run: { id: 123, head_sha: sha }, digest: `sha256:${'c'.repeat(64)}` },
  };
  mutate(data);
  return async url => ({ ok: true, json: async () => url.includes('/artifacts?') ? data.site : url.includes('/actions/artifacts/') ? data.artifact : data.run });
}
const options = { runId: '123', artifactId: '456', sha, artifactDigest, browser: 'chromium', phase: 'candidate' };
test('provider verification binds exact successful run, scope and both artifacts', async () => {
  const result = await readVerifiedExecution({ ...options, request: provider() });
  assert.equal(result.result_locator, 'https://github.com/RAMBULLS/control-atlas/actions/runs/123/artifacts/456');
});
for (const [name, mutate] of [
  ['wrong SHA', d => { d.run.head_sha = 'd'.repeat(40); }],
  ['failed run', d => { d.run.conclusion = 'failure'; }],
  ['expired result', d => { d.artifact.expired = true; }],
  ['wrong result run', d => { d.artifact.workflow_run.id = 999; }],
  ['wrong attempt', d => { d.artifact.name = d.artifact.name.replace(/-2$/, '-1'); }],
  ['wrong site digest', d => { d.site.artifacts[0].digest = `sha256:${'d'.repeat(64)}`; }],
  ['ambiguous site', d => d.site.artifacts.push(d.site.artifacts[0])],
]) test(`provider verification rejects ${name}`, async () => assert.rejects(() => readVerifiedExecution({ ...options, request: provider(mutate) })));
