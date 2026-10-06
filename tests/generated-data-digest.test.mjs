import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  digestArtifacts,
  generatedDataIsIdentical,
  runtimeArtifactPaths,
} from "../tools/lib/generated-data-digest.mjs";

/**
 * The static build may serve the generated data already staged in dist rather
 * than copying it again. Getting that decision wrong means shipping data the
 * repository no longer holds, under a product whose whole claim is that its
 * sources are what it says they are.
 */

const MANIFEST = {
  schema_version: "1.0",
  generated_at: "2026-09-23T00:00:00.000Z",
  build_manifest: {
    kind: "build_manifest",
    runtime_artifacts: ["sources.json", "catalog-bootstrap.json", "catalog-records/"],
  },
};

function makeTree(root, { sources, record }) {
  mkdirSync(join(root, "catalog-records"), { recursive: true });
  writeFileSync(join(root, "build-manifest.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(root, "sources.json"), sources);
  writeFileSync(join(root, "catalog-bootstrap.json"), '{"catalog_bootstrap":{"catalogs":[]}}');
  writeFileSync(join(root, "catalog-records", "nist-800-53.json"), record);
}

async function withTrees(run) {
  const base = mkdtempSync(join(tmpdir(), "ca-digest-"));
  try {
    // Awaited, or the finally below deletes the tree while the test is still
    // reading it.
    return await run(join(base, "source"), join(base, "staged"));
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
}

test("identical trees are identical", async () => {
  await withTrees(async (source, staged) => {
    const contents = { sources: '{"sources":[{"id":"a"}]}', record: '{"records":[1,2,3]}' };
    makeTree(source, contents);
    makeTree(staged, contents);
    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, true, verdict.reason);
  });
});

test("a same-length content change is rejected", async () => {
  // The case size-and-mtime could never catch, and the reason this check hashes
  // rather than compares metadata. Both strings are the same number of bytes.
  await withTrees(async (source, staged) => {
    const before = '{"note":"binds version 1.5.0"}';
    const after = '{"note":"binds version 1.6.0"}';
    assert.equal(Buffer.byteLength(before), Buffer.byteLength(after), "the fixture must be the same length");

    makeTree(staged, { sources: before, record: '{"records":[1,2,3]}' });
    makeTree(source, { sources: after, record: '{"records":[1,2,3]}' });

    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, false);
    assert.equal(verdict.reason, "content-differs");
  });
});

test("a same-length change inside a directory artifact is rejected", async () => {
  await withTrees(async (source, staged) => {
    const sources = '{"sources":[{"id":"a"}]}';
    makeTree(staged, { sources, record: '{"records":["AC-2","AC-3"]}' });
    makeTree(source, { sources, record: '{"records":["AC-2","AC-9"]}' });
    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, false);
    assert.equal(verdict.reason, "content-differs");
  });
});

test("a newer mtime on identical content still counts as identical", async () => {
  // Copying, caching and archive extraction all rewrite mtimes. Freshness is
  // not evidence of difference any more than staleness is evidence of sameness.
  await withTrees(async (source, staged) => {
    const contents = { sources: '{"sources":[{"id":"a"}]}', record: '{"records":[1]}' };
    makeTree(staged, contents);
    makeTree(source, contents);
    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, true, verdict.reason);
  });
});

test("a missing staged artifact is rejected rather than ignored", async () => {
  await withTrees(async (source, staged) => {
    const contents = { sources: '{"sources":[]}', record: "{}" };
    makeTree(source, contents);
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, "build-manifest.json"), JSON.stringify(MANIFEST));
    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, false);
    assert.equal(verdict.reason, "staged-artifact-missing");
  });
});

test("an extra file inside a directory artifact is rejected", async () => {
  await withTrees(async (source, staged) => {
    const contents = { sources: '{"sources":[]}', record: "{}" };
    makeTree(staged, contents);
    makeTree(source, contents);
    writeFileSync(join(source, "catalog-records", "disa-stig.json"), "{}");
    const verdict = await generatedDataIsIdentical(source, staged);
    assert.equal(verdict.identical, false, "a new record file must invalidate the staged copy");
  });
});

test("a missing manifest on either side is rejected", async () => {
  await withTrees(async (source, staged) => {
    makeTree(staged, { sources: "{}", record: "{}" });
    mkdirSync(source, { recursive: true });
    assert.equal((await generatedDataIsIdentical(source, staged)).reason, "no-source-manifest");
  });
});

test("directory artifacts expand to the files inside them", async () => {
  await withTrees((source) => {
    makeTree(source, { sources: "{}", record: "{}" });
    const paths = runtimeArtifactPaths(source, MANIFEST);
    assert.deepEqual(paths, [
      "catalog-bootstrap.json",
      "catalog-records/nist-800-53.json",
      "sources.json",
    ]);
  });
});

test("the digest covers the path as well as the bytes", async () => {
  // Two files swapping contents must not hash the same.
  await withTrees(async (source, staged) => {
    makeTree(source, { sources: "AAAA", record: "BBBB" });
    makeTree(staged, { sources: "BBBB", record: "AAAA" });
    const paths = runtimeArtifactPaths(source, MANIFEST);
    assert.notEqual(await digestArtifacts(source, paths), await digestArtifacts(staged, paths));
  });
});
