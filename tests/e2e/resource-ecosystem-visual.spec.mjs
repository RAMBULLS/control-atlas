import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const output = resolve("docs/evidence/resource-ecosystem/screenshots");
const shouldWriteEvidence = process.env.UPDATE_RESOURCE_EVIDENCE === "1";
mkdirSync(output, { recursive: true });
const collections = [
  "dod-cybersecurity-portals",
  "reciprocity-authorization-reuse",
  "implementation-assessment-tools",
  "product-assurance-approved-products",
  "cloud-devsecops-software-factories",
  "cmmc-defense-industrial-base",
  "cyber-workforce-training",
  "practitioner-communities",
  "vulnerability-management-prioritization",
  "detection-soc",
  "threat-intelligence-investigation",
  "dfir-threat-hunting",
  "stig-configuration-automation",
  "network-security-analysis",
  "devsecops-supply-chain",
  "identity-access-security",
  "disa-services-capabilities",
];

async function open(page, hash) {
  await page.goto(`/${hash}`);
  await expect(page.locator("#workspace")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function shot(page, name) {
  if (!shouldWriteEvidence) return;
  await page.addStyleTag({ content: ".brand-key-word { visibility: hidden !important; }" });
  await page.screenshot({ path: resolve(output, `${name}.jpg`), type: "jpeg", quality: 82, fullPage: true });
}

test("resource ecosystem visual evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, "#/resources");
  await expect(page.getByRole("heading", { name: "Browse by Collection" })).toBeVisible();
  await expect(page.locator(".workspace-browse-card--collection")).toHaveCount(17);
  await expect(page.locator(".workspace-result-list")).toHaveCount(0);
  await shot(page, "01-landing-collections");

  for (let index = 0; index < collections.length; index += 1) {
    const id = collections[index];
    await open(page, `#/resources?collection=${id}&showAll=true`);
    await expect(page.locator(".workspace-result-list")).toBeVisible();
    await shot(page, `${String(index + 2).padStart(2, "0")}-collection-${id}`);
  }

  await open(page, "#/resources?q=Repo%20One");
  await expect(page.getByText("DoD Platform One Iron Bank Container Registry", { exact: true }).first()).toBeVisible();
  await shot(page, "10-search-alias-repo-one");

  await open(page, "#/resources?resourceType=template&showAll=true");
  await expect(page.locator(".workspace-result-list")).toBeVisible();
  await expect(page.locator('[data-result-class="resource"] .workspace-kind-tag').first()).toHaveText("Template");
  await shot(page, "11-filtered-templates");

  await open(page, "#/resources?showAll=true");
  await expect(page.locator(".workspace-result-list")).toBeVisible();
  await shot(page, "11b-browse-all");

  const detailCases = [
    ["official-nist-oscal", "12-detail-public"],
    ["portal-dod-policy-guidance", "13-detail-cac"],
    ["portal-disa-servicenow", "14-detail-dod-network"],
    ["service-dcsa-nisp-emass", "15-detail-restricted-government"],
    ["commercial-cis-benchmarks-free", "16-detail-free-commercial-publisher-artifact"],
    ["template-i-assure-ssp-worksheet", "16b-detail-i-assure-free-templates-only"],
    ["portal-cis-workbench", "17-detail-community"],
    ["ecosystem-common-criteria", "18-detail-parent"],
    ["directory-common-criteria-products", "19-detail-child"],
    ["commercial-aws-govcloud-docs", "20-detail-generic-brand-fallback"],
  ];
  for (const [id, name] of detailCases) {
    await open(page, `#/resources/${id}?from=commons`);
    await expect(page.locator(".resource-detail-hero")).toBeVisible();
    await shot(page, name);
  }

  await open(page, "#/resources?q=zzzzqqqq");
  await expect(page.getByRole("heading", { name: "No resources match." })).toBeVisible();
  await shot(page, "21-empty-search");

});

test("resource directory data error is honest", async ({ page }) => {
  await page.route("**/data/generated/commons-search-index.json*", (route) => route.abort());
  await page.route("**/data/commons-resource-dataset.json*", (route) => route.abort());
  await page.route("**/data/commons-resource-dataset.json.gz*", (route) => route.abort());
  await open(page, "#/resources");
  await expect(page.getByRole("heading", { name: "Resources did not load." })).toBeVisible();
  await shot(page, "22-dataset-error");
});

test("identity marks never depend on remote images", async ({ page }) => {
  await open(page, "#/resources?showAll=true");
  await expect(page.locator(".resource-type-icon img")).toHaveCount(0);
  await expect(page.locator(".resource-type-icon").first()).toBeVisible();
});

test("resource ecosystem remains usable at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });

  await open(page, "#/resources");
  await expect(page.getByRole("heading", { name: "Browse by Collection" })).toBeVisible();
  await expect(page.locator(".workspace-browse-card--collection")).toHaveCount(17);
  await shot(page, "23-mobile-landing-320");

  await open(page, "#/resources/portal-cis-workbench?from=commons");
  await expect(page.locator(".resource-detail-hero")).toBeVisible();
  await expect(page.getByText("Do not post CUI", { exact: false }).first()).toBeVisible();
  await shot(page, "24-mobile-community-detail-320");
});

test("resource directory supports keyboard use and a 200 percent zoom equivalent", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await open(page, "#/resources");

  const search = page.getByRole("searchbox", { name: "Find resources" });
  await search.focus();
  await expect(search).toBeFocused();
  await search.pressSequentially("I-Assure", { delay: 50 });
  await search.press("Enter");
  await expect(page.getByText("I-Assure RMF artifact templates", { exact: true }).first()).toBeVisible();

  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});
