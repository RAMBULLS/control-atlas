import * as Accordion from "@radix-ui/react-accordion";
import { IconArrowRight, IconX } from "@tabler/icons-react";
import React, { useId, type ElementType, type ReactNode } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import {
  sourceCurrentAsOf,
  sourceFreshness,
  sourceFreshnessWarning,
} from "../../shared/source-freshness.mjs";
import { AcronymText } from "../components/AccessibleTerm";
import { ProvenanceTerm } from "../components/ProvenanceTerm";
import { Button, ButtonLink } from "../components/lsm/Button";
import type { ViewState } from "./viewState";
import { sourceIdentityPresentationFor } from "./sourceIdentity";

export const PATTERN_RENAMES: Record<string, string> = {
  "rmf-lifecycle": "Plan Work Across the RMF Lifecycle",
  "ato-vs-atc": "ATO vs. Network Connection Approval",
  "csp-inheritance": "Using FedRAMP Inheritance",
  "shared-responsibility": "What Your Cloud Provider Owns vs What You Own",
  "reciprocity-basics": "Reusing Prior Authorization Work",
  "reciprocity-failures": "Why Prior Assessments Get Rejected",
  "control-inheritance": "Using Controls Your Provider Already Runs",
  "common-control-provider": "Providing Controls Other Systems Can Inherit",
  "enterprise-inheritance": "Using Agency Identity, Logging, and Monitoring Services",
  "conmon-cadence": "Keeping Authorization Evidence Current",
  "boundary-patterns": "Defining the Right Authorization Boundary",
  "boe-reuse": "Packaging Evidence for Reuse",
  "poam-concepts": "Managing a POA&M and Residual Risk",
  "evidence-patterns": "Choosing Evidence an Assessor Can Use",
};

export function openAtlasMapForNode(
  navigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void,
  nodeId: string,
) {
  navigate("atlas-map", { node: nodeId });
}

function copyTextWithSelection(value: string) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Clipboard permissions can be denied in otherwise supported browsers.
    }
  }
  copyTextWithSelection(value);
}

export function downloadBlobFile(
  filename: string,
  blob: Blob,
  onDispatch?: () => void,
) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  // Fire confirmation from the real anchor-click dispatch so the toast tracks
  // the actual download, not just a successful generate (CATL-V2/67).
  onDispatch?.();
  anchor.remove();
  // Browsers start blob downloads asynchronously. Revoking the object URL in
  // this same task can cancel larger Office packages before the download
  // manager reads them.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
  onDispatch?: () => void,
) {
  downloadBlobFile(
    filename,
    new Blob([content], { type: mimeType }),
    onDispatch,
  );
}

export function sourceTrustSummary(source: any) {
  if (!source) {
    return "Source pending.";
  }
  if (source.provenance_class === "inferred") {
    return "Needs review before relying on it.";
  }
  if (
    source.provenance_class === "federal_published" ||
    source.provenance_class === "official"
  ) {
    return "Official source.";
  }
  if (source.provenance_class?.includes("published")) {
    return "Published by the named source.";
  }
  return "Supporting source.";
}

export function sourceUsageSummary(source: any) {
  return source?.graph_eligible && source?.eligibility_status === "eligible"
    ? "Its published records and mappings appear in search, comparison, and Atlas connections"
    : "Control Atlas links to this source for reference; its records are not part of search, comparison, or Atlas connections";
}

export function sourceWarnings(source: any) {
  const warnings: string[] = [];
  if (!source) {
    return warnings;
  }
  if (!source.graph_eligible || source.eligibility_status === "excluded") {
    warnings.push(
      "This source is linked for reference; its records are not part of search, comparison, or Atlas connections.",
    );
  }
  if (
    source.lifecycle_status === "deprecated" ||
    source.lifecycle_status === "draft"
  ) {
    warnings.push(
      "This source is old or draft content. Review it carefully before reusing it.",
    );
  }
  if (source.access_status !== "public") {
    warnings.push(
      "Access restrictions may limit what can be verified from this source.",
    );
  }
  if (sourceFreshness(source).is_stale) {
    const freshnessWarning = sourceFreshnessWarning(source);
    if (freshnessWarning) warnings.push(freshnessWarning);
  }
  return warnings;
}

/**
 * Record-page provenance resolves "Published by / From / Enriched by /
 * Connections supplied by" from the record's own real
 * artifact_ids and the sources those artifacts declare a source_role for,
 * never a generic process description. Names, not internal enum values.
 */
export function nodeProvenanceBreakdown(
  node: any,
  edges: any[],
  getSource: (id: string) => any,
) {
  const nameFor = (source: any) => {
    const name = source?.display_name || source?.name || null;
    return typeof name === "string"
      ? name.replace(/\s+Artifact$/i, "")
      : name;
  };

  const artifactSources = (node?.artifact_ids || [])
    .map((id: string) => getSource(id))
    .filter(Boolean);

  const importedFrom = [
    ...new Set(
      artifactSources
        .filter((s: any) => s.source_role === "primary_data" || !s.source_role)
        .map(nameFor)
        .filter(Boolean),
    ),
  ] as string[];

  const enrichedBy = [
    ...new Set(
      artifactSources
        .filter((s: any) => s.source_role === "enrichment")
        .map(nameFor)
        .filter(Boolean),
    ),
  ] as string[];

  const connectionSourceIds = new Set<string>();
  for (const edge of edges || []) {
    if (edge.source_artifact_id) connectionSourceIds.add(edge.source_artifact_id);
    for (const ref of edge.source_refs || []) {
      if (ref.source_id) connectionSourceIds.add(ref.source_id);
    }
  }
  const connectionsSuppliedBy = [
    ...new Set(
      [...connectionSourceIds]
        .map((id) => nameFor(getSource(id)))
        .filter(Boolean),
    ),
  ] as string[];

  return { importedFrom, enrichedBy, connectionsSuppliedBy };
}

export function formatRelationshipLabel(edge: any) {
  return displayNameFor("relationship_type", edge.relationship_type);
}

export function formatConfidence(value: string) {
  return displayNameFor("confidence", value);
}

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).trim();
  }
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) {
    return node.map(extractNodeText).join(" ").trim();
  }
  const candidate = node as any;
  if (candidate && typeof candidate === "object" && candidate.props && "children" in candidate.props) {
    return extractNodeText(candidate.props.children);
  }
  return "";
}

export function MissionPage(props: {
  children: ReactNode;
  className?: string;
  id?: string;
  maxWidth?: "workspace" | "content" | "reading" | "full";
  style?: React.CSSProperties;
  role?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  const widthClass =
    props.maxWidth === "content"
      ? "mission-page--content"
      : props.maxWidth === "reading"
        ? "mission-page--reading"
        : props.maxWidth === "full"
          ? "mission-page--full"
          : "mission-page--workspace";

  return (
    <main
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      className={`mission-page ${widthClass} ${props.className || ""}`.trim()}
      id={props.id || "workspace"}
      role={props.role}
      style={props.style}
      tabIndex={-1}
    >
      {props.children}
    </main>
  );
}

export function MissionPageHeader(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  action?: ReactNode;
  primary?: boolean;
  className?: string;
  id?: string;
}) {
  // Orbital task header (§3.4):
  // H1: Oswald display face, Bone.
  // Eyebrow: IBM Plex Mono, uppercase, wide tracking, teal only when indicating scope/state.
  // Summary: Inter, Dust, maximum 65ch.
  // One action maximum in the pagehead.
  // Thin datum rule beneath with registration/datum tick.
  const titleText = extractNodeText(props.title);
  const eyebrowText = typeof props.eyebrow === "string" ? props.eyebrow.trim() : "";
  const isDuplicate =
    eyebrowText.length > 0 &&
    titleText.length > 0 &&
    eyebrowText.toLowerCase() === titleText.toLowerCase();
  const showEyebrow = props.eyebrow != null && (!eyebrowText || !isDuplicate);

  return (
    <header
      className={`page-header mission-page-header ${props.className || ""}`.trim()}
      data-route-primary-header={props.primary ? "true" : undefined}
      id={props.id}
    >
      <div className="page-header-title" data-route-primary-copy="true">
        {showEyebrow ? (
          <span className="eyebrow page-header-eyebrow">
            {typeof props.eyebrow === "string" ? (
              <AcronymText>{props.eyebrow}</AcronymText>
            ) : (
              props.eyebrow
            )}
          </span>
        ) : null}
        <h1>
          {typeof props.title === "string" ? (
            <AcronymText>{props.title}</AcronymText>
          ) : (
            props.title
          )}
        </h1>
        {props.summary ? (
          <p className="page-summary" data-route-primary-copy="true">
            {typeof props.summary === "string" ? (
              <AcronymText>{props.summary}</AcronymText>
            ) : (
              props.summary
            )}
          </p>
        ) : null}
      </div>
      {props.action ? (
        <div className="page-header-action" data-route-primary-support="true">
          {props.action}
        </div>
      ) : null}
    </header>
  );
}

export const PageHeader = MissionPageHeader;

export function MissionWorkspace(props: {
  children: ReactNode;
  className?: string;
  singleColumn?: boolean;
  id?: string;
  role?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      aria-label={props["aria-label"]}
      className={`mission-workspace ${props.singleColumn ? "mission-workspace--single" : ""} ${props.className || ""}`.trim()}
      id={props.id}
      role={props.role}
    >
      {props.children}
    </section>
  );
}

export function SupportRail(props: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <aside
      aria-label={props.ariaLabel || "Supporting context"}
      className={`support-rail ${props.sticky ? "support-rail--sticky" : ""} ${props.className || ""}`.trim()}
      id={props.id}
    >
      {props.children}
    </aside>
  );
}

export function WorkbenchControlSurface(props: {
  children: ReactNode;
  className?: string;
  label: string;
  targetId: string;
}) {
  return (
    <section
      aria-controls={props.targetId}
      aria-label={props.label}
      className={`workbench-controls ${props.className || ""}`.trim()}
      data-controls-for={props.targetId}
    >
      <p className="workbench-controls-title">{props.label}</p>
      {props.children}
    </section>
  );
}

export function SummaryCard(props: {
  title: string;
  children: ReactNode;
  headingLevel?: 2 | 3 | 4;
  tone?: "default" | "trust" | "warning";
}) {
  const titleId = useId();
  const HeadingTag = (props.headingLevel
    ? `h${props.headingLevel}`
    : "span") as ElementType;

  return (
    <article
      aria-label={props.headingLevel ? undefined : props.title}
      aria-labelledby={props.headingLevel ? titleId : undefined}
      className={`summary-card tone-${props.tone || "default"}`}
    >
      <HeadingTag className="summary-card-title" id={props.headingLevel ? titleId : undefined}>
        {props.title}
      </HeadingTag>
      <div>{props.children}</div>
    </article>
  );
}

export function Badge(props: {
  children: ReactNode;
  tone?: "default" | "info" | "warning" | "success" | "applicability";
}) {
  return (
    <span className={`badge tone-${props.tone || "default"}`}>
      {props.children}
    </span>
  );
}

export function jumpToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }
  scrollElementBelowHeader(el);
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

export function scrollElementBelowHeader(
  element: HTMLElement,
  behavior: "auto" | "smooth" = "smooth",
) {
  const header = document.querySelector<HTMLElement>(".site-header:not([hidden])");
  const safeOffset = (header?.getBoundingClientRect().height || 0) + 12;
  window.scrollTo({
    behavior,
    top: Math.max(
      0,
      window.scrollY + element.getBoundingClientRect().top - safeOffset,
    ),
  });
}

export function PageJumpNav(props: {
  sections: Array<{ id: string; label: string; count?: number }>;
  ariaLabel?: string;
  onJump?: (id: string) => void;
}) {
  return (
    <nav
      aria-label={props.ariaLabel || "On this page"}
      className="connection-group-nav page-jump-nav"
    >
      <ul>
        {props.sections.map((section) => (
          <li key={section.id}>
            <button
              aria-label={`Jump to ${section.label}`}
              className="connection-group-nav-link"
              onClick={() => (props.onJump || jumpToSection)(section.id)}
              type="button"
            >
              <span>{section.label}</span>
              {section.count != null ? (
                <strong>{section.count.toLocaleString()}</strong>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CardTitle(props: {
  children: ReactNode;
  id?: string;
  onOpen?: () => void;
  href?: string;
}) {
  if (props.onOpen) {
    return (
      <h3 className="card-title">
        <button
          id={props.id}
          className="card-title-action"
          onClick={props.onOpen}
          type="button"
        >
          {props.children}
        </button>
      </h3>
    );
  }
  if (props.href) {
    return (
      <h3 className="card-title">
        <a
          id={props.id}
          className="card-title-action"
          href={props.href}
          rel="noreferrer"
          target="_blank"
        >
          {props.children}
        </a>
      </h3>
    );
  }
  return <h3 className="card-title" id={props.id}>{props.children}</h3>;
}

export function SourceSummaryCard(props: { source: any; onOpen?: () => void; detail?: boolean }) {
  const { source, onOpen } = props;
  const identity = sourceIdentityPresentationFor(source);
  return (
    <article
      aria-label={props.detail ? "Source status summary" : undefined}
      className="result-card source-card"
    >
      {props.detail ? (
        identity.familyName ? (
          <div className="result-card-header source-detail-family">
            <div>
              <p className="result-meta">Source family</p>
              <Badge>{identity.familyName}</Badge>
            </div>
          </div>
        ) : null
      ) : (
      <div className="result-card-header">
        <div>
          <p className="result-meta">Source</p>
          <CardTitle onOpen={onOpen}>
            {identity.primaryName}
          </CardTitle>
        </div>
        {identity.familyName ? (
          <Badge>{identity.familyName}</Badge>
        ) : null}
      </div>
      )}
      <p className="result-summary">Maintained by {source.owner}.</p>
      <p className="support-meta">
        {sourceCurrentAsOf(source)}
      </p>
      <div className="source-summary-grid">
        <ProvenanceTerm
          kind="provenance"
          value={source.provenance_class || ""}
        />
        <ProvenanceTerm
          kind="trust"
          label={displayNameFor("lifecycle_status", source.lifecycle_status)}
          value={source.lifecycle_status}
        />
        <ProvenanceTerm
          kind="trust"
          label={displayNameFor("access_status", source.access_status)}
          value={source.access_status}
        />
      </div>
      {sourceWarnings(source).length ? (
        <div className="warning-list">
          {sourceWarnings(source).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <div className="card-actions">
        <ButtonLink
          variant="secondary"
          href={source.catalog_browse_url || source.artifact_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open the original source
        </ButtonLink>
      </div>
    </article>
  );
}

export function DisclosurePanel(props: {
  value: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Accordion.Item className="accordion-item" value={props.value}>
      <Accordion.Header asChild>
        <h2>
        <Accordion.Trigger className="accordion-trigger">
          <span>{props.title}</span>
          <IconArrowRight size={18} stroke={1.8} />
        </Accordion.Trigger>
        </h2>
      </Accordion.Header>
      <Accordion.Content className="accordion-content">
        {props.children}
      </Accordion.Content>
    </Accordion.Item>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function SelectField(props: {
  emptyLabel?: string;
  hint?: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const fieldId = `field-${props.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

  return (
    <label className="field" htmlFor={fieldId}>
      <span>{props.label}</span>
      <select
        aria-label={props.label}
        disabled={props.disabled}
        id={fieldId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        <option value="">{props.emptyLabel || "All"}</option>
        {props.options.map((option) => (
          <option disabled={option.disabled} key={`${props.label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint ? <p className="field-hint">{props.hint}</p> : null}
    </label>
  );
}

/**
 * Standardized EmptyState component (T5.8).
 */
export function EmptyState(props: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  tone?: "default" | "warning" | "info";
  className?: string;
}) {
  return (
    <div
      className={`empty-state tone-${props.tone || "default"} ${props.className || ""}`.trim()}
      role="status"
    >
      {props.icon ? <div aria-hidden="true" className="empty-state-icon">{props.icon}</div> : null}
      <h3 className="empty-state-title">
        <AcronymText>{props.title}</AcronymText>
      </h3>
      <p className="empty-state-message">
        <AcronymText>{props.message}</AcronymText>
      </p>
      {props.actionLabel && props.onAction ? (
        <div className="empty-state-action">
          <Button onClick={props.onAction} variant="secondary">
            {props.actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Standardized Staged Flow StepIndicator (T5.8).
 */
export function StepIndicator(props: {
  steps: Array<{ id: string; label: string; description?: string }>;
  currentStep: number;
  onSelectStep?: (stepIndex: number) => void;
}) {
  return (
    <nav aria-label="Step progress" className="staged-flow-steps">
      <ol className="step-list">
        {props.steps.map((step, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === props.currentStep;
          const isComplete = stepNum < props.currentStep;
          return (
            <li
              aria-current={isActive ? "step" : undefined}
              className={`step-item ${isActive ? "step-active" : isComplete ? "step-complete" : "step-pending"}`}
              key={step.id}
            >
              <span aria-hidden="true" className="step-number">
                {stepNum}
              </span>
              <span className="step-info">
                <strong className="step-label">{step.label}</strong>
                {step.description ? <small className="step-description">{step.description}</small> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Standardized FilterBar container (T5.8).
 */
export function FilterBar(props: {
  children: ReactNode;
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
  className?: string;
}) {
  return (
    <div className={`filter-bar ${props.className || ""}`.trim()} role="search">
      <div className="filter-bar-controls">{props.children}</div>
      {props.activeCount && props.activeCount > 0 && props.onReset ? (
        <div className="filter-bar-actions">
          <button className="filter-bar-reset" onClick={props.onReset} type="button">
            {props.resetLabel || "Reset filters"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Standardized InspectorDrawer container (T5.8, T5.11).
 */
export function InspectorDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
  className?: string;
  id?: string;
}) {
  const drawerRef = React.useRef<HTMLElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [isCompact, setIsCompact] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1100 : false,
  );

  React.useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 1100);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  React.useEffect(() => {
    if (!props.isOpen) return;

    if (isCompact) {
      closeButtonRef.current?.focus();
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
        return;
      }
      if (!isCompact || event.key !== "Tab" || !drawerRef.current) return;

      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCompact, props.isOpen, props.onClose]);

  if (!props.isOpen) return null;

  return (
    <>
      {isCompact ? (
        <div
          aria-hidden="true"
          className="inspector-drawer-backdrop"
          onClick={props.onClose}
        />
      ) : null}
      <aside
        aria-label={props.ariaLabel || "Details inspector"}
        aria-modal={isCompact ? "true" : undefined}
        className={`inspector-drawer ${isCompact ? "inspector-drawer--modal" : "inspector-drawer--inline"} ${props.className || ""}`.trim()}
        id={props.id}
        ref={drawerRef}
        role={isCompact ? "dialog" : "region"}
        tabIndex={-1}
      >
        <div className="inspector-drawer-header">
          <div>
            {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
            <h2 className="inspector-drawer-title">{props.title}</h2>
          </div>
          <button
            aria-label="Close inspector"
            className="inspector-drawer-close"
            onClick={props.onClose}
            ref={closeButtonRef}
            type="button"
          >
            <IconX aria-hidden="true" size={18} stroke={1.8} />
          </button>
        </div>
        <div className="inspector-drawer-body">{props.children}</div>
        {props.actions ? (
          <div className="inspector-drawer-actions">{props.actions}</div>
        ) : null}
      </aside>
    </>
  );
}

/**
 * Standardized DataTable component (T5.8).
 */
export function DataTable<T>(props: {
  columns: Array<{
    key: string;
    header: ReactNode;
    className?: string;
    render: (row: T, index: number) => ReactNode;
  }>;
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  caption?: string;
  emptyState?: ReactNode;
  className?: string;
}) {
  if (props.data.length === 0 && props.emptyState) {
    return <>{props.emptyState}</>;
  }
  return (
    <div className={`data-table-container ${props.className || ""}`.trim()}>
      <table className="data-table">
        {props.caption ? <caption className="visually-hidden">{props.caption}</caption> : null}
        <thead>
          <tr>
            {props.columns.map((col) => (
              <th className={col.className} key={col.key} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.data.map((row, index) => (
            <tr key={props.keyExtractor(row, index)}>
              {props.columns.map((col) => (
                <td className={col.className} key={col.key}>
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Standardized SourceProvenanceSummary component (T5.8).
 */
export function SourceProvenanceSummary(props: {
  owner?: string;
  version?: string;
  lastChecked?: string;
  provenanceClass?: string;
  officialUrl?: string;
  compact?: boolean;
}) {
  return (
    <div className={`source-provenance-summary ${props.compact ? "compact" : ""}`}>
      <span className="source-provenance-owner">{props.owner || "Publisher not recorded"}</span>
      {props.version ? <span className="source-provenance-version"> · {props.version}</span> : null}
      {props.lastChecked ? <span className="source-provenance-checked"> · Checked {props.lastChecked}</span> : null}
      {props.officialUrl ? (
        <a
          className="source-provenance-link"
          href={props.officialUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Official source
        </a>
      ) : null}
    </div>
  );
}
