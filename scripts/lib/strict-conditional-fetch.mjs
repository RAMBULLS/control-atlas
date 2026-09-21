import { join } from 'node:path';

import makeFetchHappen from 'make-fetch-happen';

import { backoffDelayMs, classifyFailure, isTransientStatus, realSleep, retryAfterMs } from './retry-policy.mjs';
import { assertOfficialSourceUrl } from './source-url-policy.mjs';

const DEFAULT_CACHE_PATH = join(process.cwd(), '.local', 'http-cache-v1');
// Small on purpose: three requests, waits of 1s and 2s. A publisher that is
// still failing after that gets a clear failure, not dozens of requests.
export const DEFAULT_REQUEST_RETRY = Object.freeze({ attempts: 3, baseMs: 1000, maxMs: 8000, retryAfterCapMs: 15000, timeoutMs: 60000 });

export function createStrictConditionalFetch(options = {}) {
  const cachePath = options.cachePath || process.env.CONTROL_ATLAS_HTTP_CACHE || DEFAULT_CACHE_PATH;
  const fetchImpl = options.fetchImpl || makeFetchHappen;
  const urlPolicy = options.urlPolicy || assertOfficialSourceUrl;
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new Error('strict refresh redirect limit must be an integer from 0 to 20');
  }
  const retry = { ...DEFAULT_REQUEST_RETRY, ...options.retry };
  const sleep = options.sleep || realSleep;
  if (!Number.isInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 5) {
    throw new Error('strict refresh request attempts must be an integer from 1 to 5');
  }

  // Only timeouts, dropped connections, 429 and 5xx are asked for again. The
  // final transient response is returned so callers report the real status.
  async function requestWithRetry(href, requestInit) {
    for (let attempt = 1; ; attempt += 1) {
      let response = null;
      let failure = null;
      try {
        response = await fetchImpl(href, requestInit);
      } catch (error) {
        failure = error;
      }
      // A caller's own deadline has passed; asking again cannot succeed.
      const transient = !requestInit.signal?.aborted &&
        (failure ? classifyFailure(failure) === 'transient' : isTransientStatus(response.status));
      if (!transient || attempt >= retry.attempts) {
        if (failure) {
          failure.attempts = attempt;
          throw failure;
        }
        return response;
      }
      const waitMs = retryAfterMs(response?.headers?.get?.('retry-after'), retry.retryAfterCapMs)
        ?? backoffDelayMs(attempt, retry);
      // Release the connection before waiting.
      if (response?.arrayBuffer) await response.arrayBuffer().catch(() => {});
      await sleep(waitMs);
    }
  }

  return async function strictConditionalFetch(url, init = {}) {
    let current = new URL(urlPolicy(url));
    const headers = new Headers(init.headers);
    const method = (init.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) throw new Error('strict refresh permits GET and HEAD only');
    const visited = new Set();
    for (let redirects = 0; ; redirects += 1) {
      current.hash = '';
      if (visited.has(current.href)) throw new Error('strict refresh rejected redirect loop');
      visited.add(current.href);
      const response = await requestWithRetry(current.href, {
        ...init,
        method,
        headers: Object.fromEntries(headers),
        redirect: 'manual',
        cache: 'no-cache',
        cachePath,
        retry: false,
        timeout: retry.timeoutMs,
      });
      const cacheStatus = response.headers?.get?.('x-local-cache-status') || '';
      if (cacheStatus === 'stale') {
        throw new Error(`strict refresh rejected stale cached bytes for ${current.href}`);
      }
      if (response.status === 304) {
        throw new Error(`strict refresh received 304 without reusable cached bytes for ${current.href}`);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      // Finish cache writes and release the connection before following.
      if (response.arrayBuffer) await response.arrayBuffer();
      if (redirects >= maxRedirects) throw new Error('strict refresh exceeded redirect limit');
      const location = response.headers?.get?.('location');
      if (!location) throw new Error('strict refresh redirect missing location');
      const next = new URL(urlPolicy(new URL(location, current).href));
      if (next.origin !== current.origin) {
        for (const name of [...headers.keys()]) {
          // Only public representation headers cross origins. Authorization
          // (including GITHUB_TOKEN), cookies and custom API keys cannot leak.
          if (!['accept', 'accept-language', 'user-agent', 'range'].includes(name)) headers.delete(name);
        }
      }
      current = next;
    }
  };
}

export const strictConditionalFetch = createStrictConditionalFetch();
