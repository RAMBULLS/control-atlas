const identities = (registry) => new Map([
  ...(registry.sources || []), ...(registry.publications || []),
].map((source) => [source.id, source]));

export function refreshSourceRows(current, previous) {
  const sources = identities(current);
  const oldSources = identities(previous);
  const oldFreshness = new Map((previous.freshness?.sources || []).map((entry) => [entry.source_id, entry]));
  return (current.freshness?.sources || []).map((entry) => {
    const source = sources.get(entry.source_id);
    if (!source) throw new Error(`Freshness source has no registered identity: ${entry.source_id}`);
    const oldSource = oldSources.get(entry.source_id) || {};
    const before = oldFreshness.get(entry.source_id) || {};
    const added = !oldSources.has(entry.source_id);
    const contentChanged = added || (before.hash ?? null) !== (entry.hash ?? null)
      || (oldSource.version ?? null) !== (source.version ?? null);
    if (!contentChanged && (before.last_checked ?? null) === (entry.last_checked ?? null)
      && (before.last_imported ?? null) === (entry.last_imported ?? null)) return null;
    return `| \`${entry.source_id}\` | ${oldSource.version || '—'} → ${source.version || '—'} | ${contentChanged ? 'yes' : 'no'} | ${entry.last_checked || 'not verified'} |`;
  }).filter(Boolean);
}
