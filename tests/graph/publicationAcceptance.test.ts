import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadPublicationAcceptanceInputs, renderPublicationMatrixMarkdown } from "../../tools/publication-acceptance-matrix.mjs";
import { buildPublicationAcceptanceMatrix } from "../../src/ui/lib/publicationAcceptance";

const inputs = loadPublicationAcceptanceInputs();
const matrix = buildPublicationAcceptanceMatrix(inputs);
const identities = JSON.parse(readFileSync("data/generated/publication-identity-index.json", "utf8")).identities;
const bootstrap = JSON.parse(readFileSync("data/generated/catalog-bootstrap.json", "utf8")).catalog_bootstrap;

// Issue #284's representative acceptance set. The matrix itself covers the whole corpus.
const REPRESENTATIVE = [
  "nist-800-53", "nist-800-53a", "nist-800-53b", "nist-800-37",
  "fips-199", "fips-200",
  "disa-stig", "disa-srg", "disa-cci",
  "cmmc-2", "cui-policy",
  "fedramp-2026", "fedramp-rev5",
  "dod-zt", "nist-zt",
  "mitre-attack", "mitre-attack-ics", "mitre-d3fend",
  "dod-rai", "nist-mobile-threats", "microsoft-zt-maturity", "nist-iot-cybersecurity",
];
const REPRESENTATIVE_POLICY = [
  "authority-usc-44-3554", "authority-32-cfr-170", "authority-dfars-252-204-7012",
  "authority-eo-13556", "authority-omb-m-24-15", "authority-dodi-8500-01",
];

test("the matrix covers every public publication and every Library catalog", () => {
  assert.equal(matrix.rows.length, identities.length);
  assert.deepEqual(matrix.uncoveredCatalogs, []);
  const catalogs = new Set(matrix.rows.map((row) => row.catalogId).filter(Boolean));
  for (const catalog of bootstrap.catalogs) assert.ok(catalogs.has(catalog.id), `${catalog.id} has a matrix row`);
  assert.ok(matrix.rows.some((row) => row.kind === "policy"));
});

test("every publication is accepted: identity resolves and every surface agrees", () => {
  const blocked = matrix.rows.filter((row) => row.status !== "ACCEPTED");
  assert.deepEqual(blocked.map((row) => `${row.id}: ${row.issues.join("; ")}`), []);
  for (const row of matrix.rows) {
    assert.equal(row.facts.officialTitle, "recorded", row.id);
    assert.equal(row.facts.publisher, "recorded", row.id);
    assert.equal(row.surfaces.sources, "same", row.id);
    if (row.catalogId) {
      for (const surface of ["atlas", "library", "publicationPage"] as const) assert.equal(row.surfaces[surface], "same", `${row.id} ${surface}`);
      assert.ok(row.nextActions.includes("browse"), `${row.id} can be browsed`);
      assert.ok(row.records > 0, `${row.id} indexes records`);
    }
    assert.ok(row.nextActions.includes("sources"), `${row.id} links to its source details`);
  }
});

test("the representative publications and policy documents are all present and accepted", () => {
  const byCatalog = new Map(matrix.rows.map((row) => [row.catalogId || row.id, row]));
  for (const id of [...REPRESENTATIVE, ...REPRESENTATIVE_POLICY]) {
    assert.equal(byCatalog.get(id)?.status, "ACCEPTED", id);
  }
  for (const id of REPRESENTATIVE_POLICY) assert.equal(byCatalog.get(id)?.kind, "policy", id);
  assert.equal(byCatalog.get("fedramp-rev5")?.lifecycle, "Historical");
  assert.equal(byCatalog.get("fedramp-2026")?.lifecycle, "Active");
});

test("missing source facts are classified, not filled", () => {
  const states = matrix.summary.facts;
  assert.ok(states.version.retrieval_dated >= 1, "retrieval-dated versions are called out");
  assert.ok(states.freshness.retrieved_only >= 1, "retrieval without a check is called out");
  for (const row of matrix.rows) {
    if (row.facts.version === "retrieval_dated") assert.equal(row.versionLabel, "Not stated by the publisher");
    if (row.facts.freshness !== "checked") assert.ok(row.limitations.includes("no_check_recorded"), row.id);
  }
  const markdown = renderPublicationMatrixMarkdown(matrix);
  assert.match(markdown, /Source-fact classification/);
});

test("a contradiction between surfaces blocks the publication", () => {
  // Rebuild with an Atlas publisher that disagrees with Sources for one publication.
  const territory = {
    ...inputs.territory,
    publications: inputs.territory.publications.map((entry) =>
      entry.id === "disa-stig" ? { ...entry, publisher: "Somebody else" } : entry),
  };
  const result = buildPublicationAcceptanceMatrix({ ...inputs, territory });
  const stig = result.rows.find((row) => row.catalogId === "disa-stig")!;
  assert.equal(stig.status, "BLOCKED");
  assert.equal(stig.surfaces.atlas, "MISMATCH");
});
