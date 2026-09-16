import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createFederalGraphRuntime } from "../src/app/runtime.mjs";

function indexedRuntime() {
  const search = JSON.parse(readFileSync("data/generated/library-search.json", "utf8")).library_search;
  const indexArtifact = JSON.parse(readFileSync("data/generated/library-search-index.json", "utf8"));
  const index = indexArtifact.library_search_index;
  const columns = index.fields.map(() => []);
  for (const shard of indexArtifact.sharded_collection.shards) {
    const chunk = JSON.parse(readFileSync(`data/generated/${shard.path}`, "utf8")).library_search_index;
    chunk.columns.forEach((column, fieldIndex) => columns[fieldIndex].push(...column));
  }
  return createFederalGraphRuntime({
    sources: [],
    nodes: [],
    edges: [],
    evidence: [],
    findings: [],
    librarySearch: {
      ...search,
      documents: [],
      indexed_transport: { ...index, columns },
    },
  });
}

test("columnar Library index preserves benchmark search answers without eager record expansion", () => {
  const runtime = indexedRuntime();
  assert.equal(runtime.searchLibrary("AC-2")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("AC-02")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("ac02")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("AC 02")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("AC-02(01)")[0].id, "nist-800-53:AC-2.1");
  assert.equal(runtime.searchLibrary("CCI-225")[0].id, "disa-cci:CCI-000225");
  assert.equal(runtime.searchLibrary("NIST AC-02")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("account management")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("V-205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("WN19-DC-000290")[0].id, "disa-stig:V-205646");
  assert.ok(
    runtime.searchLibrary("zero trust").some((record) => record.catalog_id === "nist-zt"),
  );
});

test("columnar Library index retains governed tags for the tag filter contract", () => {
  const runtime = indexedRuntime();
  const tagged = runtime.searchLibrary("", { catalog_id: "disa-stig" });
  assert.ok(tagged.some((record) => Array.isArray(record.taxonomy_tags)));
});

test("columnar Library index applies multi-publication area constraints before its result cap", () => {
  const runtime = indexedRuntime();
  const implementationCatalogs = ["disa-stig", "disa-srg"];
  const results = runtime.searchLibrary("", { catalog_ids: implementationCatalogs });

  assert.ok(results.length > 0);
  assert.ok(results.every((record) => implementationCatalogs.includes(record.catalog_id)));
});
