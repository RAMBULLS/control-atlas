import { createHash } from 'node:crypto';

const repository = 'RAMBULLS/control-atlas';
export const reportDigest = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');

// Read-only provider verification. The caller obtains the report from this
// immutable Actions artifact, never from an arbitrary caller-supplied locator.
export async function readVerifiedExecution({ runId, artifactId, sha, artifactDigest, browser, phase, request }) {
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(artifactId)) || !/^[a-f0-9]{40}$/.test(sha ?? '') || !/^[a-f0-9]{64}$/.test(artifactDigest ?? '')) throw new Error('Invalid expected execution identity');
  if (!['chromium', 'firefox', 'webkit'].includes(browser) || !['candidate', 'live'].includes(phase)) throw new Error('Unsupported execution scope');
  const api = `https://api.github.com/repos/${repository}`;
  const runResponse = await request(`${api}/actions/runs/${runId}`);
  if (!runResponse.ok) throw new Error('Execution run readback failed');
  const run = await runResponse.json();
  if (run.repository?.full_name !== repository || run.head_sha !== sha || run.status !== 'completed' || run.conclusion !== 'success' || !Number.isSafeInteger(run.run_attempt)) throw new Error('Run is not a completed successful exact-SHA execution');
  const siteResponse = await request(`${api}/actions/runs/${runId}/artifacts?name=site-build&per_page=100`);
  if (!siteResponse.ok) throw new Error('Site artifact readback failed');
  const siteArtifacts = (await siteResponse.json()).artifacts?.filter(a => a.name === 'site-build' && !a.expired) ?? [];
  if (siteArtifacts.length !== 1 || siteArtifacts[0].digest !== `sha256:${artifactDigest}` || siteArtifacts[0].workflow_run?.head_sha !== sha) throw new Error('Immutable site artifact digest is not verified for this run');
  const artifactResponse = await request(`${api}/actions/artifacts/${artifactId}`);
  if (!artifactResponse.ok) throw new Error('Result artifact readback failed');
  const artifact = await artifactResponse.json();
  const name = `assurance-results-${phase}-${browser}-${sha}-${run.run_attempt}`;
  if (artifact.expired || artifact.name !== name || artifact.workflow_run?.id !== Number(runId) || artifact.workflow_run?.head_sha !== sha || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')) throw new Error('Result artifact is stale or does not belong to exact run/scope');
  return {
    run_id: String(runId), run_attempt: run.run_attempt, artifact_id: String(artifactId),
    code_sha: sha, artifact_digest: artifactDigest, browser, phase,
    archive_digest: artifact.digest.slice(7),
    result_locator: `https://github.com/${repository}/actions/runs/${runId}/artifacts/${artifactId}`,
    download_url: `${api}/actions/artifacts/${artifactId}/zip`,
  };
}
