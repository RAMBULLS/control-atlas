import * as Dialog from "@radix-ui/react-dialog";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { practitionerGuides } from "../../app/learn-content.mjs";
import { requestSearchResultsFocus } from "../../shared/navigation-events";
import { GLOBAL_SEARCH_PLACEHOLDER } from "../../shared/product-identity";
import { TAXONOMY_TAGS, taxonomyTagMatchesQuery } from "../../shared/taxonomy-contract.mjs";
import { AtlasTag } from "./AtlasTag";
import { catalogDisplayNameFor } from "../lib/catalogProfiles";
import {
  recordIdentityPresentationFor,
  recordPublisherName,
} from "../lib/recordTitle";
import {
  MarkedSearchText,
  searchPreviewText,
} from "../lib/searchPresentation";
import {
  resourceAccessLabel,
  resourceTypeLabel,
} from "../lib/resourceBrands.mjs";
import { searchResourceDocuments } from "../lib/resourceSearch.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { AppLink, type AppNavigate } from "./AppLink";

type SearchOverlayProps = {
  bundle: RuntimeBundle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: AppNavigate;
  onOpenNode: (nodeId: string) => void;
};

export function SearchOverlay(props: SearchOverlayProps) {
  const { bundle, open, onOpenChange, onNavigate, onOpenNode } = props;
  const [query, setQuery] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const composingRef = useRef(false);
  const focusSearchResultsOnCloseRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSubmitStatus("");
      setHighlightedIndex(-1);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!bundle || !query.trim()) {
      return {
        libraryResults: [],
        resourceResults: [],
        communityResults: [],
        guideResults: [],
        sourceResults: [],
      };
    }
    const libraryResults = bundle.runtime.searchLibrary(query.trim()).slice(0, 8);
    const commonsResults = searchResourceDocuments(
      bundle.commonsSearchIndex?.documents || [],
      query,
      8,
    ).map((entry) => entry.document);
    const resourceResults = commonsResults
      .filter((document) => document.resourceType !== "community_forum")
      .slice(0, 4);
    const communityResults = commonsResults
      .filter((document) => document.resourceType === "community_forum")
      .slice(0, 4);
    const needle = query.trim().toLowerCase();
    const guideResults = practitionerGuides
      .filter((guide) =>
        [guide.title, guide.summary, guide.whereItSits]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 3);
    const sourceResults = (bundle.runtime.dataset.sources || [])
      .filter((source: any) =>
        [source.id, source.display_name, source.name, source.publisher]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 3);

    const matchingTags = needle.length >= 2
      ? TAXONOMY_TAGS.filter((tag: any) => taxonomyTagMatchesQuery(tag, needle)).slice(0, 3)
      : [];

    return {
      libraryResults,
      resourceResults,
      communityResults,
      guideResults,
      sourceResults,
      matchingTags,
    };
  }, [bundle, query]);

  const suggestions = useMemo(() => [
    ...results.libraryResults.map((document: any) => ({ id: document.id, kind: "library" })),
    ...results.guideResults.map((guide) => ({ id: guide.id, kind: "guide" })),
    ...results.sourceResults.map((source: any) => ({ id: source.id, kind: "source" })),
    ...results.resourceResults.map((document) => ({ id: document.id, kind: "resource" })),
    ...results.communityResults.map((document) => ({ id: document.id, kind: "community" })),
  ], [results]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query]);

  function openResult(nodeId: string) {
    onOpenChange(false);
    onOpenNode(nodeId);
  }

  function openCommonsResult(id: string) {
    onOpenChange(false);
    onNavigate("commons-detail", { id });
  }

  function openExplore() {
    focusSearchResultsOnCloseRef.current = true;
    onOpenChange(false);
    onNavigate("search", { query: query.trim() });
  }

  function activateSuggestion(suggestion: { id: string; kind: string }) {
    if (suggestion.kind === "library") {
      openResult(suggestion.id);
      return;
    }
    if (suggestion.kind === "guide") {
      onOpenChange(false);
      onNavigate("patterns", { pattern: suggestion.id });
      return;
    }
    if (suggestion.kind === "source") {
      onOpenChange(false);
      onNavigate("sources", { source: suggestion.id });
      return;
    }
    openCommonsResult(suggestion.id);
  }

  function submitSearch() {
    if (composingRef.current) return;
    if (!query.trim()) {
      setSubmitStatus("Enter an identifier, title, or topic to search.");
      return;
    }
    const highlightedSuggestion = suggestions[highlightedIndex];
    if (highlightedSuggestion) {
      activateSuggestion(highlightedSuggestion);
      return;
    }
    // Enter must not discard known resource matches in favor of an empty
    // records-only page. Explicit Library and Resources links remain available.
    if (bundle?.librarySearchReady && results.libraryResults.length === 0
      && (results.resourceResults.length > 0 || results.communityResults.length > 0)) {
      onOpenChange(false);
      onNavigate("commons", { query: query.trim(), showAll: "true" }, true);
      return;
    }
    openExplore();
  }

  function suggestionIndex(kind: string, id: string) {
    return suggestions.findIndex(
      (suggestion) => suggestion.kind === kind && suggestion.id === id,
    );
  }

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay search-overlay-backdrop" />
        <Dialog.Content
          aria-label="Search Control Atlas"
          className="search-overlay"
          onCloseAutoFocus={(event) => {
            if (focusSearchResultsOnCloseRef.current) {
              focusSearchResultsOnCloseRef.current = false;
              event.preventDefault();
              requestSearchResultsFocus();
              return;
            }
            event.preventDefault();
            const trigger = document.querySelector<HTMLElement>(".header-search-trigger");
            trigger?.focus();
          }}
        >
          <form
            className="search-overlay-header"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
            role="search"
          >
            <Dialog.Title className="visually-hidden">
              Search Control Atlas
            </Dialog.Title>
            <div className="search-input search-overlay-input">
              <IconSearch aria-hidden="true" size={18} stroke={1.8} />
              <input
                aria-activedescendant={highlightedIndex >= 0 ? `search-suggestion-${highlightedIndex}` : undefined}
                aria-label="Search Control Atlas"
                autoFocus
                id="global-search-query"
                name="query"
                onChange={(event) => { setQuery(event.target.value); setSubmitStatus(""); }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onCompositionStart={() => { composingRef.current = true; }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !composingRef.current) {
                    event.preventDefault();
                    submitSearch();
                    return;
                  }
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  if (suggestions.length === 0) return;
                  setHighlightedIndex((current) => {
                    if (event.key === "ArrowDown") return (current + 1) % suggestions.length;
                    return current <= 0 ? suggestions.length - 1 : current - 1;
                  });
                }}
                placeholder={GLOBAL_SEARCH_PLACEHOLDER}
                type="search"
                value={query}
              />
              {query ? (
                <button aria-label="Clear search" className="search-overlay-clear" onClick={() => { setQuery(""); setSubmitStatus(""); }} type="button">
                  Clear
                </button>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close search" className="icon-button" type="button">
                <IconX aria-hidden="true" size={18} stroke={1.8} />
              </button>
            </Dialog.Close>
            {/* Submit control for implicit Enter submission, kept out of the
                tab order so it is not an invisible stop between the input and
                the results. */}
            <button className="visually-hidden" tabIndex={-1} type="submit">Search</button>
          </form>
          <span aria-live="polite" className="visually-hidden" role="status">{submitStatus}</span>

          {!bundle ? (
            <p className="field-hint">Loading public data…</p>
          ) : !query.trim() ? (
            <div className="search-overlay-empty-hint">
              <p className="field-hint">{GLOBAL_SEARCH_PLACEHOLDER}</p>
              <p className="search-overlay-shortcut-hint">
                <kbd>Ctrl</kbd><span>+</span><kbd>K</kbd> opens search from anywhere. <kbd>Esc</kbd> closes it.
              </p>
            </div>
          ) : results.libraryResults.length === 0 && results.resourceResults.length === 0 && results.communityResults.length === 0 && results.guideResults.length === 0 && results.sourceResults.length === 0 && results.matchingTags.length === 0 ? (
            <p className="field-hint">
              No records or resources match &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <div className="search-overlay-results-container space-y-4">
              {results.matchingTags.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Matching tags
                  </div>
                  <div className="related-in-atlas__tags" style={{ padding: "0 var(--ca-space-sm)" }}>
                    {results.matchingTags.map((tag: any) => (
                      <AtlasTag key={tag.id} onNavigate={onNavigate} showIdentity showType size="sm" tagId={tag.id} />
                    ))}
                  </div>
                </div>
              ) : null}
              {results.libraryResults.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Records ({results.libraryResults.length})
                  </div>
                  <ul className="search-overlay-results">
                    {results.libraryResults.map((document: any) => {
                      const index = suggestionIndex("library", document.id);
                      const source = bundle?.runtime.getSource(document.source_id);
                      const publisher = recordPublisherName(
                        document.publisher_name,
                        source?.owner,
                        source?.publisher,
                      );
                      const catalog = bundle?.runtime
                        .getCatalogs()
                        .find((entry: any) => entry.id === document.catalog_id);
                      const publication = catalogDisplayNameFor(
                        document.catalog_id || "",
                        catalog?.name || document.catalog_name || "",
                      );
                      const identity = recordIdentityPresentationFor({
                        publisher,
                        catalogId: document.catalog_id || "",
                        publicationName: publication,
                        family: document.control_family || "",
                        itemId: document.item_id || "",
                        title: document.title || "",
                        objectType: document.object_type || "",
                        metadata: { identity_category: document.identity_category || "" },
                      });
                      const title = identity.primary;
                      const publishedName = identity.secondary;
                      return (
                        <li key={document.id}>
                          <AppLink
                            aria-label={`Open ${identity.accessibleName}`}
                            className={`search-overlay-result${highlightedIndex === index ? " is-highlighted" : ""}`}
                            id={`search-suggestion-${index}`}
                            onFocus={() => setHighlightedIndex(index)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onNavigate={onNavigate}
                            patch={{ node: document.id }}
                            view="library-detail"
                          >
                            <h3 className="search-overlay-result-title">
                              <MarkedSearchText query={query} text={title} />
                            </h3>
                            <span className="search-overlay-result-meta">
                              {identity.stableIdIsGenerated
                                ? identity.context
                                : `${publishedName ? `${publishedName} · ` : ""}${displayNameFor("object_type", document.object_type)}`}
                            </span>
                            {searchPreviewText(document) ? <span className="search-overlay-result-summary">
                              <MarkedSearchText query={query} text={searchPreviewText(document)} />
                            </span> : null}
                          </AppLink>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {results.guideResults.length > 0 ? (
                <div data-result-class="practitioner-guide">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Guides ({results.guideResults.length})
                  </div>
                  <ul className="search-overlay-results">
                    {results.guideResults.map((guide) => {
                      const index = suggestionIndex("guide", guide.id);
                      return <li key={guide.id}>
                        <AppLink
                          aria-label={guide.title}
                          className={`search-overlay-result${highlightedIndex === index ? " is-highlighted" : ""}`}
                          id={`search-suggestion-${index}`}
                          onFocus={() => setHighlightedIndex(index)}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onNavigate={onNavigate}
                          patch={{ pattern: guide.id }}
                          view="patterns"
                        >
                          <h3 className="search-overlay-result-title"><MarkedSearchText query={query} text={guide.title} /></h3>
                          <span className="search-overlay-result-meta">Guide</span>
                          <span className="search-overlay-result-summary"><MarkedSearchText query={query} text={guide.summary} /></span>
                        </AppLink>
                      </li>;
                    })}
                  </ul>
                </div>
              ) : null}

              {results.sourceResults.length > 0 ? (
                <div data-result-class="provenance-source">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Sources ({results.sourceResults.length})
                  </div>
                  <ul className="search-overlay-results">
                    {results.sourceResults.map((source: any) => {
                      const index = suggestionIndex("source", source.id);
                      const publisher = recordPublisherName(source.publisher, source.agency, source.owner, source.display_group);
                      return <li key={source.id}>
                        <AppLink
                          aria-label={source.display_name || source.name || source.id}
                          className={`search-overlay-result${highlightedIndex === index ? " is-highlighted" : ""}`}
                          id={`search-suggestion-${index}`}
                          onFocus={() => setHighlightedIndex(index)}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onNavigate={onNavigate}
                          patch={{ source: source.id }}
                          view="sources"
                        >
                          <h3 className="search-overlay-result-title">
                            <MarkedSearchText query={query} text={source.display_name || source.name || source.id} />
                          </h3>
                          <span className="search-overlay-result-meta">
                            {publisher}
                          </span>
                        </AppLink>
                      </li>;
                    })}
                  </ul>
                </div>
              ) : null}

              {results.resourceResults.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Tools and resources ({results.resourceResults.length})
                  </div>
                  <ul className="search-overlay-results">
                    {results.resourceResults.map((doc) => {
                      const index = suggestionIndex("resource", doc.id);
                      return <li key={doc.id}>
                        <AppLink
                          aria-label={doc.name}
                          className={`search-overlay-result${highlightedIndex === index ? " is-highlighted" : ""}`}
                          id={`search-suggestion-${index}`}
                          onFocus={() => setHighlightedIndex(index)}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onNavigate={onNavigate}
                          patch={{ id: doc.id }}
                          view="commons-detail"
                        >
                          <h3 className="search-overlay-result-title">
                            <MarkedSearchText query={query} text={doc.name} />
                          </h3>
                          <span className="search-overlay-result-meta">
                            {[resourceTypeLabel(doc.resourceType), resourceAccessLabel(doc)].filter(Boolean).join(" · ")}
                          </span>
                          <span className="search-overlay-result-summary">
                            <MarkedSearchText query={query} text={doc.summary} />
                          </span>
                        </AppLink>
                      </li>;
                    })}
                  </ul>
                </div>
              ) : null}

              {results.communityResults.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ca-text-muted)] mb-2 px-3">
                    Communities ({results.communityResults.length})
                  </div>
                  <ul className="search-overlay-results">
                    {results.communityResults.map((doc) => {
                      const index = suggestionIndex("community", doc.id);
                      return <li key={doc.id}>
                        <AppLink
                          aria-label={doc.name}
                          className={`search-overlay-result${highlightedIndex === index ? " is-highlighted" : ""}`}
                          id={`search-suggestion-${index}`}
                          onFocus={() => setHighlightedIndex(index)}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onNavigate={onNavigate}
                          patch={{ id: doc.id }}
                          view="commons-detail"
                        >
                          <h3 className="search-overlay-result-title">
                            <MarkedSearchText query={query} text={doc.name} />
                          </h3>
                          <span className="search-overlay-result-meta">
                            {[resourceTypeLabel(doc.resourceType), resourceAccessLabel(doc)].filter(Boolean).join(" · ")}
                          </span>
                          <span className="search-overlay-result-summary">
                            <MarkedSearchText query={query} text={doc.summary} />
                          </span>
                        </AppLink>
                      </li>;
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {query.trim() ? (
            <div className="card-actions flex flex-wrap gap-2">
              <AppLink onNavigate={onNavigate} patch={{ query: query.trim() }} variant="secondary" view="search">
                Search Library records
              </AppLink>
              <AppLink onNavigate={onNavigate} patch={{ query: query.trim(), showAll: "true" }} variant="secondary" view="commons">
                Search Resources
              </AppLink>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
