// Shipping facts for Pulse product events, read from the Git history the site is
// built from. Nothing here is authored: a feature exists only as a pull request
// that GitHub squash-merged onto the first-parent history of the build commit,
// and a release only as a tag whose commit is reachable from that history.
// Merge SHAs and timestamps are whatever Git records.
import { execFileSync } from 'node:child_process';

/** GitHub commits squash and merge-button merges as this identity. */
export const MERGE_COMMITTER_EMAIL = 'noreply@github.com';
/** GitHub's squash subject ends with the pull request number: "title (#123)". */
const PULL_REQUEST_SUFFIX = /\(#(\d+)\)\s*$/;
const SEPARATOR = '\u001f';

const utc = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * @param {string} root repository checkout
 * @param {{ head?: string, tags?: string[] }} options head is the build commit; tags are the release tags presentation text exists for
 * @returns {{ available: boolean, reason?: string, head?: string, merges?: Map<number, object>, tags?: Map<string, object> }}
 */
export function readProductHistory(root, { head = 'HEAD', tags = [] } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
  const ok = (...args) => {
    try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
  };
  let headSha;
  try {
    if (git('rev-parse', '--is-shallow-repository') !== 'false') return { available: false, reason: 'shallow_history' };
    headSha = git('rev-parse', '--verify', `${head}^{commit}`);
  } catch {
    return { available: false, reason: 'no_git_history' };
  }
  const merges = new Map();
  const log = git('log', '--first-parent', '--reverse', `--format=%H${SEPARATOR}%cI${SEPARATOR}%ce${SEPARATOR}%s`, headSha);
  for (const line of log.split('\n')) {
    const [sha, committedAt, committerEmail, subject = ''] = line.split(SEPARATOR);
    const match = subject.match(PULL_REQUEST_SUFFIX);
    if (!match || committerEmail !== MERGE_COMMITTER_EMAIL) continue;
    const pullRequest = Number(match[1]);
    // The first merge on the history is the one that shipped it.
    if (!merges.has(pullRequest)) merges.set(pullRequest, { sha, committed_at: utc(committedAt), subject });
  }
  const tagFacts = new Map();
  for (const name of tags) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) { tagFacts.set(name, { found: false }); continue; }
    const ref = git('for-each-ref', `refs/tags/${name}`, `--format=%(objecttype)${SEPARATOR}%(objectname)${SEPARATOR}%(*objectname)${SEPARATOR}%(taggerdate:iso-strict)`);
    if (!ref) { tagFacts.set(name, { found: false }); continue; }
    const [type, object, peeled, taggerDate] = ref.split(SEPARATOR);
    const commit = type === 'tag' ? peeled : object;
    const taggedAt = utc(taggerDate) || utc(git('show', '-s', '--format=%cI', commit));
    tagFacts.set(name, {
      found: true, annotated: type === 'tag', tag_object: object, commit, tagged_at: taggedAt,
      reachable: ok('merge-base', '--is-ancestor', commit, headSha),
    });
  }
  return { available: true, head: headSha, merges, tags: tagFacts };
}
