import { createElement, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RECORD_FACT_LABELS } from "../../shared/record-fact-labels.mjs";

import { publisherSection, publisherTextModel, publisherFactRows, publishedSectionsWithContent, type PublisherNode, type PublishedSection } from "../../shared/publisher-text-model";
import { adoptPublisherText, hasPublisherText } from "../lib/publisherRecordOwner";

import { Button } from "./lsm";
import { copyText } from "../lib/pagePrimitives";
export { publishedSectionsWithContent } from "../../shared/publisher-text-model";
export type PublisherCitationEntry = { title: string; url: string };
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

function publisherNodeToReact(value: PublisherNode, key: number): ReactNode {
  if (typeof value === "string") return value;
  if (value.tag === "snippet") return <CopyableCodeSnippet key={key} value={value.attributes.value} />;
  const { class: className, ...attributes } = value.attributes;
  return createElement(value.tag, { ...attributes, className, key }, value.children.map(publisherNodeToReact));
}

export function SourceSectionContent(props: { kind: string; value: any; presentation?: any }) {
  return <>{publisherSection(props.kind, props.value, props.presentation).map(publisherNodeToReact)}</>;
}
/**
 * A published fact is rendered in the reader's language, never as a raw
 * internal value. `String(false)` used to reach the page as the literal text
 * "false" under a heading reading "Published facts", and a list of publisher
 * objects came out as "0: [object Object]".
 */
export function RecordNativeFacts(props: { fields: string[]; metadata: Record<string, any>; title: string }) {
  const rows = publisherFactRows(props.fields, props.metadata);
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
  recordId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const retained = Boolean(props.recordId && hasPublisherText(props.recordId));
  useLayoutEffect(() => {
    if (props.recordId && host.current) adoptPublisherText(props.recordId, host.current);
  }, [props.recordId]);
  const visible = publishedSectionsWithContent(props.sections, props.metadata);
  const shown = typeof props.limit === "number" ? visible.slice(0, props.limit) : visible;
  if (retained) return <div key={props.recordId} ref={host} className="publisher-text-owner" style={{ display: "contents" }} />;
  if (!shown.length) return null;
  return publisherNodeToReact(publisherTextModel(shown, props.metadata, props.headingLevel, props.claimOrigin), 0);
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
