#!/usr/bin/env node
// Generates the Publication Acceptance Matrix from the accepted corpus (issue
// #284). Every row comes from data/generated: the publication-identity index,
// the source register, the catalog bootstrap, the graph and the same Atlas
// territory index the site ships. Nothing here is a hand-kept list.
//
//   node --import tsx tools/publication-acceptance-matrix.mjs                  markdown to stdout
//   node --import tsx tools/publication-acceptance-matrix.mjs --json out.json  full rows as JSON
//   node --import tsx tools/publication-acceptance-matrix.mjs --check          exit 1 on any BLOCKED publication
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";
import { buildTerritoryIndex } from "../src/ui/lib/atlasTerritoryIndex.ts";
import { buildPublicationAcceptanceMatrix } from "../src/ui/lib/publicationAcceptance.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadPublicationAcceptanceInputs(root = ROOT) {
  const read = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
  if (!existsSync(join(root, "data/generated/publication-identity-index.json"))) {
    throw new Error('Generated data is missing. Run "npm run build:data" first.');
  }
  const nodes = readGeneratedCollection(root, "nodes").nodes;
  const edges = readGeneratedCollection(root, "edges").edges;
  const registry = read("data/source-registry.json");
  const spine = read("data/curated/tree-spine.json");
  const geometry = read("data/curated/atlas-territory-geography.json");
  const identities = read("data/generated/publication-identity-index.json").identities;
  const bootstrap = read("data/generated/catalog-bootstrap.json").catalog_bootstrap;
  // The same inputs scripts/build-atlas-territory-artifact.mjs uses, so the
  // Atlas column checks what the site actually ships.
  const { index: territory } = buildTerritoryIndex({
    generatedAt: read("data/generated/edges.json").generated_at,
    datasetId: "matrix",
    taxonomy: read("data/generated/taxonomy-registry.json"),
    geometryVersion: geometry.version,
    catalogIds: [...Object.keys(spine.catalogLimbs), ...spine.syntheticCatalogs.map((c) => c.catalog_id)],
    identities,
    sources: registry.sources,
    registryPublications: registry.publications,
    nodes,
    edges,
  });
  return {
    sources: read("data/generated/sources.json").sources,
    catalogs: bootstrap.catalogs,
    mappingSources: bootstrap.mapping_sources || {},
    identities,
    nodes,
    territory,
    presentationAliases: geometry.presentation,
  };
}

export function loadPublicationAcceptanceMatrix(root = ROOT) {
  return buildPublicationAcceptanceMatrix(loadPublicationAcceptanceInputs(root));
}

const count = (object) => Object.entries(object).map(([key, value]) => `${key} ${value}`).join(", ") || "none";

export function renderPublicationMatrixMarkdown({ rows, uncoveredCatalogs, summary }) {
  const lines = [
    "# Publication acceptance matrix",
    "",
    `Generated from data/generated. ${summary.publications} public publications (${count(summary.byKind)}). Status: ${count(summary.byStatus)}.`,
    "",
    "## Source-fact classification",
    "",
    ...Object.entries(summary.facts).map(([fact, states]) => `- ${fact}: ${count(states)}`),
    "",
    `Known limitations shown publicly: ${count(summary.limitations)}.`,
    "",
    "| Publication | Kind | Name / official title | Publisher | Status | Version | Freshness | Records | Next actions | Atlas | Library | Page | Sources | Result |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const name = row.practitionerName === row.officialTitle ? row.officialTitle : `${row.practitionerName} / ${row.officialTitle}`;
    lines.push(`| ${row.catalogId || row.id} | ${row.kind} | ${name.replaceAll("|", "\\|")} | ${row.publisher} | ${row.lifecycle} | ${row.facts.version}: ${row.versionLabel} | ${row.facts.freshness} | ${row.records} | ${row.nextActions.join(", ")} | ${row.surfaces.atlas} | ${row.surfaces.library} | ${row.surfaces.publicationPage} | ${row.surfaces.sources} | ${row.status}${row.issues.length ? `: ${row.issues.join("; ")}` : ""} |`);
  }
  if (uncoveredCatalogs.length) lines.push("", `Library catalogs with no publication identity: ${uncoveredCatalogs.join(", ")}`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const result = loadPublicationAcceptanceMatrix();
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) writeFileSync(args[jsonIndex + 1], JSON.stringify(result, null, 2));
  else process.stdout.write(renderPublicationMatrixMarkdown(result));
  if (args.includes("--check")) {
    const blocked = result.rows.filter((row) => row.status !== "ACCEPTED");
    if (blocked.length || result.uncoveredCatalogs.length) {
      console.error(`Publication acceptance gate failed: ${blocked.map((row) => `${row.id} (${row.issues.join("; ")})`).join(", ")} ${result.uncoveredCatalogs.join(", ")}`);
      process.exit(1);
    }
  }
}
