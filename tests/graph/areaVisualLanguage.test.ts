import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import treeSpine from "../../data/curated/tree-spine.json";
import {
  AREA_IDS,
  AREA_PRESENTATIONS,
  AUTHORITY_PRESENTATION,
  areaCssVariables,
  areaPresentationFor,
  areaPresentationForCatalog,
} from "../../src/ui/lib/areaVisualLanguage";

const tokens = [
  readFileSync("node_modules/orbital-archive-no-01/tokens/dist/tokens.css", "utf8"),
  readFileSync("styles/tokens.css", "utf8"),
].join("\n");
const components = readFileSync("styles/components.css", "utf8");
const atlasTerritoryCss = readFileSync("styles/atlas-territory.css", "utf8");
const tagComponent = readFileSync("src/ui/components/TaxonomyTag.tsx", "utf8");

// Governance and architecture were violet (#5a63d6/#8791f0, #8a57cc/#b085ec)
// and implementation a saturated blue; Orbital AGENTS.md §4 forbids purple
// outright and keeps the base field desaturated, so all three moved onto the
// system's own muted blue-green family.
const LOCKED_HUES = {
  governance: ["#3f6f86", "#77a8be"],
  assessment: ["#1c8fb2", "#45b6d6"],
  risk: ["#c87a24", "#e0a24a"],
  operations: ["#61748a", "#8496a8"],
  compliance: ["#2e9b6e", "#4fc38e"],
  "threats-defense": ["#ce463f", "#f0736b"],
  architecture: ["#4a7d74", "#7fb9ad"],
  knowledge: ["#3e9b78", "#5fc79c"],
  implementation: ["#3a6f92", "#7aa8c6"],
  authority: ["#b07a1e", "#e0b15a"],
} as const;

const FORBIDDEN_HUE_RANGE = { min: 255, max: 330 };

function tokenValue(name: string, seen = new Set<string>()): string {
  assert.ok(!seen.has(name), `Circular token reference at ${name}`);
  seen.add(name);
  const match = tokens.match(new RegExp(`${name}:\\s*([^;]+);`, "i"));
  assert.ok(match, `Missing ${name}`);
  const value = match[1].trim().toLowerCase();
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias ? tokenValue(alias[1], seen) : value;
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".css", ".html", ".mjs", ".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

test("area presentation registry exactly follows the canonical nine-area spine", () => {
  assert.deepEqual(AREA_IDS, treeSpine.limbs.map((limb) => limb.id));
  assert.equal(AREA_PRESENTATIONS.length, 9);
  assert.equal(new Set(AREA_PRESENTATIONS.map((area) => area.token)).size, 9);
  assert.equal(AUTHORITY_PRESENTATION.token, "--ca-area-authority");

  for (const area of AREA_PRESENTATIONS) {
    assert.equal(areaPresentationFor(area.id), area);
    assert.equal(areaPresentationFor(area.label), area);
    assert.equal(areaPresentationFor(area.slug), area);
    assert.deepEqual(areaCssVariables(area), {
      "--ca-area-color": `var(${area.token})`,
      "--ca-area-color-on-light": `var(${area.token}-on-light)`,
      "--ca-area-color-on-dark": `var(${area.token}-on-dark)`,
    });
  }
  assert.equal(areaPresentationFor("not-an-area"), null);
});

test("catalogs and their families inherit one canonical area mapping", () => {
  for (const [catalogId, areaId] of Object.entries(treeSpine.catalogLimbs)) {
    assert.equal(areaPresentationForCatalog(catalogId)?.id, areaId);
  }
  for (const catalog of treeSpine.syntheticCatalogs) {
    assert.equal(areaPresentationForCatalog(catalog.catalog_id)?.id, catalog.limb);
  }
  assert.equal(areaPresentationForCatalog("unknown-catalog"), null);
});

test("locked area hue pairs and global layout tokens are exact", () => {
  for (const [slug, [onLight, onDark]] of Object.entries(LOCKED_HUES)) {
    assert.equal(tokenValue(`--ca-area-${slug}-on-light`), onLight);
    assert.equal(tokenValue(`--ca-area-${slug}-on-dark`), onDark);
    assert.match(tokens, new RegExp(`--ca-area-${slug}:\\s*var\\(--ca-area-${slug}-on-dark\\)`));
    assert.ok(contrast(onLight, tokenValue("--ca-paper")) >= 3, `${slug} must remain visible on light surfaces`);
    assert.ok(contrast(onDark, tokenValue("--ca-surface")) >= 3, `${slug} must remain visible on dark surfaces`);
  }

  assert.match(tokens, /--ca-content-max:\s*82rem/);
  assert.match(tokens, /--ca-workspace-max:\s*100rem/);
  assert.match(tokens, /--ca-reading-measure:\s*45rem/);
  assert.match(tokens, /--ca-grid-gutter:\s*var\(--ca-space-6\)/);
  assert.match(tokens, /--ca-section-gap:\s*var\(--ca-space-12\)/);
  assert.match(tokens, /--ca-card-min:\s*17\.5rem/);
  assert.match(tokens, /--ca-facet-rail-width:\s*17\.5rem/);
  assert.match(tokens, /--ca-record-rail-width:\s*20rem/);
  assert.match(tokens, /--ca-atlas-rail-width:\s*20rem/);
  for (const step of [5, 10, 20, 24]) {
    assert.match(tokens, new RegExp(`--ca-space-${step}:\\s*var\\(--lsm-space-${step}\\)`));
  }
  assert.doesNotMatch(tokens, /--ca-space-32:/);
});

test("no area hue lands in the purple range Orbital forbids", () => {
  for (const [slug, pair] of Object.entries(LOCKED_HUES)) {
    for (const hex of pair) {
      const hue = hueOf(hex);
      assert.ok(
        hue < FORBIDDEN_HUE_RANGE.min || hue > FORBIDDEN_HUE_RANGE.max,
        `${slug} (${hex}) sits at ${Math.round(hue)}deg, inside the purple/magenta range Orbital AGENTS.md forbids`,
      );
    }
  }
});

function hueOf(hex: string): number {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

test("decorative color resolves to one teal accent, and the primary action is orange", () => {
  // v1.8: teal (#5ca3a6) is the single broad decorative/state hue; the primary
  // ACTION button is the only surface carrying orange, so it is asserted apart.
  assert.equal(tokenValue("--ca-accent"), "#5ca3a6");
  for (const alias of [
    "--ca-primary",
    "--ca-secondary",
    "--ca-link",
    "--ca-priority",
    "--ca-info",
  ]) {
    assert.equal(tokenValue(alias), "#5ca3a6", `${alias} must resolve to the one accent`);
  }
  assert.equal(tokenValue("--ca-editorial"), "#cbae67", "editorial accent uses gold, not teal");
  assert.equal(tokenValue("--ca-action-primary"), "#cb7248", "primary action button must be Ignition Orange");
  assert.equal(tokenValue("--ca-on-primary"), "#11181e", "primary action ink must be dark (orbit)");
  assert.equal(tokenValue("--ca-accent-gold"), "#cbae67", "sparing gold accent must be defined");
});

test("bucket tags stay neutral and area fills remain inside Atlas", () => {
  assert.match(tagComponent, /presentation\?\.label/);
  assert.match(components, /\.bucket-tag,[\s\S]*background:\s*var\(--ca-surface\)/);
  assert.match(components, /\.bucket-tag:not\(\.bucket-tag--neutral\)\s*\{[\s\S]*border-left:[^}]*--ca-area-color/);
  assert.doesNotMatch(components, /\.bucket-tag\s*\{[^}]*background:[^;}]*--ca-area-color/s);
  // Area colour fills belong to the Atlas territory map, never to tags elsewhere.
  assert.match(atlasTerritoryCss, /\.district, [^{]*\{\s*--c: var\(--ca-area-color-on-dark, var\(--ca-area-color/);
});

test("stylesheets never reference undefined font tokens (the canonical names are --ca-font-*)", () => {
  // Guards the class of bug where `var(--font-display)` (no --ca- prefix) is
  // undefined, silently falls back to inherited body/serif, and quietly drops
  // the Oswald display face on headings. Only --ca-font-display/body/mono/pixel
  // exist; a bare --font-* reference is always a typo.
  const offenders = sourceFiles("styles")
    .flatMap((path) => {
      const hits = readFileSync(path, "utf8").match(/var\(--font-(?:display|body|mono|pixel)\)/g);
      return hits ? [`${path}: ${[...new Set(hits)].join(", ")}`] : [];
    });
  assert.deepEqual(offenders, [], "use var(--ca-font-*), not var(--font-*)");
});

test("route and component sources contain no authored color literals", () => {
  const offenders = [...sourceFiles("src"), ...sourceFiles("styles")]
    .filter((path) => !path.endsWith(join("styles", "tokens.css")))
    .flatMap((path) => {
      const matches = readFileSync(path, "utf8").match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi);
      return matches ? [`${path}: ${matches.join(", ")}`] : [];
    });
  assert.deepEqual(offenders, []);
});
