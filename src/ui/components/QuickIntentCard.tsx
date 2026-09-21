import type { ReactNode } from "react";
import type { ViewState } from "../lib/viewState";
import { AppLink, shouldInterceptAppLink, type AppNavigate } from "./AppLink";
import { Input } from "./lsm";

export function QuickIntentCard(props: {
  title: string;
  body: string;
  icon: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  actionLabel?: string;
  onNavigate: AppNavigate;
  onBeforeNavigate?: () => void;
  patch?: Partial<ViewState>;
  selected?: boolean;
  view: ViewState["view"];
}) {
  return (
    <AppLink
      className={`flex flex-col items-start text-left p-[24px] border rounded-[3px] transition-[border-color,background-color,box-shadow] duration-[120ms] group w-full cursor-pointer h-full ${
        props.selected
          ? "border-[var(--ca-secondary)] bg-[color-mix(in_srgb,var(--ca-secondary)_10%,transparent)] shadow-[0_0_0_1px_var(--ca-secondary)]"
          : "border-[var(--ca-border-strong)] bg-[var(--ca-surface)] hover:bg-[var(--ca-surface-raised)]"
      }`}
      data-selected={props.selected ? "true" : undefined}
      onClick={(event) => {
        if (shouldInterceptAppLink(event)) props.onBeforeNavigate?.();
      }}
      onNavigate={props.onNavigate}
      patch={props.patch}
      view={props.view}
    >
      <div className="text-[var(--ca-secondary)] mb-[16px] p-[8px] bg-[color-mix(in_srgb,var(--ca-secondary)_10%,transparent)] rounded group-hover:bg-[color-mix(in_srgb,var(--ca-secondary)_20%,transparent)] transition-colors">
        {props.icon}
      </div>
      <span className="block font-mono uppercase tracking-wider text-[11px] font-bold text-[var(--ca-text)] mb-[8px]">{props.title}</span>
      <span className="block text-[var(--ca-text-muted)] text-[13px] leading-relaxed mb-[16px]">{props.body}</span>
      {props.meta ? (
        <div className="flex flex-wrap gap-[6px] mb-[12px]">{props.meta}</div>
      ) : null}
      {props.details ? (
        <div className="template-card-details">{props.details}</div>
      ) : null}
      {props.actionLabel ? (
        <span className="mt-auto text-[var(--ca-accent-text)] text-[12px] font-medium flex items-center gap-[4px] group-hover:translate-x-1 transition-transform">
          {props.actionLabel}
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
        </span>
      ) : null}
    </AppLink>
  );
}

export function CompareStepIndicator(props: { step: 1 | 2 | 3; label: string }) {
  const steps = [
    { n: 1, text: "Choose comparison" },
    { n: 2, text: "Set inputs" },
    { n: 3, text: "Use results" },
  ] as const;

  return (
    <nav aria-label={props.label} className="mb-[24px]">
      <ol className="flex gap-[8px] flex-wrap m-0 p-0 list-none">
        {steps.map((entry) => (
          <li
            className={`flex items-center gap-[8px] px-[12px] py-[8px] text-[12px] rounded-[3px] border ${
              entry.n === props.step
                ? "border-[var(--ca-secondary)] bg-[color-mix(in_srgb,var(--ca-secondary)_10%,transparent)] text-[var(--ca-text)]"
                : entry.n < props.step
                  ? "border-[var(--ca-border-strong)] bg-[var(--ca-surface-raised)] text-[var(--ca-text)]"
                  : "border-[var(--ca-border)] bg-[var(--ca-surface)] text-[var(--ca-text-muted)]"
            }`}
            key={entry.n}
          >
            <span className={`w-[20px] h-[20px] rounded flex items-center justify-center font-bold text-[10px] ${
              entry.n === props.step || entry.n < props.step
                ? "bg-[var(--ca-secondary)] text-[var(--ca-bg)]"
                : "bg-[var(--ca-border-strong)] text-[var(--ca-text-muted)]"
            }`}>{entry.n}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CatalogFilterBar(props: {
  category: string;
  categoryOptions: string[];
  countLabel: string;
  onCategoryChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  query: string;
  queryPlaceholder: string;
}) {
  return (
    <div className="mb-[32px] p-[24px] bg-[var(--ca-surface-raised)] border border-[var(--ca-border-strong)] rounded-[3px]">
      <div className="flex flex-col md:flex-row gap-[16px] md:items-center justify-between mb-[24px]">
        <p className="text-[13px] text-[var(--ca-text)] m-0">{props.countLabel}</p>
        <div className="w-full md:w-[320px]">
          <Input
            aria-label="Search"
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder={props.queryPlaceholder}
            type="search"
            value={props.query}
          />
        </div>
      </div>
      <div
        aria-label="Filter by category"
        className="flex gap-[8px] flex-wrap"
        role="group"
      >
        <button
          className={`inline-flex items-center min-h-[44px] sm:min-h-[26px] px-[12px] py-[4px] border rounded font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer ${
            props.category === ""
              ? "border-[var(--ca-info)] text-[var(--ca-text)] bg-[color-mix(in_srgb,var(--ca-info)_20%,transparent)]"
              : "border-[var(--ca-border-strong)] text-[var(--ca-text)] bg-[var(--ca-surface)] hover:bg-[var(--ca-surface-raised)]"
          }`}
          onClick={() => props.onCategoryChange("")}
        >
          All categories
        </button>
        {props.categoryOptions.map((option) => (
          <button
            key={option}
            className={`inline-flex items-center min-h-[44px] sm:min-h-[26px] px-[12px] py-[4px] border rounded font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer ${
              props.category === option
                ? "border-[var(--ca-info)] text-[var(--ca-text)] bg-[color-mix(in_srgb,var(--ca-info)_20%,transparent)]"
                : "border-[var(--ca-border-strong)] text-[var(--ca-text)] bg-[var(--ca-surface)] hover:bg-[var(--ca-surface-raised)]"
            }`}
            onClick={() => props.onCategoryChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
