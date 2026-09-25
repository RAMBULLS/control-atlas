import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_DESTINATIONS,
  canonicalizeHashLocation,
  recoveryViewFor,
  routeIdentityFor,
  selectedNavFor,
} from "../../src/ui/lib/routeIdentity";
import { parseHashLocation, serializeHashLocation } from "../../src/ui/lib/hashRoutes";
import { normalizeViewState } from "../../src/ui/lib/viewState";
import { orbitalRouteContext } from "../../src/ui/components/OrbitalContextBar";

test("Source detail keeps recovery beside the inspector instead of duplicating a global return bar", () => {
  const state = normalizeViewState("sources", {
    view: "sources",
    layer: "ingestion",
    query: "DISA",
    source: "cyber-mil-stig-downloads",
    publisher: "DISA",
    lifecycle: "active",
  });
  assert.equal(orbitalRouteContext(state).back, undefined);
});

test("Resource detail context preserves the active Resources workspace on return", () => {
  const state = normalizeViewState("commons-detail", {
    view: "commons-detail",
    id: "tool-cisa-scubagear",
    query: "ScubaGear",
    resourceType: "tool",
    collection: "cloud-devsecops-software-factories",
    owner: "Cybersecurity and Infrastructure Security Agency",
    sort: "name",
    showAll: "true",
    viewMode: "map",
  });
  assert.equal(
    serializeHashLocation(state),
    "/resources/tool-cisa-scubagear?q=ScubaGear&resourceType=tool&collection=cloud-devsecops-software-factories&owner=Cybersecurity+and+Infrastructure+Security+Agency&sort=name&showAll=true&viewMode=map",
  );
  const canonical = canonicalizeHashLocation(serializeHashLocation(state));
  assert.equal(canonical.canonicalPath, serializeHashLocation(state));
  assert.equal(canonical.recoveryMessage, "");
  assert.equal(
    serializeHashLocation(normalizeViewState("commons-detail", { id: state.id })),
    "/resources/tool-cisa-scubagear",
  );
  assert.deepEqual(
    orbitalRouteContext(state).back,
    {
      label: "Back to resources",
      view: "commons",
      patch: {
        query: "ScubaGear",
        resourceType: "tool",
        collection: "cloud-devsecops-software-factories",
        owner: "Cybersecurity and Infrastructure Security Agency",
        sort: "name",
        showAll: "true",
        viewMode: "map",
      },
    },
  );
  assert.deepEqual(
    parseHashLocation(serializeHashLocation(state), ""),
    state,
  );
  const unsupported = canonicalizeHashLocation(
    `${serializeHashLocation(state)}&from=templates`,
  );
  assert.equal(unsupported.canonicalPath, serializeHashLocation(state));
  assert.match(unsupported.recoveryMessage, /removed/i);
});

test("Phase 3 durable paths and old bookmarks resolve to one canonical IA", () => {
  const cases = [
    // The classic "map" view is the territory record focus now; its old parameter is translated away.
    ["/atlas?node=nist-800-53%3AAC-2&relationshipView=map", "/atlas/nist-800-53:AC-2"],
    ["/explore?node=nist-800-53%3AAC-2&relationshipView=list", "/atlas/nist-800-53:AC-2?relationshipView=list"],
    ["/search?q=access+control&connectedOnly=true", "/library?q=access+control&connectedOnly=true"],
    ["/catalog", "/library"],
    ["/catalog/nist-800-53?q=account&family=AC", "/library/publication/nist-800-53?q=account&family=AC"],
    ["/resources", "/resources"],
    ["/resources?collection=open-source&q=oscal", "/resources?collection=open-source&q=oscal"],
    ["/resources/official-nist-sp800-53-r5?from=templates", "/resources/official-nist-sp800-53-r5"],
    ["/library?kind=tools-communities&q=oscal", "/resources?q=oscal"],
    ["/learn", "/guides"],
    ["/help", "/about"],
  ] as const;

  for (const [input, canonical] of cases) {
    const resolved = canonicalizeHashLocation(input);
    assert.equal(resolved.canonicalPath, canonical, input);
    assert.equal(resolved.requiresReplace, input !== canonical, input);
  }
});

test("unsupported state and arrival-state parameters are stripped", () => {
  const atlas = canonicalizeHashLocation(
    "/atlas?relationshipView=unsupported&sourceView=unknown&bogus=value",
  );
  assert.equal(atlas.canonicalPath, "/atlas");
  assert.match(atlas.recoveryMessage, /removed/i);

  const record = canonicalizeHashLocation(
    "/record/nist-800-53/AC-2?from=search&returnTo=%2Flibrary%3Fq%3DAC-2",
  );
  assert.equal(record.canonicalPath, "/record/nist-800-53/AC-2");
  assert.match(record.recoveryMessage, /removed/i);

  const retiredWorkspaceFilters = [
    canonicalizeHashLocation("/library?q=AC-2&objectType=control&controlFamily=AC&collection=legacy"),
    canonicalizeHashLocation("/resources?q=oscal&lane=official&framework=nist&lifecycle=active&kind=tool&costType=free"),
  ];
  assert.equal(retiredWorkspaceFilters[0].canonicalPath, "/library?q=AC-2");
  assert.equal(retiredWorkspaceFilters[1].canonicalPath, "/resources?q=oscal");
  for (const result of retiredWorkspaceFilters) assert.match(result.recoveryMessage, /removed/i);
});

test("invalid comparison and Library boolean state still fail closed", () => {
  const compare = canonicalizeHashLocation("/compare?crosswalk=decide-for-me&source=nist-800-53");
  assert.equal(compare.canonicalPath, "/compare?source=nist-800-53");
  assert.match(compare.recoveryMessage, /removed/i);

  const library = canonicalizeHashLocation("/library?q=AC-2&connectedOnly=yes");
  assert.equal(library.canonicalPath, "/library?q=AC-2");
  assert.match(library.recoveryMessage, /removed/i);
});

test("WS7 promotes record identity and supported comparison mode into readable path segments", () => {
  const atlas = canonicalizeHashLocation("/atlas/nist-800-53%3AAC-2?relationshipView=list");
  assert.equal(atlas.canonicalPath, "/atlas/nist-800-53:AC-2?relationshipView=list");

  const legacyCompare = canonicalizeHashLocation(
    "/compare?crosswalk=relationships&workbench=relationships&source=nist-800-53&target=csf-2",
  );
  assert.equal(legacyCompare.canonicalPath, "/compare/relationships?source=nist-800-53&target=csf-2");
  assert.equal(legacyCompare.requiresReplace, true);

  const atlasState = normalizeViewState("atlas-map", {
    view: "atlas-map",
    node: "nist-800-53:AC-2",
    atlasJourney: "rmf",
    relationshipView: "list",
  });
  assert.equal(serializeHashLocation(atlasState), "/atlas/nist-800-53:AC-2?atlasJourney=rmf&relationshipView=list");
  const parsedAtlas = parseHashLocation("/atlas/mitre-attack:T1000", "?atlasJourney=threats");
  assert.equal(parsedAtlas.view === "atlas-map" && parsedAtlas.atlasJourney, "threats");

  const compareState = normalizeViewState("matrix", {
    view: "matrix",
    crosswalk: "relationships",
    source: "nist-800-53",
    target: "csf-2",
  });
  assert.equal(serializeHashLocation(compareState), "/compare/relationships?source=nist-800-53&target=csf-2");
});

test("retired Compare routes recover to published crosswalks without obsolete state", () => {
  const cases = [
    [
      "/compare?workbench=threat-chain&chainCatalog=mitre-attack&chainItem=mitre-attack%3AT1033&source=nist-800-53&intent=item-mapping&compareView=list",
      "/compare?source=nist-800-53&intent=item-mapping",
    ],
    [
      "/compare?crosswalk=baseline-compare&baselineA=low&baselineB=moderate&source=nist-800-53&target=csf-2&intent=frameworks",
      "/compare?source=nist-800-53&target=csf-2&intent=frameworks",
    ],
    [
      "/compare/stig-chain?chainBenchmark=DISA-STIG&items=V-12345&mappingSource=official",
      "/compare?items=V-12345&mappingSource=official",
    ],
    [
      "/compare/threat-chain?includeCandidates=true&relationshipType=mapped_to&provenance=federal_published&confidence=high&compareRun=true",
      "/compare?relationshipType=mapped_to&compareRun=true",
    ],
  ] as const;

  for (const [input, canonicalPath] of cases) {
    const recovered = canonicalizeHashLocation(input);
    assert.equal(recovered.canonicalPath, canonicalPath, input);
    assert.equal(recovered.requiresReplace, true, input);
    assert.equal(
      recovered.recoveryMessage,
      "This Compare link used a retired workflow. Start a published crosswalk here.",
      input,
    );
  }
});

test("Compare canonicalization rejects stale or unsafe mode state", () => {
  const conflictingModes = canonicalizeHashLocation(
    "/compare?crosswalk=relationships&workbench=threat-chain&source=nist-800-53",
  );
  assert.equal(conflictingModes.canonicalPath, "/compare?source=nist-800-53");
  assert.match(conflictingModes.recoveryMessage, /retired workflow/i);

  const invalidState = canonicalizeHashLocation(
    "/compare/relationships?intent=baseline-compare&compareView=graph&source=nist-800-53",
  );
  assert.equal(invalidState.canonicalPath, "/compare/relationships?source=nist-800-53");
  assert.match(invalidState.recoveryMessage, /retired workflow/i);
});

test("Build and former Build-resource bookmarks retain their durable content", () => {
  assert.equal(
    canonicalizeHashLocation("/build?templateType=security_plan_starter&format=docx").canonicalPath,
    "/build/documents/security_plan_starter?format=docx",
  );
  assert.equal(
    canonicalizeHashLocation("/build/resources/official-nist-sp800-53-r5?from=templates").canonicalPath,
    "/resources/official-nist-sp800-53-r5",
  );
  assert.equal(
    canonicalizeHashLocation("/build/resources?category=tools&lane=open_source").canonicalPath,
    "/resources",
  );
});

test("every app state has one approved display identity", () => {
  for (const view of [
    "home", "start-here", "atlas-map", "search", "catalog-detail",
    "library-detail", "matrix", "patterns", "templates", "sources",
    "commons", "commons-detail", "about", "retired", "not-found",
  ] as const) {
    const identity = routeIdentityFor(view);
    assert.ok(identity.label, view);
    assert.ok(identity.title, view);
    assert.ok(identity.contextLabel, view);
    assert.ok(recoveryViewFor(view), view);
  }

  assert.equal(routeIdentityFor("start-here").path, "/start");
  assert.equal(routeIdentityFor("search").path, "/library");
  assert.equal(routeIdentityFor("patterns").path, "/guides");
  assert.equal(routeIdentityFor("atlas-map").path, "/atlas");
  assert.equal(routeIdentityFor("sources").path, "/sources");
  assert.equal(routeIdentityFor("about").path, "/about");
});

test("direct task destinations and overflow pages own consistent active navigation", () => {
  assert.equal(selectedNavFor("start-here"), "start-here");
  for (const view of ["search", "catalog-detail"] as const) {
    assert.equal(selectedNavFor(view), "search", view);
  }
  assert.equal(selectedNavFor("matrix"), "matrix");
  assert.equal(selectedNavFor("atlas-map"), "atlas-map");
  for (const view of ["commons", "commons-detail"] as const) {
    assert.equal(selectedNavFor(view), "commons", view);
  }
  assert.equal(selectedNavFor("library-detail"), null);
  assert.equal(selectedNavFor("patterns"), "patterns");
  assert.equal(selectedNavFor("templates"), "templates");
  assert.equal(selectedNavFor("sources"), "sources");
  assert.equal(selectedNavFor("about"), "about");

  const destinations = new Map(CANONICAL_DESTINATIONS.map((entry) => [entry.view, entry]));
  assert.equal(destinations.get("start-here")?.label, "Start here");
  assert.equal(destinations.get("search")?.label, "Library");
  assert.equal(destinations.get("matrix")?.label, "Compare");
  assert.equal(destinations.get("atlas-map")?.label, "Atlas");
  assert.equal(destinations.get("commons")?.label, "Resources");
  assert.equal(destinations.get("patterns")?.label, "Guides");
});

test("record URLs serialize canonically without arrival or presentation state", () => {
  const detail = normalizeViewState("library-detail", {
    view: "library-detail",
    node: "nist-800-53:AC-2",
    relationshipView: "map",
  });
  assert.equal(serializeHashLocation(detail), "/record/nist-800-53/AC-2");
  assert.match(`https://example.test/#${serializeHashLocation(detail)}`, /^https:\/\/[^?]+#\/record\/[^?]+$/);

  const parsed = parseHashLocation(
    "/record/nist-800-53/AC-2",
    "?from=search&returnTo=%2Flibrary",
  );
  assert.equal(parsed.view, "library-detail");
  assert.equal((parsed as Extract<typeof parsed, { view: "library-detail" }>).node, "nist-800-53:AC-2");

  const generated = normalizeViewState("library-detail", {
    view: "library-detail",
    node: "nist-zt:COLLABORATOR-APPGATE-835EC7F121",
  });
  assert.equal(
    serializeHashLocation(generated),
    "/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121",
  );
  const parsedGenerated = parseHashLocation(
    "/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121",
    "",
  );
  assert.equal(parsedGenerated.view, "library-detail");
  assert.equal(
    (parsedGenerated as Extract<typeof parsedGenerated, { view: "library-detail" }>).node,
    "nist-zt:COLLABORATOR-APPGATE-835EC7F121",
  );
});

test("durable Phase 3 view fields survive canonicalization", () => {
  const samples = [
    ["/atlas", {
      node: "nist-800-53:AC-2",
      atlasLimb: "atlas:LIMB-COMPLIANCE",
      atlasFramework: "nist-800-53",
      atlasJourney: "rmf",
      atlasContext: "program.stig",
      atlasLayer: "publisher:DISA",
    }],
    ["/library", {
      q: "access control",
      kind: "requirements",
      publisher: "National Institute of Standards and Technology",
      connectedOnly: "true",
      sort: "identifier",
      view: "map",
    }],
    ["/library/publication/nist-800-53", { q: "AC", family: "AC", page: "2", area: "Compliance" }],
    ["/start", { goal: "assess", context: "fedramp" }],
  ] as const;

  for (const [path, params] of samples) {
    for (const [key, value] of Object.entries(params)) {
      const canonical = canonicalizeHashLocation(`${path}?${key}=${encodeURIComponent(value)}`);
      const appearsInPath = path === "/atlas" && key === "node"
        ? canonical.canonicalPath.startsWith(`/atlas/${value}`)
        : canonical.canonicalPath.includes(`${key}=`);
      assert.ok(appearsInPath, `${key} was stripped from ${path}`);
      assert.equal(canonical.recoveryMessage, "", `${key} triggered recovery on ${path}`);
    }
  }
});

test("Sources layer state survives canonicalization and rejects unknown layers", () => {
  const canonical = canonicalizeHashLocation("/sources?layer=ingestion&publisher=DISA");
  assert.equal(canonical.canonicalPath, "/sources?layer=ingestion&publisher=DISA");
  assert.equal(canonical.recoveryMessage, "");

  const parsed = parseHashLocation("/sources", "?layer=connection");
  assert.equal(parsed.view, "sources");
  assert.equal(
    (parsed as Extract<typeof parsed, { view: "sources" }>).layer,
    "connection",
  );
  assert.equal(serializeHashLocation(parsed), "/sources?layer=connection");

  const invalid = canonicalizeHashLocation("/sources?layer=everything");
  assert.equal(invalid.canonicalPath, "/sources");
  assert.match(invalid.recoveryMessage, /removed/i);
});

test("Library taxonomy parameters remain repeatable, stable, and fail closed", () => {
  const valid = canonicalizeHashLocation(
    "/library?tag=vendor.microsoft&tag=asset.server&tag=vendor.microsoft",
  );
  assert.equal(
    valid.canonicalPath,
    "/library?tag=asset.server&tag=vendor.microsoft",
  );
  assert.equal(valid.requiresReplace, true);
  assert.equal(valid.recoveryMessage, "");

  const invalid = canonicalizeHashLocation(
    "/library?tag=asset.server&tag=editorial.unreviewed",
  );
  assert.equal(invalid.canonicalPath, "/library?tag=asset.server");
  assert.match(invalid.recoveryMessage, /unsupported link settings/i);
});

test("unrecognized retired aliases remain honest not-found routes", () => {
  for (const path of [
    "/menu", "/home", "/start-here", "/atlas-map", "/map", "/browse",
    "/compare-controls", "/source", "/playbooks", "/playbook", "/templates",
    "/template", "/build/community", "/commons", "/resource-bazaar", "/bazaar",
    "/hub", "/object/nist-800-53/AC-2", "/commons-detail",
  ]) {
    assert.equal(canonicalizeHashLocation(path).canonicalPath, path);
    assert.equal(parseHashLocation(path, "").view, "not-found", path);
  }
});
