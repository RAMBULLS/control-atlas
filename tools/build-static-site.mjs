#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { runNodeSync } from "./lib/process-runner.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_SEGMENT = "dist/site";
const DIST = join(ROOT, ...DIST_SEGMENT.split("/"));
const REQUIRED_GENERATED_FILES = [
  "data/generated/build-manifest.json",
  "data/generated/library-search-index.json",
  "data/generated/catalog-bootstrap.json",
  "data/generated/library-search.json",
  "data/generated/commons-search-index.json",
  "data/generated/atlas-neighborhood-manifest.json",
];

const COPY_PATHS = [
  ["data", "data"],
  ["maps", "maps"],
];
const reuseGenerated = process.argv.includes("--reuse-generated");

function copyIntoDist(sourceRelativePath, destRelativePath) {
  const sourcePath = join(ROOT, sourceRelativePath);
  const destPath = join(DIST, destRelativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Required build input missing: ${sourceRelativePath}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(sourcePath, destPath, { recursive: true });
}

function readGeneratedArtifact(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function assertGeneratedDataComplete() {
  for (const sourceRelativePath of REQUIRED_GENERATED_FILES) {
    if (!existsSync(join(ROOT, sourceRelativePath))) {
      throw new Error(`Required generated artifact missing: ${sourceRelativePath}`);
    }
  }

  const catalogBootstrap = readGeneratedArtifact(
    "data/generated/catalog-bootstrap.json",
  ).catalog_bootstrap;
  for (const catalog of catalogBootstrap?.catalogs ?? []) {
    const path = `data/generated/catalog-records/${catalog.id}.json`;
    if (!existsSync(join(ROOT, path))) {
      throw new Error(`Generated data cache is incomplete: ${path}`);
    }
  }

  const neighborhoodManifest = readGeneratedArtifact(
    "data/generated/atlas-neighborhood-manifest.json",
  ).atlas_neighborhood_manifest;
  for (const shard of neighborhoodManifest?.shards ?? []) {
    const path = `data/generated/${shard.path}`;
    if (!existsSync(join(ROOT, path))) {
      throw new Error(`Generated data cache is incomplete: ${path}`);
    }
  }
}

function stagedGeneratedDataMatches() {
  const sourceManifest = join(ROOT, "data/generated/build-manifest.json");
  const stagedManifest = join(DIST, "data/generated/build-manifest.json");
  if (!existsSync(sourceManifest) || !existsSync(stagedManifest)) return false;
  if (!readFileSync(sourceManifest).equals(readFileSync(stagedManifest))) return false;
  if (!REQUIRED_GENERATED_FILES.every((path) => existsSync(join(DIST, path)))) return false;

  // The manifest lists artifact names and the source-data date; it carries no
  // content digest. Two data builds from the same snapshot date produce an
  // identical manifest even when an artifact's contents differ, so matching it
  // alone let the staged copy win over freshly regenerated data. A registry
  // text change was rebuilt, written to data/generated, and then served from
  // the previous dist — the site showed the old words while the repository
  // held the new ones. Size and mtime are cheap and catch that; nodes.json and
  // edges.json are tens of megabytes and are not worth hashing on every build.
  // The manifest names its own runtime artifacts, so this stays right when
  // that list changes. Directory entries are covered by the files inside them
  // that the manifest names individually.
  const manifest = JSON.parse(readFileSync(sourceManifest, "utf8"));
  const runtimeArtifacts = (manifest.build_manifest?.runtime_artifacts || [])
    .filter((name) => !name.endsWith("/"))
    .map((name) => `data/generated/${name}`);

  return [...new Set([...REQUIRED_GENERATED_FILES, ...runtimeArtifacts])].every((path) => {
    const source = join(ROOT, path);
    const staged = join(DIST, path);
    if (!existsSync(source)) return true;
    if (!existsSync(staged)) return false;
    const sourceStats = statSync(source);
    if (sourceStats.isDirectory()) return true;
    const stagedStats = statSync(staged);
    return stagedStats.size === sourceStats.size && stagedStats.mtimeMs >= sourceStats.mtimeMs;
  });
}

if (reuseGenerated) {
  console.log("Reusing the validated generated-data artifact.");
} else {
  // Run deterministic artifact builders in-process. On Windows, repeatedly
  // nesting Node through execFileSync can terminate before diagnostics are
  // emitted; direct module execution preserves the same package-script owners
  // and surfaces the actual exception.
  const { buildFrameworkData } = await import(
    pathToFileURL(join(ROOT, "scripts/build-framework-data.mjs")).href
  );
  const graphResult = buildFrameworkData();
  console.log(
    `Built federal graph: ${graphResult.sources} sources, ${graphResult.nodes} nodes, ${graphResult.edges} edges, ${graphResult.evidence} evidence records, ${graphResult.findings} findings`,
  );
  await import(pathToFileURL(join(ROOT, "scripts/build-commons-index.mjs")).href);
}

assertGeneratedDataComplete();
const reuseStagedData = reuseGenerated && stagedGeneratedDataMatches();
if (reuseStagedData) {
  rmSync(join(DIST, "assets"), { force: true, recursive: true });
  console.log("Reusing unchanged staged data and rebuilding application assets only.");
}

const commitSha =
  process.env.CONTROL_ATLAS_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const releaseDate =
  process.env.CONTROL_ATLAS_RELEASE_DATE ||
  execFileSync("git", ["show", "-s", "--format=%cI", commitSha], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
const sourceDataGeneratedAt = readGeneratedArtifact(
  "data/generated/sources.json",
).generated_at;

if (!/^\d{4}-\d{2}-\d{2}T/.test(releaseDate)) {
  throw new Error(`Unable to determine release date for ${commitSha}`);
}
if (!/^\d{4}-\d{2}-\d{2}T/.test(sourceDataGeneratedAt || "")) {
  throw new Error("Generated sources are missing a valid generated_at timestamp");
}

// Pulse is derived from accepted lifecycle evidence before the app build: Home
// renders its bounded slice statically, so Home never fetches it.
runNodeSync(["--import", "tsx", join(ROOT, "scripts/build-pulse-artifact.mjs"),
  "--output", join(ROOT, "data/generated")], { cwd: ROOT, stdio: "inherit" });

runNodeSync([join(ROOT, "node_modules/vite/bin/vite.js"), "build"], {
  cwd: ROOT,
  env: {
    ...process.env,
    VITE_CONTROL_ATLAS_RELEASE_DATE: releaseDate,
    VITE_CONTROL_ATLAS_SOURCE_DATA_DATE: sourceDataGeneratedAt,
    CONTROL_ATLAS_REUSE_STAGED_DATA: reuseStagedData ? "1" : "0",
  },
  stdio: "inherit",
});

writeFileSync(
  join(DIST, "release.json"),
  `${JSON.stringify({
    schema_version: "1.1",
    commit_sha: commitSha,
    released_at: releaseDate,
    source_data_generated_at: sourceDataGeneratedAt,
  })}\n`,
  "utf8",
);

if (reuseStagedData) {
  console.log("Reusing the staged data, map, Atlas, and compressed JSON artifacts.");
} else {
  for (const [sourceRelativePath, destRelativePath] of COPY_PATHS) {
    copyIntoDist(sourceRelativePath, destRelativePath);
  }
}

// The full Pulse artifact (every event with its evidence, and what was withheld)
// is published beside the site for audit, even when staged data is reused.
mkdirSync(join(DIST, "data/generated"), { recursive: true });
cpSync(join(ROOT, "data/generated/pulse.json"), join(DIST, "data/generated/pulse.json"));

// Research data is requested only when a visitor opens the research view.
// Build against the same accepted corpus even when application assets are reused.
runNodeSync(["--import", "tsx", join(ROOT, "scripts/build-atlas-research-artifact.mjs"),
  "--output", join(DIST, "data/generated")], { cwd: ROOT, stdio: "inherit" });

// The territory index is small (publication routes only); rebuilt with the corpus like research data.
runNodeSync(["--import", "tsx", join(ROOT, "scripts/build-atlas-territory-artifact.mjs"),
  "--output", join(DIST, "data/generated")], { cwd: ROOT, stdio: "inherit" });

console.log(reuseStagedData ? "Compressing changed JSON files with gzip..." : "Compressing JSON files with gzip...");
function getFiles(dir) {
  const result = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getFiles(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

for (const file of getFiles(DIST)) {
  if (file.endsWith(".json")) {
    const compressedPath = `${file}.gz`;
    if (
      reuseStagedData &&
      existsSync(compressedPath) &&
      statSync(compressedPath).mtimeMs >= statSync(file).mtimeMs
    ) {
      continue;
    }
    const content = readFileSync(file);
    const compressed = gzipSync(content, { level: 9 });
    writeFileSync(compressedPath, compressed);
  }
}

console.log(`Built staged static site at ${DIST}`);
