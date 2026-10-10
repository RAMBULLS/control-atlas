import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const host = process.env.ANALYTICS_HOST;
assert(
  ["rambulls.dev", "orbital.rambulls.dev", "atlas.rambulls.dev"].includes(host),
);
const origin = "https://" + host,
  root = path.resolve(process.env.PUBLIC_ROOT),
  out = process.env.RUNNER_TEMP + "/analytics-candidate";
await mkdir(out, { recursive: true });
const proof = {
  source: process.env.GITHUB_SHA,
  host,
  scope:
    "Actual candidate bytes served at a modeled canonical HTTPS origin; actual official SDK and collector. Production DNS/TLS/deployment and dashboard acceptance remain separate.",
  contexts: [],
};
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain",
};
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const row = {
      width,
      files: {},
      collector: [],
      sdk: [],
      failures: [],
      pageErrors: [],
      csp: [],
      stages: [],
      unrecognized: [],
    };
    proof.contexts.push(row);
    page.on("pageerror", (e) => row.pageErrors.push(e.message));
    page.on("requestfailed", (r) =>
      row.failures.push({
        url: r.url(),
        failure: r.failure(),
        method: r.method(),
      }),
    );
    page.on("response", async (r) => {
      if (
        r.url().startsWith("https://cloudflareinsights.com/cdn-cgi/rum") &&
        r.request().method() === "POST"
      )
        row.collector.push({
          url: r.url(),
          status: r.status(),
          headers: r.headers(),
          payload: r.request().postData(),
          requestHeaders: r.request().headers(),
        });
      if (
        r
          .url()
          .startsWith("https://static.cloudflareinsights.com/beacon.min.js")
      )
        row.sdk.push({ status: r.status() });
    });
    await page.addInitScript(() => {
      window.__analyticsCsp = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__analyticsCsp.push({
          blocked: e.blockedURI,
          directive: e.effectiveDirective,
          disposition: e.disposition,
        }),
      );
    });
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (
        u.origin === "https://static.cloudflareinsights.com" &&
        u.pathname === "/beacon.min.js"
      )
        return route.continue();
      if (
        u.origin === "https://cloudflareinsights.com" &&
        u.pathname === "/cdn-cgi/rum"
      )
        return route.continue();
      if (u.origin !== origin) {
        row.unrecognized.push(u.origin);
        return route.abort();
      }
      let relative = decodeURIComponent(u.pathname).replace(/^\//, "");
      if (!relative || relative.endsWith("/")) relative += "index.html";
      const file = path.resolve(root, relative);
      assert(file.startsWith(root + path.sep));
      const headers = {
        "content-type": mime[path.extname(file)] || "application/octet-stream",
      };
      if (host === "rambulls.dev") {
        const lines = (await readFile(path.join(root, "_headers"), "utf8"))
          .split("\n")
          .slice(1)
          .filter((x) => x.trim());
        for (const line of lines) {
          const i = line.indexOf(":");
          headers[line.slice(0, i).trim().toLowerCase()] = line
            .slice(i + 1)
            .trim();
        }
      }
      try {
        assert((await stat(file)).isFile());
        const data = await readFile(file);
        row.files[relative] = {
          bytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
        };
        return route.fulfill({ status: 200, headers, body: data });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        return route.fulfill({
          status: 404,
          contentType: "text/html",
          body: await readFile(path.join(root, "404.html")),
        });
      }
    });
    try {
      const marker = "SYNTHETIC_T16_" + process.env.GITHUB_RUN_ID;
      const url =
        origin + "/?query=" + marker + "&x=1&x=2&empty=#bookmark=" + marker;
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 45000,
        referer: origin + "/?referrer=" + marker,
      });
      await page.locator("#rb-analytics-banner").waitFor();
      assert(
        (await page.locator(".rb-analytics-text").innerText()).startsWith(
          "With your permission, Cloudflare measures page visits and loading speed. Declining won\u2019t affect this site.",
        ),
      );
      assert.equal(row.sdk.length, 0);
      assert.equal(row.collector.length, 0);
      assert(await page.locator("#rb-analytics-toggle").isVisible());
      await page.locator("#rb-analytics-toggle").click();
      assert(await page.locator("#rb-panel-decline").isVisible());
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "rb-analytics-toggle",
      );
      const layout = await page
        .locator("#rb-analytics-banner")
        .evaluate((el) => {
          const a = el
              .querySelector(".rb-analytics-btn-primary")
              .getBoundingClientRect(),
            d = el
              .querySelector(".rb-analytics-btn-secondary")
              .getBoundingClientRect(),
            b = el.getBoundingClientRect();
          return {
            overflow: Math.max(
              0,
              document.documentElement.scrollWidth - innerWidth,
            ),
            allowWidth: a.width,
            declineWidth: d.width,
            visible:
              b.top >= 0 &&
              b.bottom <= innerHeight &&
              b.left >= 0 &&
              b.right <= innerWidth,
          };
        });
      assert.equal(layout.overflow, 0);
      assert(layout.visible);
      assert(Math.abs(layout.allowWidth - layout.declineWidth) < 2);
      row.stages.push({ stage: "default-off", layout });
      await page.screenshot({
        path: path.join(out, host + "-" + width + ".jpg"),
        type: "jpeg",
        quality: 45,
      });
      await page
        .locator("#rb-analytics-banner .rb-analytics-btn-primary")
        .click();
      const deadline = Date.now() + 12000;
      while (row.collector.length === 0 && Date.now() < deadline)
        await page.waitForTimeout(100);
      assert(row.collector.some((r) => r.status === 204));
      assert.equal(row.sdk.length, 1);
      await page.locator("#rb-analytics-toggle").click();
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "rb-analytics-toggle",
      );
      await page.locator("#rb-analytics-toggle").click();
      await page.locator("#rb-panel-allow").click();
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        location.hash = "#/library?search=SYNTHETIC_SEARCH";
      });
      await page.waitForTimeout(800);
      assert.equal(row.sdk.length, 1);
      assert.equal(
        row.collector.filter((r) => JSON.parse(r.payload).eventType === 1)
          .length,
        1,
      );
      assert(!JSON.stringify(row.collector).includes(marker));
      assert(!JSON.stringify(row.collector).includes("SYNTHETIC_SEARCH"));
      if (host === "atlas.rambulls.dev") {
        assert.equal(
          await page.locator('meta[name="referrer"]').getAttribute("content"),
          "no-referrer",
        );
        assert(row.collector.every((r) => !r.requestHeaders.referer));
      }
      const preference = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rambulls.analytics.choice")),
      );
      assert.deepEqual(Object.keys(preference).sort(), [
        "choice",
        "expiresAt",
        "version",
      ]);
      assert.equal(preference.choice, "allow");
      row.stages.push({
        stage: "allowed",
        collectorResponses: row.collector.length,
        preferenceSchema: Object.keys(preference),
      });
      await page.locator("#rb-analytics-toggle").click();
      await page.locator("#rb-panel-decline").click();
      const cut = row.collector.length;
      assert(
        await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              'meta[http-equiv="Content-Security-Policy"]',
            ),
          ].some((m) => m.content === "connect-src 'self'"),
        ),
      );
      const blocked = await page.evaluate(async () => {
        try {
          await fetch("https://cloudflareinsights.com/cdn-cgi/rum", {
            method: "POST",
            body: "{}",
          });
          return false;
        } catch {
          return true;
        }
      });
      assert(blocked);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          get: () => "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(500);
      assert.equal(row.collector.length, cut);
      assert.equal(
        await page
          .evaluate(
            async (p) => (await fetch(p)).status,
            host === "orbital.rambulls.dev"
              ? "/assets/analytics-consent.js"
              : "/analytics-consent.js",
          )
          .catch(() => 0),
        200,
      );
      row.csp = await page.evaluate(() => window.__analyticsCsp);
      assert(
        row.csp.some(
          (x) =>
            x.disposition === "enforce" &&
            x.blocked.includes("cloudflareinsights.com"),
        ),
      );
      row.stages.push({
        stage: "withdrawn",
        collectorResponsesAfterCut: row.collector.length - cut,
        inFlightRequestsNotRecalled: true,
      });
      const beforeReload = row.sdk.length;
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(row.sdk.length, beforeReload);
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("rambulls.analytics.choice"))
              .choice,
        ),
        "deny",
      );
      await page.locator("#rb-analytics-toggle").click();
      assert(await page.locator("#rb-panel-allow").isVisible());
      await page.keyboard.press("Escape");
      if (host === "rambulls.dev") {
        await page.locator('a[href="privacy/"]').click();
        await page.locator("h1").waitFor();
        assert.equal(
          await page.locator("h1").innerText(),
          "Analytics is your choice.",
        );
        await page.locator('a[href="/shady-bits/privacy/"]').click();
        await page.locator("h1").waitFor();
        assert(
          (await page.locator("h1").innerText()).includes(
            "Your checks stay on your phone",
          ),
        );
      } else if (host === "orbital.rambulls.dev") {
        await page.goto(origin + "/examples/");
        await page.locator("h1").waitFor();
        assert.equal(
          await page.locator("#rb-analytics-banner:visible").count(),
          0,
        );
        const tokens = await page.request.get(
          origin + "/tokens/dist/tokens.css",
        );
        assert.equal(tokens.status(), 200);
        const body = await tokens.body();
        assert(body.length > 1000);
        row.download = {
          path: "/tokens/dist/tokens.css",
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          scope:
            "Actual same-origin downloadable token export; no new download UI",
        };
      } else {
        const bookmark =
          origin +
          "/#/compare/relationships?source=nist-800-53&target=nist-800-53a&items=nist-800-53:AC-2&intent=item-mapping&compareRun=true";
        await page.goto(bookmark);
        await page
          .locator(".compare-results-table tbody tr")
          .first()
          .waitFor({ timeout: 60000 });
        const entrance = page.getByRole("dialog", {
          name: "Control Atlas introduction",
        });
        if (await entrance.isVisible())
          await entrance
            .getByRole("button", { name: "Enter the Atlas" })
            .click();
        const skip = page.getByRole("button", { name: "Skip", exact: true });
        if (await skip.isVisible()) await skip.click();
        assert.equal(
          await page.locator("#rb-analytics-banner:visible").count(),
          0,
        );
        const downloaded = page.waitForEvent("download", { timeout: 15000 });
        await page.getByRole("button", { name: "CSV", exact: true }).click();
        const download = await downloaded,
          csv = await readFile(await download.path());
        assert.equal(csv.length, 692);
        assert.equal(
          createHash("sha256").update(csv).digest("hex"),
          "e7b0e3abfb572d06a8d056a56f76559dcc181bf08190735651b8d4cd18fcd2aa",
        );
        row.download = {
          bytes: csv.length,
          sha256: createHash("sha256").update(csv).digest("hex"),
        };
        await page.reload();
        await page
          .locator(".compare-results-table tbody tr")
          .first()
          .waitFor({ timeout: 60000 });
        assert.equal(page.url(), bookmark);
      }
      assert.equal(row.pageErrors.length, 0);
      assert.equal(row.unrecognized.length, 0);
      row.pass = true;
    } finally {
      await context.close();
    }
  }
  proof.pass =
    proof.contexts.length === 2 && proof.contexts.every((x) => x.pass);
} finally {
  await browser.close();
  await writeFile(path.join(out, "proof.json"), JSON.stringify(proof, null, 2));
}
console.log(
  JSON.stringify({
    pass: proof.pass,
    host,
    contexts: proof.contexts.map((r) => ({
      width: r.width,
      pass: r.pass,
      stages: r.stages,
      errors: r.pageErrors,
    })),
  }),
);
assert(proof.pass);
