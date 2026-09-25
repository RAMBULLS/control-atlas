import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const matrix = JSON.parse(
  readFileSync("config/experience-guardian/route-matrix.json", "utf8"),
);
const routeSource = readFileSync("src/ui/lib/routeIdentity.ts", "utf8");
const activeRoutes = [
  ...routeSource.matchAll(/^\s*(?:"([^"]+)"|([\w-]+)):\s*\{\s*path:/gm),
].map((match) => match[1] || match[2]);

test("every active route has desktop and mobile Guardian coverage", () => {
  assert.deepEqual([...matrix.activeRoutes].sort(), [...activeRoutes].sort());
  for (const route of activeRoutes) {
    const states = matrix.states.filter((state) => state.route === route);
    assert.ok(states.length > 0, `Missing Guardian state for ${route}`);
    const viewports = new Set(states.flatMap((state) => state.viewports));
    assert.ok(viewports.has("desktop"), `Missing desktop review for ${route}`);
    assert.ok(viewports.has("mobile"), `Missing mobile review for ${route}`);
  }
});

test("every state names its layout family, primary journey, keyboard contract, and recovery contract", () => {
  const stateIds = new Set();
  for (const state of matrix.states) {
    assert.ok(!stateIds.has(state.id), `Duplicate state ID ${state.id}`);
    stateIds.add(state.id);
    assert.ok(matrix.layoutFamilies.includes(state.layoutFamily), `${state.id} has an unknown layout family`);
    assert.ok(matrix.keyboardContracts[state.keyboardContract], `${state.id} has no keyboard contract`);
    assert.ok(matrix.recoveryContracts[state.recoveryContract], `${state.id} has no recovery contract`);
    assert.ok(state.primaryJourney?.trim(), `${state.id} has no primary journey`);
  }
});

test("one representative per layout family covers every canonical responsive width", () => {
  assert.deepEqual(matrix.canonicalBreakpoints, [320, 375, 390, 768, 1024, 1440]);
  for (const family of matrix.layoutFamilies) {
    const representative = matrix.states.find(
      (state) => state.layoutFamily === family && state.breakpointSample,
    );
    assert.ok(representative, `Missing breakpoint representative for ${family}`);
    assert.deepEqual(representative.breakpointSample, matrix.canonicalBreakpoints);
  }
});

test("trust, workbench, and recovery states are explicitly registered", () => {
  for (const id of [
    "sources-selected",
    "sources-unknown",
    "sources-empty",
    "record-unknown",
    "compare-empty",
    "compare-incomplete",
    "compare",
    "not-found",
    "loading",
  ]) {
    assert.ok(matrix.states.some((state) => state.id === id), `Missing ${id}`);
  }
});

test("record review states cover the required object classes and responsive template", () => {
  for (const id of [
    "control-rich",
    "cci",
    "stig-rule",
    "attack-technique",
    "supply-chain",
    "record-sparse",
  ]) {
    const state = matrix.states.find((entry) => entry.id === id);
    assert.ok(state, `Missing ${id}`);
    assert.match(state.path, /#\/record\//);
    assert.ok(state.viewports.includes("desktop"));
    assert.ok(state.viewports.includes("mobile"));
  }
  assert.equal(matrix.states.find((entry) => entry.id === "stig-rule").path, "/#/record/disa-stig/V-256609");
  const home = readFileSync("src/ui/pages/HomePage.tsx", "utf8");
  const records = readFileSync("src/ui/pages/ObjectDetailPage.tsx", "utf8");
  const publishedText = readFileSync("src/ui/components/RecordPublishedText.tsx", "utf8");
  assert.match(home, /data-visual-identity="universal-front-door"/);
  assert.match(
    home,
    /DESTINATION_ICONS[\s\S]*IconRocket[\s\S]*IconTopologyStar3[\s\S]*IconBooks[\s\S]*IconUsersGroup/,
  );
  assert.match(records, /data-template="E"/);
  assert.match(records, /<RecordPublishedText[\s\S]*claimOrigin={claimOrigin}/);
  assert.match(publishedText, /data-claim-origin={props.claimOrigin}/);
  assert.match(publishedText, /data-source-text="published"/);
  assert.match(records, /displayNameFor\("object_type"/);
});
