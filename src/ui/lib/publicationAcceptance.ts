import { RETIRED_RECORD_TYPES } from "../../shared/record-acceptance.mjs";
import type { TerritoryIndex } from "./atlasTerritoryIndex";
import { PUBLICATION_NON_LEAF_NODE_TYPES, publicationNextActions } from "./publicationActions";
import { catalogProfileFor } from "./catalogProfiles";
import { datasetCheckedThroughFor, publicationTrustFor, type PublicationTrust } from "./publicationIdentity";
import { buildPublicationRegister, type CatalogSummary } from "./sourceRegister";

/**
 * Publication Acceptance Matrix (issue #284), generated from the accepted
 * corpus. One row per public publication: every canonical identity in the
 * publication-identity index, which covers every Library catalog and every
 * policy document in the source register. Nothing here is a hand-kept list.
 *
 * Each row answers the publication contract (identity, lifecycle, version,
 * freshness, official destination, what is indexed, next actions) and proves
 * that Atlas, the Library, the publication page and Sources resolve the same
 * identity. A missing fact is classified, never filled.
 */

export type FactState = string;

export type PublicationAcceptanceRow = {
  id: string;
  kind: PublicationTrust["kind"];
  catalogId: string | null;
  practitionerName: string;
  officialTitle: string;
  publisher: string;
  facts: {
    practitionerName: "governed_alias" | "register_display_name" | "official_title_only";
    officialTitle: "recorded" | "absent";
    publisher: "recorded" | "absent";
    publisherFullName: "recorded" | "absent";
    lifecycle: "recorded" | "unknown";
    version: PublicationTrust["version"]["state"];
    freshness: PublicationTrust["freshness"]["state"];
    accepted: "recorded" | "absent";
    review: "recorded" | "absent";
    officialDestination: "recorded" | "absent";
    summary: "governed" | "absent";
    indexed: "records" | "source_record_only";
  };
  lifecycle: string;
  versionLabel: string;
  records: number;
  recordKinds: Record<string, number>;
  structure: string;
  nextActions: string[];
  limitations: string[];
  surfaces: { atlas: string; library: string; publicationPage: string; sources: string };
  issues: string[];
  status: "ACCEPTED" | "BLOCKED";
};

export type PublicationAcceptanceInput = {
  sources: any[];
  catalogs: Array<CatalogSummary & Record<string, any>>;
  mappingSources: Record<string, Array<{ value: string; label: string }>>;
  identities: any[];
  nodes: any[];
  territory: TerritoryIndex;
  presentationAliases: Record<string, { alias?: string }>;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function compare(label: string, pairs: Array<[string, unknown, unknown]>, issues: string[]): string {
  const mismatched = pairs.filter(([, left, right]) => String(left ?? "") !== String(right ?? ""));
  for (const [field, left, right] of mismatched) issues.push(`${label} ${field} "${left}" != "${right}"`);
  return mismatched.length ? "MISMATCH" : "same";
}

export function buildPublicationAcceptanceMatrix(input: PublicationAcceptanceInput) {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const catalogById = new Map(input.catalogs.map((catalog) => [catalog.id, catalog]));
  const register = new Map(buildPublicationRegister(input.sources, input.catalogs).map((row) => [row.id, row]));
  const datasetCheckedThrough = datasetCheckedThroughFor(input.sources);
  const atlasPublications = new Map(input.territory.publications.map((entry) => [entry.id, entry]));
  const atlasListed = new Map([...input.territory.authority, ...input.territory.other].map((entry) => [entry.id, entry]));

  const leafByCatalog = new Map<string, Record<string, number>>();
  const rootSourceByCatalog = new Map<string, string>();
  for (const node of input.nodes) {
    const catalogId = node.metadata?.catalog_id;
    if (!catalogId) continue;
    if (node.node_type === "catalog" && node.metadata?.catalog_id === catalogId && node.source_id) rootSourceByCatalog.set(catalogId, node.source_id);
    if (PUBLICATION_NON_LEAF_NODE_TYPES.has(node.node_type) || RETIRED_RECORD_TYPES.has(node.node_type)) continue;
    const kinds = leafByCatalog.get(catalogId) || {};
    kinds[node.node_type] = (kinds[node.node_type] || 0) + 1;
    leafByCatalog.set(catalogId, kinds);
  }

  const rows: PublicationAcceptanceRow[] = input.identities.map((identity) => {
    const issues: string[] = [];
    const source = sourceById.get(identity.id);
    const catalogId: string | null = identity.catalog_id || null;
    const catalog = catalogId ? catalogById.get(catalogId) : undefined;
    if (!source) issues.push("no source record for the identity");
    const trust = publicationTrustFor({
      source: source || { id: identity.id, name: identity.name, owner: identity.publisher },
      catalogId,
      review: catalog?.source_review,
      counts: identity.catalog_counts,
      datasetCheckedThrough,
    });

    // Contract facts that must resolve.
    if (!trust.officialTitle || trust.officialTitle === identity.id) issues.push("official title does not resolve");
    if (!trust.publisher) issues.push("publisher does not resolve");
    if (trust.version.state === "recorded" && ISO_DAY.test(trust.version.value)
      && [trust.dates.retrieved, trust.dates.accepted, trust.dates.checked].includes(trust.version.value)) {
      issues.push("a retrieval date is presented as the publisher version");
    }
    const noteVersion = /\bversion\s+(\d+(?:\.\d+)+)/i.exec(trust.coverageNote)?.[1];
    if (noteVersion && trust.version.value && !trust.version.value.includes(noteVersion)) {
      issues.push(`coverage note names version ${noteVersion} but the accepted version is ${trust.version.value}`);
    }

    // Sources register: same identity, same trust facts.
    const row = register.get(identity.id);
    const sourcesSurface = row
      ? compare("Sources", [
        ["official title", row.officialTitle, trust.officialTitle],
        ["name", row.trust.practitionerName, trust.practitionerName],
        ["publisher", row.publisher.value, trust.publisher],
        ["lifecycle", row.trust.lifecycle.label, trust.lifecycle.label],
        ["version", row.trust.version.label, trust.version.label],
        ["official destination", row.officialLink, trust.official.url],
      ], issues)
      : (issues.push("missing from the Sources register"), "MISSING");

    // Atlas: mapped publications carry name/publisher; policy and other listed documents carry name/title/url.
    let atlasSurface = "not_listed";
    if (catalogId && atlasPublications.has(catalogId)) {
      const atlas = atlasPublications.get(catalogId)!;
      atlasSurface = compare("Atlas", [
        ["official title", atlas.name, trust.officialTitle],
        ["name", input.presentationAliases[catalogId]?.alias || atlas.name, trust.practitionerName],
        ["publisher", atlas.publisher, trust.publisher],
      ], issues);
    } else if (atlasListed.has(identity.id)) {
      const listed = atlasListed.get(identity.id)!;
      atlasSurface = compare("Atlas", [
        ["name", listed.name, trust.practitionerName],
        ["official title", listed.title || listed.name, trust.showsOfficialTitle ? trust.officialTitle : trust.practitionerName],
        ["publisher", listed.publisher, trust.publisher],
        ["official destination", listed.url, trust.official.url],
      ], issues);
    } else if (catalogId) {
      issues.push("Library publication is not on the Atlas");
    }

    // Library inventory and the publication page resolve the catalog's source independently.
    let librarySurface = "no_catalog_page";
    let pageSurface = "no_catalog_page";
    const kinds = catalogId ? leafByCatalog.get(catalogId) || {} : {};
    const records = Object.values(kinds).reduce((sum, count) => sum + count, 0);
    if (catalogId) {
      if (!catalog) issues.push("catalog has no Library entry");
      librarySurface = compare("Library", [["source", catalog?.source_id, identity.id]], issues);
      pageSurface = compare("Publication page", [["source", rootSourceByCatalog.get(catalogId) || catalog?.source_id, identity.id]], issues);
      if (!records) issues.push("publication page has no records to browse");
    }

    const recordLabel = catalogId ? catalogProfileFor(catalogId).recordLabel : "Records";
    const actions = publicationNextActions({ trust, recordLabel, recordCount: records, mappingSources: input.mappingSources });
    for (const action of actions) {
      if (action.kind === "compare" && !catalogById.has(action.target)) issues.push(`Compare target ${action.target} is not a Library publication`);
    }
    if (catalogId && !actions.some((action) => action.kind === "browse")) issues.push("no browse action");
    if (!actions.some((action) => action.kind === "sources")) issues.push("no source-details action");

    const alias = catalogId ? input.presentationAliases[catalogId]?.alias : "";
    return {
      id: identity.id,
      kind: trust.kind,
      catalogId,
      practitionerName: trust.practitionerName,
      officialTitle: trust.officialTitle,
      publisher: trust.publisher,
      facts: {
        practitionerName: alias ? "governed_alias" : trust.showsOfficialTitle ? "register_display_name" : "official_title_only",
        officialTitle: trust.officialTitle ? "recorded" : "absent",
        publisher: trust.publisher ? "recorded" : "absent",
        publisherFullName: trust.publisherFullName ? "recorded" : "absent",
        lifecycle: trust.lifecycle.value ? "recorded" : "unknown",
        version: trust.version.state,
        freshness: trust.freshness.state,
        accepted: trust.dates.accepted ? "recorded" : "absent",
        review: trust.review ? "recorded" : "absent",
        officialDestination: trust.official.url ? "recorded" : "absent",
        summary: trust.summary ? "governed" : "absent",
        indexed: records ? "records" : "source_record_only",
      },
      lifecycle: trust.lifecycle.label,
      versionLabel: trust.version.label,
      records,
      recordKinds: kinds,
      structure: catalog?.tier_label_plural ? `${catalog.tier_count || 0} ${catalog.tier_label_plural}` : "",
      nextActions: [...new Set(actions.map((action) => action.kind))],
      limitations: trust.limitations.map((limitation) => limitation.code),
      surfaces: { atlas: atlasSurface, library: librarySurface, publicationPage: pageSurface, sources: sourcesSurface },
      issues,
      status: issues.length ? "BLOCKED" : "ACCEPTED",
    };
  });

  rows.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const catalogsCovered = new Set(rows.map((row) => row.catalogId).filter(Boolean));
  const uncoveredCatalogs = input.catalogs.map((catalog) => catalog.id).filter((id) => !catalogsCovered.has(id));
  return { rows, uncoveredCatalogs, summary: summarizePublicationMatrix(rows) };
}

export function summarizePublicationMatrix(rows: PublicationAcceptanceRow[]) {
  const tally = (pick: (row: PublicationAcceptanceRow) => string) => {
    const counts: Record<string, number> = {};
    for (const row of rows) counts[pick(row)] = (counts[pick(row)] || 0) + 1;
    return counts;
  };
  const facts = Object.fromEntries(
    (Object.keys(rows[0]?.facts || {}) as Array<keyof PublicationAcceptanceRow["facts"]>).map((key) => [key, tally((row) => row.facts[key])]),
  );
  const limitations: Record<string, number> = {};
  for (const row of rows) for (const code of row.limitations) limitations[code] = (limitations[code] || 0) + 1;
  return {
    publications: rows.length,
    byKind: tally((row) => row.kind),
    byStatus: tally((row) => row.status),
    facts,
    limitations,
  };
}
