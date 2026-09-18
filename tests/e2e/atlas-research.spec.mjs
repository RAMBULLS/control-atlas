import { gzipSync } from "node:zlib";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

// The NIST destination comes from the accepted CCI reference, not a guessed endpoint.
const edges = readGeneratedCollection(process.cwd(), "edges").edges;
const start = "disa-stig:V-205646";
const cci = "disa-cci:CCI-000185";
const upstream = edges.find(edge => edge.source_node_id === cci && edge.target_node_id.startsWith("nist-800-53:") && edge.relationship_type === "maps_to");
if (!upstream) throw new Error("Expected the accepted CCI reference for the regression journey.");
const end = upstream.target_node_id;
const endLabel = end.slice(end.indexOf(":") + 1);
function route(patch = {}) {
  const params = new URLSearchParams({ atlasResearch: "path", atlasPins: JSON.stringify([start,end]), atlasFrom:start,atlasTo:end,atlasHops:"2",...patch });
  return `/#/atlas?${params}`;
}
async function open(page, path = route(), width = 1440) {
  attachPageDiagnostics(page);
  await page.setViewportSize({width,height:width<768?844:1050});
  await gotoApp(page,path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}
async function ready(page) {
  await expect(page.getByLabel("Add a record",{exact:true})).toBeVisible({timeout:65000});
}
async function found(page) {
  await expect(page.getByRole("heading",{name:`2 steps from V-205646 to ${endLabel}`,exact:true})).toBeVisible({timeout:65000});
}

test("research is opt-in and the ordinary Atlas does not fetch the research graph", async ({page}) => {
  const paths=[];
  page.on("request",request=>paths.push(request.url()));
  await open(page,"/#/atlas");
  await expect(page.getByTestId("atlas-area-map")).toBeVisible();
  expect(paths.filter(path=>/atlas-research|atlasResearch\.worker/.test(path))).toEqual([]);
  await page.getByRole("link",{name:"Find a connection",exact:true}).click();
  await ready(page);
  await expect(page).toHaveURL(/atlasResearch=path/);
  await page.getByRole("link",{name:"Back to map",exact:true}).click();
  await expect(page.getByTestId("atlas-area-map")).toBeVisible();
});

test("two searched records produce a real STIG-to-CCI-to-NIST path with exact per-hop evidence", async ({page}) => {
  await open(page,"/#/atlas?atlasResearch=path");await ready(page);
  await page.getByLabel("Add a record",{exact:true}).fill("V-205646");
  await page.getByRole("button",{name:/^Pin V-205646 ·/}).click();
  await page.getByLabel("Add a record",{exact:true}).fill(end);
  await page.getByRole("button",{name:new RegExp(`^Pin ${endLabel.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")} ·`)}).click();
  await found(page);
  const path = page.getByRole("list",{name:"Published connection path"});
  await expect(path.locator(".atlas-research__waypoint strong")).toHaveText(["V-205646","CCI-000185",endLabel]);
  await expect(page.locator(".atlas-research__evidence")).toHaveAttribute("data-research-edge",edges.find(edge=>edge.source_node_id===start && edge.target_node_id===cci).id);
  await path.getByRole("button",{name:/^Step 2:/}).click();
  const evidence=page.locator(".atlas-research__evidence");
  await expect(evidence).toHaveAttribute("data-research-edge",upstream.id);
  await expect(evidence).toContainText(upstream.source_locator);
  await expect(evidence).toContainText(upstream.rationale);
  await expect(evidence.getByRole("link",{name:"View source details",exact:true})).toHaveAttribute("href",/source=/);
  await path.getByRole("button",{name:"Pin CCI-000185",exact:true}).click();
  await expect(page.locator(".atlas-research__pins strong")).toHaveText(["V-205646",endLabel,"CCI-000185"]);
});

test("research deep links restore pins, endpoints and options through refresh and browser back", async ({page}) => {
  await open(page,route({atlasLanding:"publishers",atlasFramework:"disa-stig"}));await found(page);
  const original=page.url();
  await page.getByLabel("Search depth",{exact:true}).selectOption("3");
  await expect(page).toHaveURL(/atlasHops=3/);
  await page.goBack();await found(page);
  await expect(page).toHaveURL(original);
  await page.reload();await waitForAppReady(page);await dismissOnboarding(page);await found(page);
  await expect(page.locator(".atlas-research__pins strong")).toHaveText(["V-205646",endLabel]);
  await page.getByRole("link",{name:"Back to map",exact:true}).click();
  await expect(page).toHaveURL(/atlasLanding=publishers/);
  await expect(page).toHaveURL(/atlasFramework=disa-stig/);
  await expect(page.getByTestId("atlas-area-map")).toBeVisible();
});

test("reverse traversal is opt-in and never rewrites the direction of the source assertion", async ({page}) => {
  await open(page);await found(page);
  await page.getByRole("button",{name:"Swap start and end",exact:true}).click();
  await expect(page.getByRole("heading",{name:"No path found within this search",exact:true})).toBeVisible();
  await page.getByLabel("Follow links",{exact:true}).selectOption("either");
  await expect(page.getByRole("heading",{name:`2 steps from ${endLabel} to V-205646`,exact:true})).toBeVisible();
  await expect(page.getByText("Following this link in reverse",{exact:true})).toHaveCount(2);
  const assertion=page.locator(".atlas-research__assertion strong");
  await expect(assertion).toHaveText(["CCI-000185",endLabel]);
});

test("shared connections retain separate source evidence for every pin", async ({page}) => {
  await open(page,route({atlasResearch:"shared"}));await ready(page);
  const shared=page.locator(".atlas-research__shared > li").filter({has:page.getByRole("link",{name:/CCI-000185/})});
  await expect(shared).toHaveCount(1);
  await shared.getByRole("button",{name:new RegExp(`Connection with ${endLabel.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`)}).click();
  await expect(page.locator(".atlas-research__evidence")).toHaveAttribute("data-research-edge",upstream.id);
  await expect(page.locator(".atlas-research__evidence")).toContainText("not a new direct mapping");
});

test("missing records are recoverable and never reported as an unconnected pair", async ({page}) => {
  await open(page,route({atlasTo:"does-not-exist",atlasPins:JSON.stringify([start,"does-not-exist"])}));await ready(page);
  await expect(page.getByRole("heading",{name:"Check the selected records",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"No path found within this search",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Remove Record unavailable",exact:true}).click();
  await expect(page.getByLabel("To",{exact:true})).toHaveValue("");
  await expect(page.locator(".atlas-research__pins strong")).toHaveText(["V-205646"]);
});

test("invalid data manifests never become a false no-path result and retry restores the search", async ({page}) => {
  let broken=true;
  await page.context().route("**/atlas-research-manifest.json", async route => {
    if (broken) await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({schemaVersion:999})});
    else await route.continue();
  });
  await open(page);
  await expect(page.getByRole("heading",{name:"Connection data did not load",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"No path found within this search",exact:true})).toHaveCount(0);
  broken=false;
  await page.getByRole("button",{name:"Retry connection data",exact:true}).click();await found(page);
});

test("unavailable workers produce an honest recovery state", async ({page}) => {
  await page.addInitScript(()=>{Object.defineProperty(globalThis,"Worker",{configurable:true,value:class {constructor(){throw new Error("worker unavailable fixture");}}});});
  await open(page);
  await expect(page.getByRole("heading",{name:"Connection data did not load",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"Back to map",exact:true})).toBeVisible();
});

test("sharing copies the research URL only after clipboard success", async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{globalThis.__researchCopy=value;}}}));
  await open(page);await found(page);
  await page.getByRole("button",{name:"Share this view",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__researchCopy)).toBe(page.url());
  await expect(page.getByRole("status").filter({hasText:"View link copied."})).toBeAttached();
});

test("record paths and evidence remain usable at every governed width", async ({page}) => {
  test.setTimeout(180000);
  await open(page);await found(page);
  for(const width of [320,375,390,768,1024,1440]) {
    await page.setViewportSize({width,height:width<768?844:1050});
    expect(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth-globalThis.document.documentElement.clientWidth),`${width}px overflow`).toBeLessThanOrEqual(1);
    for(const control of await page.locator(".atlas-research button:visible,.atlas-research select:visible,.atlas-research input:visible").all()) {
      const box=await control.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button",{name:/^Step 2:/}).click();
    await expect(page.locator(".atlas-research__evidence")).toHaveAttribute("data-research-edge",upstream.id);
    await page.getByRole("button",{name:/^Step 1:/}).focus();await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:/^Step 1:/})).toHaveAttribute("aria-pressed","true");
  }
});


test("tampered connection bytes fail integrity validation without a false result", async ({page}) => {
  await page.context().route("**/atlas-research/*.json.gz", route => route.fulfill({
    status:200, contentType:"application/gzip", body:gzipSync(Buffer.from('{"schemaVersion":1}')),
  }));
  await open(page);
  await expect(page.getByRole("heading",{name:"Connection data did not load",exact:true})).toBeVisible();
  await expect(page.getByRole("list",{name:"Published connection path"})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"No path found within this search",exact:true})).toHaveCount(0);
});

test("path controls and evidence have no serious or critical accessibility violations", async ({page}) => {
  await open(page);await found(page);
  const results=await new AxeBuilder({page}).include(".atlas-research").withTags(["wcag2a","wcag2aa"]).analyze();
  expect(results.violations.filter(violation=>["serious","critical"].includes(violation.impact||""))).toEqual([]);
  await page.setViewportSize({width:375,height:844});
  await page.getByRole("button",{name:/^Step 2:/}).click();
  await expect(page.locator("#research-evidence")).toBeFocused();
  await expect(page.locator("#research-evidence")).toBeInViewport();
});
