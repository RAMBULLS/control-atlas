/** Canonical record identity without loading unrelated product route state. */
export function recordIdFromPath(path: string): string | null {
  const match = path.match(/^\/record\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  try { return `${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`; }
  catch { return null; }
}

export function recordIdFromHash(hash: string): string | null {
  return recordIdFromPath(hash.replace(/^#/, '').split('?', 1)[0]);
}

export function recordHashForId(id: string): string {
  const colon = id.indexOf(':');
  return `#/record/${encodeURIComponent(id.slice(0, colon))}/${encodeURIComponent(id.slice(colon + 1))}`;
}

export function atlasHashForId(id: string): string {
  return `#/atlas/${encodeURIComponent(id).replaceAll('%3A', ':')}`;
}
