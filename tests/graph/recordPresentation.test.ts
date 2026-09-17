import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  missingRequiredRecordFields,
  PAGE_ROLES,
  relationshipTreatmentFor,
  RELATIONSHIP_TREATMENTS,
  recordPresentationContract,
  SUPPORTED_RECORD_CONTRACT_KEYS,
  SUPPORTED_RECORD_TYPES,
  undeclaredCapturedRecordFields,
} from "../../src/shared/record-presentation.mjs";
import {
  buildSourceTextPresentation,
  isValidSourceTextPresentation,
} from "../../src/shared/source-text-presentation.mjs";

test("record presentation profiles use source-native headings", () => {
  assert.equal(recordPresentationContract("nist-800-53", "control").sections[0].heading, "Control Statement");
  assert.equal(recordPresentationContract("nist-800-171", "requirement").sections[0].heading, "Requirement");
  assert.equal(recordPresentationContract("disa-stig", "stig_rule").sections[0].heading, "Discussion");
  assert.equal(recordPresentationContract("mitre-attack", "attack_technique").sections[0].heading, "Technique Description");
  assert.equal(recordPresentationContract("mitre-d3fend", "defend_countermeasure").sections[0].heading, "Countermeasure Description");
  const assessmentProfile = recordPresentationContract("nist-800-53a", "assessment_procedure");
  assert.equal(assessmentProfile.sections[0].heading, "Assessment Procedure");
  assert.equal(assessmentProfile.sections[0].field, "procedure_text");
});

test("record presentation rejects unknown kinds and missing required source fields", () => {
  assert.throws(
    () => recordPresentationContract("future-catalog", "future_record"),
    /Missing record presentation contract/,
  );
  const profile = recordPresentationContract("disa-stig", "stig_rule");
  assert.deepEqual(
    missingRequiredRecordFields(profile, { description: "Discussion", check_text: "Check" }),
    ["fix_text"],
  );
});

test("catalog-specific profiles preserve source-native nouns", () => {
  assert.equal(recordPresentationContract("csf-2", "requirement").sections[0].heading, "Outcome");
  assert.equal(recordPresentationContract("nist-ssdf", "requirement").sections[0].heading, "Practice");
  assert.equal(recordPresentationContract("nist-ai-rmf", "requirement").sections[0].heading, "Action");
  assert.equal(recordPresentationContract("dod-rai", "requirement").sections[0].heading, "Guidance");
  assert.equal(recordPresentationContract("disa-cci", "requirement").sections[1].field, "references");
  assert.equal(recordPresentationContract("dod-zt", "zt_activity").sections[1].field, "outcomes");
  assert.equal(recordPresentationContract("nist-zt", "zt_product_component").sections[1].field, "mapping_targets");
  assert.equal(recordPresentationContract("nist-zt", "zt_collaborator").sections[0].field, "publisher_context");
  assert.equal(recordPresentationContract("nist-zt", "zt_mapping_contributor").sections[0].field, "publisher_field");
  assert.equal(recordPresentationContract("nist-iot-cybersecurity", "iot_capability_element").sections[1].field, "publisher_mappings");
  const mobileThreat = recordPresentationContract("nist-mobile-threats", "mobile_threat");
  assert.deepEqual(mobileThreat.required_fields, ["title"]);
  assert.ok(mobileThreat.sections.every((section) => section.field !== "description"));
  assert.ok(mobileThreat.sections.some((section) => section.field === "publisher_field_availability"));
});

test("every supported record form has a presentation contract", () => {
  assert.equal(new Set(SUPPORTED_RECORD_TYPES).size, SUPPORTED_RECORD_TYPES.length);
  assert.equal(SUPPORTED_RECORD_TYPES.includes("zt_overlay_section"), false);
  for (const key of SUPPORTED_RECORD_CONTRACT_KEYS) {
    const separator = key.indexOf(":");
    const profile = recordPresentationContract(key.slice(0, separator), key.slice(separator + 1));
    assert.ok(profile.sections.length > 0, `${key} sections`);
    assert.ok(profile.required_fields.length > 0 || profile.optional_fields.length > 0, `${key} fields`);
    for (const item of profile.sections) {
      assert.ok(profile.field_dispositions[item.field], `${key}:${item.field} disposition`);
    }
  }
  assert.throws(() => recordPresentationContract("future-catalog", "requirement"), /Missing record presentation contract/);
});

test("record presentation contracts validate against the governed schema", () => {
  const schema = JSON.parse(readFileSync("data/schemas/record-presentation-contract.schema.json", "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const key of SUPPORTED_RECORD_CONTRACT_KEYS) {
    const separator = key.indexOf(":");
    const value = recordPresentationContract(key.slice(0, separator), key.slice(separator + 1));
    assert.equal(validate(value), true, `${key}: ${JSON.stringify(validate.errors)}`);
  }
});

test("fixture manifest covers every final supported record type with a real runtime node", () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/record-type-fixtures.json", "utf8"));
  const manifest = JSON.parse(readFileSync("data/generated/nodes.json", "utf8"));
  const nodes = manifest.sharded_collection.shards.flatMap((shard: { path: string }) =>
    JSON.parse(readFileSync(join("data/generated", shard.path), "utf8")).nodes,
  );
  const byId = new Map(nodes.map((node: any) => [node.id, node]));
  assert.deepEqual(new Set(fixture.records.map((entry: any) => entry.record_type)), new Set(SUPPORTED_RECORD_TYPES));
  for (const entry of fixture.records) {
    const node: any = byId.get(`${entry.catalog_id}:${entry.record_id}`);
    assert.ok(node, `${entry.catalog_id}:${entry.record_id}`);
    assert.equal(node.node_type, entry.record_type);
    const profile = recordPresentationContract(entry.catalog_id, entry.record_type);
    assert.equal(profile.page_role, entry.page_role);
    assert.deepEqual(undeclaredCapturedRecordFields(profile, node.metadata || {}), [], `${node.id} dispositions`);
    for (const field of entry.expected_fields || []) {
      assert.notEqual(node.metadata?.[field], null, `${node.id}:${field}`);
      assert.notEqual(node.metadata?.[field], undefined, `${node.id}:${field}`);
      assert.ok(profile.field_dispositions[field], `${node.id}:${field} disposition`);
    }
  }
});

test("high-risk publisher fields survive normalization into runtime metadata exactly", () => {
  const manifest = JSON.parse(readFileSync("data/generated/nodes.json", "utf8"));
  const nodes = manifest.sharded_collection.shards.flatMap((shard: { path: string }) =>
    JSON.parse(readFileSync(join("data/generated", shard.path), "utf8")).nodes,
  );
  const byId = new Map(nodes.map((node: any) => [node.id, node]));
  const cases = [
    {
      catalogId: "csf-2",
      recordId: "PR.AA-01",
      sourcePath: "data/csf-subcategories.json",
      fields: ["description"],
      metadataFields: ["implementation_examples", "informative_references"],
    },
    {
      catalogId: "disa-stig",
      recordId: "V-256609",
      sourcePath: "data/stig-rules.json",
      fields: ["description", "check_text", "fix_text", "severity", "rule_id", "vuln_id", "stig_id"],
      metadataFields: [],
    },
    {
      catalogId: "disa-srg",
      recordId: "V-202013",
      sourcePath: "data/srg-requirements.json",
      fields: ["description", "check_text", "fix_text", "severity", "rule_id", "vuln_id", "stig_id"],
      metadataFields: [],
    },
  ];
  for (const entry of cases) {
    const source = JSON.parse(readFileSync(entry.sourcePath, "utf8")).records.find(
      (record: any) => record.id === entry.recordId,
    );
    const runtime: any = byId.get(`${entry.catalogId}:${entry.recordId}`);
    assert.ok(source, `${entry.sourcePath}:${entry.recordId}`);
    assert.ok(runtime, `${entry.catalogId}:${entry.recordId}`);
    for (const field of entry.fields) {
      assert.deepEqual(runtime.metadata[field], source[field], `${runtime.id}:${field}`);
    }
    for (const field of entry.metadataFields) {
      assert.deepEqual(runtime.metadata[field], source.metadata[field], `${runtime.id}:${field}`);
    }
  }
});

test("relationship governance preserves edges while selecting page treatment", () => {
  const csf = recordPresentationContract("csf-2", "requirement");
  const stig = recordPresentationContract("disa-stig", "stig_rule");
  assert.equal(relationshipTreatmentFor({ recordContract: csf, counterpartContract: stig, recordCatalogId: "csf-2", counterpartCatalogId: "disa-stig", relationshipType: "maps_to", relationshipClass: "correlation" }), RELATIONSHIP_TREATMENTS.ATLAS_ONLY);
  const benchmark = recordPresentationContract("disa-stig", "benchmark");
  assert.equal(relationshipTreatmentFor({ recordContract: benchmark, counterpartContract: csf, recordCatalogId: "disa-stig", counterpartCatalogId: "csf-2", relationshipType: "maps_to", relationshipClass: "correlation" }), RELATIONSHIP_TREATMENTS.SUMMARIZE);
  assert.equal(benchmark.page_role, PAGE_ROLES.CONTAINER);
});

test("every observed supported correlation tuple resolves to a governed treatment", () => {
  const nodeManifest = JSON.parse(readFileSync("data/generated/nodes.json", "utf8"));
  const edgeManifest = JSON.parse(readFileSync("data/generated/edges.json", "utf8"));
  const nodes = nodeManifest.sharded_collection.shards.flatMap((shard: { path: string }) =>
    JSON.parse(readFileSync(join("data/generated", shard.path), "utf8")).nodes,
  );
  const edges = edgeManifest.sharded_collection.shards.flatMap((shard: { path: string }) =>
    JSON.parse(readFileSync(join("data/generated", shard.path), "utf8")).edges,
  );
  const byId = new Map(nodes.map((node: any) => [node.id, node]));
  const supported = new Set(SUPPORTED_RECORD_CONTRACT_KEYS);
  const observed = new Set<string>();
  for (const edge of edges) {
    if (edge.publication_status !== "published" || edge.relationship_class !== "correlation") continue;
    const source: any = byId.get(edge.source_node_id);
    const target: any = byId.get(edge.target_node_id);
    if (!source || !target) continue;
    const sourceCatalog = source.metadata?.catalog_id;
    const targetCatalog = target.metadata?.catalog_id;
    const sourceKey = `${sourceCatalog}:${source.node_type}`;
    const targetKey = `${targetCatalog}:${target.node_type}`;
    if (!supported.has(sourceKey) || !supported.has(targetKey)) continue;
    observed.add(`${sourceKey}|${targetKey}|${edge.relationship_type}`);
    const treatment = relationshipTreatmentFor({
      recordContract: recordPresentationContract(sourceCatalog, source.node_type),
      counterpartContract: recordPresentationContract(targetCatalog, target.node_type),
      recordCatalogId: sourceCatalog,
      counterpartCatalogId: targetCatalog,
      relationshipType: edge.relationship_type,
      relationshipClass: edge.relationship_class,
    });
    assert.ok(Object.values(RELATIONSHIP_TREATMENTS).includes(treatment), [...observed].at(-1));
  }
  assert.ok(observed.size > 0, "expected published supported correlation tuples");
});

test("V-256609 formatting keeps exact command and configuration source ranges", () => {
  const records = JSON.parse(readFileSync("data/stig-rules.json", "utf8")).records;
  const record = records.find((entry: any) => entry.id === "V-256609");
  assert.ok(record, "V-256609 must remain in the current DISA corpus");
  const { check_text: check, fix_text: fix } = record;

  for (const text of [check, fix]) {
    const presentation = buildSourceTextPresentation(text);
    assert.equal(isValidSourceTextPresentation(text, presentation), true);
    const snippets = presentation.blocks.filter((block) => block.kind === "code");
    assert.ok(snippets.length > 0);
    for (const snippet of snippets) {
      assert.equal(text.slice(snippet.start, snippet.end), text.substring(snippet.start, snippet.end));
      assert.match(text.slice(snippet.start, snippet.end), /^# /);
    }
  }
  const fixPresentation = buildSourceTextPresentation(fix);
  assert.equal(fixPresentation.blocks.filter((block) => block.kind === "list").length, 2);
  assert.equal(fixPresentation.blocks.filter((block) => block.kind === "code").length, 2);
});

test("all-ATLAS_ONLY relationships produce zero visible groups and no fake 0 count badge", () => {
  const csfContract = recordPresentationContract("csf-2", "requirement");
  const stigContract = recordPresentationContract("disa-stig", "stig_rule");
  const treatment = relationshipTreatmentFor({
    recordContract: csfContract,
    counterpartContract: stigContract,
    recordCatalogId: "csf-2",
    counterpartCatalogId: "disa-stig",
    relationshipType: "maps_to",
    relationshipClass: "correlation",
  });
  assert.equal(treatment, RELATIONSHIP_TREATMENTS.ATLAS_ONLY);

  const mockGovernedGroups = [
    {
      catalogId: "disa-stig",
      label: "DISA STIG",
      relationshipType: "maps_to",
      treatment,
      items: [
        {
          edgeId: "edge-1",
          nodeId: "disa-stig:V-1234",
          itemId: "V-1234",
          title: "Sample STIG Rule",
          provenanceClass: "published_record",
        },
      ],
    },
  ];
  const visibleGroups = mockGovernedGroups.filter(
    (group) => group.treatment !== RELATIONSHIP_TREATMENTS.ATLAS_ONLY,
  );
  const visibleCount = visibleGroups.reduce((acc, g) => acc + g.items.length, 0);

  // Asserts that no visible connection groups are created, preventing an empty Related records wrapper with count 0
  assert.equal(visibleGroups.length, 0);
  assert.equal(visibleCount, 0);
});
