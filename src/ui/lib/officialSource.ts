/**
 * One resolution rule for "where is the official source".
 *
 * Control Atlas sells verifiability, so one publication must resolve to one
 * destination on every surface. Before this module six call sites preferred
 * `artifact_url` and three preferred `catalog_browse_url`, so a record page
 * and the Sources register could cite the same publication differently.
 *
 * Two named intents, because they are genuinely different questions:
 *
 *   officialSourceFor    - the citable publisher page a practitioner pastes
 *                          into an SAR or a POA&M. Prefers catalog_browse_url.
 *   retrievedArtifactFor - the file Control Atlas actually downloaded, for
 *                          source-material and connection-evidence rows that
 *                          also carry a checksum, format, and retrieval date.
 *
 * Disposition is derived from the URL, not from the register's `format`
 * field: `format` is a declared string that can disagree with the URL it sits
 * beside, and nothing reconciles them. What the browser does when the link is
 * activated is decided by the URL, so the label follows the URL.
 *
 * Per AGENTS.md, Control Atlas must never fabricate an official source URL.
 * Where a publisher only offers a compilation download, the honest fix is the
 * label, never a synthesized per-record deep link.
 */

export type OfficialSourceInput =
  | {
      artifact_url?: string | null;
      catalog_browse_url?: string | null;
      format?: string | null;
      artifact_type?: string | null;
    }
  | null
  | undefined;

/** What activating the link actually does in a browser. */
export type SourceDisposition = "page" | "document" | "download";

export type OfficialSourceResolution = {
  /** The citable destination. Empty when the register has neither field. */
  url: string;
  /** The retrieved file, when one is recorded and distinct from `url`. */
  artifactUrl: string;
  /** Uppercase extension of `url` ("ZIP", "PDF"), or "" when it is a page. */
  formatLabel: string;
  disposition: SourceDisposition;
  /** True when activating `url` starts a file download rather than a view. */
  isDownload: boolean;
};

const PAGE_EXTENSIONS = new Set(["html", "htm", "xhtml", "asp", "aspx", "php"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf"]);
const DOWNLOAD_EXTENSIONS = new Set([
  "zip",
  "xlsx",
  "xls",
  "xlsm",
  "csv",
  "tsv",
  "json",
  "xml",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "txt",
  "gz",
  "tar",
  "7z",
]);

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Extension of the URL's final path segment, lowercased, or "" when the URL
 * has no recognized file extension. Query strings and fragments are ignored,
 * and a trailing version-like segment (".../r5.1.14") is not an extension.
 */
export function urlExtension(url: string): string {
  const clean = trimmed(url).split(/[?#]/)[0];
  if (!clean) return "";
  const segment = clean.split("/").pop() || "";
  const match = segment.match(/\.([A-Za-z0-9]{1,5})$/);
  if (!match) return "";
  const extension = match[1].toLowerCase();
  if (!/[a-z]/.test(extension)) return "";
  return extension;
}

export function urlDisposition(url: string): SourceDisposition {
  const extension = urlExtension(url);
  if (!extension || PAGE_EXTENSIONS.has(extension)) return "page";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (DOWNLOAD_EXTENSIONS.has(extension)) return "download";
  return "page";
}

function resolve(url: string, artifactUrl: string): OfficialSourceResolution {
  const disposition = urlDisposition(url);
  const extension = urlExtension(url);
  return {
    url,
    artifactUrl: artifactUrl && artifactUrl !== url ? artifactUrl : "",
    formatLabel: disposition === "page" ? "" : extension.toUpperCase(),
    disposition,
    isDownload: disposition === "download",
  };
}

export type OfficialSourceOptions = {
  /** Publication a child source belongs to, used as a last-resort page. */
  parent?: OfficialSourceInput;
  /**
   * Whether the retrieved artifact may stand in as the official destination.
   * Surfaces that already show the artifact in its own field pass `false`, so
   * one URL never fills both slots and read as two separate destinations.
   * Defaults to `true`: a record page must offer something citable.
   */
  allowArtifactFallback?: boolean;
};

/** Number of non-empty path segments, as a proxy for how specific a URL is. */
function pathDepth(url: string): number {
  const withoutScheme = trimmed(url).replace(/^[a-z]+:\/\/[^/]*/i, "");
  return withoutScheme.split(/[?#]/)[0].split("/").filter(Boolean).length;
}

/**
 * The citable publisher destination for a source.
 *
 * Two rules, in order:
 *
 * 1. Prefer something the practitioner can actually read. A publication page
 *    beats a raw file, which is the defect this module exists to fix: an
 *    SP 800-53A record used to cite a multi-megabyte OSCAL JSON blob whose
 *    filename says SP 800-53.
 * 2. When both fields are readable pages, prefer the more specific path.
 *    `catalog_browse_url` is not reliably the better of the two - for
 *    `nist-800-53` it is the CPRT tool home while `artifact_url` is the
 *    SP 800-53 Rev 5 publication page, and the same inversion holds for
 *    `nist-csf-2` and the FedRAMP authority entries. Preferring the browse
 *    field unconditionally would regress the two most-used catalogs in the
 *    product.
 *
 * Only five register entries are genuinely ambiguous under rule 2; the rest
 * either agree, hold one field, or pair a page against a file.
 */
export function officialSourceFor(
  source: OfficialSourceInput,
  options: OfficialSourceOptions = {},
): OfficialSourceResolution {
  const { parent, allowArtifactFallback = true } = options;
  const browse = trimmed(source?.catalog_browse_url);
  const artifact = trimmed(source?.artifact_url);
  const parentBrowse = trimmed(parent?.catalog_browse_url);

  const candidates = allowArtifactFallback ? [browse, artifact] : [browse];
  // A PDF counts as readable: it opens in the browser, and for the DoD and OMB
  // authority documents the PDF *is* the publication. Ranking it below a page
  // would swap DoDI 8510.01 for an index of every DoD issuance - the same
  // "landed on a generic index" defect this module exists to remove.
  const readable = candidates.filter(
    (candidate) => candidate && urlDisposition(candidate) !== "download",
  );

  let url: string;
  if (readable.length > 1) {
    url = readable.reduce((best, candidate) =>
      pathDepth(candidate) > pathDepth(best) ? candidate : best,
    );
  } else if (readable.length === 1) {
    url = readable[0];
  } else {
    // Nothing opens in a browser. Offer the file that was actually retrieved
    // and checksummed rather than a floating branch URL, so the citation
    // matches the bytes Control Atlas ingested.
    url = (allowArtifactFallback ? artifact || browse : browse) || parentBrowse;
  }

  return resolve(url, artifact);
}

/**
 * The file Control Atlas retrieved, for rows that describe an artifact rather
 * than a publication. Never falls back to a browse page: a browse page is not
 * a retrieved file, and presenting it as one beside a checksum would misstate
 * what was verified.
 */
export function retrievedArtifactFor(
  source: OfficialSourceInput,
): OfficialSourceResolution {
  const artifact = trimmed(source?.artifact_url);
  return resolve(artifact, artifact);
}

export type SourceActionVerbs = {
  /** Used when the destination opens in the browser. */
  view: string;
  /** Used when the destination starts a download. */
  download: string;
};

export const OFFICIAL_SOURCE_VERBS: SourceActionVerbs = {
  view: "View official source",
  download: "Download official source",
};

export const OFFICIAL_PUBLICATION_VERBS: SourceActionVerbs = {
  view: "Open official publication",
  download: "Download official publication",
};

export const ORIGINAL_SOURCE_VERBS: SourceActionVerbs = {
  view: "Open the original source",
  download: "Download the original source",
};

/**
 * A label that matches what the link does. A control labelled "View" must open
 * something viewable - this audience works on managed government endpoints
 * where an unexpected .zip is an endpoint-protection event, so an unlabelled
 * download is a broken promise rather than a cosmetic issue.
 */
export function officialSourceActionLabel(
  resolution: OfficialSourceResolution,
  verbs: SourceActionVerbs = OFFICIAL_SOURCE_VERBS,
): string {
  if (!resolution.url) return "";
  const verb = resolution.isDownload ? verbs.download : verbs.view;
  return resolution.formatLabel ? `${verb} (${resolution.formatLabel})` : verb;
}
