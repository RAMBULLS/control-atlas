import assert from "node:assert/strict";
import test from "node:test";

import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";

import {
  buildRecordConnectionGroups,
  familyQualifiedRecordId,
  formatRecordTitle,
  GENERATED_STABLE_ID_TYPES,
  humanReadableEvidenceLocator,
  officialRecordName,
  recordIdentityPresentationFor,
  recordIdentityFor,
  recordDisplayTitle,
  recordPublisherName,
  routeDocumentTitle,
  usesScaffoldStableId,
} from "../../src/ui/lib/recordTitle";

test("source detail document titles use the specific source name", () => {
  assert.equal(
    routeDocumentTitle(
      { view: "sources" },
      null,
      "DISA STIG Downloads Landing Page",
    ),
    "DISA STIG Downloads Landing Page — Control Atlas",
  );
  assert.equal(
    routeDocumentTitle({ view: "sources" }),
    "Sources — Control Atlas",
  );
  assert.equal(
    routeDocumentTitle({ view: "sources" }, null, "Source not found"),
    "Source not found — Control Atlas",
  );
});

test("shared record titles do not repeat leading official identifiers", () => {
  assert.equal(
    formatRecordTitle("T1195.002", "T1195.002 COMPROMISE SOFTWARE SUPPLY CHAIN"),
    "T1195.002 COMPROMISE SOFTWARE SUPPLY CHAIN",
  );
  assert.equal(
    formatRecordTitle("SV-230221r991565_rule", "SV-230221r991565_rule — Account policy"),
    "SV-230221r991565_rule — Account policy",
  );
  assert.equal(
    formatRecordTitle("CCI-000001", "cci-000001 Cryptographic protection"),
    "cci-000001 Cryptographic protection",
  );
  assert.equal(
    formatRecordTitle("AC-2", "Account Management"),
    "AC-2 — Account Management",
  );
});

test("shared record titles preserve legitimate later identifier references", () => {
  assert.equal(
    formatRecordTitle("AC-2", "Account Management for AC-2 implementations"),
    "AC-2 — Account Management for AC-2 implementations",
  );
  assert.equal(
    recordDisplayTitle({
      id: "nist-800-53:AC-2",
      node_type: "control",
      metadata: { item_id: "AC-2", title: "Account Management" },
    }),
    "AC-2 — Account Management",
  );
});

test("record template qualifies ambiguous numeric identifiers without changing official IDs", () => {
  assert.equal(
    familyQualifiedRecordId("3.1.1", "Access Control", "nist-800-171-rev2"),
    "AC-3.1.1",
  );
  assert.equal(
    familyQualifiedRecordId("3.10.1", "Physical Protection", "nist-800-172"),
    "PE-3.10.1",
  );
  assert.equal(
    familyQualifiedRecordId(
      "3.12.1",
      "Security Assessment and Monitoring",
      "nist-800-171",
    ),
    "CA-3.12.1",
  );
  assert.equal(
    familyQualifiedRecordId("3.6.1", "Incident response", "nist-800-171-rev2"),
    "IR-3.6.1",
  );
  assert.equal(familyQualifiedRecordId("AC-2", "Access Control"), "AC-2");
  assert.equal(
    familyQualifiedRecordId("3.1.1", "Unknown family", "nist-800-171-rev2"),
    "3.1.1",
  );
  assert.equal(
    familyQualifiedRecordId("3.1.1", "Access Control", "unrelated-catalog"),
    "3.1.1",
  );
});

test("record template never derives a record name from body text", () => {
  assert.equal(
    officialRecordName("3.1.1", "3.1.1"),
    "",
  );
  assert.equal(
    officialRecordName("AC-2", "Account Management"),
    "Account Management",
  );
});

test("record identities use publisher, source-native category, and official identifier", () => {
  assert.equal(recordIdentityFor({ publisher: "NIST", catalogId: "nist-800-53", family: "Access Control", itemId: "AC-2" }), "NIST AC-2");
  assert.equal(recordIdentityFor({ publisher: "NIST", catalogId: "nist-800-171", family: "Access Control", itemId: "3.1.1" }), "NIST AC 3.1.1");
  // ATT&CK techniques belong to every tactic MITRE lists, and `family` is only
  // the first of them, so it must not reach the identity: T1078 would read
  // "MITRE Stealth T1078" for a technique MITRE names "Valid Accounts" and
  // files under four tactics. Identity stays publisher + official ID, and the
  // full membership is a published fact on the record instead.
  assert.equal(recordIdentityFor({ publisher: "MITRE", catalogId: "mitre-attack", family: "Initial Access", itemId: "T1195.002" }), "MITRE T1195.002");
  assert.equal(recordIdentityFor({ publisher: "MITRE", catalogId: "mitre-attack-ics", family: "Impair Process Control", itemId: "T0806" }), "MITRE T0806");
  assert.equal(recordIdentityFor({ publisher: "MITRE", catalogId: "mitre-d3fend", family: "Harden", itemId: "D3-AA" }), "MITRE Harden D3-AA");
  assert.equal(recordIdentityFor({ publisher: "DISA", catalogId: "disa-cci", family: "Policy and Technical", itemId: "CCI-000001" }), "DISA Policy and Technical CCI-000001");
  assert.equal(recordIdentityFor({ publisher: "DISA", catalogId: "disa-stig", family: "IBM Hardware Management Console Security Technical Implementation Guide", itemId: "V-256876", metadata: { identity_category: "HMC" } }), "DISA HMC V-256876");
});

test("baseline headings keep the level word the scaffold key repeats", () => {
  const heading = (catalogId: string, itemId: string, title: string) => recordIdentityPresentationFor({
    publisher: "NIST", catalogId, publicationName: "Baselines", family: "Baselines", itemId, title, objectType: "baseline",
  }).primary;
  assert.equal(heading("nist-800-53b", "HIGH", "High Impact Baseline"), "High Impact Baseline");
  assert.equal(heading("nist-800-53b", "PRIVACY", "Privacy Baseline"), "Privacy Baseline");
  assert.equal(heading("fedramp-rev5", "LOW", "Low Baseline"), "Low Baseline");
  assert.equal(heading("fedramp-rev5", "LI-SAAS", "LI-SaaS Baseline"), "LI-SaaS Baseline");
});

test("FedRAMP control context leads with the control and keeps the publisher title beneath", () => {
  const identity = recordIdentityPresentationFor({
    publisher: "FedRAMP", catalogId: "fedramp-2026", publicationName: "FedRAMP Consolidated Rules for 2026",
    family: "Control parameters and guidance: AC", itemId: "CTL-AC-06-01", title: "AC-06-01 control context", objectType: "control_context",
  });
  assert.equal(identity.primary, "FedRAMP AC-6.1 parameters and guidance");
  assert.equal(identity.secondary, "AC-06-01 control context");
  assert.equal(identity.stableIdIsGenerated, false);
  assert.equal(identity.browserTitle, "FedRAMP AC-6.1 parameters and guidance — AC-06-01 control context");
});

test("no scaffold-keyed record in the corpus loses words from its heading", () => {
  const lost: string[] = [];
  for (const node of readGeneratedCollection(".", "nodes").nodes as any[]) {
    const metadata = node.metadata || {};
    const itemId = String(metadata.item_id || "").trim();
    const title = String(metadata.title || "").trim();
    if (!title || metadata.publisher_item_id || !usesScaffoldStableId(node.node_type, itemId)) continue;
    const primary = recordIdentityPresentationFor({
      publisher: "P", catalogId: metadata.catalog_id, family: "", itemId, title, objectType: node.node_type, metadata,
    }).primary;
    if (primary !== title) lost.push(`${node.id}: "${title}" -> "${primary}"`);
  }
  assert.deepEqual(lost.slice(0, 5), []);
});

test("generated stable IDs yield publisher-authored primary identity and human context", () => {
  const collaborator = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "nist-zt",
    publicationName: "NIST Zero Trust",
    family: "SP 1800-35 Technology Collaborators",
    itemId: "COLLABORATOR-APPGATE-835EC7F121",
    title: "Appgate",
    objectType: "zt_collaborator",
  });
  assert.deepEqual(collaborator, {
    primary: "Appgate",
    secondary: "",
    context: "Technology collaborator · NIST Zero Trust",
    accessibleName: "Appgate, Technology collaborator, NIST Zero Trust",
    browserTitle: "Appgate — Technology collaborator · NIST Zero Trust",
    stableId: "COLLABORATOR-APPGATE-835EC7F121",
    stableIdIsGenerated: true,
  });

  const mappingContributor = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "nist-zt",
    publicationName: "NIST Zero Trust",
    family: "SP 1800-35 Mapping Workbook Contributors",
    itemId: "MAPPING-CONTRIBUTOR-APPGATE-835EC7F121",
    title: "Appgate",
    objectType: "zt_mapping_contributor",
  });
  assert.equal(mappingContributor.primary, "Appgate");
  assert.equal(mappingContributor.context, "Mapping workbook contributor · NIST Zero Trust");
  assert.notEqual(mappingContributor.context, collaborator.context);

  const product = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "nist-zt",
    publicationName: "NIST Zero Trust",
    family: "Appgate",
    itemId:
      "PRODUCT-COMPONENT-APPGATE-APPGATE-HEADLESS-CLIENT-RESOURCE-PROTECTION-CL-E65DEBF0E8",
    title:
      "Appgate Headless Client — Resource Protection – Cloud Workload Protection",
    objectType: "zt_product_component",
  });
  assert.equal(
    product.primary,
    "Appgate Headless Client — Resource Protection – Cloud Workload Protection",
  );
  assert.equal(product.context, "Product component · NIST Zero Trust");

  const iot = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "nist-iot-cybersecurity",
    publicationName: "NIST IoT Device Cybersecurity",
    family: "Non-Technical Manufacturer Capabilities",
    itemId: "DOMAIN-NON-TECHNICAL-MANUFACTURER-CAPABILITIES-1925D28A4B",
    title: "Non-Technical Manufacturer Capabilities",
    objectType: "iot_capability_domain",
  });
  assert.equal(iot.primary, "Non-Technical Manufacturer Capabilities");
  assert.equal(
    iot.context,
    "IoT capability domain · NIST IoT Device Cybersecurity",
  );

  for (const presentation of [collaborator, mappingContributor, product, iot]) {
    assert.doesNotMatch(presentation.primary, /-[0-9A-F]{10}$/);
    assert.doesNotMatch(presentation.accessibleName, /-[0-9A-F]{10}$/);
    assert.match(presentation.stableId, /-[0-9A-F]{10}$/);
  }
});

test("publisher-native identifiers keep their identity-led presentation", () => {
  const cases = [
    {
      publisher: "NIST",
      catalogId: "nist-800-53",
      family: "Access Control",
      itemId: "AC-2",
      title: "Account Management",
      objectType: "control",
      expected: "NIST AC-2",
    },
    {
      publisher: "DISA",
      catalogId: "disa-cci",
      family: "Policy and Technical",
      itemId: "CCI-000366",
      title: "CCI-000366",
      objectType: "cci",
      expected: "DISA Policy and Technical CCI-000366",
    },
    {
      publisher: "DISA",
      catalogId: "disa-stig",
      family: "VMware vSphere 7.0 vCenter Appliance PostgreSQL",
      itemId: "V-256609",
      title: "The PostgreSQL configuration must require approved settings.",
      objectType: "stig_rule",
      metadata: {
        identity_category: "VMware vSphere 7.0 vCenter Appliance PostgreSQL",
      },
      expected:
        "DISA VMware vSphere 7.0 vCenter Appliance PostgreSQL V-256609",
    },
  ];

  for (const input of cases) {
    const presentation = recordIdentityPresentationFor(input);
    assert.equal(presentation.primary, input.expected);
    assert.equal(presentation.stableIdIsGenerated, false);
    assert.equal(presentation.stableId, input.itemId);
  }

  assert.equal(
    recordIdentityPresentationFor(cases[0]).browserTitle,
    "NIST AC-2 — Account Management",
  );
});

test("the generated-ID type contract covers the complete current corpus", () => {
  const nodes = readGeneratedCollection(".", "nodes").nodes;
  const generated = nodes.filter((node: any) =>
    /-[0-9A-F]{10}$/.test(node.metadata?.item_id || ""),
  );
  const generatedTypes = new Set(
    generated.map((node: any) => String(node.node_type)),
  );
  const contracted = nodes.filter((node: any) =>
    GENERATED_STABLE_ID_TYPES.has(String(node.node_type)),
  );

  assert.ok(generated.length > 0);
  assert.equal(
    contracted.length,
    generated.length,
    "every contracted generated-ID type must retain the generated stable-key shape",
  );
  assert.deepEqual(
    [...generatedTypes].sort(),
    [...GENERATED_STABLE_ID_TYPES].sort(),
  );
  assert.ok(
    generated.every((node: any) => node.metadata?.title?.trim()),
    "every generated stable ID needs a publisher-authored display title",
  );
});

test("record publisher names use official compact forms", () => {
  assert.equal(recordPublisherName("National Institute of Standards and Technology"), "NIST");
  assert.equal(recordPublisherName("Defense Information Systems Agency"), "DISA");
  assert.equal(recordPublisherName("The MITRE Corporation"), "MITRE");
});

test("record citations suppress file, path, fragment, and internal-id locators", () => {
  assert.equal(humanReadableEvidenceLocator("Table 3"), "Table 3");
  assert.equal(humanReadableEvidenceLocator("32 CFR 170.14"), "32 CFR 170.14");
  assert.equal(humanReadableEvidenceLocator("Relationships#PR.AA-01"), "");
  assert.equal(humanReadableEvidenceLocator("U_CCI_List.xml#CCI-000010"), "");
  assert.equal(humanReadableEvidenceLocator("folder\\mapping.json"), "");
  assert.equal(humanReadableEvidenceLocator("13c67bb0-9c04-442b-8c7f-0e4f55f995a5"), "");
});

test("record connections include only published cross-catalog correlations", () => {
  const nodes = new Map([
    ["center", { id: "center", metadata: { catalog_id: "nist-800-171-rev2", item_id: "3.1.1", title: "3.1.1" } }],
    ["parent", { id: "parent", metadata: { catalog_id: "nist-800-171-rev2", item_id: "FAMILY-AC", title: "Access Control" } }],
    ["same", { id: "same", metadata: { catalog_id: "nist-800-171-rev2", item_id: "3.1.2", title: "Access Enforcement" } }],
    ["cmmc", { id: "cmmc", metadata: { catalog_id: "cmmc-2", item_id: "L2-AC.1.001", title: "Limit system access" } }],
    ["cci", { id: "cci", metadata: { catalog_id: "disa-cci", item_id: "CCI-000001", title: "Access control" } }],
  ]);
  const groups = buildRecordConnectionGroups(
    "center",
    "nist-800-171-rev2",
    [
      { source_node_id: "parent", target_node_id: "center", relationship_type: "contains", relationship_class: "structural", publication_status: "published" },
      { source_node_id: "center", target_node_id: "same", relationship_type: "maps_to", relationship_class: "correlation", publication_status: "published" },
      { id: "edge-1", source_node_id: "center", target_node_id: "cmmc", relationship_type: "maps_to", relationship_class: "correlation", publication_status: "published", provenance_class: "federal_published", source_refs: [{ source_id: "nist-olir", source_name: "NIST OLIR", source_version: "2.0", locator: "Relationships#PR.AA-01", evidence_quality: "publisher asserted" }] },
      { id: "edge-2", source_node_id: "center", target_node_id: "cmmc", relationship_type: "equivalent_to", relationship_class: "correlation", publication_status: "published", provenance_class: "federal_referenced", source_refs: [{ source_id: "cmmc-model", source_name: "CMMC Model", source_version: "2.0", locator: "Table 3", evidence_quality: "direct" }] },
      { source_node_id: "center", target_node_id: "cci", relationship_type: "references", relationship_class: "correlation", publication_status: "candidate" },
      { source_node_id: "center", target_node_id: "cci", relationship_type: "references" },
    ],
    (id) => nodes.get(id),
    (catalogId) => ({ "cmmc-2": "CMMC 2.0", "disa-cci": "DISA CCI" })[catalogId] || catalogId,
  );
  assert.deepEqual(groups, [{
    catalogId: "cmmc-2",
    label: "CMMC 2.0",
    relationshipType: "equivalent_to",
    items: [{
      nodeId: "cmmc",
      itemId: "L2-AC.1.001",
      title: "Limit system access",
      relationshipType: "equivalent_to",
      edgeId: "edge-2",
      provenanceClass: "federal_referenced",
      sourceRefs: [{ sourceId: "cmmc-model", sourceName: "CMMC Model", sourceVersion: "2.0", locator: "Table 3", evidenceQuality: "direct" }],
    }],
  }, {
    catalogId: "cmmc-2",
    label: "CMMC 2.0",
    relationshipType: "maps_to",
    items: [{
      nodeId: "cmmc",
      itemId: "L2-AC.1.001",
      title: "Limit system access",
      relationshipType: "maps_to",
      edgeId: "edge-1",
      provenanceClass: "federal_published",
      sourceRefs: [{ sourceId: "nist-olir", sourceName: "NIST OLIR", sourceVersion: "2.0", locator: "Relationships#PR.AA-01", evidenceQuality: "publisher asserted" }],
    }],
  }]);
});

test("record connections omit counterparts without public display identity", () => {
  const groups = buildRecordConnectionGroups(
    "center",
    "nist-800-53",
    [{
      id: "edge-private",
      source_node_id: "center",
      target_node_id: "internal-node-id",
      relationship_type: "maps_to",
      relationship_class: "correlation",
      publication_status: "published",
    }],
    () => ({ id: "internal-node-id", metadata: { catalog_id: "private-catalog" } }),
    () => "",
  );
  assert.deepEqual(groups, []);
});

test("record connections never infer missing relationship provenance", () => {
  const groups = buildRecordConnectionGroups(
    "center",
    "nist-800-53",
    [{
      id: "edge-incomplete",
      source_node_id: "center",
      target_node_id: "public-node",
      relationship_class: "correlation",
      publication_status: "published",
    }],
    () => ({
      id: "public-node",
      metadata: {
        catalog_id: "csf-2",
        item_id: "PR.AA-01",
        title: "Identities and credentials are managed",
      },
    }),
    () => "NIST CSF 2.0",
  );
  assert.deepEqual(groups, []);
});

test("Control Atlas scaffold keys never lead a container heading", () => {
  const cases = [
    { objectType: "category", itemId: "CATEGORY-PR.AA", title: "Identity Management, Authentication, and Access Control", family: "Identity Management, Authentication, and Access Control", catalogId: "csf-2", publicationName: "NIST Cybersecurity Framework 2.0" },
    { objectType: "function", itemId: "FUNCTION-PR", title: "PROTECT", family: "PROTECT", catalogId: "csf-2", publicationName: "NIST Cybersecurity Framework 2.0" },
    { objectType: "family", itemId: "FAMILY-AC", title: "Access Control", family: "Access Control", catalogId: "nist-800-53", publicationName: "SP 800-53 Rev. 5" },
    { objectType: "tactic", itemId: "TACTIC-TA0001", title: "Initial Access", family: "Initial Access", catalogId: "mitre-attack", publicationName: "MITRE ATT&CK" },
    { objectType: "benchmark", itemId: "BENCHMARK-VMW-VSPHERE-7-0-VCA-POSTGRESQL-STIG", title: "VMware vSphere 7.0 vCenter Appliance PostgreSQL Security Technical Implementation Guide", family: "VMware vSphere 7.0 vCenter Appliance PostgreSQL Security Technical Implementation Guide", catalogId: "disa-stig", publicationName: "DISA Public STIG Library" },
    { objectType: "rmf_step", itemId: "RMF-ASSESS", title: "Assess", family: "Risk Management Framework", catalogId: "nist-800-37", publicationName: "SP 800-37 Rev. 2" },
  ];
  for (const input of cases) {
    const presentation = recordIdentityPresentationFor({ publisher: "NIST", ...input });
    assert.equal(presentation.primary, input.title, input.itemId);
    assert.equal(presentation.stableId, input.itemId);
    assert.equal(presentation.stableIdIsGenerated, true, input.itemId);
    assert.equal(presentation.browserTitle.includes(input.itemId), false, input.itemId);
  }
});

test("publisher-assigned identifiers still lead their heading", () => {
  const control = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "nist-800-53",
    family: "Access Control",
    itemId: "AC-2",
    title: "Account Management",
    objectType: "control",
  });
  assert.equal(control.primary, "NIST AC-2");
  assert.equal(control.stableIdIsGenerated, false);
});

test("publisher-native container identifiers lead without replacing stable routes", () => {
  const category = recordIdentityPresentationFor({
    publisher: "NIST",
    catalogId: "csf-2",
    publicationName: "NIST Cybersecurity Framework 2.0",
    family: "Identity Management, Authentication, and Access Control",
    itemId: "CATEGORY-PR.AA",
    title: "Identity Management, Authentication, and Access Control",
    objectType: "category",
    metadata: { publisher_item_id: "PR.AA" },
  });
  assert.equal(category.primary, "PR.AA — Identity Management, Authentication, and Access Control");
  assert.equal(category.stableId, "CATEGORY-PR.AA");
  assert.equal(category.stableIdIsGenerated, true);
  assert.equal(category.browserTitle.includes("CATEGORY-"), false);

  const tactic = recordIdentityPresentationFor({
    publisher: "MITRE",
    catalogId: "mitre-attack",
    publicationName: "MITRE ATT&CK",
    family: "Initial Access",
    itemId: "TACTIC-TA0001",
    title: "Initial Access",
    objectType: "tactic",
    metadata: { publisher_item_id: "TA0001" },
  });
  assert.equal(tactic.primary, "TA0001 — Initial Access");
  assert.equal(tactic.stableId, "TACTIC-TA0001");

  assert.equal(recordDisplayTitle({
    id: "csf-2:CATEGORY-PR.AA",
    node_type: "category",
    metadata: {
      item_id: "CATEGORY-PR.AA",
      publisher_item_id: "PR.AA",
      title: "Identity Management, Authentication, and Access Control",
    },
  }), "PR.AA — Identity Management, Authentication, and Access Control");
  assert.equal(recordDisplayTitle({
    id: "nist-ai-rmf:GROUP-GOVERN-1",
    node_type: "group",
    metadata: {
      item_id: "GROUP-GOVERN-1",
      publisher_item_id: "GOVERN-1",
      title: "GOVERN-1",
    },
  }), "GOVERN-1");
});
