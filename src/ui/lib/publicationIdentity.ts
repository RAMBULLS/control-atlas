import geography from "../../../data/curated/atlas-territory-geography.json" with { type: "json" };
import identityRegistry from "../../../data/curated/identity-registry.json" with { type: "json" };
import authoritySpine from "../../../data/curated/authority-spine.json" with { type: "json" };
import { displayNameFor } from "../../app/display-names.mjs";
import { catalogProfileFor } from "./catalogProfiles";
import { officialSourceFor, type OfficialSourceResolution } from "./officialSource";
import { publisherDisplayName } from "./publisherName";

export { publisherDisplayName };

/**
 * One governed identity and trust story per publication (issue #284).
 *
 * Atlas, the Library, a publication page and the Sources register all answer
 * "what is this, who published it, which edition does Control Atlas use, and
 * how fresh is it" from this one resolver, so the same publication can never
 * read differently on two surfaces. Nothing here is a naming registry of its
 * own: every value comes from data that is already governed.
 *
 *   practitioner name  Atlas's reviewed short alias (atlas-territory-geography
 *                      presentation) for a mapped publication, else the
 *                      source register's display_name.
 *   official title     the source register's `name`, verbatim.
 *   publisher          the register's `owner`; its long form only where the
 *                      curated identity registry records one.
 *   version            the register's `version`, classified so a retrieval
 *                      date is never presented as a publisher version.
 *   dates              retrieved, checked and accepted are separate facts.
 *
 * Absent facts stay absent and say so; nothing is filled with invented copy.
 */

export type PublicationKind = "publication" | "policy" | "reference";

export type VersionState =
  /** The publisher's own edition or release label. */
  | "recorded"
  /** A "current through"/"current as of" statement (codes and regulations). */
  | "current_through"
  /** The only recorded "version" is the date Control Atlas retrieved it. */
  | "retrieval_dated"
  /** The register records a status word ("current"), not an edition. */
  | "unversioned"
  /** The register records that the publisher states no version. */
  | "not_stated"
  | "unknown";

export type FreshnessState = "checked" | "retrieved_only" | "unrecorded";

export type Limitation = {
  /** Stable key for tests and the acceptance matrix. Never rendered. */
  code:
    | "no_check_recorded"
    | "check_older_than_window"
    | "retrieval_dated_version"
    | "version_not_stated"
    | "superseded_upstream"
    | "update_pending"
    | "review_incomplete"
    | "held_for_review"
    | "count_not_independently_confirmed"
    | "records_excluded";
  text: string;
};

export type PublicationTrust = {
  sourceId: string;
  catalogId: string | null;
  kind: PublicationKind;
  /** The name practitioners use. Equal to officialTitle when nothing shorter is governed. */
  practitionerName: string;
  /** The publisher's exact title, verbatim from the source register. */
  officialTitle: string;
  /** True when the official title adds information beyond the practitioner name. */
  showsOfficialTitle: boolean;
  publisher: string;
  /** Long form recorded in the curated identity registry ("Defense Information Systems Agency"), or "". */
  publisherFullName: string;
  /** "Implementation standard", "Control catalog", or the register group for policy ("DoD Issuances"). */
  role: string;
  /** Governed one-line description, or "" when the corpus holds none. */
  summary: string;
  version: { state: VersionState; value: string; label: string; detail: string };
  lifecycle: { value: string; label: string; note: string };
  dates: { retrieved: string; checked: string; accepted: string };
  freshness: { state: FreshnessState; label: string; date: string };
  review: { reviewedAt: string; currentness: string; label: string } | null;
  coverageNote: string;
  limitations: Limitation[];
  official: OfficialSourceResolution;
};

export type CatalogReviewInput = {
  reviewed_at?: string;
  upstream_currentness_review?: string;
} | null | undefined;

export type CatalogCountsInput = {
  discovered_records?: number;
  normalized_records?: number;
  evidence_class?: string | null;
  excluded_records?: number;
  exclusions?: Array<{ count: number; reason: string }>;
} | null | undefined;

export type PublicationTrustInput = {
  source: any;
  catalogId?: string | null;
  review?: CatalogReviewInput;
  counts?: CatalogCountsInput;
  /** Latest check date across the register; the freshness window is measured against it. */
  datasetCheckedThrough?: string;
  /** The register holds an update to this publication for review. */
  heldForReview?: boolean;
};

const PRESENTATION = (geography as { presentation: Record<string, { alias?: string }> }).presentation;
const PUBLISHER_FULL_NAMES = new Map<string, string>(
  (identityRegistry as { identities: Array<{ label: string; accessible_name: string }> }).identities
    .filter((entry) => entry.label && entry.accessible_name && entry.label !== entry.accessible_name)
    .map((entry) => [entry.label.toLocaleLowerCase(), entry.accessible_name]),
);

type SpineInstrument = { id: string; source_id: string; label: string; blurb: string; node_type: string };
type SpinePublication = { catalog_id: string; primary_authority: string | null; also_required_by?: string[]; mandate_note?: string };
const INSTRUMENTS = new Map((authoritySpine.instruments as SpineInstrument[]).map((i) => [i.id, i]));
const INSTRUMENT_BY_SOURCE = new Map((authoritySpine.instruments as SpineInstrument[]).map((i) => [i.source_id, i]));
const MANDATES = new Map((authoritySpine.publications as SpinePublication[]).map((p) => [p.catalog_id, p]));

const DEFAULT_FRESHNESS_WINDOW_DAYS = 45;
const DAY_MS = 86_400_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isoDay(value: unknown): string {
  const day = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function same(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim().toLocaleLowerCase() === right.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** Long form from the curated identity registry, or "" where none is recorded. */
export function publisherFullNameFor(publisher: string): string {
  return PUBLISHER_FULL_NAMES.get(publisher.toLocaleLowerCase()) || "";
}

export function publicationKindFor(source: any): PublicationKind {
  const id = text(source?.id);
  if (id.startsWith("authority-") || text(source?.metadata?.authority_node_id)) return "policy";
  return source?.metadata?.identity_kind === "reference" ? "reference" : "publication";
}

/** Formats a recorded date for display. Only the date part is ever shown. */
export function formatPublicationDate(value: unknown): string {
  const day = isoDay(value);
  if (!day) return text(value);
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })
    .format(new Date(Date.UTC(year, month - 1, date)));
}

/** The latest check date across a register, used as the reference point for the freshness window. */
export function datasetCheckedThroughFor(sources: readonly any[]): string {
  let latest = "";
  for (const source of sources) {
    const checked = isoDay(source?.last_checked);
    if (checked > latest) latest = checked;
  }
  return latest;
}

function versionFor(source: any): PublicationTrust["version"] {
  const value = text(source?.version);
  const reason = text(source?.metadata?.version_unknown_reason);
  if (!value) {
    if (reason) return { state: "not_stated", value: "", label: "Not stated by the publisher", detail: reason };
    return { state: "unknown", value: "", label: "Not recorded", detail: "No publisher version is recorded for this publication." };
  }
  if (/^current\s+(through|as of)\b/i.test(value)) {
    return { state: "current_through", value, label: value, detail: "As stated by the official text." };
  }
  if (/^current(\s+published\s+data)?$/i.test(value)) {
    return {
      state: "unversioned", value, label: "Not versioned by the publisher",
      detail: `The source register records “${value}”; the publisher does not state a release version.`,
    };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const acquisitionDates = [source?.retrieved_at, source?.last_imported, source?.last_checked].map(isoDay);
  if (day && acquisitionDates.includes(day)) {
    return {
      state: "retrieval_dated", value, label: "Not stated by the publisher",
      detail: `Control Atlas identifies this snapshot by the date it was retrieved, ${formatPublicationDate(day)}.`,
    };
  }
  return { state: "recorded", value, label: value, detail: "" };
}

function lifecycleFor(source: any): PublicationTrust["lifecycle"] {
  const value = text(source?.lifecycle_status);
  return {
    value,
    label: value ? displayNameFor("lifecycle_status", value) : "Not recorded",
    note: text(source?.metadata?.transition_note),
  };
}

function reviewFor(review: CatalogReviewInput): PublicationTrust["review"] {
  const reviewedAt = isoDay(review?.reviewed_at);
  const currentness = text(review?.upstream_currentness_review);
  if (!reviewedAt || !currentness) return null;
  const labels: Record<string, string> = {
    current_as_checked: "Current as checked",
    superseded: "Publisher has superseded this edition",
    refresh_required: "Publisher update not yet reflected",
    blocked: "Review not completed",
  };
  return { reviewedAt, currentness, label: labels[currentness] || "Not recorded" };
}

/**
 * Resolves the one public identity and trust story for a publication.
 * `source` is a row of data/generated/sources.json (or the source register).
 */
export function publicationTrustFor(input: PublicationTrustInput): PublicationTrust {
  const { source } = input;
  const sourceId = text(source?.id);
  const catalogId = text(input.catalogId) || null;
  const kind = publicationKindFor(source);
  const officialTitle = text(source?.name) || text(source?.display_name) || sourceId;
  const alias = catalogId ? text(PRESENTATION[catalogId]?.alias) : "";
  const displayName = text(source?.display_name);
  const practitionerName = alias || (displayName && displayName !== sourceId ? displayName : "") || officialTitle;
  const publisher = publisherDisplayName(source?.owner);
  const profile = catalogId ? catalogProfileFor(catalogId) : null;
  const instrument = INSTRUMENT_BY_SOURCE.get(sourceId);

  const version = versionFor(source);
  const lifecycle = lifecycleFor(source);
  const dates = {
    retrieved: isoDay(source?.retrieved_at),
    checked: isoDay(source?.last_checked),
    accepted: isoDay(source?.last_imported),
  };
  const freshness: PublicationTrust["freshness"] = dates.checked
    ? { state: "checked", label: "Checked against the publisher", date: dates.checked }
    : dates.retrieved
      ? { state: "retrieved_only", label: "Retrieved (no check recorded)", date: dates.retrieved }
      : { state: "unrecorded", label: "Not recorded", date: "" };
  const review = reviewFor(input.review);

  const limitations: Limitation[] = [];
  if (input.heldForReview) {
    limitations.push({ code: "held_for_review", text: "An update to this publication is being reviewed. Control Atlas continues to show the edition it last accepted." });
  }
  if (freshness.state !== "checked") {
    limitations.push({
      code: "no_check_recorded",
      text: dates.retrieved
        ? `No check against the publisher is recorded. The date shown is when Control Atlas retrieved it, ${formatPublicationDate(dates.retrieved)}.`
        : "No check against the publisher or retrieval date is recorded.",
    });
  } else if (input.datasetCheckedThrough) {
    const window = Number.isInteger(source?.stale_after_days) ? source.stale_after_days : DEFAULT_FRESHNESS_WINDOW_DAYS;
    const age = Math.floor((Date.parse(input.datasetCheckedThrough) - Date.parse(dates.checked)) / DAY_MS);
    if (age > window) {
      limitations.push({
        code: "check_older_than_window",
        text: `Last checked against the publisher on ${formatPublicationDate(dates.checked)}, more than ${window} days before the newest check in this data set. The publisher may have made changes since.`,
      });
    }
  }
  if (version.state === "retrieval_dated") limitations.push({ code: "retrieval_dated_version", text: `The publisher does not state a version for this material. ${version.detail}` });
  if (version.state === "not_stated") limitations.push({ code: "version_not_stated", text: version.detail });
  if (review?.currentness === "superseded") {
    limitations.push({ code: "superseded_upstream", text: `Control Atlas's source review on ${formatPublicationDate(review.reviewedAt)} recorded that the publisher has superseded this edition.` });
  } else if (review?.currentness === "refresh_required") {
    limitations.push({ code: "update_pending", text: `Control Atlas's source review on ${formatPublicationDate(review.reviewedAt)} found a publisher update that is not yet reflected here.` });
  } else if (review?.currentness === "blocked") {
    limitations.push({ code: "review_incomplete", text: `Control Atlas could not complete its currentness review on ${formatPublicationDate(review.reviewedAt)}.` });
  }
  const counts = input.counts;
  if (counts?.evidence_class === "reviewed_snapshot") {
    limitations.push({ code: "count_not_independently_confirmed", text: "Control Atlas has not independently confirmed that its records are every entry the publisher lists." });
  }
  for (const exclusion of counts?.exclusions || []) {
    limitations.push({ code: "records_excluded", text: `${exclusion.count.toLocaleString()} publisher ${exclusion.count === 1 ? "entry is" : "entries are"} not indexed: ${exclusion.reason}` });
  }

  return {
    sourceId,
    catalogId,
    kind,
    practitionerName,
    officialTitle,
    showsOfficialTitle: !same(practitionerName, officialTitle),
    publisher,
    publisherFullName: publisherFullNameFor(publisher),
    role: kind === "policy"
      ? text(source?.display_group) || (instrument ? displayNameFor("node_type", instrument.node_type) : "Policy")
      : profile?.publicationKind && profile.publicationKind !== "Publication" ? profile.publicationKind : "",
    summary: profile?.synopsis || instrument?.blurb || "",
    version,
    lifecycle,
    dates,
    freshness,
    review,
    coverageNote: text(source?.metadata?.provenance_note),
    limitations,
    official: officialSourceFor(source),
  };
}

/** Policy documents the authority spine records (with cited sources) as the basis for a publication, by source id. */
export function recordedBasisFor(catalogId: string): string[] {
  const mandate = MANDATES.get(catalogId);
  if (!mandate) return [];
  return [mandate.primary_authority, ...(mandate.also_required_by || [])]
    .flatMap((id) => (id && INSTRUMENTS.has(id) ? [INSTRUMENTS.get(id)!.source_id] : []));
}

/** Publications whose recorded basis in the authority spine cites a policy document. */
export function publicationsCitingPolicy(sourceId: string): string[] {
  return [...MANDATES.values()]
    .filter((mandate) => recordedBasisFor(mandate.catalog_id).includes(sourceId))
    .map((mandate) => mandate.catalog_id)
    .sort();
}

/** The mandate note the authority spine records for a publication, or "". */
export function recordedBasisNoteFor(catalogId: string): string {
  return text(MANDATES.get(catalogId)?.mandate_note);
}

/** The practitioner name for a mapped publication when only its catalog id is at hand. */
export function practitionerNameForCatalog(catalogId: string, fallback = ""): string {
  return text(PRESENTATION[catalogId]?.alias) || text(fallback) || catalogId;
}
