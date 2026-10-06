import { TERRITORY_GEOMETRY } from "./atlasTerritoryGeography";
import { validateTerritoryIndex, validateTerritoryManifest, type TerritoryIndex } from "./atlasTerritoryIndex";

let pending: Promise<TerritoryIndex> | null = null;

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url.href, { cache: "no-cache" });
  if (!response.ok) throw new Error("Territory data could not be loaded.");
  return response.json();
}

/** Small (tens of KB) publication-level routes; fetched once per page load. */
export function loadTerritoryIndex(base: string = window.location.href): Promise<TerritoryIndex> {
  pending ||= (async () => {
    const manifest = validateTerritoryManifest(await fetchJson(new URL("./data/generated/atlas-territory-manifest.json", base)));
    const index = validateTerritoryIndex(await fetchJson(new URL(`./data/generated/atlas-territory/${manifest.sha256}.json`, base)), manifest,
      Object.keys(TERRITORY_GEOMETRY.assignments));
    if (index.geometryVersion !== TERRITORY_GEOMETRY.version) throw new Error("Territory data was built for a different map version.");
    return index;
  })().catch((error) => { pending = null; throw error; });
  return pending;
}
