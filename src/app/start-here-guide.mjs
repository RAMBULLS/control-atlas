// Start here: two questions, then a short starting plan.
//
// Every step names a publication Control Atlas actually holds (catalogId) and
// an existing route. Nothing here is an applicability, scoping, or compliance
// determination — it is navigation through public material, and the page says
// so once.

export const START_HERE_GOALS = Object.freeze([
  { id: "understand", label: "Understand a requirement" },
  { id: "implement", label: "Secure or build a system" },
  { id: "assess", label: "Assess or authorize" },
  { id: "operate", label: "Operate or defend" },
  { id: "risk", label: "Manage risk or supply chain" },
  { id: "document", label: "Produce a document" },
  { id: "tools", label: "Find a resource" },
]);

export const START_HERE_CONTEXTS = Object.freeze([
  { id: "federal", label: "Federal civilian system" },
  { id: "dod", label: "DoD or national security system" },
  { id: "cui", label: "CUI contractor environment" },
  { id: "fedramp", label: "FedRAMP cloud service" },
  { id: "unsure", label: "Not sure" },
]);

// Start here renders without the runtime bundle (isStaticViewWithoutBundle),
// so the plan cannot look publication names up from the graph — without these
// it printed raw catalog ids. Values match data/generated/catalog-bootstrap.json
// and are asserted against it in tests/content-review.test.mjs.
export const PUBLICATION_NAMES = Object.freeze({
  "nist-800-53": "SP 800-53 Rev. 5",
  "nist-800-53a": "SP 800-53A Rev. 5",
  "nist-800-53b": "SP 800-53B",
  "nist-800-37": "SP 800-37 Rev. 2",
  "nist-800-171-rev2": "SP 800-171 Rev. 2",
  "fedramp-rev5": "FedRAMP Rev. 5",
  "fips-199": "FIPS 199",
  "disa-srg": "DISA SRG",
  "disa-stig": "DISA STIG",
  "cmmc-2": "CMMC 2.0",
});

export function publicationNameFor(catalogId) {
  return PUBLICATION_NAMES[catalogId] || catalogId;
}

// The publication each context treats as its requirement source of record.
const CONTEXT_PRIMARY = {
  federal: "nist-800-53",
  dod: "nist-800-53",
  cui: "nist-800-171-rev2",
  fedramp: "fedramp-rev5",
};

const CONTEXT_SECONDARY = {
  federal: "fips-199",
  dod: "disa-srg",
  cui: "cmmc-2",
  fedramp: "nist-800-53b",
};

// Goal -> what the plan leads with, after the context's own requirement source.
const GOAL_STEPS = {
  understand: {
    thenReview: "nist-800-37",
    action: { label: "Explore the topic in Atlas", view: "atlas-map" },
  },
  implement: {
    thenReview: "disa-stig",
    action: { label: "See related records", view: "atlas-map" },
  },
  assess: {
    thenReview: "nist-800-53a",
    action: { label: "Choose a template", view: "templates" },
  },
  operate: {
    thenReview: "nist-800-37",
    action: { label: "See related records", view: "atlas-map" },
  },
  risk: {
    thenReview: "nist-800-171-rev2",
    action: { label: "Search supply-chain material", view: "search", patch: { query: "supply chain" } },
  },
  document: {
    thenReview: "nist-800-53a",
    action: { label: "Choose a template", view: "templates", patch: { buildSection: "documents" } },
  },
  tools: {
    thenReview: "nist-800-37",
    action: { label: "Browse tools and communities", view: "commons" },
  },
};

export function isKnownGoal(id) {
  return START_HERE_GOALS.some((goal) => goal.id === id);
}

export function isKnownContext(id) {
  return START_HERE_CONTEXTS.some((context) => context.id === id);
}

export function labelForGoal(id) {
  return START_HERE_GOALS.find((goal) => goal.id === id)?.label || "";
}

export function labelForContext(id) {
  return START_HERE_CONTEXTS.find((context) => context.id === id)?.label || "";
}

/**
 * Returns null unless both answers identify a context with a source to
 * investigate. An unknown context must not produce a guessed publication.
 */
export function startingPlanFor(goalId, contextId) {
  if (!isKnownGoal(goalId) || !isKnownContext(contextId) || contextId === "unsure") {
    return null;
  }
  const goal = GOAL_STEPS[goalId];
  const startWith = CONTEXT_PRIMARY[contextId];
  // When the goal's own review publication is the same as the context's
  // requirement source, fall back to the context's secondary rather than
  // printing the same publication twice.
  const thenReview =
    goal.thenReview === startWith ? CONTEXT_SECONDARY[contextId] : goal.thenReview;

  return {
    goalId,
    contextId,
    startWith: { catalogId: startWith, view: "catalog-detail" },
    thenReview: { catalogId: thenReview, view: "catalog-detail" },
    action: goal.action,
  };
}

export function validateStartHereGuide() {
  const errors = [];
  for (const context of START_HERE_CONTEXTS) {
    if (context.id === "unsure") continue;
    if (!CONTEXT_PRIMARY[context.id]) errors.push(`context ${context.id} has no primary publication`);
    if (!CONTEXT_SECONDARY[context.id]) errors.push(`context ${context.id} has no secondary publication`);
  }
  for (const goal of START_HERE_GOALS) {
    const step = GOAL_STEPS[goal.id];
    if (!step) {
      errors.push(`goal ${goal.id} has no plan`);
      continue;
    }
    if (!step.thenReview) errors.push(`goal ${goal.id} has no review publication`);
    if (!step.action?.label || !step.action?.view) errors.push(`goal ${goal.id} has no next action`);
  }
  for (const goal of START_HERE_GOALS) {
    for (const context of START_HERE_CONTEXTS) {
      if (context.id === "unsure") continue;
      const plan = startingPlanFor(goal.id, context.id);
      if (!plan) {
        errors.push(`no plan for ${goal.id}/${context.id}`);
        continue;
      }
      if (plan.startWith.catalogId === plan.thenReview.catalogId) {
        errors.push(`plan ${goal.id}/${context.id} repeats ${plan.startWith.catalogId}`);
      }
      for (const step of [plan.startWith, plan.thenReview]) {
        if (!PUBLICATION_NAMES[step.catalogId]) {
          errors.push(`no display name for ${step.catalogId}; it would render as a raw id`);
        }
      }
    }
  }
  return errors;
}
