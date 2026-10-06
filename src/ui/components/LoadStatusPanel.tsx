import type { ReactNode } from "react";
import { Panel, Button } from "./lsm";
import { AppLink } from "./AppLink";

export function LoadingStatusPanel(props: {
  slow: boolean;
  children?: ReactNode;
  suspensePending?: boolean;
}) {
  return (
    <Panel
      className="max-w-[800px] mx-auto mt-[40px]"
      data-route-suspense-pending={props.suspensePending ? "true" : undefined}
      title="Loading Records"
    >
      <div aria-hidden="true" className="load-progress mb-[16px]" />
      <p className="mb-[16px]">
        Loading public records, source information, and comparison tools.
      </p>
      {props.slow ? (
        <p className="text-[var(--ca-warning)] mb-[16px]">
          Still loading. Check your connection. You can keep waiting or use one
          of the available pages below.
        </p>
      ) : null}
      <p className="text-[var(--ca-text-muted)] mb-[24px]">
        Guides, Templates, and About are ready now if you would rather start
        there.
      </p>
      {props.children}
    </Panel>
  );
}

export function LoadErrorPanel(props: {
  message: string;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <Panel className="max-w-[800px] mx-auto mt-[40px] border-[var(--ca-danger)]" title="Unable to load data">
      <p className="mb-[16px] font-bold text-[var(--ca-danger)]">{props.message}</p>
      <p className="mb-[24px]">
        Check your connection, then try loading the data again. Guides,
        Templates, Atlas topics, and About still work without it.
      </p>
      <div className="flex gap-[8px] mb-[24px]">
        <Button variant="destructive" onClick={props.onRetry}>
          Try loading again
        </Button>
      </div>
      {props.children}
    </Panel>
  );
}

export function OfflineFallbackActions(props: {
  onNavigate: (view: "patterns" | "templates" | "about" | "atlas-map") => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
      <AppLink
        className="flex flex-col items-start p-[16px] text-left border border-[var(--ca-border-strong)] rounded-[3px] bg-[var(--ca-surface-raised)] hover:border-[var(--ca-secondary)] transition-colors"
        onNavigate={props.onNavigate}
        view="patterns"
      >
        <strong className="text-[var(--ca-text)] font-mono uppercase tracking-wider text-[11px] mb-[4px]">Read the guides</strong>
        <span className="text-[var(--ca-text-muted)] text-[13px]">Cited procedures with goals, prerequisites, steps, outputs, and handoff checks.</span>
      </AppLink>
      <AppLink
        className="flex flex-col items-start p-[16px] text-left border border-[var(--ca-border-strong)] rounded-[3px] bg-[var(--ca-surface-raised)] hover:border-[var(--ca-secondary)] transition-colors"
        onNavigate={props.onNavigate}
        view="templates"
      >
        <strong className="text-[var(--ca-text)] font-mono uppercase tracking-wider text-[11px] mb-[4px]">Open Templates</strong>
        <span className="text-[var(--ca-text-muted)] text-[13px]">Choose a starter file built from explicit inputs.</span>
      </AppLink>
      <AppLink
        className="flex flex-col items-start p-[16px] text-left border border-[var(--ca-border-strong)] rounded-[3px] bg-[var(--ca-surface-raised)] hover:border-[var(--ca-secondary)] transition-colors"
        onNavigate={props.onNavigate}
        view="atlas-map"
      >
        <strong className="text-[var(--ca-text)] font-mono uppercase tracking-wider text-[11px] mb-[4px]">Explore Atlas topics</strong>
        <span className="text-[var(--ca-text-muted)] text-[13px]">Find the topic and publisher source for your question.</span>
      </AppLink>
      <AppLink
        className="flex flex-col items-start p-[16px] text-left border border-[var(--ca-border-strong)] rounded-[3px] bg-[var(--ca-surface-raised)] hover:border-[var(--ca-secondary)] transition-colors"
        onNavigate={props.onNavigate}
        view="about"
      >
        <strong className="text-[var(--ca-text)] font-mono uppercase tracking-wider text-[11px] mb-[4px]">About Control Atlas</strong>
        <span className="text-[var(--ca-text-muted)] text-[13px]">What this tool is for, and where its answers come from.</span>
      </AppLink>
    </div>
  );
}

export function DataPendingNotice(props: {
  title?: string;
  description?: string;
  slow?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Panel className="max-w-[800px] mx-auto mt-[40px]" title={props.title || "Loading data"}>
      <p className="mb-[24px]">
        {props.description || "This page needs the public mapping data. It should load in a moment."}
      </p>
      {props.slow ? (
        <>
          <p className="mb-[16px] text-[var(--ca-warning)]">
            Still loading. Check your connection, then try loading the data again.
          </p>
          {props.onRetry ? (
            <Button variant="primary" onClick={props.onRetry}>
              Try loading again
            </Button>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
