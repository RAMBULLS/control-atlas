import assert from "node:assert/strict";
import test from "node:test";

import { TEMPLATE_HANDOFF_FRAMEWORKS } from "../../src/shared/record-acceptance.mjs";
import { BUILD_SOURCE_CONTEXTS } from "../../src/ui/lib/buildRouteState.ts";

// A record page may only hand a catalog to the Templates page when that page
// can preselect it. The Templates page offers exactly BUILD_SOURCE_CONTEXTS.
test("template handoff frameworks match the catalogs the Templates page offers", () => {
  const offered = new Set(BUILD_SOURCE_CONTEXTS.map((context) => context.id));
  for (const framework of Object.values(TEMPLATE_HANDOFF_FRAMEWORKS)) {
    assert.ok(offered.has(framework), `${framework} is not a Templates page catalog`);
  }
  const reachable = new Set([
    ...BUILD_SOURCE_CONTEXTS.map((context) => context.id),
    ...BUILD_SOURCE_CONTEXTS.map((context) => context.baselineCatalogId),
  ]);
  assert.deepEqual([...reachable].sort(), Object.keys(TEMPLATE_HANDOFF_FRAMEWORKS).sort(),
    "every catalog with a template context should hand off, and no other");
});
