import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COMMONS_GROUPS,
  groupResourcesByKind,
  hostIdentity,
  resourceDateLabel,
  resourceHost,
  resourceSummaryPresentation,
} from "../src/ui/lib/commonsPresentation.mjs";
import {
  RESOURCE_BRAND_REGISTRY,
  RESOURCE_TYPE_FALLBACKS,
  resourceAccessLabel,
  resourceFieldLabel,
  resourceBrandIdentity,
  resourceTypeLabel,
} from "../src/ui/lib/resourceBrands.mjs";
import { resolveIdentityByKey } from "../src/shared/identity-registry.mjs";

const dataset = JSON.parse(
  readFileSync(resolve("data/commons-resource-dataset.json"), "utf8"),
);
const resources = dataset.resources;
const sourceRegistry = JSON.parse(
  readFileSync(resolve("data/source-registry.json"), "utf8"),
);

test("Resource replacement IDs resolve to one canonical Resource or Publication", () => {
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const publicationIds = new Set(
    sourceRegistry.publications.map((publication) => publication.id),
  );

  for (const resource of resources) {
    const replacements = resource.lifecycle?.replacedBy || [];
    if (resource.supersededBy) {
      assert.equal(resource.supersededBy, replacements[0], `${resource.id}/supersededBy`);
    }
    for (const replacementId of replacements) {
      assert.ok(
        resourceIds.has(replacementId) || publicationIds.has(replacementId),
        `${resource.id} replacement ${replacementId} is unresolved`,
      );
    }
  }

  const diacap = resources.find((resource) => resource.id === "legacy-diacap-transition");
  assert.deepEqual(diacap.lifecycle.replacedBy, ["authority-dodi-8510-01"]);
  assert.equal(diacap.supersededBy, "authority-dodi-8510-01");
});

test("Resource dates use one human-readable UTC convention without inventing missing values", () => {
  assert.equal(resourceDateLabel("2026-08-10T16:48:29Z"), "August 10, 2026");
  assert.equal(resourceDateLabel("2026-08-03"), "August 3, 2026");
  assert.equal(resourceDateLabel(null), "");
  assert.equal(resourceDateLabel(""), "");
  assert.equal(resourceDateLabel("not-a-date"), "");
  assert.equal(resourceDateLabel("08/03/2026"), "");
  assert.equal(resourceDateLabel("2026-02-31"), "");
  assert.equal(resourceDateLabel("2026-08-03T12:00:00"), "");
  assert.equal(resourceDateLabel("2026-02-31T12:00:00Z"), "");
});

test("shipped Resource maintenance fields retain their governed date shapes", () => {
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
  const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  for (const resource of resources) {
    assert.match(resource.lastCheckedAt, calendarDate, `${resource.id}/lastCheckedAt`);
    if (resource.nextCheckAt) {
      assert.match(resource.nextCheckAt, calendarDate, `${resource.id}/nextCheckAt`);
    }
    if (resource.publisherUpdatedAt) {
      assert.match(resource.publisherUpdatedAt, calendarDate, `${resource.id}/publisherUpdatedAt`);
    }
    if (resource.lastCommitAt) {
      assert.match(resource.lastCommitAt, utcInstant, `${resource.id}/lastCommitAt`);
    }
  }
});

test("resourceHost normalizes hostnames and refuses to guess at malformed URLs", () => {
  assert.equal(resourceHost("https://www.reddit.com/r/NISTControls/"), "reddit.com");
  assert.equal(resourceHost("https://CSRC.NIST.GOV/pubs/sp/800/53/r5/upd1/final"), "csrc.nist.gov");
  assert.equal(resourceHost("not a url"), "");
  assert.equal(resourceHost(""), "");
  assert.equal(resourceHost(null), "");
  assert.equal(resourceHost(undefined), "");
});

test("hostIdentity resolves bundled brand marks from the canonical URL", () => {
  assert.deepEqual(hostIdentity("https://github.com/ComplianceAsCode/content"), {
    host: "github.com",
    kind: "github",
    label: "github.com",
  });
  assert.equal(
    hostIdentity("https://raw.githubusercontent.com/org/repo/main/file.json").kind,
    "github",
  );
  assert.equal(hostIdentity("https://www.reddit.com/r/NISTControls/").kind, "reddit");
  assert.equal(hostIdentity("https://old.reddit.com/r/CMMC/").kind, "reddit");
  assert.equal(hostIdentity("https://oscal.slack.com/").kind, "slack");
  assert.equal(hostIdentity("https://docs.aws.amazon.com/whitepapers/").kind, "aws");
  assert.equal(hostIdentity("https://learn.microsoft.com/en-us/azure/").kind, "microsoft");
});

test("hostIdentity resolves publishing-organization monograms per registrable domain", () => {
  assert.deepEqual(hostIdentity("https://csrc.nist.gov/pubs/sp/800/53/r5/final"), {
    host: "csrc.nist.gov",
    kind: "monogram",
    label: "NIST",
  });
  assert.equal(hostIdentity("https://nvd.nist.gov/").label, "NIST");
  assert.equal(hostIdentity("https://niccs.cisa.gov/").label, "CISA");
  assert.equal(hostIdentity("https://marketplace.fedramp.gov/").label, "FedRAMP");
  assert.equal(hostIdentity("https://public.cyber.mil/stigs/").label, "DoD");
  assert.equal(hostIdentity("https://esd.whs.mil/Directives/").label, "DoD");
  assert.equal(hostIdentity("https://p1.dso.mil/").label, "DoD");
});

test("hostIdentity falls back to the hostname rather than approximating an unknown publisher", () => {
  assert.deepEqual(hostIdentity("https://example.net/tool/"), {
    host: "example.net",
    kind: "generic",
    label: "example.net",
  });
  assert.deepEqual(hostIdentity("garbage"), { host: "", kind: "generic", label: "" });
});

test("every resource in the shipped dataset yields a resolvable host", () => {
  const unresolved = resources.filter((resource) => !resourceHost(resource.canonicalUrl));
  assert.deepEqual(
    unresolved.map((resource) => `${resource.id} -> ${resource.canonicalUrl}`),
    [],
  );
});

test("every host used by two or more resources has a specific identity, not a generic glyph", () => {
  const counts = new Map();
  for (const resource of resources) {
    const host = resourceHost(resource.canonicalUrl);
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  const repeatedButGeneric = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .filter(([host]) => hostIdentity(`https://${host}/`).kind === "generic")
    .map(([host, count]) => `${host} (${count} resources)`);

  assert.deepEqual(repeatedButGeneric, []);
});

test("grouping classifies every shipped resource exactly once, in section order", () => {
  const groups = groupResourcesByKind(resources);

  const total = groups.reduce((sum, group) => sum + group.resources.length, 0);
  assert.equal(total, resources.length);

  const seen = new Set();
  for (const group of groups) {
    for (const resource of group.resources) {
      assert.ok(!seen.has(resource.id), `Resource classified twice: ${resource.id}`);
      seen.add(resource.id);
    }
  }
  assert.equal(seen.size, resources.length);

  const expectedOrder = COMMONS_GROUPS.map((group) => group.id).filter((id) =>
    groups.some((group) => group.id === id),
  );
  assert.deepEqual(groups.map((group) => group.id), expectedOrder);
});

test("every resourceType in the shipped dataset maps to a named section, never to Other", () => {
  const mapped = new Set(COMMONS_GROUPS.flatMap((group) => group.types));
  const unmapped = [...new Set(resources.map((resource) => resource.resourceType))]
    .filter((type) => !mapped.has(type))
    .sort();
  assert.deepEqual(unmapped, []);

  const groups = groupResourcesByKind(resources);
  assert.equal(groups.find((group) => group.id === "other"), undefined);
});

test("grouping keeps an unclassified resourceType visible under Other instead of dropping it", () => {
  const groups = groupResourcesByKind([
    { id: "a", resourceType: "tool" },
    { id: "b", resourceType: "something_new" },
  ]);

  assert.deepEqual(groups.map((group) => group.id), ["tools", "other"]);
  assert.deepEqual(
    groups.find((group) => group.id === "other").resources.map((r) => r.id),
    ["b"],
  );
});

test("grouping preserves the caller's ordering inside each section", () => {
  const groups = groupResourcesByKind([
    { id: "tool-second", resourceType: "tool" },
    { id: "policy-first", resourceType: "policy" },
    { id: "tool-first", resourceType: "tool" },
  ]);

  assert.deepEqual(
    groups.find((group) => group.id === "tools").resources.map((r) => r.id),
    ["tool-second", "tool-first"],
  );
});

test("every section carries a plain-English label and blurb, and no type is double-assigned", () => {
  const seenTypes = new Set();
  for (const group of COMMONS_GROUPS) {
    assert.ok(group.label.length > 0, `Group ${group.id} has no label`);
    assert.ok(group.blurb.length > 0, `Group ${group.id} has no blurb`);
    assert.ok(group.types.length > 0, `Group ${group.id} claims no resource types`);
    for (const type of group.types) {
      assert.ok(!seenTypes.has(type), `resourceType ${type} claimed by two groups`);
      seenTypes.add(type);
    }
  }
});

test("central resource brand registry covers every required owner and ecosystem", () => {
  const requiredKeys = [
    "reddit",
    "fedramp",
    "nist",
    "cisa",
    "disa",
    "dod_cyber_exchange",
    "dod_cio",
    "platform_one",
    "iron_bank",
    "common_criteria",
    "niap",
    "tenable",
    "github",
    "mattermost",
    "slack",
    "cis",
    "microsoft",
    "mitre",
    "dcsa",
    "cyber_ab",
    "project_spectrum",
  ];

  assert.deepEqual(
    requiredKeys.filter((key) => !RESOURCE_BRAND_REGISTRY[key]),
    [],
  );
  for (const key of requiredKeys) {
    const entry = RESOURCE_BRAND_REGISTRY[key];
    assert.equal(entry.key, key);
    assert.ok(entry.ownerLabel);
    assert.ok(entry.accessibleName);
    assert.ok(entry.iconKey || entry.initials);
    assert.doesNotMatch(JSON.stringify(entry), /https?:\/\//i);
  }
});

test("brand resolution prefers the specific ecosystem over a generic host", () => {
  const cases = [
    [
      {
        id: "community-reddit-nistcontrols",
        name: "Reddit /r/NISTControls Practitioner Community",
        publisher: "Reddit",
        canonicalUrl: "https://www.reddit.com/r/NISTControls/",
      },
      "reddit",
    ],
    [
      {
        id: "tool-platform-one-ironbank",
        name: "DoD Platform One Iron Bank Container Registry",
        publisher: "Platform One",
        canonicalUrl: "https://p1.dso.mil/services/iron-bank",
      },
      "iron_bank",
    ],
    [
      {
        name: "Big Bang deployment documentation",
        publisher: "Platform One",
        canonicalUrl: "https://p1.dso.mil/",
      },
      "platform_one",
    ],
    [
      {
        name: "NIAP Common Criteria Product Compliant List",
        publisher: "NIAP",
        canonicalUrl: "https://www.niap-ccevs.org/",
      },
      "niap",
    ],
    [
      {
        name: "MITRE Heimdall",
        publisher: "MITRE",
        canonicalUrl: "https://github.com/mitre/heimdall2",
      },
      "mitre",
    ],
    [
      {
        name: "PowerSTIG",
        publisher: "Microsoft",
        canonicalUrl: "https://github.com/microsoft/PowerSTIG",
      },
      "microsoft",
    ],
  ];

  for (const [resource, expectedKey] of cases) {
    assert.equal(resourceBrandIdentity(resource).key, expectedKey);
  }

  const subreddit = resourceBrandIdentity(cases[0][0]);
  assert.equal(subreddit.ownerLabel, "r/NISTControls");
  assert.equal(subreddit.variantKey, "subreddit:nistcontrols");
});

test("overlapping Commons brands source canonical identity text from the identity registry", () => {
  for (const key of ["fedramp", "nist", "cisa", "disa", "microsoft", "mitre", "dcsa"]) {
    const canonical = resolveIdentityByKey(key);
    const resourceBrand = RESOURCE_BRAND_REGISTRY[key];
    assert.ok(canonical, key);
    assert.equal(resourceBrand.canonicalIdentityKey, key);
    assert.equal(resourceBrand.ownerLabel, canonical.label);
    assert.equal(resourceBrand.accessibleName, canonical.accessible_name);
  }
  assert.equal(RESOURCE_BRAND_REGISTRY.reddit.canonicalIdentityKey, null);
});

test("registry recognizes future required identities without adding image assets", () => {
  const cases = [
    ["DoD Cyber Exchange", "dod_cyber_exchange"],
    ["DoD CIO Cyber Workforce Hub", "dod_cio"],
    ["Common Criteria Portal", "common_criteria"],
    ["Tenable Audits", "tenable"],
    ["Mattermost ChatOps", "mattermost"],
    ["CIS WorkBench", "cis"],
    ["DCSA NISP Cybersecurity Office", "dcsa"],
    ["The Cyber AB Marketplace", "cyber_ab"],
    ["Project Spectrum", "project_spectrum"],
  ];

  for (const [name, expectedKey] of cases) {
    assert.equal(
      resourceBrandIdentity({
        name,
        publisher: name,
        canonicalUrl: "https://example.test/",
      }).key,
      expectedKey,
    );
  }
});

test("type fallbacks are meaningful and visually distinct", () => {
  const requiredFallbacks = [
    "government_portal",
    "tool",
    "template",
    "dataset",
    "documentation",
    "training",
    "marketplace",
    "community",
    "repository",
    "restricted_service",
  ];
  const iconKeys = requiredFallbacks.map(
    (key) => RESOURCE_TYPE_FALLBACKS[key]?.iconKey,
  );

  assert.ok(iconKeys.every(Boolean));
  assert.equal(new Set(iconKeys).size, requiredFallbacks.length);
  assert.equal(
    resourceBrandIdentity({
      name: "Unknown community",
      publisher: "Unknown owner",
      resourceType: "community_forum",
      accessType: "public",
      canonicalUrl: "https://example.test/community",
    }).key,
    "community",
  );
  assert.equal(
    resourceBrandIdentity({
      name: "Unknown restricted tool",
      publisher: "Unknown owner",
      resourceType: "tool",
      accessType: "dod_network",
      canonicalUrl: "https://example.test/tool",
    }).key,
    "restricted_service",
  );
});

test("every shipped resource resolves to an accessible consistent identity", () => {
  for (const resource of resources) {
    const first = resourceBrandIdentity(resource);
    const second = resourceBrandIdentity(resource);
    assert.ok(first.key, resource.id);
    assert.ok(first.accessibleName, resource.id);
    assert.ok(first.iconKey || first.initials, resource.id);
    assert.deepEqual(first, second, resource.id);
  }
});

test("resource type and access labels never expose raw schema enums", () => {
  assert.equal(resourceTypeLabel("community_forum"), "Community or forum");
  assert.equal(resourceTypeLabel("historical_reference"), "Historical reference");
  assert.equal(resourceAccessLabel({ accessType: "public" }), "Public");
  assert.equal(resourceFieldLabel("active"), "Active");
  assert.equal(resourceFieldLabel("general_it"), "General IT");
  assert.equal(resourceFieldLabel("public_url"), "Public URL");
  assert.equal(resourceFieldLabel("Agency ISSO"), "Agency ISSO");
  assert.equal(resourceFieldLabel("FedRAMP PMO"), "FedRAMP PMO");
  assert.equal(resourceFieldLabel("DevSecOps services"), "DevSecOps Services");
  assert.equal(resourceFieldLabel("CUI"), "CUI");
  assert.equal(resourceFieldLabel("OSCAL"), "OSCAL");
  assert.equal(resourceFieldLabel("SCAP"), "SCAP");
  assert.equal(resourceFieldLabel("SIEM"), "SIEM");
  for (const resource of resources) {
    for (const field of ["maintenanceStatus", "verificationMethod", "resourceLane", "officialStatus", "costType"]) {
      const raw = resource[field];
      if (!raw) continue;
      const label = resourceFieldLabel(raw);
      assert.ok(label.length > 0, `${resource.id}/${field}`);
      assert.equal(label.includes("_"), false, `${resource.id}/${field}: ${label}`);
    }
  }
  assert.equal(
    resourceAccessLabel({ accessType: "free_account" }),
    "Free account required",
  );
  assert.equal(resourceAccessLabel({ accessType: "cac_or_piv" }), "CAC required");
  assert.equal(
    resourceAccessLabel({ accessType: "dod_network" }),
    "DoD network required",
  );
  assert.equal(
    resourceAccessLabel({ accessType: "public", authenticationRequired: true }),
    "Access varies",
  );
});

test("brand asset manifest forbids hotlinks and records each identity basis", () => {
  const manifest = JSON.parse(
    readFileSync(resolve("data/resource-brand-assets.json"), "utf8"),
  );
  assert.equal(manifest.policy.hotlinkingAllowed, false);
  assert.equal(manifest.policy.externalImageAssetsShipped, false);
  assert.deepEqual(manifest.localAssets, []);

  const tabler = manifest.identityBases.find(
    (entry) => entry.id === "tabler-icons-react",
  );
  const monograms = manifest.identityBases.find(
    (entry) => entry.id === "text-monograms",
  );
  assert.equal(tabler.license, "MIT");
  assert.match(tabler.sourceUrl, /^https:\/\/github\.com\/tabler\/tabler-icons$/);
  assert.equal(monograms.kind, "locally_rendered_text");
  assert.equal(monograms.sourceUrl, null);
});

test("resource card uses the central identity seam and restrained anatomy", () => {
  const card = readFileSync(
    resolve("src/ui/components/CommonsResourceCard.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve("styles/resources.css"), "utf8");

  assert.match(card, /resolveIdentity/);
  assert.match(card, /taxonomyTagsForResource/);
  assert.match(card, /DimensionGlyph/);
  assert.match(card, /resourceAccessLabel\(resource\)/);
  assert.match(card, /resourceTypeLabel\(resource\.resourceType\)/);
  assert.match(card, /resourceSummaryPresentation\(resource\)/);
  assert.match(card, /resource-summary-copy__label/);
  assert.match(card, /resource-card-purpose/);
  assert.doesNotMatch(card, /cardPurpose|whyIncluded|frameworks\.map|artifactTypes\.map|CommonsLaneBadge|resourceBrandIdentity/);
  assert.match(styles, /\.resource-brand-mark[\s\S]*height:\s*44px/);
  assert.match(styles, /\.resource-brand-mark[\s\S]*width:\s*44px/);
  assert.match(styles, /@media \(max-width:\s*30rem\)[\s\S]*height:\s*40px/);
});

test("Resource routes follow the Orbital catalog and knowledge-base compositions", () => {
  const directory = readFileSync(resolve("src/ui/pages/CommonsPage.tsx"), "utf8");
  const detail = readFileSync(resolve("src/ui/pages/CommonsDetailPage.tsx"), "utf8");
  const styles = readFileSync(resolve("styles/resources.css"), "utf8");

  assert.match(directory, /headerAction=\{\(/);
  assert.match(directory, /<h2 id="resource-collections-heading">Browse by Collection<\/h2>/);
  assert.doesNotMatch(directory, /<p className="eyebrow">Resources<\/p>/);
  assert.ok(directory.indexOf("resource-contribute-heading") > directory.indexOf("resource-catalog-grid"));
  assert.match(directory, /resource-compare-toggle/);
  assert.match(directory, /aria-label="Resource companions"/);
  assert.match(directory, /view="templates">[\s\S]*Browse Templates →[\s\S]*<\/AppLink>/);
  assert.match(directory, /view="patterns">[\s\S]*Browse Guides →[\s\S]*<\/AppLink>/);

  for (const heading of [
    "What it is",
    "Who it's for",
    "How to use or access",
    "Limitations",
    "Related resources",
  ]) {
    assert.ok(detail.includes(`title="${heading}"`), heading);
  }
  assert.doesNotMatch(detail, /title="Related topics"/);
  assert.match(detail, /<TaxonomyContext/);
  assert.match(detail, /<details className="resource-detail-maintenance">/);
  assert.match(detail, /Source &amp; maintenance details/);
  assert.doesNotMatch(detail, /Governed discovery tags/);
  assert.doesNotMatch(detail, /Publisher image from commit/);
  assert.match(styles, /\.resource-catalog-grid\s*\{[\s\S]*repeat\(auto-fill,[\s\S]*18rem/);
  assert.match(styles, /@media \(max-width:\s*64rem\)[\s\S]*\.resource-catalog-grid[\s\S]*17\.5rem/);
  assert.match(styles, /@media \(max-width:\s*48rem\)[\s\S]*\.resource-catalog-grid[\s\S]*grid-template-columns:\s*1fr/);
});

test("Resource and collection icon color communicates category instead of decoration", () => {
  const directory = readFileSync(resolve("src/ui/pages/CommonsPage.tsx"), "utf8");
  const resourceIcon = readFileSync(resolve("src/ui/components/ResourceTypeIcon.tsx"), "utf8");
  const collectionIcon = readFileSync(resolve("src/ui/components/CollectionIcon.tsx"), "utf8");
  const tokens = readFileSync(resolve("styles/tokens.css"), "utf8");
  const styles = readFileSync(resolve("styles/surfaces.css"), "utf8");

  assert.match(directory, /data-resource-type=\{resource\.resourceType\}/);
  assert.match(resourceIcon, /data-resource-tone=\{tone\}/);
  assert.match(collectionIcon, /data-collection-tone=\{tone\}/);
  assert.match(tokens, /--ca-type-portal:/);
  assert.match(tokens, /--ca-type-tool:/);
  assert.match(styles, /\.resource-type-icon\[data-resource-tone="tool"\]/);
  assert.match(styles, /\.collection-icon\[data-collection-tone="operations"\]/);
});

test("Resource summaries disclose whether Atlas or the publisher wrote the browse copy", () => {
  assert.deepEqual(resourceSummaryPresentation({
    summary: "Atlas text",
    claimEvidence: [{ fieldPath: "/summary", origin: "atlas_editorial" }],
  }), { text: "Atlas text", origin: "atlas_editorial", label: "Control Atlas summary" });
  assert.deepEqual(resourceSummaryPresentation({
    summary: "Publisher text",
    claimEvidence: [{ fieldPath: "/summary", origin: "publisher_normalized" }],
  }), { text: "Publisher text", origin: "publisher_normalized", label: "Publisher summary" });
  assert.ok(resources.every((resource) => resourceSummaryPresentation(resource).label === "Control Atlas summary"));
});

test("Resource detail presents single classification section without duplicating governed tags", () => {
  const detail = readFileSync(resolve("src/ui/pages/CommonsDetailPage.tsx"), "utf8");

  // Only one classification/discovery section: TaxonomyContext ("Find more like this")
  const taxonomyMatches = detail.match(/<TaxonomyContext/g) || [];
  assert.equal(taxonomyMatches.length, 1, "Expected exactly one TaxonomyContext on CommonsDetailPage");

  // Assert no duplicate legacy taxonomy/tag sections
  assert.doesNotMatch(detail, /DetailSection id="related-topics"/);
  assert.doesNotMatch(detail, /Related topics<\/a>/);
  assert.doesNotMatch(detail, /Topic basis<\/h3>/);
  assert.doesNotMatch(detail, /AtlasCard title="Related in Control Atlas"/);
});
