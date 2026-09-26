// Content identity for the generated runtime artifacts.
//
// The static build may reuse the data already staged in dist instead of
// copying it again. Deciding that by comparing build-manifest.json alone was
// wrong: the manifest carries artifact names, counts and the source-data date,
// but no content digest, so two builds from the same snapshot date produce an
// identical manifest even when an artifact's contents differ. A corrected
// registry string was regenerated into data/generated and then served from the
// previous dist — the site showed the old words while the repository held the
// new ones.
//
// Size and mtime are not a fix. Two different artifacts can be the same length,
// and copying, caching or extracting an archive rewrites mtimes. The only
// honest answer to "is this the same data" is the bytes.
//
// Hashing the whole corpus costs about four seconds for roughly a gigabyte,
// which is cheaper than serving stale data people are asked to trust.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * The runtime artifacts a manifest names, with directory entries expanded to
 * the files inside them. Paths are returned relative to the generated-data
 * root, using forward slashes so a digest is the same on every platform.
 *
 * @param {string} root directory holding the generated data
 * @param {object} manifest parsed build-manifest.json
 * @returns {string[]} sorted relative paths
 */
export function runtimeArtifactPaths(root, manifest) {
  const names = manifest?.build_manifest?.runtime_artifacts || [];
  const paths = [];
  for (const name of names) {
    const relative = name.replace(/\/+$/, "");
    const absolute = join(root, relative);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) paths.push(...walk(root, relative));
    else paths.push(relative.replaceAll("\\", "/"));
  }
  return [...new Set(paths)].sort();
}

function walk(root, relative, accumulator = []) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const next = posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) walk(root, next, accumulator);
    else accumulator.push(next);
  }
  return accumulator;
}

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * One SHA-256 over the whole artifact set: every path and the digest of its
 * contents, in a fixed order. A file that changed, appeared or disappeared
 * changes this value; a file that was merely re-copied does not.
 *
 * Returns null when any expected artifact is missing, because "some of it" is
 * not an identity.
 *
 * @param {string} root directory holding the generated data
 * @param {string[]} relativePaths from runtimeArtifactPaths
 * @returns {Promise<string|null>}
 */
export async function digestArtifacts(root, relativePaths) {
  const summary = createHash("sha256");
  for (const relative of relativePaths) {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) return null;
    summary.update(relative);
    summary.update("\0");
    summary.update(await hashFile(absolute));
    summary.update("\n");
  }
  return summary.digest("hex");
}

/**
 * Do the staged copy and the source hold byte-identical runtime artifacts?
 *
 * @param {string} sourceRoot data/generated
 * @param {string} stagedRoot dist/site/data/generated
 * @returns {Promise<{identical: boolean, reason: string}>}
 */
export async function generatedDataIsIdentical(sourceRoot, stagedRoot) {
  const manifestPath = join(sourceRoot, "build-manifest.json");
  if (!existsSync(manifestPath)) return { identical: false, reason: "no-source-manifest" };
  if (!existsSync(join(stagedRoot, "build-manifest.json"))) return { identical: false, reason: "no-staged-manifest" };

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const paths = runtimeArtifactPaths(sourceRoot, manifest);
  if (paths.length === 0) return { identical: false, reason: "no-runtime-artifacts" };

  const sourceDigest = await digestArtifacts(sourceRoot, paths);
  const stagedDigest = await digestArtifacts(stagedRoot, paths);
  if (!stagedDigest) return { identical: false, reason: "staged-artifact-missing" };
  if (sourceDigest !== stagedDigest) return { identical: false, reason: "content-differs" };
  return { identical: true, reason: "content-identical" };
}
