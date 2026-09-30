// Acceptance record for the retired two-question route. These are product
// destinations, not publication or applicability recommendations.
export const START_HERE_GOALS = Object.freeze([
  ["understand", "Understand a requirement"],
  ["implement", "Secure or build a system"],
  ["assess", "Assess or authorize"],
  ["operate", "Operate or defend"],
  ["risk", "Manage risk or supply chain"],
  ["document", "Produce a document"],
  ["tools", "Find a resource"],
]);

export const START_HERE_CONTEXTS = Object.freeze([
  ["federal", "Federal civilian system"],
  ["dod", "DoD or national security system"],
  ["cui", "CUI contractor environment"],
  ["fedramp", "FedRAMP cloud service"],
]);

const TOPIC_BY_CONTEXT = Object.freeze({
  federal: ["/atlas?atlasJourney=controls", "The controls journey helps locate published controls; a federal civilian label alone does not select a governing publication."],
  dod: ["/atlas?atlasJourney=stig", "The STIG journey covers DoD benchmark research; a DoD label alone does not identify an applicable benchmark."],
  cui: ["/atlas?atlasJourney=cmmc-cui", "The CUI journey distinguishes contractor sources; CUI context alone does not decide contract requirements."],
  fedramp: ["/atlas?atlasJourney=fedramp", "The FedRAMP journey organizes cloud-service source material; the program label does not select an authorization requirement."],
});

const CONTEXT_LIMIT = Object.freeze({
  federal: "Federal civilian context does not identify the agency decision or system scope.",
  dod: "DoD context does not identify the component decision or system scope.",
  cui: "CUI contractor context does not identify the contract clause or assessment scope.",
  fedramp: "FedRAMP context does not identify the service's authorization or assessment scope.",
});

const GOAL_DESTINATIONS = Object.freeze({
  assess: ["/atlas?atlasJourney=assessment", "Choose the assessment task and check its publisher source", "Atlas owns assessment orientation. The goal and context do not establish which assessment publication governs."],
  operate: ["/atlas", "Choose the monitoring or defense topic, then check its source", "Operating and defending cover different tasks. Atlas lets the person choose the relevant topic without guessing a publication."],
  risk: ["/library?q=risk", "Narrow the risk question and inspect the publisher record", "Library search exposes publisher identity and records. Risk and supply chain are too broad to imply a single publication."],
  document: ["/build", "Choose the document and fill it with system-specific evidence", "Templates owns editable working files. The document type must be chosen before any source can be suggested."],
  tools: ["/resources", "Filter resources by the task and check the provider", "Resources owns official portals, practitioner tools, training, and communities. System context does not identify a particular resource."],
});

export const START_HERE_ACCEPTANCE_MATRIX = Object.freeze(
  START_HERE_GOALS.flatMap(([goalId, goal]) =>
    START_HERE_CONTEXTS.map(([contextId, context]) => {
      if (goalId === "understand" || goalId === "implement") {
        const [firstDestination, rationale] = TOPIC_BY_CONTEXT[contextId];
        return Object.freeze({
          goalId, goal, contextId, context, firstDestination,
          secondDestination: null,
          nextAction: goalId === "understand"
            ? "Find the relevant source and read its stated scope"
            : "Choose the implementation topic and verify the publisher source",
          rationale: `${rationale} ${goalId === "implement" ? "Atlas connects that topic to implementation material without declaring it applicable." : "Atlas provides the topic orientation without declaring it applicable."}`,
        });
      }
      const [firstDestination, nextAction, rationale] = GOAL_DESTINATIONS[goalId];
      return Object.freeze({
        goalId, goal, contextId, context, firstDestination,
        secondDestination: null, nextAction,
        rationale: `${rationale} ${CONTEXT_LIMIT[contextId]}`,
      });
    }),
  ),
);

const ROW_BY_PAIR = new Map(
  START_HERE_ACCEPTANCE_MATRIX.map((row) => [`${row.goalId}/${row.contextId}`, row]),
);

const FALLBACK_BY_GOAL = Object.freeze({
  assess: "/atlas?atlasJourney=assessment",
  risk: "/library?q=risk",
  document: "/build",
  tools: "/resources",
});

export function startHereDestinationFor(goalId, contextId) {
  return ROW_BY_PAIR.get(`${goalId}/${contextId}`)?.firstDestination
    || FALLBACK_BY_GOAL[goalId]
    || "/atlas";
}
