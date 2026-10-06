import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import readXlsxFile from "read-excel-file/node";

import {
  buildCompareExportData,
  compareExportToCsv,
  compareExportToXlsx,
  countCompareMappings,
  CROSSWALK_COLUMNS,
  filterCompareRows,
  SOURCES_COLUMNS,
} from "../../src/ui/lib/compareExport";

const sources = new Map([
  [
    "publication-a",
    {
      id: "publication-a",
      display_name: "Publication A source",
      owner: "Publisher A",
      version: "5.2.0",
      catalog_browse_url: "https://example.gov/publication-a",
      last_checked: "2026-08-19",
      lifecycle_status: "active",
    },
  ],
  [
    "publication-b",
    {
      id: "publication-b",
      display_name: "Publication B source",
      owner: "Publisher B",
      version: "2.0",
      catalog_browse_url: "https://example.gov/publication-b",
      last_checked: "2026-08-18",
      lifecycle_status: "active",
    },
  ],
  [
    "crosswalk-one",
    {
      id: "crosswalk-one",
      display_name: "Crosswalk, One",
      owner: "Publisher \"One\"",
      version: "v1",
      artifact_url: "https://example.gov/crosswalk-one.xlsx",
      retrieved_at: "2026-08-17",
      lifecycle_status: "active",
    },
  ],
  [
    "crosswalk-two",
    {
      id: "crosswalk-two",
      display_name: "Crosswalk Deux — 連携",
      owner: "Publisher Two",
      version: "v2",
      artifact_url: "https://example.gov/crosswalk-two.xlsx",
      retrieved_at: "2026-08-16",
      lifecycle_status: "active",
    },
  ],
]);

const rows = [
  {
    from_id: "publication-a:=1+1",
    from_item_id: "=1+1",
    from_title: "Comma, \"quote\" — Unicode 連携",
    targets: [
      {
        edge_id: "edge-one",
        relationship_type: "maps_to",
        to_id: "publication-b:B-1",
        to_item_id: "B-1",
        to_title: "First target",
        source_refs: [
          {
            source_id: "crosswalk-one",
            locator: "Mappings!A2, exact \"cell\"",
          },
        ],
      },
      {
        edge_id: "edge-two",
        relationship_type: "subset_of",
        to_id: "publication-b:@SUM(A1:A2)",
        to_item_id: "@SUM(A1:A2)",
        to_title: "Second target — résumé",
        source_refs: [
          { source_id: "crosswalk-one", locator: "Mappings!A3" },
          { source_id: "crosswalk-two", locator: "Sheet 連携!B4" },
        ],
      },
      {
        edge_id: "edge-three",
        relationship_type: "maps_to",
        to_id: "publication-b:B-3",
        to_item_id: "B-3",
        to_title: "Missing optional evidence",
        source_refs: [],
      },
    ],
  },
  {
    from_id: "publication-a:A-2",
    from_item_id: "A-2",
    from_title: "Another source record",
    targets: [
      {
        edge_id: "edge-four",
        relationship_type: "maps_to",
        to_id: "publication-b:B-4",
        to_item_id: "B-4",
        to_title: "Target title search needle",
        source_refs: [{ source_id: "crosswalk-two", locator: "Mappings!A4" }],
      },
    ],
  },
];

function exportData(exportRows = rows) {
  return buildCompareExportData({
    buildLabel: "2026-08-20",
    generatedAt: "2026-08-20T12:34:56.000Z",
    resolveSource: (sourceId) => sources.get(sourceId),
    rows: exportRows,
    sourceCatalog: {
      id: "publication-a",
      name: "Publication A",
      source_id: "publication-a",
      source_version: "Revision 5",
    },
    targetCatalog: {
      id: "publication-b",
      name: "Publication B",
      source_id: "publication-b",
      source_version: "Version 2",
    },
  });
}

test("Compare result search preserves matched source rows and narrows target-only matches", () => {
  assert.equal(filterCompareRows(rows, "").length, 2);
  assert.equal(filterCompareRows(rows, "Unicode").length, 1);
  assert.equal(filterCompareRows(rows, "Unicode")[0].targets.length, 3);

  const targetMatch = filterCompareRows(rows, "search needle");
  assert.equal(targetMatch.length, 1);
  assert.equal(targetMatch[0].from_item_id, "A-2");
  assert.deepEqual(targetMatch[0].targets.map((target) => target.to_item_id), ["B-4"]);
});

test("Compare exports reconcile every filtered mapping exactly once across one and multiple sources", () => {
  const filtered = filterCompareRows(rows, "Unicode");
  const data = exportData(filtered);
  assert.equal(countCompareMappings(filtered), 3);
  assert.equal(data.mappingCount, 3);
  assert.equal(data.crosswalk.length - 1, data.mappingCount);
  assert.deepEqual(data.crosswalk[0], [...CROSSWALK_COLUMNS]);
  assert.deepEqual(data.sources[0], [...SOURCES_COLUMNS]);

  const multipleSources = data.crosswalk.find((row) => row[7] === "@SUM(A1:A2)");
  assert.ok(multipleSources);
  assert.equal(multipleSources[9], "Crosswalk, One | Crosswalk Deux — 連携");
  assert.equal(multipleSources[10], "v1 | v2");
  assert.equal(multipleSources[11], "https://example.gov/crosswalk-one.xlsx");
  assert.equal(multipleSources[12], "Mappings!A3 | Sheet 連携!B4");

  const missing = data.crosswalk.find((row) => row[7] === "B-3");
  assert.ok(missing);
  assert.deepEqual(missing.slice(9, 13), ["", "", "", ""]);
  assert.equal(data.sources.filter((row) => row[0].startsWith("Crosswalk source:")).length, 2);
});

test("CSV uses the exact Crosswalk schema, UTF-8 quoting, and formula protection", () => {
  const csv = compareExportToCsv(exportData(filterCompareRows(rows, "Unicode")));
  assert.ok(csv.startsWith(`\uFEFF"${CROSSWALK_COLUMNS[0]}"`));
  assert.match(csv, /"Comma, ""quote"" — Unicode 連携"/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"'@SUM\(A1:A2\)"/);
  assert.equal(csv.split("\r\n").length - 1, 3);
});

test("XLSX has exactly three filterable sheets, frozen headers, text IDs, wrapped titles, and clickable URLs", async () => {
  const bytes = await compareExportToXlsx(exportData(filterCompareRows(rows, "Unicode")));
  const files = unzipSync(bytes);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  const sheet1 = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const sheet2 = strFromU8(files["xl/worksheets/sheet2.xml"]);
  const table1 = strFromU8(files["xl/tables/table1.xml"]);
  const styles = strFromU8(files["xl/styles.xml"]);
  const sheet1Rels = strFromU8(files["xl/worksheets/_rels/sheet1.xml.rels"]);
  const sheet2Rels = strFromU8(files["xl/worksheets/_rels/sheet2.xml.rels"]);
  const sharedStrings = strFromU8(files["xl/sharedStrings.xml"]);

  assert.deepEqual(
    [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((match) => match[1]),
    ["Crosswalk", "Sources", "About"],
  );
  assert.match(sheet1, /<pane ySplit="1"[^>]*state="frozen"/);
  assert.match(sheet2, /<pane ySplit="1"[^>]*state="frozen"/);
  assert.match(table1, /<autoFilter ref="A1:Q4"/);
  assert.match(table1, /tableColumns count="17"/);
  assert.match(styles, /numFmtId="49"/);
  assert.match(styles, /wrapText="1"/);
  assert.match(sheet1, /t="s"/);
  assert.doesNotMatch(sheet1, /<mergeCell/);
  assert.doesNotMatch(sheet2, /<mergeCell/);
  assert.doesNotMatch(sheet1, /<f>/);
  assert.match(sheet1Rels, /relationships\/hyperlink/);
  assert.match(sheet1Rels, /Target="https:\/\/example.gov\/crosswalk-one.xlsx"/);
  assert.match(sheet2Rels, /Target="https:\/\/example.gov\/publication-a"/);
  assert.match(sharedStrings, /&apos;=1\+1/);
  assert.match(sharedStrings, /&apos;@SUM\(A1:A2\)/);

  const directory = mkdtempSync(join(tmpdir(), "control-atlas-compare-export-"));
  const file = join(directory, "compare.xlsx");
  try {
    writeFileSync(file, bytes);
    const parsed = await readXlsxFile(file, { sheet: "Crosswalk" });
    const crosswalkRows = Array.isArray(parsed) && parsed[0]?.data
      ? parsed[0].data
      : parsed.data || parsed;
    assert.deepEqual(crosswalkRows[0], [...CROSSWALK_COLUMNS]);
    assert.equal(crosswalkRows.length - 1, 3);
    assert.equal(crosswalkRows[1][3], "Comma, \"quote\" — Unicode 連携");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
