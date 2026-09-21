import type { CommonsResource } from "./commonsTypes";
import type { ViewState } from "./viewState";

export type ContextReasonCode =
  | "same_family_or_publication"
  | "same_technology"
  | "same_work_stage"
  | "same_artifact_or_assessment_type"
  | "explicit_support_for_standard"
  | "same_topic";

export type ContextReason = {
  code: ContextReasonCode;
  label: string;
  detail: string;
};

export type EditorialDestination = {
  view: ViewState["view"];
  patch: Partial<ViewState>;
};

export type EditorialSuggestion = {
  id: string;
  kind: "control_atlas_suggestion";
  group: string;
  title: string;
  owner: string;
  summary: string;
  reason: ContextReason;
  destination: EditorialDestination;
  resource?: CommonsResource;
  structural: false;
};

export type RecordContextKind =
  | "control"
  | "cci"
  | "stig"
  | "assessment"
  | "attack"
  | "defense"
  | "supply_chain"
  | "policy_or_clause"
  | "published_record";

type RecordLike = {
  id: string;
  node_type?: string;
  source_id?: string;
  metadata?: Record<string, any>;
};

type DocumentLike = {
  item_id?: string;
  title?: string;
  catalog_id?: string;
  source_id?: string;
  object_type?: string;
};

type ResourceRule = {
  group: string;
  resourceIds: string[];
  reason: ContextReason;
};

const REASONS = {
  standard: {
    code: "explicit_support_for_standard",
    label: "Explicit support for the standard",
    detail:
      "The resource register identifies direct support for this publication or standard.",
  },
  stage: {
    code: "same_work_stage",
    label: "Same work stage",
    detail:
      "The resource register places this item in the same implementation, assessment, or monitoring stage.",
  },
  assessment: {
    code: "same_artifact_or_assessment_type",
    label: "Same assessment or artifact type",
    detail:
      "The resource or starter document supports the same kind of assessment work product.",
  },
  topic: {
    code: "same_topic",
    label: "Same topic",
    detail:
      "The record and resource share an explicit topic in their maintained metadata.",
  },
  publication: {
    code: "same_family_or_publication",
    label: "Same family or publication",
    detail:
      "The destination is scoped to this record's publication or control family.",
  },
} satisfies Record<string, ContextReason>;

const RESOURCE_RULES: Record<RecordContextKind, ResourceRule[]> = {
  control: [
    {
      group: "Implementation",
      resourceIds: ["tool-compliance-as-code", "tool-ansible-lockdown"],
      reason: REASONS.stage,
    },
  ],
  cci: [
    {
      group: "Implementation",
      resourceIds: ["portal-dod-stig-srg", "tool-disa-stig-viewer"],
      reason: REASONS.standard,
    },
  ],
  stig: [
    {
      group: "Implementation and validation",
      resourceIds: [
        "tool-disa-scap-compliance-checker",
        "tool-disa-stig-viewer",
        "tool-stig-manager",
      ],
      reason: REASONS.standard,
    },
  ],
  assessment: [
    {
      group: "Assessment",
      resourceIds: ["tool-cisa-cset", "tool-mitre-saf-cli"],
      reason: REASONS.assessment,
    },
  ],
  attack: [
    {
      group: "Threat intelligence",
      resourceIds: ["dataset-mitre-attack-json"],
      reason: REASONS.standard,
    },
  ],
  defense: [
    {
      group: "Defensive knowledge",
      resourceIds: ["dataset-mitre-d3fend-json"],
      reason: REASONS.standard,
    },
  ],
  supply_chain: [
    {
      group: "Acquisition and supply chain",
      resourceIds: [
        "tool-syft-sbom-generator",
        "tool-cyclonedx-cli",
        "tool-dependency-track",
      ],
      reason: REASONS.topic,
    },
  ],
  policy_or_clause: [
    {
      group: "Authority and policy",
      resourceIds: [
        "official-cui-registry",
        "portal-dod-cmmc-documentation",
      ],
      reason: REASONS.standard,
    },
  ],
  published_record: [],
};

const GUIDE_BY_KIND: Partial<Record<RecordContextKind, string>> = {
  control: "implementing-controls",
  cci: "hierarchy-and-relationships",
  stig: "stig-lifecycle",
  assessment: "conducting-assessments",
  attack: "published-mappings-in-compare",
  defense: "published-mappings-in-compare",
};

const DOCUMENT_BY_KIND: Partial<Record<RecordContextKind, string>> = {
  control: "implementation_statement_worksheet",
  assessment: "assessment_planning_worksheet",
  supply_chain: "software_baseline",
};

function searchableRecordText(node: RecordLike, document: DocumentLike): string {
  return [
    node.id,
    node.node_type,
    node.metadata?.item_id,
    node.metadata?.title,
    node.metadata?.family,
    node.metadata?.description,
    document.item_id,
    document.title,
    document.catalog_id,
    document.object_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function recordContextKind(
  node: RecordLike,
  document: DocumentLike,
): RecordContextKind {
  const catalogId =
    document.catalog_id || node.metadata?.catalog_id || "";
  const nodeType = document.object_type || node.node_type || "";
  const text = searchableRecordText(node, document);

  if (catalogId === "disa-cci") return "cci";
  if (nodeType === "stig_rule" || nodeType === "srg_requirement") return "stig";
  if (nodeType === "assessment_procedure") return "assessment";
  if (nodeType === "attack_technique") return "attack";
  if (nodeType === "defend_countermeasure") return "defense";
  if (
    /supply chain|sbom|software bill of materials|acquisition/.test(text)
  ) {
    return "supply_chain";
  }
  if (nodeType === "policy" || nodeType === "clause") {
    return "policy_or_clause";
  }
  if (nodeType === "control" || nodeType === "control_enhancement") {
    return "control";
  }
  return "published_record";
}

function resourceSuggestion(
  resource: CommonsResource,
  group: string,
  reason: ContextReason,
): EditorialSuggestion {
  return {
    id: `resource:${resource.id}`,
    kind: "control_atlas_suggestion",
    group,
    title: resource.name,
    owner: resource.publisher,
    summary: resource.cardPurpose || resource.summary,
    reason,
    destination: {
      view: "commons-detail",
      patch: { id: resource.id },
    },
    resource,
    structural: false,
  };
}

export function contextualSuggestionsForRecord(options: {
  node: RecordLike;
  document: DocumentLike;
  resources: CommonsResource[];
  maxPerGroup?: number;
}): EditorialSuggestion[] {
  const { node, document, resources, maxPerGroup = 3 } = options;
  const kind = recordContextKind(node, document);
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const suggestions: EditorialSuggestion[] = [];

  for (const rule of RESOURCE_RULES[kind]) {
    for (const resourceId of rule.resourceIds.slice(0, maxPerGroup)) {
      const resource = resourceById.get(resourceId);
      if (resource) {
        suggestions.push(resourceSuggestion(resource, rule.group, rule.reason));
      }
    }
  }

  const guide = GUIDE_BY_KIND[kind];
  if (guide) {
    suggestions.push({
      id: `guide:${guide}`,
      kind: "control_atlas_suggestion",
      group: "Related guidance",
      title: "Open the relevant practitioner guide",
      owner: "Control Atlas",
      summary: "Continue with a workflow that keeps its official references visible.",
      reason: REASONS.stage,
      destination: { view: "patterns", patch: { pattern: guide } },
      structural: false,
    });
  }

  if (kind === "attack" || kind === "defense") {
    suggestions.push({
      id: `compare:${node.id}`,
      kind: "control_atlas_suggestion",
      group: "Threats and defensive measures",
      title: "Trace published threat and defense connections",
      owner: "Control Atlas",
      summary:
        "Open Compare with this record selected; only published mappings appear as connections.",
      reason: REASONS.topic,
      destination: {
        view: "matrix",
        patch: {
          crosswalk: "threat-chain",
          chainCatalog: document.catalog_id || "",
          chainItem: node.id,
        },
      },
      structural: false,
    });
  }

  const templateType = DOCUMENT_BY_KIND[kind];
  if (templateType) {
    suggestions.push({
      id: `document:${templateType}`,
      kind: "control_atlas_suggestion",
      group: "Documents you can start",
      title: "Start a matching work product",
      owner: "Control Atlas",
      summary: "Open the starter document with this publication carried as context where supported.",
      reason: REASONS.assessment,
      destination: {
        view: "templates",
        patch: {
          buildSection: "documents",
          templateType,
          framework: ["nist-800-53", "fedramp-rev5"].includes(
            document.catalog_id || "",
          )
            ? document.catalog_id
            : "",
          controlFamily: node.metadata?.family || "",
        },
      },
      structural: false,
    });
  }

  return suggestions;
}

export function contextualResourceQuery(
  node: RecordLike,
  document: DocumentLike,
): string {
  const kind = recordContextKind(node, document);
  if (kind === "stig" || kind === "cci") return "STIG";
  if (kind === "attack") return "ATT&CK";
  if (kind === "defense") return "D3FEND";
  if (kind === "supply_chain") return "supply chain SBOM";
  if (kind === "assessment") return "assessment";
  return node.metadata?.family || document.title || document.item_id || "";
}

export const CONTEXT_REASON_CODES = Object.freeze(
  Object.values(REASONS).map((reason) => reason.code),
);
