import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAtlasSpine } from "../scripts/build-framework-data.mjs";

const authority = JSON.parse(
  readFileSync("data/curated/authority-spine.json", "utf8"),
);
const tree = JSON.parse(readFileSync("data/curated/tree-spine.json", "utf8"));
const registry = JSON.parse(readFileSync("data/source-registry.json", "utf8"));

const MANDATES = new Set([
  "statutory",
  "contractual",
  "federal_policy_or_regulatory_mandate",
  "issued_without_federal_mandate",
]);
const AUTHORITY_TYPES = new Set(["statute", "regulation", "policy_directive"]);
const registrySources = [
  ...(registry.publications || []),
  ...(registry.sources || []),
  ...(registry.artifacts || []),
];
const registrySourceIds = new Set(registrySources.map((source) => source.id));
const registryPublications = new Map(
  (registry.publications || []).map((source) => [source.id, source]),
);
const bundlesByCatalog = new Map(
  (registry.catalog_source_bundles || []).map((bundle) => [bundle.catalog_id, bundle]),
);

function sourceRefsAreValid(owner, refs) {
  assert.ok(Array.isArray(refs) && refs.length > 0, `${owner} needs source_refs`);
  for (const ref of refs) {
    assert.ok(registrySourceIds.has(ref.source_id), `${owner} references missing ${ref.source_id}`);
    assert.ok(ref.ref_type, `${owner} source ref needs ref_type`);
    assert.ok(ref.locator, `${owner} source ref needs an evidence locator`);
  }
}

test("authority spine covers all 30 Atlas publications including both restored reference catalogs", () => {
  const expected = [
    ...Object.keys(tree.catalogLimbs),
    ...tree.syntheticCatalogs.map((entry) => entry.catalog_id),
  ].sort();
  const actual = authority.publications.map((entry) => entry.catalog_id).sort();
  assert.equal(new Set(actual).size, actual.length, "duplicate authority publication");
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 30);
  for (const id of ["nist-csf-1.1", "nist-critical-software"]) assert.ok(actual.includes(id), id);
});

test("authority instruments use the three authorized node types and registered official sources", () => {
  assert.equal(authority.schema_version, "1.0");
  const ids = new Set();
  for (const instrument of authority.instruments) {
    assert.match(instrument.id, /^authority:[A-Z0-9.-]+$/);
    assert.ok(!ids.has(instrument.id), `duplicate instrument ${instrument.id}`);
    ids.add(instrument.id);
    assert.ok(AUTHORITY_TYPES.has(instrument.node_type), instrument.id);
    assert.ok(instrument.label && instrument.blurb, `${instrument.id} needs display copy`);
    assert.ok(registrySourceIds.has(instrument.source_id), `${instrument.id} missing registry source`);
    const source = registryPublications.get(instrument.source_id);
    assert.ok(source, `${instrument.source_id} must be a registry publication`);
    assert.match(source.artifact_url, /^https:\/\//);
    assert.notEqual(source.owner, "Publisher not recorded");
    sourceRefsAreValid(instrument.id, instrument.source_refs);
  }
  assert.ok(!ids.has("authority:FIPS-199"));
  assert.ok(!ids.has("authority:FIPS-200"));
});

test("every declared instrument parent resolves and authority relationships are acyclic", () => {
  const byId = new Map(authority.instruments.map((entry) => [entry.id, entry]));
  for (const instrument of authority.instruments) {
    if (instrument.parent !== null) {
      assert.ok(byId.has(instrument.parent), `${instrument.id} has missing parent ${instrument.parent}`);
    }
    const seen = new Set([instrument.id]);
    let cursor = instrument;
    while (cursor.parent !== null) {
      assert.ok(!seen.has(cursor.parent), `authority cycle reaches ${cursor.parent}`);
      seen.add(cursor.parent);
      cursor = byId.get(cursor.parent);
    }
  }
});

test("publication mandate fields and authority references are complete", () => {
  const authorityIds = new Set(authority.instruments.map((entry) => entry.id));
  for (const publication of authority.publications) {
    assert.ok(MANDATES.has(publication.mandate), `${publication.catalog_id} mandate`);
    assert.ok(publication.publication_type, `${publication.catalog_id} publication_type`);
    assert.ok(Array.isArray(publication.also_required_by));
    sourceRefsAreValid(publication.catalog_id, publication.source_refs);

    if (publication.mandate === "issued_without_federal_mandate") {
      assert.equal(publication.primary_authority, null, publication.catalog_id);
      assert.ok(publication.mandate_note.trim(), `${publication.catalog_id} needs mandate_note`);
    } else {
      assert.ok(publication.primary_authority, `${publication.catalog_id} needs primary authority`);
    }

    for (const authorityId of [
      publication.primary_authority,
      ...publication.also_required_by,
    ].filter(Boolean)) {
      assert.ok(authorityIds.has(authorityId), `${publication.catalog_id} references ${authorityId}`);
    }
  }
});

test("mixed, conditional, and legacy publications preserve their verified scope", () => {
  const byCatalog = new Map(
    authority.publications.map((entry) => [entry.catalog_id, entry]),
  );
  assert.match(byCatalog.get("csf-2").mandate_note, /federal scope|federal-network/i);
  assert.match(byCatalog.get("csf-2").mandate_note, /voluntar/i);
  assert.match(byCatalog.get("nist-800-172").mandate_note, /only when.*select/i);
  assert.match(byCatalog.get("nist-800-172").mandate_note, /2021 edition|not Rev\. 3/i);
  assert.match(byCatalog.get("fedramp-rev5").mandate_note, /legacy/i);
  assert.match(byCatalog.get("fedramp-rev5").mandate_note, /transition/i);
  assert.match(byCatalog.get("nist-ssdf").mandate_note, /M-26-05/i);
  assert.match(byCatalog.get("nist-ssdf").mandate_note, /rescinded/i);
});

test("authority mandate values reconcile with publication mandate_basis", () => {
  for (const publication of authority.publications) {
    const bundle = bundlesByCatalog.get(publication.catalog_id);
    assert.ok(bundle, `${publication.catalog_id} missing catalog source bundle`);
    const registryPublication = registryPublications.get(bundle.publication_source_id);
    assert.ok(registryPublication, `${publication.catalog_id} missing registry publication`);
    const basis = registryPublication.mandate_basis || [];
    if (publication.mandate === "issued_without_federal_mandate") {
      assert.deepEqual(basis, [], `${publication.catalog_id} must have empty mandate_basis`);
    } else {
      assert.ok(basis.length > 0, `${publication.catalog_id} needs registry mandate_basis`);
    }
  }

  assert.deepEqual(registryPublications.get("nist-ai-rmf-playbook").mandate_basis, []);
  assert.deepEqual(registryPublications.get("nist-ssdf").mandate_basis, []);
  assert.deepEqual(registryPublications.get("nist-ssdf-oscal").mandate_basis, []);
  assert.deepEqual(registryPublications.get("nist-800-172-rev3").mandate_basis, []);
  assert.deepEqual(registryPublications.get("dod-rai-toolkit").mandate_basis, []);
});

test("runtime Atlas spine keeps child and descendant-record counts distinct", () => {
  const graph = {
    nodes: [
      { id: "atlas:TRUNK", node_type: "trunk", label: "Cybersecurity", metadata: { title: "Cybersecurity" } },
      { id: "atlas:LIMB-TEST", node_type: "limb", label: "Test", metadata: { title: "Test" } },
      { id: "example:CATALOG", node_type: "catalog", label: "Example", metadata: { catalog_id: "example", title: "Example" } },
      { id: "example:FAMILY-A", node_type: "family", label: "Family A", metadata: { catalog_id: "example", title: "Family A" } },
      { id: "example:A-1", node_type: "control", label: "A-1", metadata: { catalog_id: "example", title: "A-1" } },
      { id: "example:A-2", node_type: "control", label: "A-2", metadata: { catalog_id: "example", title: "A-2" } },
      { id: "example-assess:CATALOG", node_type: "catalog", label: "Assessment", metadata: { catalog_id: "example-assess", title: "Assessment" } },
      { id: "example-assess:A-1", node_type: "assessment_procedure", label: "A-1", metadata: { catalog_id: "example-assess", family: "AC", title: "Assess A-1" } },
      { id: "example-assess:A-2", node_type: "assessment_procedure", label: "A-2", metadata: { catalog_id: "example-assess", family: "AC", title: "Assess A-2" } },
    ],
    edges: [
      { id: "e1", source_node_id: "atlas:TRUNK", target_node_id: "atlas:LIMB-TEST", relationship_type: "organizes", publication_status: "editorial" },
      { id: "e2", source_node_id: "atlas:LIMB-TEST", target_node_id: "example:CATALOG", relationship_type: "organizes", publication_status: "editorial" },
      { id: "e2b", source_node_id: "atlas:LIMB-TEST", target_node_id: "example-assess:CATALOG", relationship_type: "organizes", publication_status: "editorial" },
      { id: "e3", source_node_id: "example:CATALOG", target_node_id: "example:FAMILY-A", relationship_type: "contains", relationship_class: "structural", publication_status: "published" },
      { id: "e4", source_node_id: "example:FAMILY-A", target_node_id: "example:A-1", relationship_type: "contains", relationship_class: "structural", publication_status: "published" },
      { id: "e5", source_node_id: "example:FAMILY-A", target_node_id: "example:A-2", relationship_type: "contains", relationship_class: "structural", publication_status: "published" },
    ],
  };
  const spine = buildAtlasSpine(
    graph,
    {
      instruments: [{ id: "authority:TEST", node_type: "statute", label: "Test law", blurb: "Test", parent: null }],
      publications: [
        { catalog_id: "example", mandate: "statutory", primary_authority: "authority:TEST", also_required_by: [], publication_type: "standard", mandate_note: "Test note" },
        { catalog_id: "example-assess", mandate: "statutory", primary_authority: "authority:TEST", also_required_by: [], publication_type: "assessment", mandate_note: "Test note" },
      ],
    },
    {
      trunk: { id: "atlas:TRUNK" },
      limbs: [{ id: "atlas:LIMB-TEST", label: "Test", blurb: "Test area" }],
      catalogLimbs: { example: "atlas:LIMB-TEST", "example-assess": "atlas:LIMB-TEST" },
      syntheticCatalogs: [],
    },
  );
  const family = spine.entries.find((entry) => entry.id === "example:FAMILY-A");
  assert.equal(family.child_count, 2);
  assert.equal(family.descendant_record_count, 2);
  const catalog = spine.entries.find((entry) => entry.id === "example:CATALOG");
  assert.equal(catalog.child_count, 1);
  assert.equal(catalog.descendant_record_count, 2);
  const assessment = spine.entries.find(
    (entry) => entry.id === "example-assess:CATALOG",
  );
  assert.equal(assessment.child_count, 1);
  assert.equal(assessment.descendant_record_count, 2);
  const membership = spine.entries.find(
    (entry) => entry.parent_id === "example-assess:CATALOG",
  );
  assert.equal(membership.id, "membership:example-assess:AC");
  assert.equal(membership.child_count, 2);
  assert.equal(membership.descendant_record_count, 2);
});
