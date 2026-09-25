#!/usr/bin/env node
// Captures real-token review renders for the public routes a change touches.
//
// This is review evidence, not an assertion. It never passes or fails; a person
// looks at the images. Pair it with tools/ui-review-routes.mjs, which decides
// which routes a change affects, and the ui-review CI job, which uploads the
// folder this writes.
//
//   node tools/capture-ui-review.mjs --out artifacts/ui-review/candidate \
//     --base-url http://localhost:4317 --label candidate [--routes a,b,c]
//
// Each route is captured four ways, because a first viewport and a whole page
// fail differently: 1440 desktop first viewport, 1440 full page, 390 phone
// first viewport, 390 full page. First-viewport shots use deviceScaleFactor 2
// so copy is legible when someone reads them; full-page shots use 1 to keep the
// files openable.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import { UI_REVIEW_ROUTES } from "./ui-review-routes.mjs";

/* global document, window */

const VIEWPORTS = [
  { id: "desktop-1440", width: 1440, height: 1000, scale: 2 },
  { id: "phone-390", width: 390, height: 844, scale: 2 },
];

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

/** Waits for the app shell and the route's own content, not just load. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("main").first().waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
  // Route styles load with the route, so let the stylesheet and any font swap
  // land before the shutter: an unstyled shot is worse than no shot.
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(600);
}

async function capture(browser, { baseUrl, outDir, route, viewport }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/${route.path.replace(/^\//, "")}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page);
    const prefix = `${route.id}__${viewport.id}`;
    await page.screenshot({ path: join(outDir, `${prefix}__viewport.png`) });
    // Full page at scale 1: composition and scroll length, not legibility.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({ path: join(outDir, `${prefix}__fullpage.png`), fullPage: true });
    const metrics = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      headingOrder: [...document.querySelectorAll("main h1, main h2, main h3, main h4")]
        .map((node) => `${node.tagName}:${(node.textContent || "").trim().slice(0, 60)}`),
      title: document.title,
    }));
    return { route: route.id, viewport: viewport.id, url, errors, ...metrics };
  } finally {
    await context.close();
  }
}

async function main() {
  const baseUrl = argumentValue("--base-url", "http://localhost:4317");
  const outDir = argumentValue("--out", "artifacts/ui-review/candidate");
  const label = argumentValue("--label", "candidate");
  const only = argumentValue("--routes");
  const requested = only ? new Set(only.split(",").map((value) => value.trim()).filter(Boolean)) : null;
  const routes = UI_REVIEW_ROUTES.filter((route) => !requested || requested.has(route.id));
  if (routes.length === 0) {
    console.error(`No review routes matched ${only}`);
    process.exit(2);
  }

  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const results = [];
  try {
    // One context at a time. These runners are memory-bound and a parallel
    // sweep here has cost whole runs.
    for (const route of routes) {
      for (const viewport of VIEWPORTS) {
        const result = await capture(browser, { baseUrl, outDir, route, viewport });
        results.push(result);
        const flag = result.horizontalOverflow ? " OVERFLOW" : "";
        console.log(`${label} ${route.id} ${viewport.id} ${result.documentHeight}px${flag}`);
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    join(outDir, "metrics.json"),
    `${JSON.stringify({ label, baseUrl, capturedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  const withErrors = results.filter((result) => result.errors.length);
  if (withErrors.length) {
    console.error(`Page errors on ${withErrors.map((result) => result.route).join(", ")}`);
  }
  console.log(`Wrote ${results.length * 2} images to ${outDir}`);
}

await main();
