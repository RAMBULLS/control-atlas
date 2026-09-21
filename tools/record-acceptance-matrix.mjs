#!/usr/bin/env node
// Generates the Record Acceptance Matrix from the registry and the generated
// corpus (issue #279). Nothing here is a hand-kept list: pairs come from
// CATALOG_RECORD_TYPES, representatives from data/generated.
//
//   node tools/record-acceptance-matrix.mjs                 markdown to stdout
//   node tools/record-acceptance-matrix.mjs --json out.json full rows as JSON
//   node tools/record-acceptance-matrix.mjs --check         exit 1 on any BLOCKED/UNREVIEWED pair
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRecordMatrixAccumulator, summarizeRecordMatrix } from "../src/shared/record-acceptance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "data", "generated");

export function loadRecordAcceptanceMatrix(generatedDir = GENERATED) {
  const nodesDir = join(generatedDir, "graph-data", "nodes");
  const edgesDir = join(generatedDir, "graph-data", "edges");
  if (!existsSync(nodesDir) || !existsSync(edgesDir)) {
    throw new Error(`Generated graph data is missing under ${generatedDir}. Run "npm run build:data" first.`);
  }
  const sources = new Map(
    JSON.parse(readFileSync(join(generatedDir, "sources.json"), "utf8")).sources.map((source) => [source.id, source]),
  );
  const accumulator = createRecordMatrixAccumulator();
  for (const file of readdirSync(nodesDir).sort()) {
    for (const node of JSON.parse(readFileSync(join(nodesDir, file), "utf8")).nodes) accumulator.addNode(node);
  }
  for (const file of readdirSync(edgesDir).sort()) {
    for (const edge of JSON.parse(readFileSync(join(edgesDir, file), "utf8")).edges) accumulator.addEdge(edge);
  }
  const { rows, unsupported } = accumulator.finish({
    sourceLabel: (id) => {
      const source = sources.get(id);
      return source ? source.owner || source.publisher || source.display_name || id : id;
    },
  });
  return { rows, unsupported, summary: summarizeRecordMatrix(rows) };
}

const yesNo = (value) => (value ? "yes" : "no");

function actionsText(actions) {
  if (!actions) return "-";
  return [
    actions.atlas.header ? "Atlas(header)" : "Atlas(rail)",
    actions.compare ? "Compare" : null,
    actions.templateFramework ? "Templates" : null,
  ].filter(Boolean).join(", ");
}

export function renderMatrixMarkdown({ rows, unsupported, summary }) {
  const lines = [
    "# Record acceptance matrix",
    "",
    `Generated from the presentation registry and data/generated. ${summary.pairs} catalog x type pairs, ${summary.catalogs} catalog scopes, ${summary.record_types} record types, ${summary.with_representative} with a real representative record.`,
    "",
    `By disposition: ${Object.entries(summary.by_disposition).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `By acceptance: ${Object.entries(summary.by_acceptance).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    "",
    "| Pair | Role | Records | Representative | Search | Sections | Facts | Children | Related | Actions | Disposition | Status | Issues |",
    "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| ${row.pair} | ${row.page_role} | ${row.record_count} | ${row.representative_id || "-"} | ${yesNo(row.library_search_included)} | ${row.sections_populated}/${row.sections_declared.length} | ${row.facts_populated}/${row.facts_declared.length} | ${row.structural_children} | ${row.related_connections} | ${actionsText(row.actions)} | ${row.disposition || "-"} | ${row.acceptance} | ${row.issues.join("; ") || "-"} |`);
  }
  if (Object.keys(unsupported).length) {
    lines.push("", "## Corpus types with no presentation contract", "", ...Object.entries(unsupported).map(([k, v]) => `- ${k} (${v})`));
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const result = loadRecordAcceptanceMatrix();
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) writeFileSync(args[jsonIndex + 1], JSON.stringify(result, null, 2));
  else process.stdout.write(renderMatrixMarkdown(result));
  if (args.includes("--check")) {
    const bad = result.rows.filter((row) => row.acceptance === "BLOCKED" || row.acceptance === "UNREVIEWED");
    if (bad.length || Object.keys(result.unsupported).length) {
      console.error(`Record acceptance gate failed: ${bad.map((row) => row.pair).join(", ")} ${JSON.stringify(result.unsupported)}`);
      process.exit(1);
    }
  }
}
