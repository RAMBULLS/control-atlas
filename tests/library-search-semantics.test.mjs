import assert from "node:assert/strict";
import test from "node:test";

import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";
import { createFederalGraphRuntime } from "../src/app/runtime.mjs";

// Real generated Library data. Expected counts are derived by scanning the raw records
// independently of the search code, so these tests cannot merely restate the answer.
const librarySearch = readGeneratedCollection(".", "library-search").library_search;
const runtime = createFederalGraphRuntime({
  sources: [],
  nodes: [],
  edges: [],
  evidence: [],
  findings: [],
  librarySearch,
});
const documents = librarySearch.documents;
const lower = (value) => String(value || "").trim().toLowerCase();
const textOf = (document) => [
  document.search_item_id || lower(document.item_id),
  document.search_title || lower(document.title),
  lower(document.control_family),
  lower(document.source_name),
  lower(document.publisher_name),
  lower(document.official_text_preview),
].join(" ");
const indexedText = documents.map(textOf);
const recordsContainingAll = (...words) =>
  indexedText.filter((text) => words.every((word) => text.includes(word))).length;
const count = (query, filters = {}) => runtime.getLibraryTagContext(query, filters).result_count;

for (const version of ["2019", "2016", "2022"]) {
  test(`windows server ${version} returns the records that contain those words`, () => {
    const expected = recordsContainingAll("windows", "server", version);
    assert.ok(expected > 0, `the accepted data should contain Windows Server ${version} records`);
    assert.equal(count(`windows server ${version}`), expected);
    const top = runtime.searchLibrary(`windows server ${version}`).slice(0, 10);
    assert.ok(top.every((document) => lower(document.title).includes(`windows server ${version}`)));
  });
}

test("adding a correct term never turns a broad search into zero", () => {
  const broad = count("windows server");
  assert.ok(broad > 1000, "windows server stays broad");
  for (const term of ["2019", "2016", "2022", "audit", "password"]) {
    const expected = recordsContainingAll("windows", "server", term);
    assert.equal(count(`windows server ${term}`), expected, `windows server ${term}`);
    assert.ok(expected <= broad);
  }
  assert.ok(count("server 2019") >= count("windows server 2019"), "server 2019 stays broad");
  assert.ok(count("windows 2019") > 0);
});

test("three-word queries that merely look like a STIG id still search by their words", () => {
  for (const query of ["server 2019 audit", "windows 10 must", "windows server 2022"]) {
    assert.ok(count(query) > 0, query);
  }
});

test("notation rewriting never hides product and version words", () => {
  for (const query of ["sp 800-53", "sp 800-171", "red hat 8", "tls 1.2", "iis 10"]) {
    assert.ok(count(query) > 0, query);
  }
  const redHat = runtime.searchLibrary("red hat 8");
  assert.ok(redHat.every((document) => /(^|[^a-z0-9])8([^a-z0-9]|$)/.test(textOf(document))), "8 matches whole numbers only");
});

test("exact identifiers still resolve and rank first", () => {
  assert.equal(runtime.searchLibrary("V-205646")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("CCI-000185")[0].id, "disa-cci:CCI-000185");
  assert.equal(runtime.searchLibrary("AC-2")[0].id, "nist-800-53:AC-2");
  assert.equal(runtime.searchLibrary("wn19 dc 000290")[0].id, "disa-stig:V-205646");
  assert.equal(runtime.searchLibrary("WN19-DC-000290")[0].id, "disa-stig:V-205646");
});

test("plain-language searches stay broad", () => {
  for (const [query, minimum] of [["password", 1000], ["audit logging", 100], ["multifactor authentication", 100], ["remote desktop", 10], ["account lockout", 10]]) {
    assert.ok(count(query) >= minimum, `${query} returns at least ${minimum}`);
  }
});

test("a query that names a publication ranks that publication first", () => {
  const catalogsOfTop = (query, size) => runtime.searchLibrary(query).slice(0, size).map((document) => document.catalog_id);
  assert.ok(catalogsOfTop("DISA STIG", 25).every((id) => id === "disa-stig"));
  assert.ok(catalogsOfTop("FedRAMP", 10).every((id) => id.startsWith("fedramp")));
  assert.ok(catalogsOfTop("SP 800-53", 25).every((id) => id.startsWith("nist-800-53")));
  assert.ok(catalogsOfTop("ATT&CK", 25).every((id) => id.startsWith("mitre-attack")));
});

test("a genuine zero stays zero", () => {
  assert.equal(recordsContainingAll("zzqxv", "kkwp"), 0);
  assert.equal(count("zzqxv 2019 kkwp"), 0);
  assert.equal(runtime.searchLibrary("zzqxv 2019 kkwp").length, 0);
});

test("a single digit alone is still not a search", () => {
  assert.equal(count("8"), 0);
});

test("the Atlas tag handoff population is unchanged by free-text changes", () => {
  const tags = ["program.stig", "product.microsoft-windows", "asset.server"];
  const filters = { catalog_id: "disa-stig", taxonomy_tag_groups: tags.map((tag) => [tag]) };
  const expected = documents.filter((document) => document.catalog_id === "disa-stig"
    && tags.every((tag) => (document.taxonomy_tags || []).some((entry) => (typeof entry === "string" ? entry : entry?.id) === tag))).length;
  assert.ok(expected > 0);
  assert.equal(count("", filters), expected);
  assert.equal(count("windows server 2019", filters) <= expected, true);
});

test("repeated identical searches agree and different filters are never mixed up", () => {
  const first = runtime.searchLibrary("windows server 2019").map((document) => document.id);
  const again = runtime.searchLibrary("windows server 2019").map((document) => document.id);
  assert.deepEqual(again, first);
  const filtered = count("windows server 2019", { catalog_id: "nist-800-53" });
  assert.equal(filtered, 0);
  assert.equal(count("windows server 2019"), recordsContainingAll("windows", "server", "2019"));
});
