import { AtlasIndex, normalizeScene, compareSnapshots } from "./model.mjs";
let indexPromise;
const proofCache = new Map();
async function readArtifact(base, descriptor) {
  if (!descriptor || !/^atlas-workbench\/[a-z0-9-]+\.json$/.test(descriptor.path) || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error("Invalid Atlas artifact reference.");
  const url = new URL(descriptor.path, base);
  if (url.origin !== self.location.origin || descriptor.bytes > 45000000) throw new Error("Atlas artifact is outside the allowed boundary.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    let bytes;
    if (typeof DecompressionStream !== "undefined") {
      try {
        const response = await fetch(`${url}.gz`, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("Compressed artifact unavailable.");
        bytes = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      } catch (error) { if (controller.signal.aborted) throw error; }
    }
    if (!bytes) { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error(`Atlas data request failed (${response.status}).`); bytes = await response.arrayBuffer(); }
    if (bytes.byteLength !== descriptor.bytes) throw new Error("Atlas data size did not match the published manifest.");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (hash !== descriptor.sha256) throw new Error("Atlas data did not match this release. Reload before continuing.");
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { clearTimeout(timer); }
}
async function getIndex(base, manifest) {
  if (!indexPromise) indexPromise = readArtifact(base, manifest.index).then((payload) => {
    if (payload.snapshot !== manifest.snapshot) throw new Error("Atlas refuses mixed public snapshots.");
    return new AtlasIndex(payload);
  }).catch((error) => { indexPromise = null; throw error; });
  return indexPromise;
}
self.onmessage = async ({ data }) => {
  const { id, command, manifest, base } = data;
  try {
    if (command === "snapshot") {
      const snapshot = await readArtifact(base, manifest.snapshotFile);
      if (snapshot.snapshot !== manifest.snapshot) throw new Error("Snapshot mismatch.");
      self.postMessage({ id, result: snapshot }); return;
    }
    if (command === "changes") {
      const snapshot = await readArtifact(base, manifest.snapshotFile);
      if (snapshot.snapshot !== manifest.snapshot) throw new Error("Snapshot mismatch.");
      const changes = compareSnapshots(data.before, snapshot);
      const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
      const priorById = new Map((data.before?.nodes || []).map((node) => [node.id, node]));
      self.postMessage({ id, result: { ...changes, rows: changes.available ? [
        ...changes.nodes.added.slice(0, 40).map((key) => ({ change: "Added to Atlas", node: byId.get(key) })),
        ...changes.nodes.changed.slice(0, 40).map((key) => ({ change: "Record changed", node: byId.get(key), previous: priorById.get(key) })),
        ...changes.nodes.removed.slice(0, 40).map((key) => ({ change: "Removed from this snapshot", node: priorById.get(key) })),
      ] : [] } }); return;
    }
    const index = await getIndex(base, manifest);
    if (command === "evidence") {
      const edge = index.edges.get(data.edge);
      if (!edge) throw new Error("This relationship is not in the selected snapshot.");
      if (!proofCache.has(edge.shard)) {
        if (proofCache.size >= 4) proofCache.delete(proofCache.keys().next().value);
        proofCache.set(edge.shard, readArtifact(base, manifest.evidence[edge.shard]).catch((error) => { proofCache.delete(edge.shard); throw error; }));
      }
      const payload = await proofCache.get(edge.shard);
      const proof = payload.records[data.edge];
      if (payload.snapshot !== manifest.snapshot || !proof || proof.source_node_id !== edge.source || proof.target_node_id !== edge.target || proof.relationship_type !== edge.type) throw new Error("Relationship evidence did not match the query index.");
      self.postMessage({ id, result: proof }); return;
    }
    const scene = normalizeScene(data.scene);
    const selected = index.nodes.get(scene.focus) || null;
    const result = { ...index.search(scene), selected, pins: scene.pins.map((pin) => index.nodes.get(pin) || { id: pin, title: pin, missing: true }), neighbors: scene.focus ? index.neighbors(scene.focus, scene) : [], parents: selected ? (index.adjacency.get(selected.id) || []).filter((edge) => edge.class === "structural" && edge.target === selected.id).map((edge) => ({ edge, node: index.nodes.get(edge.source) })) : [], route: scene.mode === "route" && (scene.from || scene.focus) && scene.target ? index.route(scene.from || scene.focus, scene.target, scene) : null, shared: scene.mode === "shared" ? index.shared(scene.pins, scene) : null };
    result.neighborTotal = result.neighbors.length;
    result.neighbors = result.neighbors.slice(0, 24);
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : "Atlas could not finish this request." }); }
};
