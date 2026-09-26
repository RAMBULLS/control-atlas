import assert from "node:assert/strict";
import test from "node:test";

import {
  datasetCheckedThroughFor,
  publicationKindFor,
  publicationTrustFor,
  publicationsCitingPolicy,
  recordedBasisFor,
} from "../../src/ui/lib/publicationIdentity";
import { publicationNextActions } from "../../src/ui/lib/publicationActions";

const base = {
  id: "fixture-pub",
  name: "Fixture Publication Official Title",
  display_name: "Fixture Pub",
  owner: "NIST",
  lifecycle_status: "active",
  version: "Revision 5",
  retrieved_at: "2026-06-01",
  artifact_url: "https://example.gov/fixture",
  metadata: { identity_kind: "publication" },
};

test("the governed Atlas alias leads and the exact official title is kept beside it", () => {
  const trust = publicationTrustFor({ source: { ...base, id: "disa-stig-library", name: "DISA Public STIG Library", owner: "DISA" }, catalogId: "disa-stig" });
  assert.equal(trust.practitionerName, "DISA STIG");
  assert.equal(trust.officialTitle, "DISA Public STIG Library");
  assert.equal(trust.showsOfficialTitle, true);
  assert.equal(trust.publisher, "DISA");
  assert.equal(trust.publisherFullName, "Defense Information Systems Agency");
});

test("without a governed alias the register display name is used, never an invented one", () => {
  const trust = publicationTrustFor({ source: base });
  assert.equal(trust.practitionerName, "Fixture Pub");
  const bare = publicationTrustFor({ source: { ...base, display_name: "" } });
  assert.equal(bare.practitionerName, base.name);
  assert.equal(bare.showsOfficialTitle, false);
});

test("a retrieval date in the version slot is never presented as a publisher version", () => {
  const trust = publicationTrustFor({ source: { ...base, version: "2026-06-01", retrieved_at: "2026-06-01" } });
  assert.equal(trust.version.state, "retrieval_dated");
  assert.equal(trust.version.label, "Not stated by the publisher");
  assert.ok(trust.limitations.some((limitation) => limitation.code === "retrieval_dated_version"));
  // A publisher date that differs from every acquisition date stays a version.
  assert.equal(publicationTrustFor({ source: { ...base, version: "2018-12" } }).version.state, "recorded");
});

test("current-through statements, status words and stated absences are classified", () => {
  assert.equal(publicationTrustFor({ source: { ...base, version: "Current through July 17, 2026" } }).version.state, "current_through");
  assert.equal(publicationTrustFor({ source: { ...base, version: "current" } }).version.state, "unversioned");
  const stated = publicationTrustFor({ source: { ...base, version: null, metadata: { version_unknown_reason: "The publisher PDF does not state a release version." } } });
  assert.equal(stated.version.state, "not_stated");
  assert.equal(stated.version.detail, "The publisher PDF does not state a release version.");
  assert.equal(publicationTrustFor({ source: { ...base, version: "" } }).version.state, "unknown");
});

test("unknown lifecycle stays unknown; it never becomes current", () => {
  const trust = publicationTrustFor({ source: { ...base, lifecycle_status: "" } });
  assert.equal(trust.lifecycle.value, "");
  assert.equal(trust.lifecycle.label, "Not recorded");
  assert.equal(publicationTrustFor({ source: { ...base, lifecycle_status: "historical" } }).lifecycle.label, "Historical");
});

test("checked, retrieved and accepted are separate facts", () => {
  const retrievedOnly = publicationTrustFor({ source: base });
  assert.equal(retrievedOnly.freshness.state, "retrieved_only");
  assert.equal(retrievedOnly.dates.checked, "");
  assert.ok(retrievedOnly.limitations.some((limitation) => limitation.code === "no_check_recorded"));

  const checked = publicationTrustFor({
    source: { ...base, last_checked: "2026-09-20", last_imported: "2026-09-10" },
    datasetCheckedThrough: "2026-09-23",
  });
  assert.deepEqual(checked.dates, { retrieved: "2026-06-01", checked: "2026-09-20", accepted: "2026-09-10" });
  assert.equal(checked.freshness.state, "checked");
  assert.equal(checked.limitations.length, 0);

  const old = publicationTrustFor({ source: { ...base, last_checked: "2026-06-13" }, datasetCheckedThrough: "2026-09-23" });
  assert.ok(old.limitations.some((limitation) => limitation.code === "check_older_than_window"));
});

test("a recorded upstream review is reported, not inferred from a newer edition existing", () => {
  const superseded = publicationTrustFor({ source: base, review: { reviewed_at: "2026-08-13", upstream_currentness_review: "superseded" } });
  assert.ok(superseded.limitations.some((limitation) => limitation.code === "superseded_upstream"));
  assert.equal(superseded.lifecycle.label, "Active", "the register's lifecycle is not rewritten by the review");
  const none = publicationTrustFor({ source: base });
  assert.equal(none.review, null);
  assert.ok(!none.limitations.some((limitation) => limitation.code === "superseded_upstream"));
});

test("an update held for review never leaks the operational reason", () => {
  const held = publicationTrustFor({ source: base, heldForReview: true });
  const text = held.limitations.map((limitation) => limitation.text).join(" ");
  assert.match(text, /previous|last (?:accepted|added)/i);
  assert.doesNotMatch(text, /quarantin|workflow|validator|branch|job|error/i);
});

test("policy documents are their own kind and carry only recorded basis relationships", () => {
  assert.equal(publicationKindFor({ id: "authority-dodi-8500-01" }), "policy");
  assert.equal(publicationKindFor(base), "publication");
  assert.deepEqual(recordedBasisFor("disa-stig"), ["authority-dodi-8500-01"]);
  assert.deepEqual(publicationsCitingPolicy("authority-dodi-8500-01"), ["disa-cci", "disa-srg", "disa-stig"]);
  assert.deepEqual(recordedBasisFor("mitre-attack"), [], "issued without a federal mandate records no basis");
});

test("the register's newest check date anchors the freshness window", () => {
  assert.equal(datasetCheckedThroughFor([{ last_checked: "2026-06-01" }, { last_checked: "2026-09-23" }, {}]), "2026-09-23");
});

test("Compare is offered only for a pair with a published crosswalk", () => {
  const trust = publicationTrustFor({ source: { ...base, id: "nist-csf-2" }, catalogId: "csf-2" });
  const actions = publicationNextActions({
    trust,
    recordLabel: "Outcomes",
    recordCount: 106,
    mappingSources: { "csf-2|nist-800-53": [{ value: "nist-olir-csf2-to-sp800-53", label: "NIST CSF 2.0" }], "nist-800-53|fips-200": [{ value: "x", label: "x" }] },
  });
  const compare = actions.filter((action) => action.kind === "compare");
  assert.equal(compare.length, 1);
  assert.equal((compare[0] as { target: string }).target, "nist-800-53");
  assert.ok(actions.some((action) => action.kind === "browse"));
  assert.ok(actions.some((action) => action.kind === "sources"));
  assert.equal(
    publicationNextActions({ trust, recordLabel: "Outcomes", recordCount: 0, mappingSources: {} }).some((action) => action.kind === "browse"),
    false,
  );
});
