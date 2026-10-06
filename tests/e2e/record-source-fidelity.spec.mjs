import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, dismissOnboarding, OFFICIAL_SOURCE_ACTION, waitForAppReady } from "./support.mjs";

async function openRecord(page, route) {
  attachPageDiagnostics(page);
  await page.goto(route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator("[data-record-source-error]")).toHaveCount(0);
}

const roleRecords = [
  ["atomic_record", "/#/record/csf-2/PR.AA-01"],
  ["container", "/#/record/csf-2/CATEGORY-PR.AA"],
  ["publication_document", "/#/record/dod-zt/DOC-OVERLAYS"],
  ["assessment_question", "/#/record/microsoft-zt-maturity/MSZT-1-1"],
  ["implementation_artifact", "/#/record/nist-zt/SP180035-E1B1"],
];

test("every public semantic role uses the governed universal record shell", async ({ page }) => {
  for (const [role, route] of roleRecords) {
    await openRecord(page, route);
    await expect(page.locator(`.record-template[data-page-role="${role}"]`)).toBeVisible();
    if (role === "container") {
      await expect(page.locator('[data-record-section="child-inventory"]')).toBeVisible();
    } else {
      await expect(page.locator('[data-record-section="official-text"]')).toBeVisible();
    }
    await expect(page.getByRole("link", { name: OFFICIAL_SOURCE_ACTION })).toHaveCount(1);
  }
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
]) {
  test(`CSF source fields and hierarchy remain ordered at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openRecord(page, "/#/record/csf-2/PR.AA-01");
    const official = page.locator('[data-record-section="official-text"]');
    await expect(official.locator(":scope > section > h2")).toHaveText(["Outcome", "Implementation Examples", "Informative References"]);
    const hierarchy = page.locator('[data-record-section="publisher-hierarchy"]');
    await expect(hierarchy).toContainText("PROTECT");
    await expect(hierarchy).toContainText("Identity Management, Authentication, and Access Control");
    const collapsed = page.locator("details.record-relationship-disclosure");
    expect(await collapsed.count()).toBeGreaterThan(0);
    for (const group of await collapsed.all()) {
      await expect(group).not.toHaveAttribute("open", "");
      expect(await group.locator("[data-record-connection-id]").count()).toBeLessThanOrEqual(5);
    }
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("CSF category is a bounded publisher-native container", async ({ page }) => {
  await openRecord(page, "/#/record/csf-2/CATEGORY-PR.AA");
  await expect(page).toHaveURL(/#\/record\/csf-2\/CATEGORY-PR\.AA$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("PR.AA — Identity Management, Authentication, and Access Control");
  await expect(page.locator('[data-record-section="publisher-hierarchy"]')).toContainText("PROTECT");
  const inventory = page.locator('[data-record-section="child-inventory"]');
  await expect(inventory).toContainText("PR.AA-01");
  expect(await inventory.locator("li").count()).toBeGreaterThan(1);
  for (const group of await page.locator('[data-relationship-treatment="SUMMARIZE"]').all()) {
    expect(await group.locator("[data-record-connection-id]").count()).toBeLessThanOrEqual(3);
  }
});

test("ATT&CK tactic uses publisher identity without changing its stable route", async ({ page }) => {
  await openRecord(page, "/#/record/mitre-attack/TACTIC-TA0001");
  await expect(page).toHaveURL(/#\/record\/mitre-attack\/TACTIC-TA0001$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("TA0001 — Initial Access");
  await expect(page.locator('[data-record-section="child-inventory"] li').first()).toBeVisible();
});

test("DISA rule and benchmark expose native identity, release, and inventory facts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRecord(page, "/#/record/disa-stig/V-256609");
  const facts = page.locator('[data-record-section="native-facts"]');
  for (const label of ["Finding / Vuln ID", "Rule ID", "STIG ID", "Severity"]) {
    await expect(facts.getByText(label, { exact: true })).toBeVisible();
  }
  // Primary benchmark identity/version remain visible. Secondary source facts
  // move behind the owner's requested disclosure rather than disappearing.
  const about = page.locator('[data-rail-section="about-this-record"]');
  for (const label of ["Benchmark", "Version"]) {
    const field = about.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });
    await expect(field.locator("dt")).toBeVisible();
    await expect(field.locator("dd")).not.toBeEmpty();
  }
  const sourceDetails = about.locator("[data-record-source-details]");
  await expect(sourceDetails).not.toHaveAttribute("open", "");
  await sourceDetails.locator("summary").click();
  for (const label of ["Benchmark date", "Publication"]) {
    const field = sourceDetails.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });
    await expect(field.locator("dt")).toBeVisible();
    await expect(field.locator("dd")).not.toBeEmpty();
  }
  await expect(sourceDetails.getByRole("link", { name: "Open source record" })).toBeVisible();
  await expect(facts.getByText("Benchmark", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-record-section="official-text"] > section > h2')).toHaveText(["Discussion", "Check", "Fix"]);
  await openRecord(page, "/#/record/disa-stig/BENCHMARK-VMW-VSPHERE-7-0-VCA-POSTGRESQL-STIG");
  await expect(page.locator('[data-page-role="container"]')).toBeVisible();
  await expect(page.locator('[data-record-section="native-facts"]')).toContainText("Version / release");
  await expect(page.locator('[data-record-section="native-facts"]')).toContainText("Severity distribution");
  await expect(page.locator('[data-record-section="child-inventory"] li').first()).toBeVisible();
});

test("high-risk records retain role, hierarchy, and governed relationship behavior", async ({ page }) => {
  const records = [
    ["/#/record/nist-800-53/AC-2", "atomic_record"],
    ["/#/record/mitre-attack/T1059", "atomic_record"],
    ["/#/record/mitre-attack/T1059.001", "atomic_record"],
    ["/#/record/nist-zt/SP180035-E1B1", "implementation_artifact"],
  ];
  for (const [route, role] of records) {
    await openRecord(page, route);
    await expect(page.locator(`[data-page-role="${role}"]`)).toBeVisible();
    await expect(page.locator('[data-record-section="publisher-hierarchy"]')).toBeVisible();
    expect(await page.locator('[data-relationship-treatment="PROMOTE"] [data-record-connection-id]').count()).toBeLessThanOrEqual(5);
    expect(await page.locator('[data-relationship-treatment="SUMMARIZE"] [data-record-connection-id]').count()).toBeLessThanOrEqual(3);
  }
});

test("collapsed relationship groups are keyboard-operable and bounded by default", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53/AC-2");
  const disclosure = page.locator("details.record-relationship-disclosure").first();
  await expect(disclosure).toBeVisible();
  const summary = disclosure.locator(":scope > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.locator("[data-record-connection-id]").first()).toBeVisible();

  await openRecord(page, "/#/record/csf-2/PR.AA-01");
  await expect(page.locator('[data-relationship-treatment="ATLAS_ONLY"]')).toHaveCount(0);
  expect(await page.locator("details.record-relationship-disclosure").count()).toBeGreaterThan(0);
  await expect(page.locator("details.record-relationship-disclosure").first()).not.toHaveAttribute("open", "");
});

test("short record headers do not absorb the height of the desktop rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [, route] of roleRecords) {
    await openRecord(page, route);
    const header = await page.locator(".record-title-block").boundingBox();
    const main = await page.locator(".record-template-main").boundingBox();
    expect(main.y - (header.y + header.height), `Excessive title-to-content gap on ${route}`).toBeLessThanOrEqual(40);
    expect(main.y).toBeGreaterThanOrEqual(header.y + header.height);
  }
});

test("a publication's raw catalog record redirects to its publication page", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/record/csf-2/CATALOG");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/library\/publication\/csf-2/);
  await expect(page.locator('[data-page-role="publication_document"]')).toHaveCount(0);
  // The publisher's first function is still a public container page.
  await openRecord(page, "/#/record/csf-2/FUNCTION-GV");
  await expect(page.locator('[data-page-role="container"]')).toBeVisible();
});

test("finding cleanup trims repetition without removing tags, source facts, or the utility rail", async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
    // A new document resets disclosure state even for repeated same-hash URLs.
    await page.goto("about:blank");
    await openRecord(page, "/#/record/disa-stig/V-205646");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("V-205646");
    await expect(page.locator(".record-official-name")).toHaveText("Windows Server 2019 domain controller PKI certificates must be issued by the DOD PKI or an approved External Certificate Authority (ECA).");
    const crumbs = (await page.locator("[data-canonical-breadcrumb]").innerText()).split(" › ");
    expect(crumbs).toHaveLength(4);
    expect(crumbs[0]).toBe("Implementation");
    expect(crumbs[1]).toBe("DISA");
    expect(crumbs[2]).toMatch(/Windows Server 2019.*STIG/);
    expect(crumbs[3]).toBe("V-205646");
    await expect(page.locator(".record-discovery-tag__label")).toHaveText([
      "DISA", "STIG", "Microsoft", "Microsoft Windows", "Server", "Operating system",
    ]);
    await expect(page.locator("[data-record-source-identity]")).toHaveCount(0);
    await expect(page.locator('[data-record-section="official-text"] > section > h2')).toHaveText(["Discussion", "Check", "Fix"]);
    await expect(page.locator('[data-record-section="related-records"]')).toContainText("CCI-000185");
    await expect(page.locator(".record-template-sidebar > details[data-rail-section]")).toHaveCount(4);

    const about = page.locator('[data-rail-section="about-this-record"]');
    if (width <= 768) {
      await expect(about).not.toHaveAttribute("open", "");
      await about.locator(":scope > summary").click();
    }
    await expect(about.locator(".record-source-facts dt")).toHaveText([
      "Record type", "Publisher", "Benchmark", "Version", "Status", "Source last checked",
    ]);
    await expect(about.locator(".record-source-facts")).toContainText("Microsoft Windows Server 2019 Security Technical Implementation Guide");
    const details = about.locator("[data-record-source-details]");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator("dl")).toBeHidden();
    await details.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("dt")).toHaveText(["Benchmark date", "Publication"]);
    // Issue #279: benchmark_status_date renders as a plain date, not raw ISO.
    await expect(details.locator("dd").first()).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await expect(details.locator("dd").last()).toContainText("DISA Public STIG Library");
    await expect(details.getByRole("link", { name: "Open source record" })).toHaveAttribute("href", /sources\?source=/);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole("link", { name: "Open source record" }).click();
  await waitForAppReady(page);
  await expect(page).toHaveURL(/sources\?source=/);
});

test("compact finding identity generalizes to SRGs without changing other record roles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecord(page, "/#/record/disa-srg/V-202013");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("V-202013");
  await expect(page.locator('[data-source-field="description"]')).not.toBeEmpty();
  await openRecord(page, "/#/record/nist-800-53/AC-2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NIST AC-2");
});
