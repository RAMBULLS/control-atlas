import assert from "node:assert/strict";
import test from "node:test";

import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";
import {
  controlContextLabel,
  CONTROL_CONTEXT_RELATIONSHIP_TYPE,
  controlContextTargetId,
  parseControlContext,
} from "../src/shared/record-control-context.mjs";

test("control context ids read as the control a practitioner knows", () => {
  assert.equal(controlContextLabel("CTL-AC-06-01"), "AC-6.1");
  assert.equal(controlContextLabel("CTL-AC-20"), "AC-20");
  assert.equal(controlContextLabel("CTL-IR-04-11"), "IR-4.11");
  assert.equal(controlContextTargetId("CTL-AC-06-01"), "nist-800-53:AC-6.1");
  assert.equal(controlContextLabel("AC-6"), null);
  assert.equal(controlContextTargetId(""), null);
});

test("parameter notation becomes a readable label and keeps the publisher identifier", () => {
  const [entry] = parseControlContext("ac-06.01_odp.02: all functions not publicly accessible");
  assert.deepEqual(entry, {
    kind: "parameter",
    label: "AC-6.1 parameter 2",
    id: "ac-06.01_odp.02",
    value: "all functions not publicly accessible",
  });
  const [unnumbered] = parseControlContext("ac-06.02_odp: all security functions");
  assert.equal(unnumbered.label, "AC-6.2 parameter");
  assert.equal(unnumbered.id, "ac-06.02_odp");
  const [base] = parseControlContext("ac-02_odp.01: the organization-defined value");
  assert.equal(base.label, "AC-2 parameter 1");
});

test("guidance and parameters stay in the publisher's order and nothing is dropped", () => {
  const text = "Lead-in guidance.\n\nac-06.01_odp.02: value two\n\nac-06.01_odp.05: value five\n\nClosing guidance.";
  const entries = parseControlContext(text);
  assert.deepEqual(entries.map((entry) => entry.kind), ["guidance", "parameter", "parameter", "guidance"]);
  assert.equal(entries[0].text, "Lead-in guidance.");
  assert.equal(entries[3].text, "Closing guidance.");
  assert.deepEqual(parseControlContext(""), []);
});

test("every FedRAMP control context in the corpus parses without loss and points at a real control", () => {
  const nodes = readGeneratedCollection(".", "nodes").nodes;
  const ids = new Set(nodes.map((node) => node.id));
  const contexts = nodes.filter((node) => node.node_type === "control_context");
  assert.ok(contexts.length > 0);
  const problems = [];
  for (const node of contexts) {
    const itemId = node.metadata.item_id;
    const target = controlContextTargetId(itemId);
    if (!target || !ids.has(target)) problems.push(`${itemId}: no control ${target}`);
    const text = String(node.metadata.description || "");
    const chunks = text.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean);
    const entries = parseControlContext(text);
    if (entries.length !== chunks.length) problems.push(`${itemId}: ${chunks.length} chunks became ${entries.length} entries`);
    for (const [index, entry] of entries.entries()) {
      const shown = entry.kind === "parameter" ? entry.value : entry.text;
      if (!chunks[index].includes(shown)) problems.push(`${itemId}: entry ${index} lost text`);
    }
  }
  assert.deepEqual(problems.slice(0, 5), []);
});

test("every FedRAMP control context has a real published edge to the control it annotates", () => {
  // Control context folds onto its control's own page (issue 279). A control
  // page only ever has its own neighborhood loaded, not the full corpus, so
  // an id computed at render time is not enough - the context must be
  // reachable through a real edge, the same way every other membership
  // relationship in this graph is.
  const nodes = readGeneratedCollection(".", "nodes").nodes;
  const edges = readGeneratedCollection(".", "edges").edges;
  const contexts = nodes.filter((node) => node.node_type === "control_context");
  const describesEdges = new Map(
    edges
      .filter((edge) => edge.relationship_type === CONTROL_CONTEXT_RELATIONSHIP_TYPE && edge.publication_status === "published")
      .map((edge) => [edge.source_node_id, edge.target_node_id]),
  );
  assert.equal(describesEdges.size, contexts.length, "one describes edge per control context record");
  const problems = [];
  for (const node of contexts) {
    const expectedTarget = controlContextTargetId(node.metadata.item_id);
    const actualTarget = describesEdges.get(node.id);
    if (actualTarget !== expectedTarget) problems.push(`${node.id}: edge points at ${actualTarget}, expected ${expectedTarget}`);
  }
  assert.deepEqual(problems.slice(0, 5), []);
});
