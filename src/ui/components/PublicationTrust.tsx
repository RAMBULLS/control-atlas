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

/** The dated facts, each under its own name. Retrieval, check and acceptance are never merged. */
export function SourceDates(props: { trust: PublicationTrust }) {
  const { dates, review } = props.trust;
  return (
    <dl className="publication-dates">
      <div><dt>Retrieved by Control Atlas</dt><dd><RecordedDate value={dates.retrieved} /></dd></div>
      <div><dt>Last checked against the publisher</dt><dd>{dates.checked ? <RecordedDate value={dates.checked} /> : "No check recorded"}</dd></div>
      <div><dt>Accepted into Control Atlas</dt><dd><RecordedDate value={dates.accepted} /></dd></div>
      {review ? <div><dt>Control Atlas source review</dt><dd>{review.label} · <RecordedDate value={review.reviewedAt} /></dd></div> : null}
    </dl>
  );
}

export { inlineLabel } from "../lib/publicationActions";
