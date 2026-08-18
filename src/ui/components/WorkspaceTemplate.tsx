import * as Dialog from "@radix-ui/react-dialog";
import {
  IconAdjustmentsHorizontal,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import { CLOSE_OVERLAYS_EVENT } from "../../shared/navigation-events";
import { PageHeader } from "../lib/pagePrimitives";

export type WorkspaceSortOption = {
  label: string;
  value: string;
};

export type WorkspaceViewOption = {
  icon?: ReactNode;
  label: string;
  value: string;
};

export function TypeaheadFacet(props: {
  id: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  if (props.options.length === 0) return null;

  const selected = props.options.find((option) => option.value === props.value);
  const [draft, setDraft] = useState(selected?.label || "");

  useEffect(() => setDraft(selected?.label || ""), [selected?.label]);

  const commit = () => {
    const normalized = draft.trim().toLocaleLowerCase();
    const match = props.options.find(
      (option) =>
        option.label.toLocaleLowerCase() === normalized ||
        option.value.toLocaleLowerCase() === normalized,
    );
    props.onChange(match?.value || "");
    setDraft(match?.label || "");
  };

  return (
    <label className="workspace-typeahead" htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        autoComplete="off"
        id={props.id}
        list={`${props.id}-options`}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        placeholder={`Find ${props.label.toLocaleLowerCase()}`}
        type="text"
        value={draft}
      />
      <datalist id={`${props.id}-options`}>
        {props.options.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
    </label>
  );
}

export function CheckboxFacet(props: {
  label: string;
  options: Array<{ count?: number; label: ReactNode; textLabel: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <fieldset className="workspace-checkbox-facet">
      <legend>{props.label}</legend>
      {props.options.map((option) => (
        <label key={option.value}>
          <input
            checked={props.value === option.value}
            onChange={(event) => props.onChange(event.target.checked ? option.value : "")}
            type="checkbox"
          />
          <span>{option.label}</span>
          {typeof option.count === "number" ? (
            <small aria-hidden="true">
              {option.count.toLocaleString()}
            </small>
          ) : null}
        </label>
      ))}
    </fieldset>
  );
}

export function TagFacet(props: {
  label: string;
  options: Array<{ aliases: string[]; count: number; label: string; value: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = props.options.filter((option) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [option.label, option.value, ...option.aliases]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });

  if (props.options.length === 0) return null;


  return (
    <fieldset className="workspace-checkbox-facet workspace-tag-facet">
      <legend>{props.label}</legend>
      <label className="workspace-tag-facet__search">
        <span className="visually-hidden">Search {props.label.toLocaleLowerCase()} tags</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Find ${props.label.toLocaleLowerCase()}`}
          type="search"
          value={query}
        />
      </label>
      {visible.map((option) => {
        const checked = props.selected.includes(option.value);
        return (
          <label key={option.value}>
            <input
              checked={checked}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...props.selected, option.value]
                  : props.selected.filter((value) => value !== option.value);
                props.onChange([...new Set(next)].sort());
              }}
              type="checkbox"
            />
            <span>{option.label}</span>
            <small aria-hidden="true">{option.count.toLocaleString()}</small>
          </label>
        );
      })}
    </fieldset>
  );
}

export function WorkspaceTemplate(props: {
  activeFilters?: ReactNode;
  children: ReactNode;
  compareControl?: ReactNode;
  renderFacets: (scope: "desktop" | "mobile") => ReactNode;
  facetLabel: string;
  headerAction?: ReactNode;
  onClearQuery: () => void;
  onQueryDraftChange: (value: string) => void;
  onSearch: () => void;
  onSortChange: (value: string) => void;
  onViewChange?: (value: string) => void;
  purpose: string;
  queryDraft: string;
  resultCountLabel: string;
  resultsId: string;
  searchLabel: string;
  searchPlaceholder: string;
  showResultBar: boolean;
  sortLabel: string;
  sortOptions: WorkspaceSortOption[];
  sortValue: string;
  title: string;
  viewLabel?: string;
  viewOptions?: WorkspaceViewOption[];
  viewValue?: string;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const closeFilters = () => setFiltersOpen(false);
    window.addEventListener(CLOSE_OVERLAYS_EVENT, closeFilters);
    return () => window.removeEventListener(CLOSE_OVERLAYS_EVENT, closeFilters);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="workspace-template" data-page-template="workspace">
      <PageHeader action={props.headerAction} primary summary={props.purpose} title={props.title} />

      <form className="workspace-search" onSubmit={submit} role="search">
        <label>
          <IconSearch aria-hidden="true" size={18} />
          <input
            aria-label={props.searchLabel}
            onChange={(event) => props.onQueryDraftChange(event.target.value)}
            placeholder={props.searchPlaceholder}
            type="search"
            value={props.queryDraft}
          />
        </label>
        {props.queryDraft ? (
          <button
            aria-label={`Clear ${props.title} search`}
            className="workspace-search__clear"
            onClick={props.onClearQuery}
            type="button"
          >
            <IconX aria-hidden="true" size={17} />
          </button>
        ) : null}
        <button className="workspace-search__submit" type="submit">Search</button>
      </form>

      {props.showResultBar ? (
        <div className="workspace-result-bar" data-result-bar-order="count,sort,view,compare">
          <p aria-live="polite" className="workspace-result-count" role="status">
            {props.resultCountLabel}
          </p>
          <label className="workspace-sort">
            <span>Sort</span>
            <select
              aria-label={props.sortLabel}
              onChange={(event) => props.onSortChange(event.target.value)}
              value={props.sortValue}
            >
              {props.sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {props.viewOptions?.length && props.onViewChange ? (
            <div aria-label={props.viewLabel} className="workspace-view-toggle" role="group">
              {props.viewOptions.map((option) => (
                <button
                  aria-pressed={props.viewValue === option.value}
                  key={option.value}
                  onClick={() => props.onViewChange?.(option.value)}
                  type="button"
                >
                  {option.icon}{option.label}
                </button>
              ))}
            </div>
          ) : <span className="workspace-result-bar__spacer" />}
          <div className="workspace-compare-control">{props.compareControl}</div>
        </div>
      ) : null}

      {props.activeFilters}

      <Dialog.Root onOpenChange={setFiltersOpen} open={filtersOpen}>
        <Dialog.Trigger asChild>
          <button className="button button--secondary workspace-mobile-filter-button" type="button">
            <IconAdjustmentsHorizontal aria-hidden="true" size={17} /> Filters
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="workspace-filter-overlay" />
          <Dialog.Content className="workspace-filter-sheet">
            <header>
              <div>
                <p className="eyebrow">{props.title}</p>
                <Dialog.Title>{props.facetLabel}</Dialog.Title>
              </div>
              <Dialog.Close aria-label="Close filters" type="button">
                <IconX aria-hidden="true" size={20} />
              </Dialog.Close>
            </header>
            <div className="workspace-filter-sheet__body">{props.renderFacets("mobile")}</div>
            <footer>
              <Dialog.Close className="button button--primary" type="button">Show results</Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="workspace-layout">
        <aside aria-label={props.facetLabel} className="workspace-facet-rail">
          <div className="workspace-facet-heading"><strong>{props.facetLabel}</strong></div>
          {props.renderFacets("desktop")}
        </aside>
        <div className="workspace-results" id={props.resultsId} tabIndex={-1}>{props.children}</div>
      </div>
    </section>
  );
}
