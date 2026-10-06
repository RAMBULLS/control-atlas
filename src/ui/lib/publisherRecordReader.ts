import { publisherReadingModel, type PublisherNode } from '../../shared/publisher-text-model';
import { atlasHashForId, recordIdFromHash } from '../../shared/record-route-identity';
import { missingRequiredRecordFields, recordPresentationContract, relationshipTreatmentFor, RELATIONSHIP_TREATMENTS } from '../../shared/record-presentation.mjs';
import { recordRetirement } from '../../shared/record-acceptance.mjs';
import { artifactPath, clearRuntimeArtifactCache, fetchArtifact, loadAtlasNeighborhood } from './runtimeArtifacts';
import { officialSourceActionLabel, officialSourceFor } from './officialSource';
import { recordIdentityPresentationFor, recordPublisherName } from './publisherRecordIdentity';
import { catalogDisplayNameFor } from './catalogProfiles';
import { clearPublisherText, hasPublisherText, installPublisherText } from './publisherRecordOwner';
import { recordCommitToken, waitForRecordPaint } from './waitForRecordPaint';
import { canonicalBreadcrumbFromRecord } from './canonicalBreadcrumb';
import { extractGovernedRecordTaxonomy, extractOrderedRecordDiscoveryTags, formatPlainLanguageProvenance } from './taxonomyContext';
import { readerButton } from './buttonStyles';
import { CONTROL_CONTEXT_RELATIONSHIP_TYPE } from '../../shared/record-control-context.mjs';
import { buildRecordConnectionGroups } from './recordConnectionGroups';
import '../../../styles/record-detail.css';

let attempt: AbortController | undefined;

function element(tag: string, attributes: Record<string, string> = {}, text?: string) {
  const result = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'href' && !/^(?:https?:\/\/|#\/)/.test(value)) continue;
    result.setAttribute(name, value);
  }
  if (text !== undefined) result.textContent = text;
  return result;
}

function renderPublisherNode(value: PublisherNode): Node {
  if (typeof value === 'string') return document.createTextNode(value);
  if (value.tag === 'snippet') {
    const container = element('div', { class: 'source-code-snippet', 'data-source-code-snippet': '' });
    const header = element('div', { class: 'source-code-snippet__header' });
    const button = element('button', { class: readerButton('secondary'), type: 'button' }, 'Copy');
    const status = element('span', { class: 'visually-hidden', 'aria-live': 'polite' });
    button.addEventListener('click', () => {
      void copyPublisherCode(value.attributes.value).then(() => {
        button.textContent = 'Copied';
        status.textContent = 'Snippet copied to clipboard';
        window.setTimeout(() => { button.textContent = 'Copy'; status.textContent = ''; }, 1800);
      }, () => { status.textContent = 'Unable to copy. Select the text to copy it.'; });
    });
    header.append(element('span', {}, 'Command or configuration'), button, status);
    const pre = element('pre');
    pre.append(element('code', {}, value.attributes.value));
    container.append(header, pre);
    return container;
  }
  const result = element(value.tag, value.attributes);
  result.append(...value.children.map(renderPublisherNode));
  return result;
}

async function copyPublisherCode(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* Use the existing selection fallback. */ }
  }
  const area = element('textarea', { readonly: '' }) as HTMLTextAreaElement;
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Clipboard unavailable.');
}

/** Public reading entry: same canonical acquisition, no framework or graph runtime. */
export async function startPublisherRecordReader(): Promise<void> {
  attempt?.abort();
  const controller = new AbortController();
  attempt = controller;
  const hash = window.location.hash;
  const recordId = recordIdFromHash(hash);
  clearPublisherText(recordId || undefined);
  const host = document.querySelector<HTMLElement>('[data-publisher-reader]');
  const shell = document.querySelector<HTMLElement>('[data-static-route]');
  if (!host || !shell || !recordId) { host?.replaceChildren(); return; }
  if (host.dataset.readerRecordId !== recordId) {
    host.replaceChildren();
    host.hidden = true;
    host.dataset.readerRecordId = recordId;
    shell.querySelector<HTMLElement>('.page-header')?.removeAttribute('hidden');
  }
  const current = () => !controller.signal.aborted && window.location.hash === hash;
  try {
    const [sourcesArtifact, catalogArtifact, record] = await Promise.all([
      fetchArtifact(artifactPath('sources.json')),
      fetchArtifact(artifactPath('catalog-bootstrap.json')),
      loadAtlasNeighborhood(recordId),
    ]);
    if (!current()) return;
    const node = record?.center_node;
    if (!node) throw new Error('Record not found. Search the Library for another record.');
    const metadata = node.metadata || {};
    const catalogId = String(metadata.catalog_id || '');
    if (recordRetirement({ catalogId, recordType: node.node_type || '', id: node.id, sourceId: node.source_id || '', title: metadata.title || '' })) return;
    const source = (sourcesArtifact as any).sources?.find((entry: any) => entry.id === node.source_id);
    if (!source) throw new Error("Can't confirm which publisher this came from, so it isn't shown as official yet.");
    const contract = recordPresentationContract(catalogId, node.node_type);
    if (missingRequiredRecordFields(contract, metadata).length) throw new Error('The published text for this record did not load.');
    const catalog = (catalogArtifact as any).catalog_bootstrap?.catalogs?.find((entry: any) => entry.id === catalogId);
    const byId = new Map(record.nodes.map(entry => [entry.id, entry]));
    const selectionTypes = new Set(contract.selections.map((entry: any) => entry.relationship_type));
    const connections = buildRecordConnectionGroups(node.id, catalogId, record.edges.filter(edge =>
      !(edge.source_node_id === node.id && selectionTypes.has(edge.relationship_type)) && edge.relationship_type !== CONTROL_CONTEXT_RELATIONSHIP_TYPE),
      id => byId.get(id), id => catalogDisplayNameFor(id, (catalogArtifact as any).catalog_bootstrap?.catalogs?.find((entry: any) => entry.id === id)?.name || ''));
    const hasVisibleConnections = connections.some(group => {
      const target = byId.get(group.items[0]?.nodeId);
      return target && relationshipTreatmentFor({ recordContract: contract, counterpartContract: recordPresentationContract(group.catalogId, target.node_type || 'catalog'),
        recordCatalogId: catalogId, counterpartCatalogId: group.catalogId, relationshipType: group.relationshipType, relationshipClass: 'correlation' }) !== RELATIONSHIP_TREATMENTS.ATLAS_ONLY;
    });
    const identity = recordIdentityPresentationFor({ publisher: recordPublisherName(source.owner, source.publisher, catalog?.display_group),
      catalogId, publicationName: catalogDisplayNameFor(catalogId, catalog?.name || ''), family: metadata.family || '',
      itemId: metadata.item_id || node.label || '', title: metadata.title || '', objectType: node.node_type || '', metadata });
    const token = {};
    const page = element('section', { class: 'detail-page record-template ca-record-page', 'data-record-content': node.id,
      'data-record-commit': recordCommitToken(token), 'data-page-role': contract.page_role, 'data-template': 'E' });
    const grid = element('div', { class: 'record-template-grid ca-record-layout' });
    const header = element('header', { class: 'record-title-block', 'data-route-primary-header': 'true', 'data-route-primary-copy': 'true' });
    if (identity.stableIdIsGenerated) header.classList.add('record-title-block--generated');
    const heading = element('div', { class: 'ca-record-heading' });
    const technical = ['stig_rule', 'srg_requirement'].includes(contract.record_type);
    const recordHeading = technical && !identity.stableIdIsGenerated ? String(metadata.publisher_item_id || metadata.item_id || '').trim() || identity.primary : identity.primary;
    const path = canonicalBreadcrumbFromRecord(node, { catalog_id: catalogId, item_id: metadata.item_id, publisher_name: recordPublisherName(source.owner, source.publisher, catalog?.display_group) }, catalog, source, recordHeading);
    const breadcrumb = element('nav', { class: 'canonical-breadcrumb', 'aria-label': 'Canonical breadcrumb', 'data-canonical-breadcrumb': path.text });
    breadcrumb.append(element('span', {}, path.text));
    heading.append(element('h1', {}, recordHeading));
    if (identity.secondary) heading.append(element('p', { class: 'record-official-name' }, identity.secondary));
    if (identity.stableIdIsGenerated && identity.context) heading.append(element('p', { class: 'record-identity-context' }, identity.context));
    if (node.lifecycle_status && node.lifecycle_status !== 'active') heading.append(element('p', { class: 'record-identity-context', 'data-record-lifecycle': node.lifecycle_status }, node.lifecycle_status));
    const tags = extractOrderedRecordDiscoveryTags(extractGovernedRecordTaxonomy({ catalogId, metadata, nodeTaxonomyTags: metadata.taxonomy_tags, family: metadata.family, relatedCategories: metadata.related_categories }));
    const taxonomy = element('div', { class: 'ca-record-tags', 'data-record-section': 'taxonomy-context' });
    const tagLinks = element('nav', { class: 'record-discovery-tags', 'aria-label': 'Browse by tag', 'data-discovery-tags': '' });
    for (const tag of tags) {
      const link = element('a', { class: 'record-discovery-tag', href: `#/library?tag=${encodeURIComponent(tag.id)}`, 'aria-label': `Filter the Library by ${tag.label}` });
      const explanation = formatPlainLanguageProvenance(tag);
      const glyph = element('span', { class: 'dimension-glyph', 'aria-hidden': 'true' });
      glyph.style.width = '16px'; glyph.style.height = '16px'; glyph.style.flexShrink = '0';
      link.append(glyph, element('span', { class: 'record-discovery-tag__label' }, tag.label));
      if (explanation) {
        const id = `reader-tag-${tag.id}`;
        link.setAttribute('aria-describedby', id);
        link.append(element('span', { class: 'visually-hidden', id }, explanation));
      }
      tagLinks.append(link);
    }
    taxonomy.append(tagLinks);
    const actions = element('div', { class: 'record-title-actions', 'data-route-primary-support': 'true' });
    const official = officialSourceFor(source);
    if (official.url) actions.append(element('a', { href: official.url, target: '_blank', rel: 'noopener noreferrer', class: readerButton('primary') },
      metadata.origin === 'atlas_editorial' ? 'View Atlas source' : officialSourceActionLabel(official)));
    if (connections.length || record.edges.some(edge => edge.publication_status === 'published' && edge.source_node_id === node.id && (selectionTypes.has(edge.relationship_type) || edge.relationship_class === 'structural'))) {
      actions.append(element('a', { href: atlasHashForId(node.id), class: readerButton('secondary') }, 'See connections'));
    }
    const menu = element('details', { class: 'record-actions-menu' });
    menu.append(element('summary', {}, 'More actions'));
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); (menu as HTMLDetailsElement).open = false; menu.querySelector('summary')?.focus(); }
    });
    const popover = element('div', { class: 'record-actions-popover' });
    const copyLink = element('button', { type: 'button', class: readerButton('secondary'), 'data-record-action': 'copy-link' }, 'Copy link');
    copyLink.addEventListener('click', () => { void copyPublisherCode(window.location.href).then(() => { copyLink.textContent = 'Link copied'; }, () => { copyLink.textContent = 'Use your browser share menu'; }); });
    popover.append(copyLink);
    popover.append(element('p', { class: 'support-meta' }, 'More tools will be available when the page finishes loading.'));
    menu.append(popover);
    actions.append(menu);
    header.append(heading, ...(tags.length ? [taxonomy] : []), actions);
    const article = element('article', { class: 'record-template-main' });
    const content = renderPublisherNode(publisherReadingModel(contract, record, source, identity.primary)) as HTMLElement;
    const sections = [...content.querySelectorAll<HTMLElement>('[id^="section-"]')].filter(section => section.querySelector('h2'));
    if (sections.length + Number(hasVisibleConnections) > 1) {
      const navigation = element('nav', { class: 'record-section-nav ca-record-section-nav', 'aria-label': 'Record sections' });
      for (const [index, section] of sections.entries()) {
        const button = element('button', { class: 'ca-record-section-nav__item', type: 'button', ...(index === 0 ? { 'aria-current': 'location' } : {}) }, section.querySelector('h2')!.textContent || '');
        button.addEventListener('click', () => {
          section.tabIndex = -1; section.focus({ preventScroll: true });
          section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          navigation.querySelectorAll('[aria-current]').forEach(item => item.removeAttribute('aria-current'));
          button.setAttribute('aria-current', 'location');
        });
        navigation.append(button);
      }
      if (hasVisibleConnections) navigation.append(element('button', { class: 'ca-record-section-nav__item', type: 'button', disabled: '', title: 'Available when the page finishes loading' }, 'Related records'));
      article.append(navigation);
    }
    article.append(content);
    grid.append(header, article);
    page.append(breadcrumb, grid);
    host.replaceChildren(page);
    host.hidden = false;
    shell.querySelector<HTMLElement>('.page-header')?.setAttribute('hidden', '');
    shell.removeAttribute('role');
    shell.removeAttribute('aria-labelledby');
    installPublisherText(recordId, content);
    host.dataset.readerState = 'ready';
    await waitForRecordPaint(recordId, token, controller.signal, page);
  } catch (error) {
    if (!current()) return;
    if (hasPublisherText(recordId)) {
      host.append(element('p', { role: 'alert' }, 'The record could not be refreshed. The previously loaded text remains available.'));
      return;
    }
    host.replaceChildren(element('h2', {}, 'Unable to load published text'),
      element('p', { role: 'alert' }, error instanceof Error ? error.message : 'The public record did not load.'));
    const retry = element('button', { type: 'button', class: readerButton('secondary') }, 'Try again');
    retry.addEventListener('click', () => { clearRuntimeArtifactCache(); void startPublisherRecordReader(); });
    host.append(retry);
    host.hidden = false;
    host.dataset.readerState = 'error';
  }
}
