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
  assert.equal(runtime.searchLibrary("205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("V205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("v 205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("SV-205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("WN19-DC-000290")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("WN19 DC 000290")[0].id, "disa-stig:V-205646");
  assert.ok(runtime.searchLibrary("2019").length > 0);
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


test("columnar MFA discovery retains the complete reviewed top-five expected set", () => {
  const runtime = indexedRuntime();
  const required = ["nist-800-53:IA-2.1", "nist-800-53:IA-2.2", "nist-800-53:IA-5"];
  const actual = runtime.searchLibrary("MFA").slice(0, 5).map(record => record.id);
  for (const id of required) assert.ok(actual.includes(id), id);
  assert.equal(new Set(actual).size, actual.length);
});

test("MFA discovery preserves qualifiers, publication filters and exact IDs in both transports", () => {
  // Synthetic transport fixture; the canonical relevance set is independently
  // reviewed and separately checked against the actual generated corpus above.
  const records = [
    ["nist-800-53:IA-2.1", "Multi-factor Authentication to Privileged Accounts", "control"],
    ["nist-800-53:IA-2.2", "Multi-factor Authentication to Non-Privileged Accounts", "control"],
    ["nist-800-53:IA-5", "Authenticator Management", "control"],
    ["nist-800-53:IA-2.10", "Single Sign-On", "control"],
    ["nist-800-53a:IA-2.1", "Multifactor Authentication Assessment", "assessment_procedure"],
    ["fixture-external:one", "Multifactor Authentication External Users", "control"],
  ].map(([id, title, object_type]) => ({
    id, item_id: id.split(":")[1], title, object_type, catalog_id: id.split(":")[0],
    source_name: "Synthetic transport fixture", official_text_preview: title, taxonomy_tags: [],
  }));
  for (const columnar of [false, true]) {
    const make = documents => {
      const fields = Object.keys(documents[0]);
      const librarySearch = columnar
        ? { documents: [], indexed_transport: { format: "columns-v1", fields, columns: fields.map(field => documents.map(record => record[field])) } }
        : { documents };
      return createFederalGraphRuntime({ sources: [], nodes: [], edges: [], evidence: [], findings: [], librarySearch });
    };
    const runtime = make(records);
    for (const query of ["MFA", "2FA", "multi-factor authentication", "multifactor authentication", "two factor authentication"]) {
      const actual = runtime.searchLibrary(query).map(record => record.id);
      assert.deepEqual(actual.slice(0, 3), ["nist-800-53:IA-2.1", "nist-800-53:IA-2.2", "nist-800-53:IA-5"]);
      assert.equal(new Set(actual).size, actual.length);
      assert.equal(runtime.getLibraryTagContext(query).result_count, actual.length);
    }
    assert.deepEqual(runtime.searchLibrary("MFA external users").map(record => record.id), ["fixture-external:one"]);
    assert.deepEqual(runtime.searchLibrary("MFA", { catalog_id: "fixture-external" }).map(record => record.id), ["fixture-external:one"]);
    assert.deepEqual(runtime.searchLibrary("MFA", { catalog_ids: ["nist-800-53a"] }).map(record => record.id), ["nist-800-53a:IA-2.1"]);
    const exact = runtime.searchLibrary("IA-2.1").map(record => record.id);
    assert.ok(exact.includes("nist-800-53:IA-2.1"));
    assert.ok(!exact.includes("nist-800-53:IA-2.10"));
    // A preview hit in the first spelling must not discard a stronger title
    // hit from the second spelling before the two expansions are combined.
    const preview = "multifactor authentication contractor";
    const ranked = make([
      { ...records[5], id: "fixture-external:a-preview", item_id: "a-preview", title: "Other", official_text_preview: preview },
      { ...records[5], id: "fixture-external:z-title", item_id: "z-title", title: "Multi-factor authentication contractor", official_text_preview: preview },
    ]);
    assert.equal(ranked.searchLibrary("MFA contractor")[0].id, "fixture-external:z-title");
  }
});
