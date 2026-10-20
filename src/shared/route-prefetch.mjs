// Serialized into the existing progressive shell so requests can start before the
// stylesheet and React entry finish. No module executes and Home stays static.
/** @param {{modules: string[], priorityModule?: string, routeModules?: Record<string, string[]>, version: string, shardCount: number}} config */
export function startRoutePrefetch(config, environment = /** @type {typeof globalThis & {__ATLAS_ROUTE_PREFETCH__?: Map<string, Promise<Response>>}} */ (globalThis)) {
  const { document, location } = environment;
  const script = /** @type {HTMLScriptElement} */ (document.currentScript);
  if (!script) return;
  const base = script.src || document.baseURI;
  const segments = location.hash.replace(/^#/, '').split('?')[0].split('/').filter(Boolean);
  if (!segments.length) return;
  // Resources already has a useful, persistent native masthead. Its directory
  // starts after that first paint; record text needs the renderer immediately.
  if (segments[0] === 'resources' && segments.length === 1) return;
  const paths = [];
  if (segments[0] === 'record' && segments.length === 3) {
    let id;
    try { id = `${decodeURIComponent(segments[1])}:${decodeURIComponent(segments[2])}`; }
    catch { return; }
    let hash = 0x811c9dc5;
    for (const character of id) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 0x01000193) >>> 0; }
    const shard = (hash % config.shardCount).toString(16).padStart(2, '0');
    paths.push(`data/generated/catalog-bootstrap-record.json.gz?v=${config.version}`, `data/generated/atlas-neighborhood/${shard}.json.gz?v=${config.version}`);
  }
  const hinted = new Set();
  const hint = path => {
    if (hinted.has(path)) return;
    hinted.add(path);
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = new URL(path, base).href;
    link.crossOrigin = 'anonymous';
    if (path === config.priorityModule) link.fetchPriority = 'high';
    document.head.appendChild(link);
  };
  // The largest required script gets a connection before data and small
  // support modules fill the queue; no module executes before its consumer.
  if (config.priorityModule) hint(config.priorityModule);
  const pending = environment.__ATLAS_ROUTE_PREFETCH__ ||= new Map();
  for (const path of paths) {
    const url = new URL(path, base).href;
    if (pending.has(url)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = Object.assign(environment.fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer)), {
      abort: () => controller.abort(),
    });
    // The normal loader still validates bytes and owns fallback/retry/error UI.
    // Observe rejection while it waits for that consumer.
    response.catch(() => undefined);
    pending.set(url, response);
  }
  const route = segments[0] === 'resources' && segments.length > 1 ? 'resource-detail' : segments[0];
  for (const path of new Set([...config.modules, ...(config.routeModules?.[route] || [])])) {
    hint(path);
  }
}

/** Start the same visible text faces through their real FontFace objects. */
export function warmOrbitalFonts(document) {
  if (!document.fonts?.load) return;
  for (const face of ['400 1em "IBM Plex Mono"', '600 1em "IBM Plex Mono"', '600 1em "Oswald"', '700 1em "Oswald"']) {
    document.fonts.load(face).catch(() => undefined);
  }
}

/** Yield two frame opportunities before enhancing an already usable static route. */
export function waitForStaticRoutePaint(environment = globalThis) {
  return new Promise(resolve => {
    let frame = 0;
    let observer;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      environment.cancelAnimationFrame(frame);
      environment.clearTimeout(timer);
      observer?.disconnect();
      resolve(undefined);
    };
    // Background tabs can suspend rAF. Keep directory startup bounded there.
    const timer = environment.setTimeout(finish, 1_000);
    const frames = () => {
      if (settled || frame) return;
      observer?.disconnect();
      frame = environment.requestAnimationFrame(() => {
        frame = environment.requestAnimationFrame(finish);
      });
    };
    // rAF callbacks alone can run before the first useful text is painted.
    // Prefer the actual paint notification, retaining the bounded portable path.
    if (environment.PerformanceObserver?.supportedEntryTypes?.includes('paint') &&
        !environment.performance.getEntriesByName('first-contentful-paint').length) {
      observer = new environment.PerformanceObserver(list => {
        if (list.getEntries().some(entry => entry.name === 'first-contentful-paint')) frames();
      });
      observer.observe({ type: 'paint', buffered: true });
    } else frames();
  });
}

/**
 * Preserve the normal consumer's body-read deadline after early headers arrive.
 * @param {Map<string, Promise<Response> & {abort?: () => void}> | undefined} pending
 * @param {string} url
 * @param {AbortSignal} signal
 */
export function takeRouteResponse(pending, url, signal) {
  const response = pending?.get(url);
  if (!response) return null;
  pending.delete(url);
  if (response.abort) {
    if (signal.aborted) response.abort();
    else signal.addEventListener('abort', () => response.abort(), { once: true });
  }
  return response;
}
