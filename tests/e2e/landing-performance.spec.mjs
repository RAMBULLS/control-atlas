import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("landing presents Template B search, four destinations, and governed tag browsing", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByRole("heading", {
      name: "Make federal cybersecurity make sense.",
    }),
  ).toBeVisible();

  await expect(page.getByRole("searchbox", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.locator(".home-search").getByRole("button", { name: "Search" })).toBeVisible();
  // The brand keycap lives in the persistent header, which Home now shares.
  await expect(page.locator(".site-header .brand-kbd")).toBeVisible();
  // Acronyms such as NIST are valid signals. Rotation behavior is covered
  // below; this assertion only requires a non-empty initial signal.
  await expect(page.locator("[data-brand-word]")).toHaveText(/\S+/);
  await expect(page.locator(".home-secondary-action")).toHaveCount(4);
  // Five practitioner questions, ordered the way the work runs. The sixth
  // card was a record-volume statistic, not a place to start.
  await expect(page.locator(".home-library-kpis .home-library-kpi")).toHaveCount(5);
  await expect(page.locator(".home-ecosystem, .home-capability-preview")).toHaveCount(0);

  const urlBeforeSkip = page.url();
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toBeFocused();
  expect(page.url()).toBe(urlBeforeSkip);
});

test("the local release server mirrors production compression for built styles", async ({
  request,
}) => {
  const home = await request.get("/", {
    headers: { "Accept-Encoding": "gzip" },
  });
  const stylesheet = (await home.text()).match(/href="\.\/(assets\/[^"]+\.css)"/)?.[1];
  expect(stylesheet).toBeTruthy();

  const response = await request.get(`/${stylesheet}`, {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(response.headers()["content-encoding"]).toBe("gzip");
});

test("Ctrl + Alt brand signature rotates and native Home history remains coherent", async ({
  page,
}) => {
  await page.goto("/");
  await waitForAppReady(page);

  const firstWord = await page.locator("[data-brand-word]").textContent();
  await expect
    .poll(() => page.locator("[data-brand-word]").textContent(), {
      timeout: 15000,
    })
    .not.toBe(firstWord);

  await page.getByRole("link", { name: /Search the Library/ }).click();
  await waitForAppReady(page);
  await expect(page).toHaveURL(/#\/library/);

  await page.goBack();
  await waitForAppReady(page);
  await expect(
    page.getByRole("heading", {
      name: "Make federal cybersecurity make sense.",
    }),
  ).toBeVisible();

  await page.goForward();
  await waitForAppReady(page);
  await expect(page).toHaveURL(/#\/library/);
});

test("landing search and brand-home flow work without legacy onboarding surfaces", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/?view=explore");
  await dismissOnboarding(page);

  await expect(
    page.getByRole("heading", { name: "Library", level: 1 }).first(),
  ).toBeVisible({
    timeout: 90000,
  });

  await page
    .locator('[data-react-root] header.site-header a.brand')
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Make federal cybersecurity make sense.",
    }),
  ).toBeVisible({
    timeout: 15000,
  });
  // "Novice" is retired product vocabulary; it must not return anywhere.
  await expect(page.getByText(/novice/i)).toHaveCount(0);
  await expect(page.getByText("Expert Mode")).toHaveCount(0);
});
