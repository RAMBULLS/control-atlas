import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const canonicalDocs = [
  "docs/README.md",
  "docs/vision.md",
  "docs/PRD.md",
  "docs/DESIGN_PRINCIPLES.md",
  "docs/design/design-system.md",
  "docs/PAGE_CONTRACTS.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/DATA_POLICY.md",
  "docs/RECORD_TYPE_FIDELITY_AUDIT.md",
  "docs/TAXONOMY.md",
  "docs/OPERATIONS.md",
  "docs/CI_CD.md",
  "docs/BACKLOG.md",
  "docs/THIRD_PARTY_NOTICES.md",
  "docs/SOURCE_TRUTH_PROFILES.md",
  "docs/ATLAS_RESEARCH.md",
];

function docFiles(path = "docs") {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = `${path}/${entry.name}`;
    return entry.isDirectory() ? docFiles(target) : [target];
  });
}

test("documentation has one canonical foundation and no completed plan archive", () => {
  const expectedDocs = existsSync("docs/Plan.md")
    ? [...canonicalDocs, "docs/Plan.md"]
    : canonicalDocs;
  assert.deepEqual(docFiles().sort(), [...expectedDocs].sort());
  if (existsSync("docs/Plan.md")) {
    const activePlan = readFileSync("docs/Plan.md", "utf8");
    assert.match(activePlan, /Status:\*\* Active/i, "the only retained plan must be active");
    assert.match(activePlan, /delete it in the shipping change/i);
  }
  assert.equal(docFiles().filter((path) => /backlog/i.test(path)).length, 1);
  for (const path of canonicalDocs) {
    const content = readFileSync(path, "utf8");
    for (const field of ["Owner", "Status", "Last reviewed", "Supersession"]) {
      assert.match(content, new RegExp(field, "i"), `${path} needs ${field}`);
    }
  }
});
test("canonical direction defines the current product, page, data, and release contracts", () => {
  assert.match(readFileSync("docs/PRD.md", "utf8"), /Build for translation, not complexity/i);
  assert.match(readFileSync("docs/PAGE_CONTRACTS.md", "utf8"), /Adaptive Explorer/);
  assert.match(readFileSync("docs/PAGE_CONTRACTS.md", "utf8"), /Related records/);
  assert.match(readFileSync("docs/DATA_POLICY.md", "utf8"), /one or more acyclic containment paths/);
  assert.match(readFileSync("docs/DATA_POLICY.md", "utf8"), /StructuredContentBlock/);
  assert.match(readFileSync("docs/OPERATIONS.md", "utf8"), /deployed `release\.json` commit equals merged `main`/);
});

test("public product surfaces share one identity and decision boundary", () => {
  const definition = "Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.";
  const boundary = "Use Control Atlas for research, not compliance or authorization decisions.";
  for (const path of ["README.md", "CONTRIBUTING.md", "src/shared/site-copy.mjs"]) {
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes(definition), `${path} product definition`);
    assert.ok(content.includes(boundary), `${path} decision boundary`);
  }
});
