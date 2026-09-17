/** Public-data Atlas queries. No presentation grouping is ever a graph edge. */
export const SCENE_PREFIX = "workbench.v1:";
export const MAX_PINS = 8;
export const EMPTY_SCENE = Object.freeze({ pins: [], tags: [], query: "", publication: "", region: "", focus: "", from: "", layer: "connections", target: "", mode: "browse", direction: "both", historical: false, candidates: false, structure: false, page: 0 });
const text = (value, max = 400) => typeof value === "string" ? value.slice(0, max).trim() : "";
const unique = (values, max) => [...new Set((Array.isArray(values) ? values : []).map((v) => text(v)).filter(Boolean))].slice(0, max);
export function normalizeScene(value) {
  const s = value && typeof value === "object" ? value : {};
  return { pins: unique(s.pins, MAX_PINS), tags: unique(s.tags, 16), query: text(s.query, 200), publication: text(s.publication), region: text(s.region), focus: text(s.focus), from: text(s.from), layer: ["connections", "lifecycle", "freshness"].includes(s.layer) ? s.layer : "connections", target: text(s.target), mode: ["browse", "route", "shared", "changes"].includes(s.mode) ? s.mode : "browse", direction: s.direction === "forward" ? "forward" : "both", historical: s.historical === true, candidates: s.candidates === true, structure: s.structure === true, page: Number.isInteger(s.page) ? Math.max(0, Math.min(10000, s.page)) : 0 };
}
export function decodeScene(value, focus = "") {
  let scene = EMPTY_SCENE;
  try { if (typeof value === "string" && value.startsWith(SCENE_PREFIX) && value.length <= 7000) scene = JSON.parse(value.slice(SCENE_PREFIX.length)); } catch { /* Invalid public URLs recover to an empty scene. */ }
  return normalizeScene({ ...scene, ...(focus ? { focus } : {}) });
}
export function encodeScene(scene) { return SCENE_PREFIX + JSON.stringify(normalizeScene(scene)); }
export function togglePin(scene, id) {
  const normalized = normalizeScene(scene);
  if (normalized.pins.includes(id)) return { ...normalized, pins: normalized.pins.filter((pin) => pin !== id) };
  if (normalized.pins.length >= MAX_PINS) return normalized;
  return { ...normalized, pins: [...normalized.pins, text(id)] };
}
export function humanType(value) { return text(value).replaceAll("_", " "); }
const CURRENT = new Set(["active", "current", "final"]);
const HISTORICAL = new Set(["historical", "retired", "withdrawn", "superseded", "deprecated", "archived"]);
export function isHistorical(status) { return HISTORICAL.has(status); }
/** Missing/unknown lifecycle is not silently classified as active or historical. */
export function lifecycleLabel(status) { return CURRENT.has(status) ? humanType(status) : status ? humanType(status) : "Status not recorded"; }
export function edgeAllowed(edge, scene) {
  if (edge.class === "organizing" || !edge.evidenceCount) return false;
  if (!scene.structure && edge.class === "structural") return false;
  if (!scene.historical && isHistorical(edge.status)) return false;
  if (edge.publicationStatus === "published" && !["inferred", "editorial", "atlas_editorial"].includes(edge.authority) && edge.confidence !== "inferred") return true;
  return scene.candidates && edge.publicationStatus === "candidate";
}
export class AtlasIndex {
  constructor(payload) {
    payload = unpackIndex(payload);
    if (payload?.schema !== 1 || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error("Unsupported Atlas index.");
    this.payload = payload;
    this.nodes = new Map(payload.nodes.map((node) => [node.id, node]));
    this.edges = new Map(payload.edges.map((edge) => [edge.id, edge]));
    if (this.nodes.size !== payload.nodes.length || this.edges.size !== payload.edges.length) throw new Error("Duplicate Atlas identities.");
    this.adjacency = new Map(); this.children = new Map(); this.members = new Map(); this.tags = new Map((payload.tags || []).map((tag) => [tag.id, tag]));
    for (const node of payload.nodes) {
      const list = this.members.get(node.publication) || []; list.push(node.id); this.members.set(node.publication, list);
    }
    for (const edge of payload.edges) {
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) throw new Error(`Unresolved Atlas assertion: ${edge.id}`);
      for (const id of [edge.source, edge.target]) { const list = this.adjacency.get(id) || []; list.push(edge); this.adjacency.set(id, list); }
      if (edge.class === "structural") { const list = this.children.get(edge.source) || []; list.push(edge.target); this.children.set(edge.source, list); }
    }
    for (const list of this.adjacency.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  }
  matches(node, scene) {
    if (scene.publication && node.publication !== scene.publication) return false;
    if (scene.region && node.region !== scene.region) return false;
    if (!scene.historical && isHistorical(node.lifecycle)) return false;
    // OR within a dimension; AND across dimensions. Unknown tags match nothing.
    const dimensions = new Map();
    for (const id of scene.tags || []) {
      const tag = this.tags.get(id); if (!tag) return false;
      const choices = dimensions.get(tag.dimension) || []; choices.push(id); dimensions.set(tag.dimension, choices);
    }
    for (const choices of dimensions.values()) if (!choices.some((tag) => node.tags.includes(tag))) return false;
    const words = text(scene.query, 200).toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const haystack = `${node.id} ${node.item} ${node.title} ${node.context} ${node.tags.map((id) => this.tags.get(id)?.label || "").join(" ")}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  }
  search(scene, limit = 40) {
    const query = scene.query.trim().toLocaleLowerCase();
    const matches = this.payload.nodes.filter((node) => this.matches(node, scene) && !["trunk", "limb"].includes(node.type));
    const score = (node) => node.id.toLocaleLowerCase() === query || node.item.toLocaleLowerCase() === query ? 0 : node.type === "catalog" ? 1 : 2;
    matches.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id, "en", { numeric: true }));
    const start = Math.min(scene.page * limit, Math.max(0, Math.floor((matches.length - 1) / limit) * limit));
    return { total: matches.length, start, nodes: matches.slice(start, start + limit), publicationCounts: matches.reduce((acc, n) => { acc[n.publication] = (acc[n.publication] || 0) + 1; return acc; }, {}) };
  }
  neighbors(id, scene) {
    return (this.adjacency.get(id) || []).filter((edge) => edgeAllowed(edge, scene)).flatMap((edge) => {
      const reverse = edge.target === id;
      if (scene.direction === "forward" && reverse) return [];
      const node = this.nodes.get(reverse ? edge.source : edge.target);
      if (!node || !this.matches(node, { ...scene, query: "", page: 0 })) return [];
      return [{ edge, node, reverse }];
    });
  }
  /** Traverse declared containment only when expanding a pinned publication/group. */
  scope(id) {
    const node = this.nodes.get(id); if (!node) return new Set();
    if (node.type === "catalog") return new Set(this.members.get(node.publication) || [id]);
    const seen = new Set([id]), queue = [id];
    for (let i = 0; i < queue.length; i += 1) for (const child of this.children.get(queue[i]) || []) if (!seen.has(child)) { seen.add(child); queue.push(child); }
    return seen;
  }
  shared(pins, scene, limit = 40) {
    const ids = unique(pins, MAX_PINS);
    if (ids.length < 2) return { nodes: [], total: 0, missing: ids.filter((id) => !this.nodes.has(id)), exclusive: [] };
    const missing = ids.filter((id) => !this.nodes.has(id));
    if (missing.length) return { nodes: [], total: 0, missing, exclusive: [] };
    const scopes = ids.map((id) => this.scope(id));
    const union = new Set(scopes.flatMap((set) => [...set]));
    const neighbors = scopes.map((scope) => {
      const matches = new Map();
      for (const id of scope) for (const row of this.neighbors(id, { ...scene, structure: false, direction: "both" })) {
        if (union.has(row.node.id)) continue;
        const proof = matches.get(row.node.id) || []; proof.push(row.edge.id); matches.set(row.node.id, proof);
      }
      return matches;
    });
    const common = [...neighbors[0].keys()].filter((id) => neighbors.every((set) => set.has(id))).sort();
    return { total: common.length, missing, nodes: common.slice(0, limit).map((id) => ({ node: this.nodes.get(id), evidence: neighbors.map((set) => [...new Set(set.get(id))]) })), exclusive: neighbors.map((set, i) => ({ pin: ids[i], total: [...set.keys()].filter((id) => neighbors.every((other, j) => j === i || !other.has(id))).length })) };
  }
  /** Bounded BFS finds one shortest route, not equivalence or applicability. */
  route(from, to, scene, { maxHops = 6, maxVisits = 60000, maxEdges = 400000 } = {}) {
    const boundary = { maxHops, maxVisits, maxEdges, direction: scene.direction, snapshot: this.payload.snapshot };
    if (!this.nodes.has(from) || !this.nodes.has(to)) return { status: "missing", steps: [], boundary };
    if (from === to) return { status: "same", steps: [], boundary };
    const queue = [{ id: from, depth: 0 }], parents = new Map([[from, null]]);
    let scanned = 0, limited = false;
    for (let i = 0; i < queue.length; i += 1) {
      const { id, depth } = queue[i];
      if (depth >= maxHops) { limited = true; continue; }
      for (const edge of this.adjacency.get(id) || []) {
        scanned += 1;
        if (scanned > maxEdges || parents.size >= maxVisits) return { status: "limited", steps: [], visited: parents.size, boundary };
        if (!edgeAllowed(edge, scene)) continue;
        const reverse = edge.target === id;
        if (reverse && scene.direction === "forward") continue;
        const next = reverse ? edge.source : edge.target;
        if (parents.has(next)) continue;
        // User context filters constrain intermediates; endpoints remain explicit.
        if (next !== to && !this.matches(this.nodes.get(next), { ...scene, query: "", page: 0 })) continue;
        parents.set(next, { previous: id, edge, reverse });
        if (next === to) {
          const steps = []; let cursor = next;
          while (cursor !== from) { const step = parents.get(cursor); steps.unshift({ from: this.nodes.get(step.previous), to: this.nodes.get(cursor), edge: step.edge, reverse: step.reverse }); cursor = step.previous; }
          return { status: "found", steps, visited: parents.size, boundary };
        }
        queue.push({ id: next, depth: depth + 1 });
      }
    }
    return { status: limited ? "limited" : "not-found", steps: [], visited: parents.size, boundary };
  }
}
/** Snapshot IDs are publisher-data fingerprints, not file order or last-checked dates. */
export function compareSnapshots(before, after) {
  if (!before) return { available: false, reason: "No earlier public snapshot has been saved on this device." };
  if (before.schema !== 1 || after.schema !== 1) throw new Error("Incompatible public snapshots.");
  const diff = (left, right) => {
    const prior = new Map(left.map((row) => [row.key || row.id, row]));
    const next = new Map(right.map((row) => [row.key || row.id, row]));
    return { added: [...next.keys()].filter((id) => !prior.has(id)), removed: [...prior.keys()].filter((id) => !next.has(id)), changed: [...next.keys()].filter((id) => prior.has(id) && next.get(id).digest !== prior.get(id).digest) };
  };
  return { available: true, before: before.snapshot, after: after.snapshot, nodes: diff(before.nodes, after.nodes), edges: diff(before.edges, after.edges) };
}
export function publicSnapshot(payload) {
  return { schema: 1, snapshot: payload.snapshot, generatedAt: payload.generatedAt, nodes: payload.nodes.map(({ id, digest, title, item, lifecycle, version, publication }) => ({ id, digest, title, item, lifecycle, version, publication })), edges: payload.edges.map(({ key, digest, source, target, type }) => ({ key, digest, source, target, type })) };
}

/** Intern endpoint IDs and metadata once; hashes belong in the on-demand history file. */
export function packIndex(payload) {
  const strings = [], dictionary = new Map();
  const intern = (s) => { s = s || ""; if (!dictionary.has(s)) { dictionary.set(s, strings.length); strings.push(s); } return dictionary.get(s); };
  const positions = new Map(payload.nodes.map((node, index) => [node.id, index]));
  return { schema: 1, encoding: "atlas-tuples-v1", snapshot: payload.snapshot, generatedAt: payload.generatedAt, tags: payload.tags, strings,
    nodes: payload.nodes.map((n) => [n.id, n.item, n.title, intern(n.publication), intern(n.type), intern(n.source), intern(n.region), intern(n.lifecycle), intern(n.version), intern(n.context), n.tags.map(intern)]),
    edges: payload.edges.map((e) => [e.id, positions.get(e.source), positions.get(e.target), intern(e.type), intern(e.class), intern(e.publicationStatus), intern(e.status), intern(e.authority), intern(e.provenance), intern(e.confidence), e.evidenceCount, e.shard]),
  };
}
export function unpackIndex(payload) {
  if (payload.encoding !== "atlas-tuples-v1") return payload;
  const s = payload.strings;
  if (!Array.isArray(s) || s.some((v) => typeof v !== "string")) throw new Error("Invalid Atlas dictionary.");
  const nodes = payload.nodes.map((n) => ({ id: n[0], item: n[1], title: n[2], publication: s[n[3]], type: s[n[4]], source: s[n[5]], region: s[n[6]], lifecycle: s[n[7]], version: s[n[8]], context: s[n[9]], tags: n[10].map((i) => s[i]) }));
  const edges = payload.edges.map((e) => ({ id: e[0], source: nodes[e[1]]?.id, target: nodes[e[2]]?.id, type: s[e[3]], class: s[e[4]], publicationStatus: s[e[5]], status: s[e[6]], authority: s[e[7]], provenance: s[e[8]], confidence: s[e[9]], evidenceCount: e[10], shard: e[11] }));
  return { schema: payload.schema, snapshot: payload.snapshot, generatedAt: payload.generatedAt, tags: payload.tags, nodes, edges };
}
