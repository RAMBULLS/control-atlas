import assert from "node:assert/strict";
import test from "node:test";

import {
  atlasStructuralRowIdentity,
  buildAtlasBootstrapModel,
  buildAtlasDrilldownModel,
  hydrateAtlasFrameworkRecords,
  type AtlasDrillEdge,
  type AtlasDrillNode,
  type AtlasSpine,
  type AtlasSpineEntry,
} from "../../src/ui/lib/atlasDrilldown";
import {
  normalizeViewState,
  parseViewState,
  serializeViewState,
} from "../../src/ui/lib/viewState";

test("structural rows use immutable projected identity without changing atomic controls", () => {
  const category = {
    id: "csf-2:CATEGORY-PR.AA",
    itemId: "CATEGORY-PR.AA",
    label: "Identity Management, Authentication, and Access Control",
    description: "",
    nodeType: "category",
  };
  const projected = "PR.AA \u2014 Identity Management, Authentication, and Access Control";
  const first = atlasStructuralRowIdentity(category, projected);
  const settled = atlasStructuralRowIdentity(
    { ...category, label: "Later catalog lookup must not relabel this row" },
    projected,
  );
  assert.equal(first.primary, projected);
  assert.equal(settled.primary, first.primary);
  assert.equal(first.secondary, "");
  assert.equal(first.usesPublisherLabel, true);

  const atomic = atlasStructuralRowIdentity({
    itemId: "AC-2",
    label: "Account Management",
    nodeType: "control",
  }, "AC-2 \u2014 Account Management");
  assert.deepEqual(atomic, {
    primary: "AC-2",
    secondary: "Account Management",
    accessibleName: "AC-2 \u2014 Account Management",
    usesPublisherLabel: false,
  });

  const tactic = atlasStructuralRowIdentity({
    itemId: "TA0001",
    label: "Initial Access",
    nodeType: "tactic",
  });
  assert.deepEqual(tactic, {
    primary: "TA0001",
    secondary: "Initial Access",
    accessibleName: "TA0001 \u2014 Initial Access",
    usesPublisherLabel: false,
  });
});

const nodes: AtlasDrillNode[] = [
  node("nist-800-53:FAMILY-AC", "family", "FAMILY-AC", "Access Control"),
  node("nist-800-53:FAMILY-AU", "family", "FAMILY-AU", "Audit and Accountability"),
  node("nist-800-53:AC-1", "control", "AC-1", "Policy and Procedures"),
  node("nist-800-53:AC-2", "control", "AC-2", "Account Management"),
  node("nist-800-53:AU-2", "control", "AU-2", "Event Logging"),
  node("nist-800-53b:LOW", "baseline", "LOW", "Low Impact Baseline", "nist-800-53b"),
  node(
    "nist-800-53b:MODERATE",
    "baseline",
    "MODERATE",
    "Moderate Impact Baseline",
    "nist-800-53b",
  ),
  node("nist-800-37:RMF-SELECT", "rmf_step", "RMF-SELECT", "Select", "nist-800-37"),
];

const edges: AtlasDrillEdge[] = [
  edge("family-ac-1", "nist-800-53:FAMILY-AC", "nist-800-53:AC-1", "contains"),
  edge("family-ac-2", "nist-800-53:FAMILY-AC", "nist-800-53:AC-2", "contains"),
  edge("family-au-2", "nist-800-53:FAMILY-AU", "nist-800-53:AU-2", "contains"),
  edge("low-ac-1", "nist-800-53b:LOW", "nist-800-53:AC-1", "selects"),
  edge("moderate-ac-1", "nist-800-53b:MODERATE", "nist-800-53:AC-1", "selects"),
  edge("moderate-ac-2", "nist-800-53b:MODERATE", "nist-800-53:AC-2", "selects"),
  edge("moderate-au-2", "nist-800-53b:MODERATE", "nist-800-53:AU-2", "selects"),
  edge("rmf-select", "nist-800-37:RMF-SELECT", "nist-800-53b:MODERATE", "selects"),
];

function spineEntry(
  id: string,
  nodeType: string,
  label: string,
  parentId: string | null,
  overrides: Partial<AtlasSpineEntry> = {},
): AtlasSpineEntry {
  return {
    id,
    node_type: nodeType,
    label,
    blurb: `${label} description`,
    parent_id: parentId,
    child_count: 0,
    descendant_record_count: 0,
    ...overrides,
  };
}

const areaEntries = [
  ["atlas:LIMB-COMPLIANCE", "Compliance"],
  ["atlas:LIMB-GOVERNANCE", "Governance"],
  ["atlas:LIMB-RISK", "Risk"],
  ["atlas:LIMB-ASSESSMENT", "Assessment"],
  ["atlas:LIMB-IMPLEMENTATION", "Implementation"],
  ["atlas:LIMB-THREAT", "Threats & Defense"],
  ["atlas:LIMB-OPERATIONS", "Operations"],
  ["atlas:LIMB-KNOWLEDGE", "Knowledge"],
  ["atlas:LIMB-PRIVACY", "Privacy"],
].map(([id, label]) => spineEntry(id, "limb", label, "atlas:TRUNK"));

const atlasSpine: AtlasSpine = {
  entries: [
    spineEntry("authority:FISMA", "statute", "FISMA", null),
    spineEntry("atlas:TRUNK", "trunk", "Cybersecurity", null),
    ...areaEntries,
    spineEntry(
      "nist-800-53:CATALOG",
      "catalog",
      "SP 800-53 Rev. 5",
      "atlas:LIMB-COMPLIANCE",
      { area_id: "atlas:LIMB-COMPLIANCE", child_count: 1, descendant_record_count: 1_196 },
    ),
    spineEntry(
      "nist-800-53:FAMILY-AC",
      "family",
      "Access Control",
      "nist-800-53:CATALOG",
      { child_count: 25, descendant_record_count: 129 },
    ),
    spineEntry(
      "mitre-attack:CATALOG",
      "catalog",
      "MITRE ATT&CK",
      "atlas:LIMB-THREAT",
      { area_id: "atlas:LIMB-THREAT", child_count: 1, descendant_record_count: 697 },
    ),
    spineEntry(
      "mitre-attack:TA0001",
      "tactic",
      "Initial Access",
      "mitre-attack:CATALOG",
      { child_count: 10, descendant_record_count: 10 },
    ),
  ],
};

test("Atlas bootstrap reads the runtime spine without waiting for the full graph", () => {
  const model = buildAtlasBootstrapModel(atlasSpine);

  assert.equal(model.frameworkGroups.length, 9);
  assert.equal(model.baselines.length, 0);
  assert.equal(model.rmfSteps.length, 0);
  assert.equal(
    model.frameworkGroups
      .find((group) => group.id === "atlas:LIMB-THREAT")
      ?.frameworks.find((framework) => framework.id === "mitre-attack")?.label,
    "MITRE ATT&CK",
  );
  assert.deepEqual(
    model.frameworkGroups
      .find((group) => group.id === "atlas:LIMB-COMPLIANCE")
      ?.frameworks[0]?.units.map((unit) => unit.id),
    ["nist-800-53:FAMILY-AC"],
  );
  assert.equal(
    model.frameworkGroups.some((group) => group.id === "authority:FISMA"),
    false,
    "authority roots do not become areas in the existing Atlas view",
  );
});

test("Atlas bootstrap fails closed instead of falling back to catalogLimbs", () => {
  assert.throws(
    () => buildAtlasBootstrapModel({ entries: [] }),
    /Atlas spine artifact has no entries/,
  );
});

test("Atlas spine summaries hydrate records from a catalog artifact without the full graph", () => {
  const model = hydrateAtlasFrameworkRecords(buildAtlasBootstrapModel(atlasSpine), [
    {
      id: "nist-800-53:AC-2",
      node_type: "control",
      ancestor_path: [{ id: "atlas:TRUNK" }, { id: "nist-800-53:FAMILY-AC" }],
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "AC-2",
        title: "Account Management",
      },
    },
    {
      id: "nist-800-53:AC-2.1",
      node_type: "control_enhancement",
      ancestor_path: [{ id: "nist-800-53:FAMILY-AC" }, { id: "nist-800-53:AC-2" }],
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "AC-2.1",
        title: "Automated System Account Management",
      },
    },
  ]);

  const accessControl = model.frameworkGroups
    .find((group) => group.id === "atlas:LIMB-COMPLIANCE")
    ?.frameworks[0]?.units[0];
  assert.deepEqual(accessControl?.records.map((record) => record.id), [
    "nist-800-53:AC-2",
  ]);
});

test("membership summaries preserve drilldown for catalogs without structural L4 children", () => {
  const spine: AtlasSpine = {
    entries: [
      spineEntry("atlas:TRUNK", "trunk", "Cybersecurity", null),
      spineEntry("atlas:LIMB-ASSESSMENT", "limb", "Assessment", "atlas:TRUNK"),
      spineEntry(
        "nist-800-53a:CATALOG",
        "catalog",
        "SP 800-53A",
        "atlas:LIMB-ASSESSMENT",
        { area_id: "atlas:LIMB-ASSESSMENT" },
      ),
      spineEntry(
        "membership:nist-800-53a:AC",
        "family",
        "AC",
        "nist-800-53a:CATALOG",
      ),
    ],
  };
  const model = hydrateAtlasFrameworkRecords(buildAtlasBootstrapModel(spine), [
    {
      id: "nist-800-53a:AC-2",
      node_type: "assessment_procedure",
      metadata: {
        catalog_id: "nist-800-53a",
        item_id: "AC-2",
        title: "Account Management assessment",
        family: "AC",
      },
    },
  ]);
  assert.deepEqual(
    model.frameworkGroups[0]?.frameworks[0]?.units[0]?.records.map(
      (record) => record.id,
    ),
    ["nist-800-53a:AC-2"],
  );
});

function node(
  id: string,
  nodeType: string,
  itemId: string,
  title: string,
  catalogId = "nist-800-53",
): AtlasDrillNode {
  return {
    id,
    node_type: nodeType,
    label: `${itemId} ${title}`,
    description: `${title} official description`,
    metadata: {
      catalog_id: catalogId,
      item_id: itemId,
      title,
      description: `${title} official description`,
    },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  relationshipType: string,
  relationshipClass = relationshipType === "contains"
    ? "structural"
    : relationshipType === "selects"
      ? "applicability"
      : "correlation",
): AtlasDrillEdge {
  return {
    id,
    source_node_id: source,
    target_node_id: target,
    relationship_type: relationshipType,
    relationship_class: relationshipClass,
    publication_status: "published",
  };
}

test("baseline choices contain only selected records grouped by real family edges", () => {
  const model = buildAtlasDrilldownModel({ nodes, edges });
  const low = model.baselines.find((baseline) => baseline.itemId === "LOW");
  const moderate = model.baselines.find(
    (baseline) => baseline.itemId === "MODERATE",
  );

  assert.equal(low?.recordCount, 1);
  assert.deepEqual(
    moderate?.families.map((family) => [
      family.itemId,
      family.records.map((record) => record.itemId),
    ]),
    [
      ["FAMILY-AC", ["AC-1", "AC-2"]],
      ["FAMILY-AU", ["AU-2"]],
    ],
  );
});

test("RMF choices expose only published graph results and preserve relationship class", () => {
  const model = buildAtlasDrilldownModel({ nodes, edges });

  assert.deepEqual(
    model.rmfSteps.find((step) => step.itemId === "RMF-SELECT")?.results,
    [
      {
        id: "nist-800-53b:MODERATE",
        itemId: "MODERATE",
        label: "Moderate Impact Baseline",
        description: "Moderate Impact Baseline official description",
        nodeType: "baseline",
        relationshipType: "selects",
      },
    ],
  );
});

test("guided Atlas selections survive URL serialization and parsing", () => {
  const state = normalizeViewState("atlas-map", {
    view: "atlas-map",
    atlasAxis: "framework",
    atlasFramework: "nist-800-53",
    atlasBaseline: "nist-800-53b:MODERATE",
    atlasFamily: "nist-800-53:FAMILY-AC",
  });
  const parsed = parseViewState(serializeViewState(state));

  assert.equal(parsed.view, "atlas-map");
  if (parsed.view !== "atlas-map") return;
  assert.equal(parsed.atlasAxis, "framework");
  assert.equal(parsed.atlasFramework, "nist-800-53");
  assert.equal(parsed.atlasBaseline, "nist-800-53b:MODERATE");
  assert.equal(parsed.atlasFamily, "nist-800-53:FAMILY-AC");
  assert.equal(parsed.atlasRmfStep, "");
});

test("full-graph drilldown is narrowed to baseline and RMF data", () => {
  const model = buildAtlasDrilldownModel({ nodes, edges });
  assert.deepEqual(model.frameworkGroups, []);
  assert.ok(model.baselines.length > 0);
  assert.ok(model.rmfSteps.length > 0);
});
