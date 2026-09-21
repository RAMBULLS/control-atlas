import { createContext, Fragment, useCallback, useContext, useState, type ReactNode } from "react";
import { RECORD_FACT_LABELS } from "../../shared/record-fact-labels.mjs";
import { isValidSourceTextPresentation } from "../../shared/source-text-presentation.mjs";
import { Button } from "./lsm";
import { copyText, formatRelationshipLabel } from "../lib/pagePrimitives";

/**
 * Publisher-text rendering, shared by every surface that shows what a record
 * actually says.
 *
 * This used to live inside ObjectDetailPage, which is why the Atlas focused
 * record could only ever show a title and a connection count: the renderer for
 * the published statement was not reachable from there. Both surfaces now read
 * the same presentation contract through the same components, so a record says
 * the same thing wherever you meet it.
 */

export type PublisherCitationEntry = { title: string; url: string };

/**
 * Publisher citations for the record currently being rendered.
 *
 * MITRE writes `(Citation: <key>)` into technique prose, where the key is an
 * internal `source_name`. It used to be printed verbatim - 3,272 times across
 * 789 of 874 ATT&CK records - producing text like "...and remote
 * desktop.Source: volexity_0day_sophos_FW Compromised credentials...": a raw
 * identifier in user-facing copy, no link, and a sentence broken by a missing
 * separator.
 *
 * The ingestion now carries each record's own resolved references, so the
 * marker becomes a numbered link the way ATT&CK's own site presents it. A key
 * MITRE never published a reference for renders as nothing at all rather than
 * as a key no reader can follow.
 */
const PublisherCitationContext = createContext<Record<string, PublisherCitationEntry>>({});

function PublisherCitation(props: { citationKey: string }) {
  const citations = useContext(PublisherCitationContext);
  const resolved = citations[props.citationKey];
  const position = Object.keys(citations).indexOf(props.citationKey) + 1;

  // The publisher cited something here. Until the corpus carries the resolved
  // reference the marker stays, unnumbered and unlinked, rather than vanishing:
  // erasing it would quietly drop a fact the publisher wrote. What never
  // appears either way is the internal source_name key.
  if (!resolved) {
    return (
      <cite className="publisher-citation">
        <span aria-label="Publisher cited a source here">[ref]</span>
      </cite>
    );
  }

  const marker = position > 0 ? `[${position}]` : "[ref]";
  return (
    <cite className="publisher-citation">
      {resolved.url ? (
        <a
          aria-label={`Publisher reference: ${resolved.title}`}
          href={resolved.url}
          rel="noopener noreferrer"
          target="_blank"
          title={resolved.title}
        >
          {marker}
        </a>
      ) : (
        <span title={resolved.title}>{marker}</span>
      )}
    </cite>
  );
}

const ODP_PATTERN = /\[(?:Assignment|Selection)[^\]]*\]/g;

const PUBLISHER_INLINE_PATTERN = /(`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\(Citation:\s*[^)]+\)|\[(?:Assignment|Selection)[^\]]*\])/g;

function renderOdpText(text: string): ReactNode {
  if (!text) return text;
  const parts = text.split(ODP_PATTERN);
  const matches = text.match(ODP_PATTERN) || [];
  if (matches.length === 0) return text;
  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (part) nodes.push(<Fragment key={`t-${index}`}>{part}</Fragment>);
    if (index < matches.length) {
      nodes.push(
        <span className="odp-param" key={`m-${index}`}>
          {matches[index]}
        </span>,
      );
    }
  });
  return nodes;
}

function renderPublisherInlineText(text: string): ReactNode {
  if (!text) return text;
  const parts = text.split(PUBLISHER_INLINE_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^\[(?:Assignment|Selection)[^\]]*\]$/.test(part)) {
      return <span className="odp-param" key={`odp-${index}`}>{part}</span>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code className="publisher-inline-code" key={`code-${index}`}>{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return <a href={link[2]} key={`link-${index}`} rel="noopener noreferrer" target="_blank">{link[1]}</a>;
    }
    const citation = part.match(/^\(Citation:\s*([^)]+)\)$/);
    if (citation) {
      return <PublisherCitation citationKey={citation[1].trim()} key={`citation-${index}`} />;
    }
    return <Fragment key={`text-${index}`}>{part}</Fragment>;
  });
}

function CopyableCodeSnippet(props: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="source-code-snippet" data-source-code-snippet>
      <div className="source-code-snippet__header">
        <span>Command or configuration</span>
        <Button
          onClick={() => {
            void copyText(props.value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            });
          }}
          type="button"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <span aria-live="polite" className="visually-hidden">
          {copied ? "Snippet copied to clipboard" : ""}
        </span>
      </div>
      <pre><code>{props.value}</code></pre>
    </div>
  );
}

function SourceTextBlocks(props: { value: string; presentation?: any }) {
  const text = String(props.value || "");
  const resolvedPresentation = isValidSourceTextPresentation(text, props.presentation)
    ? props.presentation
    : { version: 1, blocks: [{ kind: "paragraph", start: 0, end: text.length }] };
  const blocks = resolvedPresentation.blocks;
  const rendered: ReactNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === "code") {
      rendered.push(
        <CopyableCodeSnippet
          key={`code-${block.start}-${index}`}
          value={text.slice(block.start, block.end)}
        />,
      );
      continue;
    }
    if (block.kind === "list") {
      const List = block.ordered ? "ol" : "ul";
      const followingCode = blocks[index + 1]?.kind === "code"
        ? blocks[index + 1]
        : null;
      rendered.push(
        <List
          className={`source-procedure-list${followingCode ? " source-procedure-list--with-code" : ""}`}
          key={`list-${index}`}
        >
          {block.items.map((item: any, itemIndex: number) => {
            const isCodeStep = Boolean(followingCode) && itemIndex === block.items.length - 1;
            return (
              <li className={isCodeStep ? "source-procedure-list__code-step" : undefined} key={`${item.start}-${itemIndex}`}>
                <span>{renderPublisherInlineText(text.slice(item.start, item.end))}</span>
                {isCodeStep && followingCode ? (
                  <CopyableCodeSnippet value={text.slice(followingCode.start, followingCode.end)} />
                ) : null}
              </li>
            );
          })}
        </List>,
      );
      if (followingCode) index += 1;
      continue;
    }
    rendered.push(
      <p key={`paragraph-${block.start}-${index}`}>{renderPublisherInlineText(text.slice(block.start, block.end))}</p>,
    );
  }

  return (
    <div className="source-text-blocks">{rendered}</div>
  );
}

function StructuredPublisherSections(props: { value: any[] }) {
  return (
    <div className="publisher-structured-sections">
      {props.value.map((section, sectionIndex) => (
        <section key={section.id || section.locator || sectionIndex}>
          {section.title ? <h3>{section.title}</h3> : null}
          {(section.structured_content || []).map((block: any, blockIndex: number) => {
            const key = `${section.id || sectionIndex}-${blockIndex}`;
            if (block.type === "ordered_list" || block.type === "unordered_list") {
              const List = block.type === "ordered_list" ? "ol" : "ul";
              return (
                <List className="source-structured-list" key={key}>
                  {(block.items || []).map((item: string, itemIndex: number) => (
                    <li key={`${key}-${itemIndex}`}>{renderPublisherInlineText(item)}</li>
                  ))}
                </List>
              );
            }
            if (block.type === "code") {
              return <CopyableCodeSnippet key={key} value={String(block.text || "")} />;
            }
            return <p key={key}>{renderPublisherInlineText(String(block.text || ""))}</p>;
          })}
        </section>
      ))}
    </div>
  );
}

export function SourceSectionContent(props: { kind: string; value: any; presentation?: any }) {
  if (props.kind === "structured") {
    return <StructuredPublisherSections value={props.value} />;
  }
  if (props.kind === "list") {
    return <ul className="source-structured-list">{props.value.map((item: string) => <li key={item}>{renderPublisherInlineText(item)}</li>)}</ul>;
  }
  if (props.kind === "references") {
    return (
      <ul className="source-structured-list">
        {props.value.map((reference: any, index: number) => {
          const parts = [reference.creator, reference.title, reference.version ? `Version ${reference.version}` : "", reference.index]
            .filter(Boolean);
          const label = parts.join(" · ");
          return (
            <li key={`${label}-${index}`}>
              {reference.location ? (
                <a href={reference.location} rel="noopener noreferrer" target="_blank">{label}</a>
              ) : label}
            </li>
          );
        })}
      </ul>
    );
  }
  if (props.kind === "publisher_mappings") {
    return (
      <ul className="source-structured-list">
        {props.value.map((mapping: any, index: number) => (
          <li key={`${mapping.target_catalog}:${mapping.target_id}:${index}`}>
            <strong>{mapping.target_catalog}</strong>{mapping.target_id ? ` · ${mapping.target_id}` : ""}
            {mapping.relationship_type ? ` · ${formatRelationshipLabel({ relationship_type: mapping.relationship_type })}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "mapping_targets") {
    return (
      <ul className="source-structured-list">
        {props.value.map((mapping: any, index: number) => (
          <li key={`${mapping.kind}:${mapping.target_id}:${index}`}>
            <strong>{mapping.kind}</strong>{mapping.target_id ? ` · ${mapping.target_id}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "objectives") {
    return (
      <ul className="assessment-objectives">
        {props.value.map((objective: any, index: number) => (
          <li key={objective.id || objective.label || index}>
            {objective.label ? <strong>{objective.label}</strong> : null}{" "}
            {renderOdpText(objective.prose)}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "methods") {
    return (
      <ul className="assessment-methods">
        {props.value.map((method: any, index: number) => (
          <li key={method.id || method.method || index}>
            <strong>{method.method}</strong>
            {method.objects?.length ? `: ${method.objects.join("; ")}` : null}
          </li>
        ))}
      </ul>
    );
  }
  if (props.kind === "countermeasures") {
    return (
      <div className="publisher-structured-sections">
        {props.value.map((group: any, index: number) => (
          <section key={`${(group.actors || []).join("-")}-${index}`}>
            <h3>{(group.actors || ["Unspecified"]).join(" · ")}</h3>
            <ul className="source-structured-list">
              {(group.actions || []).map((action: string, actionIndex: number) => (
                <li key={`${index}-${actionIndex}`}>{renderOdpText(action)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }
  return <SourceTextBlocks value={String(props.value)} presentation={props.presentation} />;
}

/**
 * A published fact is rendered in the reader's language, never as a raw
 * internal value. `String(false)` used to reach the page as the literal text
 * "false" under a heading reading "Published facts", and a list of publisher
 * objects came out as "0: [object Object]".
 */
function formatFactValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          return String(record.title || record.label || record.name || record.id || "");
        }
        return String(entry ?? "");
      })
      .filter(Boolean)
      .join(" · ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, count]) => `${key}: ${count}`).join(" · ");
  }
  return String(value);
}

export function RecordNativeFacts(props: { fields: string[]; metadata: Record<string, any>; title: string }) {
  const rows = props.fields.flatMap((field) => {
    const value = props.metadata[field];
    const absenceReason = props.metadata.field_absence_reasons?.[field];
    if ((value == null || value === "" || (Array.isArray(value) && value.length === 0)) && !absenceReason) return [];
    const displayValue = absenceReason
      ? `Not published — ${absenceReason}`
      : formatFactValue(value);
    if (!displayValue) return [];
    return [{ field, displayValue }];
  });
  if (!rows.length) return null;
  return (
    <section className="record-native-facts" data-record-section="native-facts">
      <h2>{props.title}</h2>
      <dl className="record-source-facts">
        {rows.map(({ field, displayValue }) => (
          <div key={field}>
            <dt>{RECORD_FACT_LABELS[field] || field}</dt>
            <dd>{displayValue}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type PublishedSection = { field: string; heading: string; kind: string };

function sectionHasContent(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
}

/**
 * The published sections that actually carry text for this record, in contract
 * order. Callers use this both to decide whether there is anything to show and
 * to take the first section when space is tight.
 */
export function publishedSectionsWithContent(
  sections: PublishedSection[],
  metadata: Record<string, any>,
): PublishedSection[] {
  return sections.filter((section) => sectionHasContent(metadata[section.field]));
}

/**
 * Render a record's published text.
 *
 * `limit` caps how many sections render, for surfaces where the record's text
 * is supporting context rather than the main event. The caller is responsible
 * for telling the reader that more text exists — silently truncating published
 * source text without a route to the rest is how the Atlas ended up looking
 * like it had no text at all.
 */
export function RecordPublishedText(props: {
  sections: PublishedSection[];
  metadata: Record<string, any>;
  claimOrigin?: string;
  headingLevel?: 2 | 3;
  limit?: number;
}) {
  const visible = publishedSectionsWithContent(props.sections, props.metadata);
  const shown = typeof props.limit === "number" ? visible.slice(0, props.limit) : visible;
  if (!shown.length) return null;
  const Heading = (props.headingLevel === 3 ? "h3" : "h2") as "h2" | "h3";
  return (
    <PublisherCitationContext.Provider value={props.metadata.citations || {}}>
    <div
      className="record-official-text"
      data-claim-origin={props.claimOrigin}
      data-record-section="official-text"
      data-source-text="published"
    >
      {shown.map((section) => (
        <section data-source-field={section.field} id={`section-${section.field}`} key={section.field}>
          <Heading>{section.heading}</Heading>
          <SourceSectionContent
            kind={section.kind}
            presentation={props.metadata.source_text_presentation?.[section.field]}
            value={props.metadata[section.field]}
          />
        </section>
      ))}
    </div>
    </PublisherCitationContext.Provider>
  );
}

/**
 * A bounded preview of a record's published text, for surfaces where the text
 * answers "what does this say" but must not take the stage.
 *
 * The Atlas needed this the moment it started showing real text: SP 800-53
 * AC-2's control statement is 1,411 characters, which rendered 568px tall and
 * pushed the connection graph — the reason the Atlas exists — nearly 400px
 * below the fold. The preview clamps to a few lines and then says, in words,
 * exactly what is not being shown, because a fade alone is not a claim a
 * reader can act on.
 */
export function RecordPublishedTextPreview(props: {
  sections: PublishedSection[];
  metadata: Record<string, any>;
  claimOrigin?: string;
  headingLevel?: 2 | 3;
  /** Where the reader gets the rest, named for the note. */
  fullRecordLabel: string;
}) {
  const [clamped, setClamped] = useState(false);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setClamped(node.scrollHeight - node.clientHeight > 4);
  }, []);

  const visible = publishedSectionsWithContent(props.sections, props.metadata);
  if (!visible.length) return null;
  const [lead, ...rest] = visible;
  const remaining = rest.map((section) => section.heading);
  const missing = [
    clamped ? `the rest of the ${lead.heading.toLocaleLowerCase()}` : "",
    ...remaining,
  ].filter(Boolean);

  return (
    <>
      <div
        className="record-published-preview"
        data-clamped={clamped ? "true" : undefined}
        ref={measure}
      >
        <RecordPublishedText
          claimOrigin={props.claimOrigin}
          headingLevel={props.headingLevel}
          limit={1}
          metadata={props.metadata}
          sections={props.sections}
        />
      </div>
      {missing.length ? (
        <p className="atlas-focused-more-text">
          On {props.fullRecordLabel}: {missing.join(", ")}.
        </p>
      ) : null}
    </>
  );
}
