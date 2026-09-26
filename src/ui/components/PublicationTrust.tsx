import {
  IconAlertTriangle,
  IconArchive,
  IconCircleCheck,
  IconCircleDashed,
  IconPencil,
} from "@tabler/icons-react";

import {
  formatPublicationDate,
  type PublicationTrust,
} from "../lib/publicationIdentity";

/**
 * The shared vocabulary for a publication's trust facts. The publication page
 * and the Sources inspector render the same four facts with these, so a
 * lifecycle, a version or a freshness date cannot be worded two ways.
 * Status is always spelled out; the icon and colour only repeat it.
 */

const LIFECYCLE_ICON = {
  active: IconCircleCheck,
  draft: IconPencil,
  historical: IconArchive,
  superseded: IconArchive,
  deprecated: IconAlertTriangle,
} as const;

export function LifecycleStatus(props: { lifecycle: PublicationTrust["lifecycle"] }) {
  const { value, label } = props.lifecycle;
  const Icon = LIFECYCLE_ICON[value as keyof typeof LIFECYCLE_ICON] || IconCircleDashed;
  return (
    <span className={`publication-lifecycle publication-lifecycle--${value || "unrecorded"}`} data-lifecycle={value || "unrecorded"}>
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
    </span>
  );
}

export function RecordedDate(props: { value: string }) {
  return props.value ? <time dateTime={props.value}>{formatPublicationDate(props.value)}</time> : <>Not recorded</>;
}

/** "Checked Sep 23, 2026" or "Retrieved Aug 12, 2026 · no check recorded". Never calls a retrieval a check. */
export function FreshnessValue(props: { freshness: PublicationTrust["freshness"] }) {
  const { freshness } = props;
  if (freshness.state === "checked") return <span data-freshness="checked">Checked <RecordedDate value={freshness.date} /></span>;
  if (freshness.state === "retrieved_only") {
    return <span data-freshness="retrieved_only">Retrieved <RecordedDate value={freshness.date} /> <small>· no check recorded</small></span>;
  }
  return <span data-freshness="unrecorded">Not recorded</span>;
}

export function VersionValue(props: { version: PublicationTrust["version"]; showDetail?: boolean }) {
  const { version } = props;
  return (
    <span data-version-state={version.state}>
      {version.label}
      {props.showDetail && version.detail && version.state !== "recorded" ? <small className="publication-fact-detail">{version.detail}</small> : null}
    </span>
  );
}

export function LimitationList(props: { limitations: PublicationTrust["limitations"]; className?: string }) {
  if (!props.limitations.length) return null;
  return (
    <ul className={`publication-limitations ${props.className || ""}`.trim()}>
      {props.limitations.map((limitation) => (
        <li data-limitation={limitation.code} key={limitation.code + limitation.text}>
          <IconAlertTriangle aria-hidden="true" size={15} />
          <span>{limitation.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Publisher with its recorded long form: "Defense Information Systems Agency (DISA)". */
export function publisherLine(trust: Pick<PublicationTrust, "publisher" | "publisherFullName">): string {
  if (!trust.publisher) return "";
  return trust.publisherFullName ? `${trust.publisherFullName} (${trust.publisher})` : trust.publisher;
}

/**
 * Retrieval, check and acceptance stay separate facts, but they very often
 * fall on the same day. Printing one date three times under three long labels
 * read as a database dump and buried the one date that mattered, so dates that
 * are genuinely the same day are named together and shown once. Different days
 * still get their own line, and a missing check is still said out loud.
 */
export function SourceDates(props: { trust: PublicationTrust }) {
  const { dates, review } = props.trust;
  // Each fact carries a short form for when it shares a date with another, so
  // a collapsed row stays one readable line instead of "RETRIEVED, LAST
  // CHECKED AND ADDED TO CONTROL ATLAS" wrapping across two.
  const entries: { label: string; short: string; value: string }[] = [];
  if (dates.retrieved) entries.push({ label: "Retrieved", short: "retrieved", value: dates.retrieved });
  if (dates.checked) entries.push({ label: "Last checked", short: "checked", value: dates.checked });
  if (dates.accepted) entries.push({ label: "Added to Control Atlas", short: "added", value: dates.accepted });

  const grouped: { labels: string[]; single: string; value: string }[] = [];
  for (const entry of entries) {
    const existing = grouped.find((group) => group.value === entry.value);
    if (existing) existing.labels.push(entry.short);
    else grouped.push({ labels: [entry.short], single: entry.label, value: entry.value });
  }

  return (
    <dl className="publication-dates">
      {grouped.map((group) => (
        <div key={group.value}>
          <dt>{group.labels.length === 1 ? group.single : joinLabels(group.labels)}</dt>
          <dd><RecordedDate value={group.value} /></dd>
        </div>
      ))}
      {dates.checked ? null : (
        <div><dt>Last checked</dt><dd>No check recorded</dd></div>
      )}
      {review ? <div><dt>Checked for a newer edition</dt><dd>{review.label} · <RecordedDate value={review.reviewedAt} /></dd></div> : null}
    </dl>
  );
}

function joinLabels(labels: string[]): string {
  const joined = `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
}

export { inlineLabel } from "../lib/publicationActions";
