import assert from "node:assert/strict";
import test from "node:test";

import {
  officialSourceActionLabel,
  officialSourceFor,
  OFFICIAL_PUBLICATION_VERBS,
  retrievedArtifactFor,
  urlDisposition,
  urlExtension,
} from "../../src/ui/lib/officialSource";

// The register entry behind the review's worst case: an SP 800-53A record whose
// artifact is the SP 800-53 OSCAL catalog, so the artifact filename names the
// wrong publication.
const assessmentProcedures = {
  artifact_url:
    "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json",
  catalog_browse_url: "https://csrc.nist.gov/pubs/sp/800/53/a/r5/final",
};

const cciList = {
  artifact_url:
    "https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_CCI_List.zip",
  catalog_browse_url: "",
};

test("one publication resolves to one citable destination", () => {
  assert.equal(
    officialSourceFor(assessmentProcedures).url,
    "https://csrc.nist.gov/pubs/sp/800/53/a/r5/final",
  );
  // The raw artifact stays reachable, but as a separate, secondary action.
  assert.equal(
    officialSourceFor(assessmentProcedures).artifactUrl,
    assessmentProcedures.artifact_url,
  );
});

test("a download is never labelled as something to view", () => {
  const resolution = officialSourceFor(cciList);
  assert.equal(resolution.url, cciList.artifact_url);
  assert.equal(resolution.isDownload, true);
  assert.equal(resolution.formatLabel, "ZIP");
  assert.equal(
    officialSourceActionLabel(resolution),
    "Download official source (ZIP)",
  );
  assert.match(officialSourceActionLabel(resolution), /^Download/);
});

test("a publication page keeps the plain view label", () => {
  const resolution = officialSourceFor(assessmentProcedures);
  assert.equal(resolution.isDownload, false);
  assert.equal(officialSourceActionLabel(resolution), "View official source");
  assert.equal(
    officialSourceActionLabel(resolution, OFFICIAL_PUBLICATION_VERBS),
    "Open official publication",
  );
});

test("disposition follows the URL, not the declared format field", () => {
  // format and artifact_url disagree in the register and nothing reconciles
  // them, so the label must follow what the browser will actually do.
  const mismatched = {
    artifact_url: "https://example.gov/library/baseline.xlsx",
    catalog_browse_url: "",
    format: "json",
  };
  assert.equal(officialSourceFor(mismatched).formatLabel, "XLSX");
  assert.equal(officialSourceFor(mismatched).isDownload, true);
});

test("a retrieved-file row never falls back to a browse page", () => {
  // Presenting a browse page beside a checksum would misstate what was verified.
  const browseOnly = { artifact_url: "", catalog_browse_url: "https://example.gov/pubs" };
  assert.equal(retrievedArtifactFor(browseOnly).url, "");
  assert.equal(retrievedArtifactFor(assessmentProcedures).url, assessmentProcedures.artifact_url);
});

test("the parent publication is a last resort, and never duplicates the artifact", () => {
  const child = { artifact_url: "https://example.gov/file.zip", catalog_browse_url: "" };
  const parent = { catalog_browse_url: "https://example.gov/pubs/parent" };
  assert.equal(officialSourceFor(child, { parent }).url, child.artifact_url);
  assert.equal(
    officialSourceFor(child, { parent, allowArtifactFallback: false }).url,
    parent.catalog_browse_url,
  );
});

test("missing sources resolve to empty rather than throwing", () => {
  for (const input of [null, undefined, {}]) {
    assert.equal(officialSourceFor(input).url, "");
    assert.equal(officialSourceActionLabel(officialSourceFor(input)), "");
  }
});

test("a trailing version segment is not a file extension", () => {
  assert.equal(urlExtension("https://example.gov/pubs/sp/800/53/r5.1.14"), "");
  assert.equal(urlDisposition("https://example.gov/pubs/sp/800/53/r5.1.14"), "page");
  assert.equal(urlDisposition("https://example.gov/a/b.html?q=1#x"), "page");
  assert.equal(urlDisposition("https://example.gov/a/b.pdf"), "document");
});

test("a readable page beats a raw file even when the file is the browse field", () => {
  // mitre-attack-ics stores a raw STIX bundle in BOTH fields; neither is a
  // page, so the honest outcome is a download label rather than a fake page.
  const icsBundle = {
    catalog_browse_url:
      "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/ics-attack/ics-attack.json",
    artifact_url:
      "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/6cda5ad/ics-attack/ics-attack-19.2.json",
  };
  assert.equal(officialSourceFor(icsBundle).isDownload, true);
  assert.match(officialSourceActionLabel(officialSourceFor(icsBundle)), /^Download/);
});

test("between two readable pages the more specific path wins", () => {
  // Regression guard: browse-first would send SP 800-53 to the CPRT tool home
  // and CSF 2.0 to the framework landing page. These are the two most-used
  // catalogs in the product, so a "consistency" fix must not cost them their
  // publication pages.
  const cases: Array<[Record<string, string>, string]> = [
    [
      {
        catalog_browse_url: "https://csrc.nist.gov/projects/cprt/catalog#/cprt/home",
        artifact_url: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
      },
      "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
    ],
    [
      {
        catalog_browse_url: "https://www.nist.gov/cyberframework",
        artifact_url:
          "https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20",
      },
      "https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20",
    ],
    [
      {
        catalog_browse_url: "https://www.fedramp.gov/2026/authority/law/",
        artifact_url: "https://www.fedramp.gov/2026/authority/law/gsa/",
      },
      "https://www.fedramp.gov/2026/authority/law/gsa/",
    ],
  ];
  for (const [source, expected] of cases) {
    assert.equal(officialSourceFor(source).url, expected);
  }
});

test("a specific PDF beats a generic index", () => {
  // DoD and OMB publish the authority document itself as a PDF. Ranking pages
  // above PDFs would swap DoDI 8510.01 for a directory of every DoD issuance,
  // which is the "landed on a generic index" defect, not a fix for it.
  const dodi851001 = {
    catalog_browse_url: "https://www.esd.whs.mil/Directives/issuances/dodi/",
    artifact_url:
      "https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/851001p.pdf",
  };
  const resolution = officialSourceFor(dodi851001);
  assert.equal(resolution.url, dodi851001.artifact_url);
  assert.equal(resolution.isDownload, false);
  assert.equal(officialSourceActionLabel(resolution), "View official source (PDF)");
});

test("when nothing is readable, the citation is the file that was retrieved", () => {
  // Both fields are STIX bundles. The commit-pinned artifact is the one that
  // was ingested and checksummed; the browse field floats on master, so citing
  // it would drift away from the bytes the records were built from.
  const pinned = {
    catalog_browse_url:
      "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json",
    artifact_url:
      "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/6cda5ad/enterprise-attack/enterprise-attack-19.2.json",
  };
  assert.equal(officialSourceFor(pinned).url, pinned.artifact_url);
});
