#!/usr/bin/env node
// Which public routes a change puts in front of a person, and whether the
// change is material enough to need someone to look at it (issue #284).
//
// This sits on top of tools/classify-change-scope.mjs. The classifier answers
// "what kind of change is this"; this answers "which pages did it change, and
// does a person have to see them". Data-only, docs-only, CI-only and
// source-refresh changes select nothing: they cannot move a public layout or
// rewrite public copy, and ceremony on them only teaches people to ignore it.
//
//   node tools/ui-review-routes.mjs --base <sha> --head <sha> --json out.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { classifyChangedPaths } from "./classify-change-scope.mjs";

/**
 * The public review catalogue. `owners` are the source paths whose change puts
 * this route in the review set; a prefix ending in `/` matches a directory.
 * Paths are the real hash routes the site ships.
 */
export const UI_REVIEW_ROUTES = [
  {
    id: "home",
    path: "/#/",
    title: "Home",
    owners: ["src/ui/pages/HomePage.tsx", "src/public/progressive-shell.js"],
  },
  {
    id: "start-here",
    path: "/#/start?goal=implement",
    title: "Start Here",
    owners: ["src/ui/pages/StartHerePage.tsx"],
  },
  {
    id: "atlas-overview",
    path: "/#/atlas",
    title: "Atlas overview",
    owners: ["src/ui/pages/AtlasTerritoryPage.tsx", "src/ui/components/atlas-territory/", "styles/atlas-territory.css"],
  },
  {
    id: "library",
    path: "/#/library",
    title: "Library",
    owners: ["src/ui/pages/ExplorePage.tsx"],
  },
  {
    id: "record-control",
    path: "/#/record/nist-800-53/AC-2",
    title: "Record — SP 800-53 AC-2",
    owners: ["src/ui/pages/ObjectDetailPage.tsx", "styles/record-detail.css"],
  },
  {
    id: "compare",
    path: "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=disa-cci&compareRun=true",
    title: "Compare results",
    owners: ["src/ui/pages/ComparePage.tsx"],
  },
  {
    id: "templates",
    path: "/#/build",
    title: "Templates",
    owners: ["src/ui/pages/TemplatesPage.tsx"],
  },
  {
    id: "guides",
    path: "/#/guides?pattern=implementing-controls",
    title: "Guides",
    owners: ["src/ui/pages/PlaybooksPage.tsx"],
  },
  {
    id: "resources",
    path: "/#/resources?showAll=true",
    title: "Resources",
    owners: ["src/ui/pages/CommonsPage.tsx", "styles/resources.css"],
  },
  {
    id: "about",
    path: "/#/about",
    title: "About",
    owners: ["src/ui/pages/AboutPage.tsx"],
  },
  // The trust layer. Each publication below is here because it renders a
  // different combination of recorded facts, so one of them failing is not the
  // same review as another failing.
  {
    id: "publication-800-53",
    path: "/#/library/publication/nist-800-53",
    title: "Publication — NIST SP 800-53 (flagship, dense)",
    owners: ["publication"],
  },
  {
    id: "publication-800-37",
    path: "/#/library/publication/nist-800-37",
    title: "Publication — NIST SP 800-37 (process publication)",
    owners: ["publication"],
  },
  {
    id: "publication-disa-stig",
    path: "/#/library/publication/disa-stig",
    title: "Publication — DISA STIG (largest inventory)",
    owners: ["publication"],
  },
  {
    id: "publication-cmmc",
    path: "/#/library/publication/cmmc-2",
    title: "Publication — CMMC (retrieval-dated version, 3 records)",
    owners: ["publication"],
  },
  {
    id: "publication-fedramp-current",
    path: "/#/library/publication/fedramp-2026",
    title: "Publication — FedRAMP current",
    owners: ["publication"],
  },
  {
    id: "publication-fedramp-historical",
    path: "/#/library/publication/fedramp-rev5",
    title: "Publication — FedRAMP Rev. 5 (historical)",
    owners: ["publication"],
  },
  {
    id: "publication-d3fend",
    path: "/#/library/publication/mitre-d3fend",
    title: "Publication — MITRE D3FEND",
    owners: ["publication"],
  },
  {
    id: "publication-sparse",
    path: "/#/library/publication/fips-199",
    title: "Publication — FIPS 199 (sparse, niche)",
    owners: ["publication"],
  },
  {
    id: "sources-publications",
    path: "/#/sources",
    title: "Sources — Publications",
    owners: ["sources"],
  },
  {
    id: "sources-policy",
    path: "/#/sources?layer=policy",
    title: "Sources — Policy & directives",
    owners: ["sources"],
  },
  {
    id: "sources-inspector",
    path: "/#/sources?source=disa-cci-list",
    title: "Sources — inspector with source files and crosswalk evidence",
    owners: ["sources"],
  },
  {
    id: "policy-detail",
    path: "/#/sources?source=authority-dodi-8510-01&layer=policy",
    title: "Policy detail — DoDI 8510.01 (no governed summary)",
    owners: ["sources"],
  },
];

/** Files that own every publication page, and every Sources view. */
const SURFACE_OWNERS = {
  publication: [
    "src/ui/pages/CatalogDetailPage.tsx",
    "src/ui/components/PublicationOverview.tsx",
    "src/ui/components/PublicationTrust.tsx",
    "src/ui/lib/publicationIdentity.ts",
    "src/ui/lib/publicationActions.ts",
    "src/ui/lib/publisherName.ts",
    "styles/publication-trust.css",
  ],
  sources: [
    "src/ui/pages/SourcesPage.tsx",
    "src/ui/components/PublicationTrust.tsx",
    "src/ui/lib/publicationIdentity.ts",
    "src/ui/lib/sourceRegister.ts",
    "src/ui/lib/sourcePresentation.ts",
    "styles/publication-trust.css",
  ],
};

/**
 * Shared shell, shared components and shared styles. A change here can move any
 * page, so it selects a bounded representative sample rather than all 22
 * routes: one of each layout family, which is what the route matrix already
 * samples by.
 */
const SHARED_UI_PREFIXES = [
  "src/ui/App.tsx",
  "src/ui/components/",
  "src/ui/lib/",
  "src/main.tsx",
  "index.html",
  "styles/base.css",
  "styles/components.css",
  "styles/surfaces.css",
  "styles/orbital.css",
  "styles/tokens.css",
  "styles/tailwind.css",
  "src/shared/",
  "src/app/",
];
const SHARED_SAMPLE = [
  "home",
  "atlas-overview",
  "library",
  "record-control",
  "compare",
  "templates",
  "publication-800-53",
  "sources-publications",
];

/** A change in one of these can never move a public layout or copy string. */
const NON_UI_PREFIXES = [
  // Static files served as-is. progressive-shell.js renders the first paint
  // and is listed as a route owner, so it is not caught by this.
  "src/public/robots.txt",
  "src/public/og-image",
  "src/public/apple-touch-icon",
  "src/public/favicon",
  ".github/",
  "docs/",
  "artifacts/",
  "data/",
  "maps/",
  "scripts/",
  "tools/",
  "tests/",
  "config/",
];

/**
 * Repository documentation and metadata that ships nothing to a browser.
 *
 * `package.json` and its lockfile are here on purpose. A dependency change can
 * move rendering, and the change-scope classifier already answers that: it
 * marks dependency changes as requiring the browser, accessibility, Lighthouse
 * and visual-regression gates. What it should not do is demand the owner sit
 * down with screenshots for every routine bump. A gate that fires on
 * everything is a gate people learn to wave through, and then it protects
 * nothing. A design-package change that is meant to look different arrives
 * with style or component edits, and those do select review.
 */
const NON_UI_FILES = /^(?:README|LICENSE|CONTRIBUTING|SECURITY|CHANGELOG|CODE_OF_CONDUCT|AGENTS|CLAUDE)(?:\.[\w.]+)?$|^package(?:-lock)?\.json$|^tsconfig[\w.]*\.json$|^\.[\w.-]+$/i;

function normalize(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function matches(path, owner) {
  return owner.endsWith("/") ? path.startsWith(owner) : path === owner;
}

/**
 * Decides the review set for a set of changed paths.
 * @returns {{material: boolean, reason: string, routes: object[], changedPaths: string[]}}
 */
export function reviewSelection(rawPaths) {
  const paths = [...new Set(rawPaths.map(normalize).filter(Boolean))];
  const uiPaths = paths.filter((path) =>
    !NON_UI_PREFIXES.some((prefix) => path.startsWith(prefix)) && !NON_UI_FILES.test(path));
  if (uiPaths.length === 0) {
    return { material: false, reason: "no-public-ui-paths", routes: [], changedPaths: paths };
  }

  const selected = new Set();
  let shared = false;
  const unmapped = [];
  for (const path of uiPaths) {
    let owned = false;
    for (const route of UI_REVIEW_ROUTES) {
      for (const owner of route.owners) {
        const owners = SURFACE_OWNERS[owner] || [owner];
        if (owners.some((candidate) => matches(path, candidate))) {
          selected.add(route.id);
          owned = true;
        }
      }
    }
    // A file a route explicitly owns is that route's change, even though it
    // sits under a shared directory. Without this, every publication component
    // also matched "src/ui/components/" and dragged Home into the review.
    if (!owned && SHARED_UI_PREFIXES.some((prefix) => matches(path, prefix))) {
      shared = true;
      owned = true;
    }
    if (!owned) unmapped.push(path);
  }

  // Fail closed. A public source file nobody mapped is reviewed as a shared
  // change rather than silently reviewed as nothing.
  if (unmapped.length) shared = true;
  if (shared) for (const id of SHARED_SAMPLE) selected.add(id);

  const routes = UI_REVIEW_ROUTES.filter((route) => selected.has(route.id));
  return {
    material: routes.length > 0,
    reason: routes.length === 0
      ? "no-route-owner"
      : shared
        ? `shared-ui${unmapped.length ? `-plus-unmapped:${unmapped.join(",")}` : ""}`
        : "route-scoped",
    routes,
    changedPaths: paths,
  };
}

/** The same decision, expressed against a change map for the CI job. */
export function reviewSelectionForChangeMap(changeMap) {
  if (changeMap.evidenceOnly) {
    return { material: false, reason: "evidence-only", routes: [], changedPaths: changeMap.changedPaths || [] };
  }
  if (!changeMap.changedPaths?.length) {
    // No usable diff. Review the representative sample rather than nothing.
    return {
      material: true,
      reason: `no-diff:${changeMap.reason}`,
      routes: UI_REVIEW_ROUTES.filter((route) => SHARED_SAMPLE.includes(route.id)),
      changedPaths: [],
    };
  }
  return reviewSelection(changeMap.changedPaths);
}

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function runCli() {
  // The approval gate runs from the base branch and never checks out PR code,
  // so it hands us the changed-file list instead of a ref pair.
  const pathsFile = argumentValue("--paths-file");
  if (pathsFile) {
    const paths = readFileSync(pathsFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    const selection = paths.length ? reviewSelection(paths) : reviewSelectionForChangeMap({ changedPaths: [], reason: "empty-file-list" });
    emit(selection);
    return;
  }

  const head = argumentValue("--head", "HEAD");
  let base = argumentValue("--base");
  if (!base || /^0+$/.test(base)) {
    try {
      base = execFileSync("git", ["merge-base", head, "origin/main"], { encoding: "utf8" }).trim();
    } catch {
      base = "";
    }
  }
  let paths = [];
  if (base) {
    try {
      paths = execFileSync("git", ["diff", "--name-only", `${base}..${head}`], { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      paths = [];
    }
  }
  const changeMap = paths.length ? classifyChangedPaths(paths) : { changedPaths: [], reason: "base-unavailable" };
  emit(reviewSelectionForChangeMap(changeMap));
}

function emit(selection) {
  const jsonPath = argumentValue("--json");
  if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(selection, null, 2)}\n`);
  process.stdout.write(`ui_review_required=${selection.material}\n`);
  process.stdout.write(`ui_review_reason=${selection.reason}\n`);
  process.stdout.write(`ui_review_routes=${selection.routes.map((route) => route.id).join(",")}\n`);
  for (const route of selection.routes) process.stderr.write(`  ${route.id}  ${route.path}  ${route.title}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runCli();
