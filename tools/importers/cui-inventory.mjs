import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';

/** Independent publisher identity traversal; never reads projected CUI records. */
export function cuiPublisherInventory(categoryHtml, regulationXml, regulationUrl = 'https://www.ecfr.gov/api/versioner/v1/full/2026-08-01/title-32.xml?part=2002') {
  const links = parse(categoryHtml).querySelectorAll('a').filter((link) => (link.getAttribute('href') || '').includes('/cui/registry/category-detail/'));
  const categories = links.map((link) => {
    const url = link.getAttribute('href').replace(/[?#].*$/, '').replace(/\/$/, '');
    const slug = url.split('/').at(-1).replace(/\.html?$/i, '');
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid native CUI category identity');
    return `CATEGORY-${slug.toUpperCase()}`;
  });
  if (!categories.length || new Set(categories).size !== categories.length) throw new Error('Empty or duplicate CUI publisher identities');
  const terms = parse(regulationXml).querySelectorAll('i').map((element) => element.text.trim().toLowerCase());
  if (!terms.includes('cui basic') || !terms.includes('cui specified') || !regulationXml.includes('(CUI) Program')) throw new Error('CUI foundation definitions missing from regulation');
  const recordIds = ['CUI-PROGRAM', 'CUI-BASIC', 'CUI-SPECIFIED', ...categories].sort();
  return { record_count: recordIds.length, record_ids: recordIds,
    scope: 'All category identities in the official NARA registry plus the three existing program/basic/specified foundation concepts defined in 32 CFR Part 2002; not every legal section or unavailable detail-page text.',
    source_evidence: [
      { url: 'https://www.archives.gov/cui/registry/category-list', sha256: `sha256:${createHash('sha256').update(categoryHtml).digest('hex')}`, byte_length: Buffer.byteLength(categoryHtml), units: categories.length },
      { url: regulationUrl, sha256: `sha256:${createHash('sha256').update(regulationXml).digest('hex')}`, byte_length: Buffer.byteLength(regulationXml), units: 3 },
    ], exclusions: ['Unavailable Privileged Safety Information detail prose and safeguarding authorities remain UNKNOWN; category identity/marking comes from the official marking table.'] };
}
