#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { loadSourceRegistry } from '../tools/validators/source-registry.mjs';
import { validateGraphArtifacts } from '../tools/validators/federal-graph.mjs';
import { readGeneratedCollection } from './lib/generated-graph-artifacts.mjs';

const required = [
  'dist/site/index.html',
  'dist/site/404.html',
  'dist/site/assets/',
  'dist/site/data/source-registry.json',
  'dist/site/data/generated/sources.json',
  'dist/site/data/generated/catalog-bootstrap-record.json',
  'dist/site/data/generated/nodes.json',
  'dist/site/data/generated/edges.json',
  'dist/site/data/generated/evidence.json',
  'dist/site/data/generated/graph-health.json',
  'dist/site/data/generated/build-manifest.json',
  'dist/site/data/generated/source-manifests.json',
  'dist/site/data/generated/graph-diff-summary.json',
];
for (const path of required) assert.ok(existsSync(path), `${path} is required`);

const registry = loadSourceRegistry(JSON.parse(readFileSync('dist/site/data/source-registry.json', 'utf8')));
const nodes = readGeneratedCollection('dist/site', 'nodes').nodes;
const edges = readGeneratedCollection('dist/site', 'edges').edges;
const evidence = readGeneratedCollection('dist/site', 'evidence').evidence;
const findings = JSON.parse(readFileSync('dist/site/data/generated/graph-health.json', 'utf8')).findings;
const buildManifest = JSON.parse(readFileSync('dist/site/data/generated/build-manifest.json', 'utf8')).build_manifest;
const sourceManifests = JSON.parse(readFileSync('dist/site/data/generated/source-manifests.json', 'utf8')).source_manifests;
const indexHtml = readFileSync('dist/site/index.html', 'utf8');
const assets = readdirSync('dist/site/assets');
const policyPosition = indexHtml.indexOf('http-equiv="Content-Security-Policy"');
const firstScriptPosition = indexHtml.search(/<script\b/i);
assert.ok(policyPosition >= 0 && firstScriptPosition > policyPosition, 'the security policy must precede every executable script');
const arrivalScripts = [...indexHtml.matchAll(/<script data-arrival-delivery>([\s\S]*?)<\/script>/g)];
assert.equal(arrivalScripts.length, 1, 'arrival delivery uses one exact inline first-paint script');
const arrivalHash = createHash('sha256').update(arrivalScripts[0][1]).digest('base64');
assert.ok(indexHtml.includes(`'sha256-${arrivalHash}'`), 'CSP must admit the exact arrival bytes');
assert.doesNotMatch(indexHtml.match(/script-src [^;]+;/)[0], /unsafe-inline/, 'executable inline scripts still require exact hashes');
const fontStyles = indexHtml.match(/<style data-orbital-fonts>([\s\S]*?)<\/style>/)?.[1];
assert.ok(fontStyles, 'pinned font declarations must precede the stylesheet and arrival script');
assert.equal((fontStyles.match(/@font-face/g) || []).length, 5);
assert.ok(indexHtml.indexOf('<style data-orbital-fonts>') < indexHtml.indexOf('<script data-arrival-delivery>'));

assert.equal(registry.registry.schema_version, '5.0');
assert.ok(nodes.length > 6000, 'normalized federal graph nodes required');
assert.ok(edges.length > 3000, 'source-backed federal graph edges required');
assert.ok(evidence.length >= edges.length, 'every current edge must have one or more evidence records');
assert.deepEqual(
  validateGraphArtifacts({ sources: registry.sources, nodes, edges, evidence }),
  [],
  'the built graph must retain complete evidence coverage and valid references',
);
assert.equal(findings.length, 0, 'the shipped graph must contain no unresolved integrity findings');
assert.ok(nodes.some((node) => node.id === 'nist-800-53a:AC-2'), 'assessment procedures must be present');
assert.ok(edges.some((edge) => edge.relationship_type === 'assesses'), 'assessment edges must be present');
assert.ok(buildManifest.governance_artifacts.includes('build-manifest.json'));
assert.ok(sourceManifests.some((entry) => entry.source_id === 'nist-800-53a-assessment-procedures'));
assert.match(indexHtml, /\.\/assets\//);
assert.doesNotMatch(indexHtml, /(?:src|href)="\/assets\//);
assert.ok(assets.some((asset) => asset.endsWith('.js')), 'built JavaScript asset must exist');
assert.ok(assets.some((asset) => asset.endsWith('.css')), 'built CSS asset must exist');

const notFoundHtml = readFileSync('dist/site/404.html', 'utf8');
assert.match(notFoundHtml, /<title>Page not found \| Control Atlas<\/title>/, '404.html must identify the static not-found state');
assert.match(notFoundHtml, /the Control Atlas home page/, '404.html must offer a canonical recovery link');
assert.doesNotMatch(notFoundHtml, /<script/, '404.html must not redirect retired path URLs into the HashRouter');

console.log(`Static smoke passed: ${registry.sources.length} sources, ${nodes.length} nodes, ${edges.length} edges, ${findings.length} findings`);
