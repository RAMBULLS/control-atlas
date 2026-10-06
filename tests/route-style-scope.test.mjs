import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Route styles stay with their routes, and the stylesheet Home pays for does
 * not grow because somewhere else got a new look.
 *
 * Home is the entry route: it loads the shared stylesheet on first paint,
 * before any route chunk. Every rule added to a shared sheet for one route is
 * bytes and parse time on every other route, Home most of all. The #284 pass
 * caught this once by moving the publication and Sources styles into their own
 * sheet; this keeps it caught.
 */

const read = (path) => readFileSync(path, "utf8");

/** Stylesheets every route loads. Adding to this list is a deliberate act. */
const SHARED_STYLESHEETS = [
  "orbital-archive-no-01/css",
  "orbital-archive-no-01/fonts.css",
  "../styles/tokens.css",
  "../styles/base.css",
  "../styles/components.css",
  "../styles/surfaces.css",
  "../styles/tailwind.css",
  "../styles/orbital.css",
];

/** Route-scoped stylesheets and the page modules allowed to import them. */
const ROUTE_STYLESHEETS = {
  "styles/publication-trust.css": ["src/ui/pages/CatalogDetailPage.tsx", "src/ui/pages/SourcesPage.tsx"],
  "styles/atlas-territory.css": ["src/ui/pages/AtlasTerritoryPage.tsx"],
  "styles/resources.css": ["src/ui/pages/CommonsPage.tsx", "src/ui/pages/CommonsDetailPage.tsx"],
};

/**
 * The shared entry sheet's ceiling. This is a ratchet, not a target: it exists
 * so growth is a decision someone makes and explains, not a side effect. Lower
 * it when the sheet shrinks.
 */
const ENTRY_CSS_BUDGET_BYTES = 410_000;

test("main.tsx loads the shared stylesheets and nothing route-specific", () => {
  const main = read("src/main.tsx");
  const imported = [...main.matchAll(/^import\s+["']([^"']+\.css|[^"']*\/css)["'];?$/gm)].map((match) => match[1]);
  assert.deepEqual(
    imported,
    SHARED_STYLESHEETS,
    "src/main.tsx stylesheet imports changed. A route-specific sheet imported here loads on Home.",
  );
});

test("route stylesheets are imported only by the routes that own them", () => {
  const sources = readdirSync("src/ui/pages")
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => join("src/ui/pages", name).replaceAll("\\", "/"));
  const scanned = [...sources, "src/main.tsx", "src/ui/App.tsx"];

  for (const [stylesheet, owners] of Object.entries(ROUTE_STYLESHEETS)) {
    const basename = stylesheet.split("/").pop();
    const importers = scanned.filter((file) => new RegExp(`import\\s+["'][^"']*${basename.replace(".", "\\.")}["']`).test(read(file)));
    assert.deepEqual(
      importers.sort(),
      [...owners].sort(),
      `${stylesheet} is imported by the wrong set of routes`,
    );
  }
});

test("every route-scoped stylesheet is actually split out of the entry bundle", { skip: !existsSync("dist/site/assets") }, () => {
  const assets = readdirSync("dist/site/assets").filter((name) => name.endsWith(".css"));
  const entry = assets.filter((name) => name.startsWith("index-"));
  assert.equal(entry.length, 1, `Expected one entry stylesheet, found ${entry.join(", ")}`);
  assert.ok(
    assets.length > 1,
    "No route stylesheets were emitted; route styles have collapsed back into the entry bundle.",
  );

  const entryBytes = statSync(join("dist/site/assets", entry[0])).size;
  assert.ok(
    entryBytes <= ENTRY_CSS_BUDGET_BYTES,
    `Entry stylesheet is ${entryBytes} bytes, over the ${ENTRY_CSS_BUDGET_BYTES} budget Home pays on first paint. ` +
    "Move route-specific rules into that route's stylesheet, or raise the budget deliberately and say why.",
  );
});

test("route-scoped rules do not leak into the shared sheets by selector", () => {
  // Cheap containment check on source, so it fails in lint/unit rather than
  // only after a build. These prefixes belong to one route each.
  const shared = ["styles/base.css", "styles/components.css", "styles/surfaces.css", "styles/orbital.css"];
  const ROUTE_ONLY_PREFIXES = [".catalog-about__", ".catalog-work-group", ".publication-dates", ".publication-limitations", ".source-register-views"];
  for (const file of shared) {
    const css = read(file);
    for (const prefix of ROUTE_ONLY_PREFIXES) {
      assert.ok(
        !css.includes(prefix),
        `${file} contains ${prefix}, which belongs to the publication/Sources stylesheet.`,
      );
    }
  }
});
