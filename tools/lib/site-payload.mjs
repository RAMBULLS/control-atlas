import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

// https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
export const MAX_PUBLISHED_SITE_BYTES = 1_000_000_000;
export const COMPRESSED_JSON_DIRECTORIES = [
  'atlas-neighborhood', 'graph-data', 'compare-data', 'catalog-records',
].map(name => `data/generated/${name}`);

function filesWithin(root) {
  const base = resolve(root);
  const files = [];
  function visit(path) {
    const within = relative(base, path);
    if (within === '..' || within.startsWith(`..${sep}`)) throw new Error('Published file escaped the site directory.');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Published site must not contain symbolic links.');
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else if (stat.isFile()) files.push({ path, relative: within.split(sep).join('/'), bytes: stat.size });
    else throw new Error('Published site contains an unsupported file type.');
  }
  visit(base);
  return files;
}

function compressedJsonFile(file) {
  return file.relative.endsWith('.json') && COMPRESSED_JSON_DIRECTORIES.some(dir => file.relative.startsWith(`${dir}/`));
}

export function compactPublishedJson(root) {
  const files = filesWithin(root);
  const byPath = new Map(files.map(file => [file.path, file]));
  const duplicates = files.filter(compressedJsonFile);
  // Validate every pair before removing anything. Source/generated evidence is
  // outside this staged site and remains untouched.
  for (const file of duplicates) {
    const compressed = byPath.get(`${file.path}.gz`);
    if (!compressed || !gunzipSync(readFileSync(compressed.path)).equals(readFileSync(file.path))) {
      throw new Error(`Published gzip does not preserve its full JSON input: ${file.relative}`);
    }
  }
  for (const file of duplicates) rmSync(file.path);
  return { removedFiles: duplicates.length, removedBytes: duplicates.reduce((sum, file) => sum + file.bytes, 0) };
}

export function verifyPublishedSite(root, maxBytes = MAX_PUBLISHED_SITE_BYTES) {
  const files = filesWithin(root);
  if (files.some(compressedJsonFile)) throw new Error('Published large JSON payloads must use their verified gzip representation.');
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes > maxBytes) throw new Error(`Published site exceeds ${maxBytes} bytes: ${bytes}`);
  return { files: files.length, bytes, maxBytes };
}
