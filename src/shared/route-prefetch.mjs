// Serialized into the existing classic shell so requests can start before the
// stylesheet and React entry finish. No module executes and Home stays static.
/** @param {{modules: string[], version: string, shardCount: number}} config */
export function startRoutePrefetch(config, environment = /** @type {typeof globalThis & {__ATLAS_ROUTE_PREFETCH__?: Map<string, Promise<Response>>}} */ (globalThis)) {
  const { document, location } = environment;
  const script = /** @type {HTMLScriptElement} */ (document.currentScript);
  if (!script) return;
  const segments = location.hash.replace(/^#/, '').split('?')[0].split('/').filter(Boolean);
  if (!segments.length) return;
  for (const path of config.modules) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = new URL(path, script.src).href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
  const paths = [];
  if (segments[0] === 'record' && segments.length === 3) {
    let id;
    try { id = `${decodeURIComponent(segments[1])}:${decodeURIComponent(segments[2])}`; }
    catch { return; }
    let hash = 0x811c9dc5;
    for (const character of id) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 0x01000193) >>> 0; }
    const shard = (hash % config.shardCount).toString(16).padStart(2, '0');
    paths.push(`data/generated/catalog-bootstrap.json.gz?v=${config.version}`, `data/generated/atlas-neighborhood/${shard}.json.gz?v=${config.version}`);
  } else if (segments[0] === 'resources' && segments.length === 1) {
    paths.push('data/generated/commons-search-index.json.gz');
  }
  const pending = environment.__ATLAS_ROUTE_PREFETCH__ ||= new Map();
  for (const path of paths) {
    const url = new URL(path, script.src).href;
    if (pending.has(url)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = environment.fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    // The normal loader still validates bytes and owns fallback/retry/error UI.
    // Observe rejection while it waits for that consumer.
    response.catch(() => undefined);
    pending.set(url, response);
  }
}
