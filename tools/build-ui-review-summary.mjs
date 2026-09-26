#!/usr/bin/env node
// Builds the concise review set: one page a person can actually read, holding
// the representative before/after pairs.
//
// The full capture is ~150 images and 138 MB. That is the right thing to keep
// for audit and the wrong thing to hand someone and call it a review. This
// pulls the pairs that matter, puts them side by side at a readable size, and
// writes a self-contained HTML contact sheet beside them.
//
//   node tools/build-ui-review-summary.mjs \
//     --base artifacts/ui-review/base \
//     --candidate artifacts/ui-review/candidate \
//     --out artifacts/ui-review-summary --head <sha>
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { UI_REVIEW_ROUTES } from "./ui-review-routes.mjs";

/**
 * The surfaces the owner asked to see first. Each renders a different
 * combination of recorded facts, so one of them looking right says little
 * about the others.
 */
const SUMMARY_ROUTES = [
  "publication-800-53",
  "publication-cmmc",
  "publication-sparse",
  "sources-publications",
  "sources-policy",
  "sources-inspector",
];
const VIEWPORTS = ["desktop-1440", "phone-390"];
/** First viewport for the impression, full page for the hierarchy. */
const EXTENTS = ["viewport", "fullpage"];

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function titleFor(routeId) {
  return UI_REVIEW_ROUTES.find((route) => route.id === routeId)?.title || routeId;
}

function pathFor(routeId) {
  return UI_REVIEW_ROUTES.find((route) => route.id === routeId)?.path || "";
}

function heightFor(metrics, routeId, viewport) {
  const row = (metrics?.results || []).find((result) => result.route === routeId && result.viewport === viewport);
  return row ? `${row.documentHeight}px` : "";
}

function readMetrics(dir) {
  const file = join(dir, "metrics.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function main() {
  const baseDir = argumentValue("--base", "artifacts/ui-review/base");
  const candidateDir = argumentValue("--candidate", "artifacts/ui-review/candidate");
  const outDir = argumentValue("--out", "artifacts/ui-review-summary");
  const headSha = argumentValue("--head", "");

  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(join(outDir, "images"), { recursive: true });

  const baseMetrics = readMetrics(baseDir);
  const candidateMetrics = readMetrics(candidateDir);

  const sections = [];
  let copied = 0;
  let missing = 0;

  for (const routeId of SUMMARY_ROUTES) {
    if (!UI_REVIEW_ROUTES.some((route) => route.id === routeId)) continue;
    const blocks = [];
    for (const viewport of VIEWPORTS) {
      for (const extent of EXTENTS) {
        const file = `${routeId}__${viewport}__${extent}.png`;
        const pair = { extent, viewport, base: "", candidate: "" };
        for (const [side, dir] of [["base", baseDir], ["candidate", candidateDir]]) {
          const source = join(dir, file);
          if (!existsSync(source)) {
            missing += 1;
            continue;
          }
          const name = `${side}__${file}`;
          copyFileSync(source, join(outDir, "images", name));
          pair[side] = `images/${name}`;
          copied += 1;
        }
        if (pair.base || pair.candidate) blocks.push(pair);
      }
    }
    if (blocks.length) {
      sections.push({
        id: routeId,
        title: titleFor(routeId),
        path: pathFor(routeId),
        blocks,
        baseHeights: VIEWPORTS.map((viewport) => [viewport, heightFor(baseMetrics, routeId, viewport)]),
        candidateHeights: VIEWPORTS.map((viewport) => [viewport, heightFor(candidateMetrics, routeId, viewport)]),
      });
    }
  }

  writeFileSync(join(outDir, "index.html"), renderContactSheet({ sections, headSha }));
  writeFileSync(
    join(outDir, "README.txt"),
    [
      "Control Atlas — concise UI review set",
      headSha ? `Head: ${headSha}` : "",
      "",
      "Open index.html. Left is the deployed main, right is this head.",
      "Every route is shown at 1440 desktop and 390 phone, first viewport and full page.",
      "",
      "This is the set to review. The full ui-review artifact holds every captured",
      "route when you want to look closer.",
      "",
    ].filter(Boolean).join("\n"),
  );

  console.log(`Wrote ${sections.length} routes (${copied} images, ${missing} missing) to ${outDir}`);
  if (sections.length === 0) {
    console.error("No summary routes were captured; nothing to review.");
    process.exit(1);
  }
}

function renderContactSheet({ sections, headSha }) {
  // "Publication — NIST SP 800-53 (flagship, dense)" navigates as "NIST SP
  // 800-53"; the part before the dash is the same on half the entries.
  const shortTitle = (title) => {
    const tail = title.includes("—") ? title.split("—").slice(1).join("—") : title;
    return tail.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
  };
  const nav = sections.map((section) =>
    `<a href="#${escapeHtml(section.id)}">${escapeHtml(shortTitle(section.title))}</a>`).join("");

  const body = sections.map((section) => {
    const rows = section.blocks.map((block) => {
      const label = `${block.viewport.replace("desktop-1440", "1440 desktop").replace("phone-390", "390 phone")} · ${block.extent === "viewport" ? "first viewport" : "full page"}`;
      const cell = (side, src) => src
        ? `<figure><figcaption>${side}</figcaption><a href="${escapeHtml(src)}" target="_blank" rel="noreferrer"><img alt="${escapeHtml(`${section.title} ${label} ${side}`)}" loading="lazy" src="${escapeHtml(src)}"></a></figure>`
        : `<figure class="absent"><figcaption>${side}</figcaption><p>Not captured</p></figure>`;
      return `<section class="pair"><h3>${escapeHtml(label)}</h3><div class="grid">${cell("base (main)", block.base)}${cell("candidate", block.candidate)}</div></section>`;
    }).join("");

    const heights = section.baseHeights.map(([viewport, base], index) => {
      const candidate = section.candidateHeights[index][1];
      if (!base || !candidate) return "";
      return `${viewport.replace("desktop-1440", "1440")}: ${base} → ${candidate}`;
    }).filter(Boolean).join(" · ");

    return `<article id="${escapeHtml(section.id)}">
      <header><h2>${escapeHtml(section.title)}</h2>
      <p class="route"><code>${escapeHtml(section.path)}</code>${heights ? ` <span class="heights">page height ${escapeHtml(heights)}</span>` : ""}</p></header>
      ${rows}
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Control Atlas UI review</title>
<style>
  :root { color-scheme: dark; --bg:#0f1519; --panel:#151d22; --line:#26323a; --text:#e8e6e1; --muted:#9fb0ba; --accent:#54bcd9; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header.top { position:sticky; top:0; z-index:2; background:var(--bg); border-bottom:1px solid var(--line); padding:16px 24px; }
  h1 { margin:0 0 4px; font-size:20px; letter-spacing:.02em; }
  .meta { color:var(--muted); font-size:13px; margin:0; }
  nav { display:flex; flex-wrap:wrap; gap:12px; margin-top:10px; }
  nav a { color:var(--accent); font-size:13px; text-decoration:none; }
  nav a:hover { text-decoration:underline; }
  main { padding:24px; max-width:1800px; margin:0 auto; }
  article { margin-bottom:56px; }
  article > header { border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:18px; }
  h2 { margin:0 0 4px; font-size:19px; }
  .route { margin:0; color:var(--muted); font-size:13px; }
  .heights { margin-left:10px; }
  .pair { margin-bottom:26px; }
  h3 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:600; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(420px,100%), 1fr)); gap:16px; align-items:start; }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:4px; overflow:hidden; }
  figcaption { padding:7px 10px; font-size:12px; color:var(--muted); border-bottom:1px solid var(--line); }
  img { display:block; width:100%; height:auto; }
  .absent p { padding:24px; color:var(--muted); margin:0; font-size:13px; }
  footer { padding:20px 24px 48px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); }
</style>
</head>
<body>
<header class="top">
  <h1>Control Atlas — UI review</h1>
  <p class="meta">Left: deployed main. Right: ${headSha ? `candidate <code>${escapeHtml(headSha)}</code>` : "candidate"}. Click any image for full size.</p>
  <nav>${nav}</nav>
</header>
<main>${body}</main>
<footer>
  These are renders for a person to look at. Layout, accessibility and performance contracts
  passing in CI is not visual or copy approval. The full <code>ui-review</code> artifact holds
  every captured route when you want to look closer.
</footer>
</body>
</html>
`;
}

main();
