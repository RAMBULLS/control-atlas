import { displayNameFor } from '../app/display-names.mjs';
import { parseControlContext } from './record-control-context.mjs';
import { isValidSourceTextPresentation } from './source-text-presentation.mjs';
import { translateMicrosoftZtCategory } from './microsoft-zt-category-labels.mjs';
import { RECORD_FACT_LABELS } from './record-fact-labels.mjs';
import { formatSourceDate } from '../ui/lib/sourcePresentation';
import { CONTROL_CONTEXT_RELATIONSHIP_TYPE } from './record-control-context.mjs';
import { recordDisplayTitle } from '../ui/lib/publisherRecordIdentity';
import { recordShowsChildInventory } from './record-acceptance.mjs';
import { PAGE_ROLES } from './record-presentation.mjs';
import { atlasHashForId, recordHashForId } from './record-route-identity';
import { sourcePublicationTitle } from '../ui/lib/sourcePresentation';

export type PublisherNode = string | {
  tag: string;
  attributes: Record<string, string>;
  children: PublisherNode[];
};
export type PublishedSection = { field: string; heading: string; kind: string };
type Metadata = Record<string, any>;
const node = (tag: string, attributes: Record<string, string>, ...children: Array<PublisherNode | PublisherNode[]>): PublisherNode =>
  ({ tag, attributes, children: children.flat() });
const external = (href: string) => ({ href, rel: 'noopener noreferrer', target: '_blank' });
const label = (type: string) => displayNameFor('relationship_type', type);
const inlinePattern = /(`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\(Citation:\s*[^)]+\)|\[(?:Assignment|Selection)[^\]]*\])/g;

/** The same source-preserving tree is consumed by native DOM and React. */
export function publisherInline(text: string, citations: Metadata = {}): PublisherNode[] {
  return String(text || '').split(inlinePattern).filter(Boolean).map(part => {
    if (/^\[(?:Assignment|Selection)[^\]]*\]$/.test(part)) return node('span', { class: 'odp-param' }, part);
    if (part.startsWith('`') && part.endsWith('`')) return node('code', { class: 'publisher-inline-code' }, part.slice(1, -1));
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return node('a', external(link[2]), link[1]);
    const citation = part.match(/^\(Citation:\s*([^)]+)\)$/);
    if (!citation) return part;
    const key = citation[1].trim();
    const resolved = citations[key];
    if (!resolved) return node('cite', { class: 'publisher-citation' }, node('span', { 'aria-label': 'Publisher cited a source here' }, '[ref]'));
    const position = Object.keys(citations).indexOf(key) + 1;
    const marker = position > 0 ? `[${position}]` : '[ref]';
    return node('cite', { class: 'publisher-citation' }, resolved.url
      ? node('a', { ...external(resolved.url), 'aria-label': `Publisher reference: ${resolved.title}`, title: resolved.title }, marker)
      : node('span', { title: resolved.title }, marker));
  });
}

function publisherParameters(text: string): PublisherNode[] {
  return String(text || '').split(/(\[(?:Assignment|Selection)[^\]]*\])/g).filter(Boolean).map(part =>
    /^\[(?:Assignment|Selection)[^\]]*\]$/.test(part) ? node('span', { class: 'odp-param' }, part) : part);
}

function textBlocks(text: string, presentation: any, citations: Metadata): PublisherNode {
  const blocks = isValidSourceTextPresentation(text, presentation) && (!text || presentation.blocks.length > 0)
    ? presentation.blocks : [{ kind: 'paragraph', start: 0, end: text.length }];
  const result: PublisherNode[] = [];
  const snippet = (value: string) => node('snippet', { value });
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind === 'code') result.push(snippet(text.slice(block.start, block.end)));
    else if (block.kind === 'list') {
      const following = blocks[index + 1]?.kind === 'code' ? blocks[index + 1] : null;
      result.push(node(block.ordered ? 'ol' : 'ul', { class: `source-procedure-list${following ? ' source-procedure-list--with-code' : ''}` },
        block.items.map((item: any, itemIndex: number) => {
          const codeStep = following && itemIndex === block.items.length - 1;
          return node('li', codeStep ? { class: 'source-procedure-list__code-step' } : {},
            node('span', {}, publisherInline(text.slice(item.start, item.end), citations)),
            codeStep ? [snippet(text.slice(following.start, following.end))] : []);
        })));
      if (following) index++;
    } else result.push(node('p', {}, publisherInline(text.slice(block.start, block.end), citations)));
  }
  return node('div', { class: 'source-text-blocks' }, result);
}

export function publisherSection(kind: string, value: any, presentation?: any, citations: Metadata = {}): PublisherNode[] {
  const list = (items: PublisherNode[]) => [node('ul', { class: 'source-structured-list' }, items)];
  const item = (...children: Array<PublisherNode | PublisherNode[]>) => node('li', {}, ...children);
  const inline = (text: string) => publisherInline(text, citations);
  if (kind === 'control_parameters') {
    const entries = parseControlContext(String(value || ''));
    if (!entries.some(entry => entry.kind === 'parameter')) return [textBlocks(String(value || ''), presentation, citations)];
    const groups: Array<typeof entries> = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      if (last && last[0].kind === entry.kind && entry.kind === 'parameter') last.push(entry);
      else groups.push([entry]);
    }
    return groups.flatMap(group => group[0].kind === 'parameter'
      ? list(group.flatMap(entry => entry.kind === 'parameter' ? [item(node('strong', {}, entry.label), ` - ${entry.value} `,
        node('code', { 'aria-label': `Publisher identifier ${entry.id}` }, entry.id))] : []))
      : group.flatMap(entry => entry.kind === 'guidance' ? [node('p', {}, entry.text)] : []));
  }
  if (kind === 'structured') return [node('div', { class: 'publisher-structured-sections' }, value.map((section: any) =>
    node('section', {}, section.title ? [node('h3', {}, section.title)] : [],
      (section.structured_content || []).map((block: any) => {
        if (block.type === 'ordered_list' || block.type === 'unordered_list') return node(block.type === 'ordered_list' ? 'ol' : 'ul',
          { class: 'source-structured-list' }, (block.items || []).map((text: string) => item(inline(text))));
        if (block.type === 'code') return node('snippet', { value: String(block.text || '') });
        return node('p', {}, inline(String(block.text || '')));
      }))))];
  if (kind === 'list') return list(value.map((text: string) => item(inline(text))));
  if (kind === 'references') return list(value.map((reference: any) => {
    const text = [reference.creator, reference.title, reference.version ? `Version ${reference.version}` : '', reference.index].filter(Boolean).join(' · ');
    return item(reference.location ? node('a', external(reference.location), text) : text);
  }));
  if (kind === 'publisher_mappings') return list(value.map((mapping: any) => item(node('strong', {}, mapping.target_catalog),
    mapping.target_id ? ` · ${mapping.target_id}` : '', mapping.relationship_type ? ` · ${label(mapping.relationship_type)}` : '')));
  if (kind === 'mapping_targets') return list(value.map((mapping: any) => item(node('strong', {}, displayNameFor('zt_mapping_kind', mapping.kind)),
    mapping.target_id ? ` · ${mapping.target_id}` : '', mapping.relationship_clauses?.length
      ? ` · ${mapping.relationship_clauses.map((clause: any) => `${label(clause.relationship_type)}${clause.property ? ` (${clause.property})` : ''}`).join('; ')}`
      : mapping.relationship_parse_status === 'unresolved' ? ' · Relationship not specified in the source cell.' : '')));
  if (kind === 'objectives') return [node('ul', { class: 'assessment-objectives' }, value.map((objective: any) =>
    item(objective.label ? [node('strong', {}, objective.label)] : [], ' ', publisherParameters(objective.prose))))];
  if (kind === 'methods') return [node('ul', { class: 'assessment-methods' }, value.map((method: any) =>
    item(node('strong', {}, method.method), method.objects?.length ? `: ${method.objects.join('; ')}` : '')))];
  if (kind === 'countermeasures') return [node('div', { class: 'publisher-structured-sections' }, value.map((group: any) =>
    node('section', {}, node('h3', {}, (group.actors || ['Unspecified']).join(' · ')),
      node('ul', { class: 'source-structured-list' }, (group.actions || []).map((text: string) => item(publisherParameters(text)))))))];
  return [textBlocks(String(value), presentation, citations)];
}

export function publishedSectionsWithContent(sections: PublishedSection[], metadata: Metadata): PublishedSection[] {
  return sections.filter(section => Array.isArray(metadata[section.field]) ? metadata[section.field].length > 0 : Boolean(String(metadata[section.field] ?? '').trim()));
}

export function publisherTextModel(sections: PublishedSection[], metadata: Metadata, headingLevel: 2 | 3 = 2, claimOrigin?: string): PublisherNode {
  return node('div', { class: 'record-official-text', 'data-record-section': 'official-text', 'data-source-text': 'published',
    ...(claimOrigin ? { 'data-claim-origin': claimOrigin } : {}) }, publishedSectionsWithContent(sections, metadata).map(section =>
    node('section', { id: `section-${section.field}`, 'data-source-field': section.field }, node(`h${headingLevel}`, {}, section.heading),
      publisherSection(section.kind, metadata[section.field], metadata.source_text_presentation?.[section.field], metadata.citations))));
}

export function publisherNativeFactsModel(fields: string[], metadata: Metadata, title: string): PublisherNode[] {
  const rows = publisherFactRows(fields, metadata);
  if (!rows.length) return [];
  return [node('section', { class: 'record-native-facts', 'data-record-section': 'native-facts' }, node('h2', {}, title),
    node('dl', { class: 'record-source-facts' }, rows.map(row => node('div', {}, node('dt', {}, RECORD_FACT_LABELS[row.field] || row.field), node('dd', {}, row.displayValue)))))];
}

/** All publisher-owned primary fields, including selections whose content is a set. */
export function publisherReadingModel(contract: any, record: any, source: any, identity: string): PublisherNode {
  const center = record.center_node;
  const metadata = center.metadata || {};
  const origin = metadata.origin || 'publisher_normalized';
  const root = node('div', { class: 'record-publisher-reading', 'data-publisher-fields-owned': 'true' }) as Exclude<PublisherNode, string>;
  const officialText = publisherTextModel(contract.sections, metadata, 2, origin);
  const technical = ['stig_rule', 'srg_requirement'].includes(contract.record_type);
  const intro: PublisherNode[] = [];
  if (technical) intro.push(node('div', { id: 'section-overview' }, publisherNativeFactsModel(contract.metadata_facts.filter((field: string) => !field.startsWith('benchmark_')), metadata, 'Overview')));
  if (origin !== 'publisher_normalized') intro.push(node('p', { class: 'support-meta', 'data-record-source-identity': '' },
    `${origin === 'atlas_editorial' ? 'Control Atlas context' : origin === 'publisher_derived' ? 'Publisher-derived projection' : 'Publisher source'} · ${sourcePublicationTitle(source, '')}`));
  root.children.unshift(...intro);
  root.children.push(officialText);
  if (!publishedSectionsWithContent(contract.sections, metadata).length) root.children.push(node('section',
    { class: 'record-source-absence', 'data-record-section': 'publisher-absence' }, node('h2', {}, 'Publisher description'),
    node('p', {}, `The publisher did not publish a separate description for this ${String(displayNameFor('object_type', center.node_type)).toLowerCase()}.`)));
  const published = record.edges.filter((edge: any) => edge.publication_status === 'published');
  const byId = new Map<string, any>(record.nodes.map((entry: any) => [entry.id, entry]));
  const sort = (left: any, right: any) => String(left.metadata?.item_id || left.id).localeCompare(String(right.metadata?.item_id || right.id), undefined, { numeric: true });
  const contexts = published.filter((edge: any) => edge.target_node_id === center.id && edge.relationship_type === CONTROL_CONTEXT_RELATIONSHIP_TYPE)
    .map((edge: any) => byId.get(edge.source_node_id)).filter(Boolean).sort(sort);
  for (const context of contexts) root.children.push(node('section', { class: 'record-fedramp-context', 'data-record-section': 'fedramp-context', id: `section-fedramp-context-${context.metadata.item_id}` },
    node('h2', {}, 'FedRAMP 2026 parameters and guidance'), node('p', {}, 'FedRAMP publishes these parameters and guidance for this control.'),
    publisherSection('control_parameters', context.metadata.description || '', context.metadata.source_text_presentation?.description)));
  if (!technical) root.children.push(...publisherNativeFactsModel(contract.metadata_facts, metadata, 'Published facts'));
  const structural = record.structural_path.filter((entry: any) => entry.origin === 'structural');
  if (structural.length > 1) root.children.push(node('section', { class: 'record-hierarchy', 'data-record-section': 'publisher-hierarchy' }, node('h2', {}, 'Publisher hierarchy'),
    node('ol', {}, structural.map((entry: any) => node('li', {}, entry.id === center.id ? identity : entry.label)))));
  for (const selection of contract.selections) {
    const ids = new Set<string>();
    const items = published.filter((edge: any) => edge.source_node_id === center.id && edge.relationship_type === selection.relationship_type)
      .map((edge: any) => byId.get(edge.target_node_id)).filter((entry: any) => entry && !ids.has(entry.id) && ids.add(entry.id)).sort(sort);
    if (!items.length) continue;
    root.children.push(node('section', { class: 'record-child-inventory record-selection', 'data-record-section': 'selection',
      'data-selection-type': selection.relationship_type, id: `section-selection-${selection.relationship_type}` },
      node('div', { class: 'section-header' }, node('div', {}, node('h2', {}, selection.heading), node('p', {}, selection.note)), node('span', { class: 'badge' }, String(items.length))),
      node('ul', {}, items.slice(0, 25).map((entry: any) => {
        let title = recordDisplayTitle(entry);
        if (title === String(entry.metadata?.item_id || '')) {
          const description = String(entry.metadata?.description || '').trim();
          if (description) title += ` - ${description.length > 100 ? `${description.slice(0, 97).trimEnd()}.` : description}`;
        }
        return node('li', {}, node('a', { href: recordHashForId(entry.id) }, title));
      })), items.length > 25 ? [node('a', { href: atlasHashForId(center.id) }, `+${items.length - 25} more \u2014 Explore in Atlas`)] : []));
  }
  const children = published.filter((edge: any) => edge.relationship_class === 'structural' && edge.source_node_id === center.id)
    .sort((left: any, right: any) => (left.publisher_order ?? Number.MAX_SAFE_INTEGER) - (right.publisher_order ?? Number.MAX_SAFE_INTEGER))
    .map((edge: any) => byId.get(edge.target_node_id)).filter(Boolean);
  if (recordShowsChildInventory({ pageRole: contract.page_role, structuralChildCount: children.length })) root.children.push(node('section',
    { class: 'record-child-inventory', 'data-record-section': 'child-inventory', id: 'section-children' },
    node('div', { class: 'section-header' }, node('div', {}, node('h2', {}, contract.page_role === PAGE_ROLES.PUBLICATION_DOCUMENT ? 'Contents' : 'Contained records'),
      node('p', {}, 'Objects published directly beneath this record.')), node('span', { class: 'badge' }, String(children.length))),
    node('ul', {}, children.slice(0, 25).map((entry: any) => node('li', {}, node('a', { href: recordHashForId(entry.id) }, recordDisplayTitle(entry))))),
    children.length > 25 ? [node('a', { href: atlasHashForId(center.id) }, 'Browse all contents in Atlas')] : []));
  return root;
}

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


export function publisherFactRows(fields: string[], metadata: Metadata) {
  return fields.flatMap((field) => {
    const value = metadata[field];
    const absenceReason = metadata.field_absence_reasons?.[field];
    if ((value == null || value === "" || (Array.isArray(value) && value.length === 0)) && !absenceReason) return [];
    // Microsoft's own workbook writes this tag in French for one pillar and
    // English for another (no header, no formal taxonomy); translate rather
    // than mix languages on an English-labeled page.
    const displayValue = absenceReason
      ? `Not published — ${absenceReason}`
      : field === "category" && metadata.catalog_id === "microsoft-zt-maturity"
        ? translateMicrosoftZtCategory(value)
        : field === "benchmark_status_date"
          ? formatSourceDate(value)
          : formatFactValue(value);
    if (!displayValue) return [];
    return [{ field, displayValue }];
  });
}
