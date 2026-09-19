import { AtlasResearchEngine, validateResearchIndex, validateResearchManifest, type ResearchManifest } from "../lib/atlasResearchIndex";
import { researchId } from "../lib/atlasResearchState";

let engine: AtlasResearchEngine | null = null;

async function bytes(url: string, compressed: boolean, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), credentials: "same-origin" });
  if (!response.ok || !response.body) throw new Error("Research download failed.");
  const body = compressed ? response.body.pipeThrough(new DecompressionStream("gzip")) : response.body;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) throw new Error("Research data exceeds the expected size.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { data.set(chunk, position); position += chunk.length; }
  return data;
}

async function load(manifestUrl: string): Promise<ResearchManifest> {
  const base = new URL(manifestUrl);
  if (base.origin !== self.location.origin || !base.pathname.endsWith("/data/generated/atlas-research-manifest.json")) {
    throw new Error("Invalid research data location.");
  }
  const manifestBytes = await bytes(base.href, false, 4096);
  const manifest = validateResearchManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const url = new URL(`atlas-research/${manifest.sha256}.json`, base);
  let data: Uint8Array<ArrayBuffer>;
  try { data = await bytes(`${url.href}.gz`, true, manifest.bytes); }
  catch { data = await bytes(url.href, false, manifest.bytes); }
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(b => b.toString(16).padStart(2, "0")).join("");
  if (data.length !== manifest.bytes || hash !== manifest.sha256) throw new Error("Research snapshot failed its integrity check.");
  engine = new AtlasResearchEngine(validateResearchIndex(JSON.parse(new TextDecoder().decode(data)), manifest));
  return manifest;
}

self.addEventListener("message", async (event: MessageEvent) => {
  const { id, command } = event.data;
  try {
    let value: unknown;
    if (command.kind === "load") value = await load(command.url);
    else {
      if (!engine) throw new Error("Research data is not ready.");
      if (command.kind === "search") value = engine.search(String(command.query));
      else if (command.kind === "records") value = engine.records(command.ids.slice(0, 8).map(researchId).filter(Boolean));
      else if (command.kind === "path") value = engine.path(researchId(command.from), researchId(command.to), command.direction, command.maxHops);
      else if (command.kind === "upstream") value = engine.upstream(researchId(command.from), command.catalogs.slice(0, 40).map(researchId).filter(Boolean), command.maxHops);
      else if (command.kind === "degree") value = engine.degree(researchId(command.id));
      else if (command.kind === "shared") value = engine.shared(command.pins, command.offset);
      else throw new Error("Unknown research request.");
    }
    self.postMessage({ id, value });
  } catch {
    // Never turn a load, parse, integrity, or selection failure into "no path".
    self.postMessage({ id, error: true });
  }
});
