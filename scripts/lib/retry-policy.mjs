// One place that decides whether a failure is worth another request. A retry is
// only useful when a new attempt could plausibly give a different answer:
// timeouts, dropped connections, 429 and 5xx. A 404, a validation rejection or
// a parse error is the publisher's current answer, and asking again is noise.
export const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const NETWORK_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
// Bare "fetch failed" is how undici reports a dropped connection. "Fetch failed (404)" is an HTTP answer.
const NETWORK_TEXT = /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE)\b|timed? ?out|socket hang up|network error|premature close|^\s*fetch failed\s*$/i;
// Errors reported by child fetch scripts only reach the parent as text.
const HTTP_TEXT = /(?:\((?:408|425|429|500|502|503|504)\)|\bHTTP (?:408|425|429|500|502|503|504)\b|\bstatus (?:408|425|429|500|502|503|504)\b|\breceived (?:408|425|429|500|502|503|504)\b)/;
// A truncated or short transfer is a bad delivery, not bad content.
const TRANSFER_TEXT = /did not match requested|body length .* did not match|unexpected end of|truncated|range total changed/i;

export const isTransientStatus = (status) => TRANSIENT_HTTP_STATUS.has(status);

/** @returns {'transient' | 'permanent'} */
export function classifyFailure(error) {
  if (!error) return 'permanent';
  if (error.transient === true) return 'transient';
  if (error.transient === false) return 'permanent';
  if (NETWORK_CODES.has(error.code) || NETWORK_CODES.has(error.cause?.code)) return 'transient';
  if (error.type === 'request-timeout' || error.name === 'TimeoutError' || error.name === 'AbortError') return 'transient';
  if (Number.isInteger(error.status) && isTransientStatus(error.status)) return 'transient';
  const text = String(error.message || error);
  return NETWORK_TEXT.test(text) || HTTP_TEXT.test(text) || TRANSFER_TEXT.test(text) ? 'transient' : 'permanent';
}

/** Exponential backoff, deterministic and capped. `attempt` is the one that just failed (1-based). */
export function backoffDelayMs(attempt, { baseMs = 1000, maxMs = 30000 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Backoff attempt must be a positive integer');
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

/** Honor a publisher's Retry-After, but never wait longer than the cap. */
export function retryAfterMs(header, capMs) {
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, capMs) : null;
}

export const realSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
