import * as Accordion from "@radix-ui/react-accordion";
import {
  IconCompass,
  IconExternalLink,
  IconFileDescription,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SITE_COPY } from "../../shared/site-copy.mjs";

import {
  buildTemplateDocument,
  templateFilename,
} from "../../app/template-engine.mjs";
import {
  CatalogFilterBar,
  QuickIntentCard,
} from "../components/QuickIntentCard";
import {
  filterByCategoryAndQuery,
  groupItemsByCategory,
  TEMPLATE_CATEGORIES,
} from "../lib/catalogGroups.mjs";

import { STARTER_DOCUMENT_REVIEW_NOTICE } from "../../shared/disclaimer.mjs";
import { ContextualCommonsModule } from "../components/ContextualCommonsModule";
import { ContextualTaxonomyLinks } from "../components/ContextualTaxonomyLinks";
import { BuildLocalNav } from "../components/BuildLocalNav";
import { CommonsResourceCard } from "../components/CommonsResourceCard";
import { groupResourcesByKind } from "../lib/commonsPresentation.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import {
  buildTemplateGenerationSnapshot,
  resolveTemplateGenerationState,
  type TemplateInputOption,
} from "../lib/templateGenerationState";
import {
  baselineCatalogForBuildContext,
  BUILD_LANES,
  BUILD_SOURCE_CONTEXTS,
} from "../lib/buildRouteState";
import {
  Badge,
  DisclosurePanel,
  PageHeader,
  SelectField,
  SummaryCard,
  downloadBlobFile,
  scrollElementBelowHeader,
} from "../lib/pagePrimitives";
import { Panel, Button, ButtonLink } from "../components/lsm";
import { AppLink } from "../components/AppLink";

type TemplateRecord = {
  template_id?: string;
  name: string;
  display_name: string;
  description: string;
  artifact_type?: string;
  supported_formats: string[];
  input_options: TemplateInputOption[];
  required_input_options?: TemplateInputOption[];
  source_refs?: string[];
  official_alternative?: { label: string; url: string };
  official_artifact_ids?: string[];
  official_resource_ids?: string[];
  workflow_ids?: string[];
  related_tool_ids?: string[];
  compatibility_level?: string;
  limitations?: string[];
  compatibility?: {
    classification?: string;
    claim?: string;
    limitations?: string;
  };
};

type OfficialArtifact = {
  artifact_id: string;
  title: string;
  artifact_family?: string;
  publisher?: string;
  classification?: string;
  status?: string;
  version?: string;
  retrieved_on?: string;
  landing_url?: string;
  download_url?: string;
  formats?: string[];
  summary?: string;
  provenance_note?: string;
  limitations?: string[];
};

type FedrampRule = {
  rule_id: string;
  process_name?: string;
  name?: string;
  force?: string;
  applicability?: string;
};

type FedrampTransitionMapping = {
  legacy_artifact_id: string;
  relationship: string;
  path_scope: string[];
  current_artifact_ids: string[];
  rule_ids: string[];
  summary: string;
  action: string;
};

type FedrampLegacyAsset = {
  title: string;
  format: string;
  url: string;
};

type FedrampTransitionIndex = {
  retrieved_on?: string;
  source?: {
    version?: string;
    last_updated?: string;
  };
  interpretation_notice?: string;
  official_links?: Record<string, string>;
  milestones?: Array<{ date: string; label: string; meaning: string }>;
  process_statuses?: Array<{
    process_id: string;
    name: string;
    status: string;
  }>;
  current_artifact_rules?: Record<string, string[]>;
  legacy_mappings?: FedrampTransitionMapping[];
  resolved_rules?: FedrampRule[];
  legacy_assets?: FedrampLegacyAsset[];
};

type WorkflowStep = {
  order: number;
  title: string;
  action: string;
  artifact_ids?: string[];
  tool_ids?: string[];
  completion_signal?: string;
};

type ComplianceWorkflow = {
  workflow_id: string;
  title: string;
  summary: string;
  audiences?: string[];
  outcomes?: string[];
  artifact_ids?: string[];
  tool_ids?: string[];
  steps?: WorkflowStep[];
  readiness_checks?: string[];
  boundary_note?: string;
  companion_template_ids?: string[];
};

type ComplianceTool = {
  tool_id: string;
  name: string;
  maintainer?: string;
  classification?: string;
  status?: string;
  version_or_release?: string;
  repository_url?: string;
  project_url?: string;
  license?: string;
  purpose?: string;
  supported_inputs?: string[];
  supported_outputs?: string[];
  artifact_families?: string[];
  access_requirements?: string[];
  limitations?: string[];
};

const COMPATIBILITY_LABELS: Record<string, string> = {
  official_current: "Official current",
  official_legacy: "Official legacy",
  official_guidance: "Official guidance",
  schema_aligned: "Schema-aligned",
  community_reference: "Community reference",
  unverified: "Unverified interoperability",
};

function compatibilityTone(value?: string) {
  const normalized = normalizedFamily(value);
  if (normalized === "official_current" || normalized === "officially_specified") {
    return "success" as const;
  }
  if (normalized === "official_legacy" || normalized.includes("unverified")) {
    return "warning" as const;
  }
  if (
    normalized === "official_guidance" ||
    normalized === "schema_aligned" ||
    normalized.includes("schema_aligned")
  ) {
    return "info" as const;
  }
  return "default" as const;
}

function compatibilityLabel(value?: string) {
  if (value?.toLowerCase() === "control atlas companion") {
    return "Starter document";
  }
  if (value && /[A-Z ]/.test(value)) return value;
  return value
    ? COMPATIBILITY_LABELS[value] || value.replaceAll("_", " ")
    : "Starter document";
}

function normalizedFamily(value?: string) {
  return (value || "").toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
}

function ruleLabel(rule: FedrampRule) {
  return `${rule.rule_id}${rule.name ? ` — ${rule.name}` : ""}`;
}

function OfficialArtifactCard(props: {
  artifact: OfficialArtifact;
  fedrampTransition?: FedrampTransitionIndex;
}) {
  const { artifact, fedrampTransition } = props;
  const primaryUrl = artifact.download_url || artifact.landing_url;
  const transition = fedrampTransition?.legacy_mappings?.find(
    (entry) => entry.legacy_artifact_id === artifact.artifact_id,
  );
  const currentRuleIds =
    fedrampTransition?.current_artifact_rules?.[artifact.artifact_id] || [];
  const applicableRuleIds = transition?.rule_ids || currentRuleIds;
  const resolvedRules = new Map(
    (fedrampTransition?.resolved_rules || []).map((rule) => [rule.rule_id, rule]),
  );
  const isLegacyArchive =
    artifact.artifact_id === "fedramp-legacy-assets-2026-transition";
  return (
    <article className="nexus-card">
      <div className="nexus-card-heading">
        <div>
          <p className="result-meta">{artifact.publisher || "Official source"}</p>
          <h3>{artifact.title}</h3>
        </div>
        <Badge tone={compatibilityTone(artifact.classification)}>
          {compatibilityLabel(artifact.classification)}
        </Badge>
      </div>
      {artifact.summary ? <p>{artifact.summary}</p> : null}
      <p className="support-meta">
        {[
          artifact.status,
          artifact.version,
          artifact.formats?.join(", "),
          artifact.retrieved_on
            ? `Checked ${artifact.retrieved_on}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {artifact.provenance_note ? (
        <details className="nexus-details">
          <summary>Source and use notes</summary>
          <p>{artifact.provenance_note}</p>
        </details>
      ) : null}
      {artifact.limitations?.length ? (
        <p className="nexus-limitation">
          <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
          {artifact.limitations[0]}
        </p>
      ) : null}
      {transition ? (
        <div className="fedramp-transition-block">
          <p className="eyebrow">Legacy → current</p>
          <p>{transition.summary}</p>
          <dl className="nexus-facts">
            <div>
              <dt>Paths</dt>
              <dd>{transition.path_scope.join(" + ")}</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd>{transition.action}</dd>
            </div>
          </dl>
          {applicableRuleIds.length ? (
            <details className="nexus-details">
              <summary>{applicableRuleIds.length} governing rule{applicableRuleIds.length === 1 ? "" : "s"}</summary>
              <ul className="nexus-list compact-list">
                {applicableRuleIds.map((ruleId) => (
                  <li key={ruleId}>
                    {resolvedRules.has(ruleId)
                      ? ruleLabel(resolvedRules.get(ruleId) as FedrampRule)
                      : ruleId}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : currentRuleIds.length ? (
        <details className="nexus-details fedramp-rule-list">
          <summary>Governed by {currentRuleIds.length} current rule{currentRuleIds.length === 1 ? "" : "s"}</summary>
          <ul className="nexus-list compact-list">
            {currentRuleIds.map((ruleId) => (
              <li key={ruleId}>
                {resolvedRules.has(ruleId)
                  ? ruleLabel(resolvedRules.get(ruleId) as FedrampRule)
                  : ruleId}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isLegacyArchive && fedrampTransition?.legacy_assets?.length ? (
        <details className="nexus-details fedramp-legacy-index">
          <summary>
            Browse all {fedrampTransition.legacy_assets.length} official legacy files
          </summary>
          <ul className="nexus-list compact-list">
            {fedrampTransition.legacy_assets.map((asset) => (
              <li key={asset.url}>
                <a href={asset.url} rel="noopener noreferrer" target="_blank">
                  {asset.title} ({asset.format.toUpperCase()})
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="card-actions">
        {primaryUrl ? (
          <ButtonLink
            variant="secondary"
            href={primaryUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {artifact.download_url ? "Download document" : "View official source"}
            <IconExternalLink aria-hidden="true" size={15} stroke={1.8} />
          </ButtonLink>
        ) : null}
        {artifact.download_url && artifact.landing_url ? (
          <a
            className="text-link"
            href={artifact.landing_url}
            rel="noopener noreferrer"
            target="_blank"
          >
            Publisher page
          </a>
        ) : null}
      </div>
    </article>
  );
}

function FedrampCurrentTruthPanel(props: {
  transition?: FedrampTransitionIndex;
}) {
  const { transition } = props;
  if (!transition?.source) return null;
  const stableProcesses = (transition.process_statuses || []).filter(
    (process) => process.status === "stable",
  );
  const placeholders = (transition.process_statuses || []).filter(
    (process) => process.status === "placeholder",
  );
  const links = transition.official_links || {};
  const upcomingMilestones = (transition.milestones || []).filter(
    (milestone) => milestone.date >= "2026-07-16",
  );
  return (
    <aside aria-labelledby="fedramp-current-heading" className="fedramp-truth-panel">
      <div className="fedramp-truth-heading">
        <div>
          <p className="eyebrow">FedRAMP current rules</p>
          <h3 id="fedramp-current-heading">
            Consolidated Rules {transition.source.version}
          </h3>
          <p>
            Updated {transition.source.last_updated}. These current rules are
            authoritative. Older files are kept only for comparison.
          </p>
        </div>
        <Badge tone="success">Official current</Badge>
      </div>
      <div className="fedramp-truth-grid">
        <div>
          <strong>{stableProcesses.length} stable process documents</strong>
          <span>
            Only {placeholders.length || "no"} process is marked placeholder
            {placeholders.length
              ? `: ${placeholders.map((process) => `${process.process_id} — ${process.name}`).join(", ")}.`
              : "."}
          </span>
        </div>
        <div>
          <strong>20x and Rev5 are both mapped</strong>
          <span>
            Current paths depend on the applicable rules and effective dates.
            The linked legacy workbook is kept for migration and comparison.
          </span>
        </div>
      </div>
      {upcomingMilestones.length ? (
        <details className="nexus-details">
          <summary>Transition dates</summary>
          <ol className="fedramp-milestones">
            {upcomingMilestones.map((milestone) => (
              <li key={milestone.date}>
                <time dateTime={milestone.date}>{milestone.date}</time>
                <span>
                  <strong>{milestone.label}</strong> — {milestone.meaning}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="card-actions fedramp-source-links">
        {[
          ["Current rules", links.current_rules],
          ["Machine-readable source", links.machine_readable_source],
          ["Schema index", links.schema_index],
          ["Changelog", links.changelog],
          ["Timeline", links.timeline],
          ["Legacy library", links.legacy_reference],
        ].map(([label, url]) =>
          url ? (
            <a className="text-link" href={url} key={label} rel="noopener noreferrer" target="_blank">
              {label}
              <IconExternalLink aria-hidden="true" size={14} stroke={1.8} />
            </a>
          ) : null,
        )}
      </div>
      {transition.interpretation_notice ? (
        <p className="support-meta">{transition.interpretation_notice}</p>
      ) : null}
    </aside>
  );
}

function ToolCard(props: { tool: ComplianceTool }) {
  const { tool } = props;
  const primaryUrl = tool.project_url || tool.repository_url;
  return (
    <article className="nexus-card">
      <div className="nexus-card-heading">
        <div>
          <p className="result-meta">{tool.maintainer || "Tool"}</p>
          <h3>{tool.name}</h3>
        </div>
        {tool.classification ? (
          <Badge tone={compatibilityTone(tool.classification)}>
            {compatibilityLabel(tool.classification)}
          </Badge>
        ) : null}
      </div>
      {tool.purpose ? <p>{tool.purpose}</p> : null}
      <p className="support-meta">
        {[tool.status, tool.version_or_release, tool.license]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {tool.supported_inputs?.length || tool.supported_outputs?.length ? (
        <dl className="nexus-facts">
          {tool.supported_inputs?.length ? (
            <div>
              <dt>Accepts</dt>
              <dd>{tool.supported_inputs.join(", ")}</dd>
            </div>
          ) : null}
          {tool.supported_outputs?.length ? (
            <div>
              <dt>Produces</dt>
              <dd>{tool.supported_outputs.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {tool.access_requirements?.length ? (
        <p className="nexus-limitation">
          <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
          {tool.access_requirements[0]}
        </p>
      ) : null}
      {tool.limitations?.length ? (
        <details className="nexus-details">
          <summary>Compatibility limits</summary>
          <ul className="nexus-list">
            {tool.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {primaryUrl ? (
        <div className="card-actions">
          <ButtonLink
            variant="secondary"
            href={primaryUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open tool page
            <IconExternalLink aria-hidden="true" size={15} stroke={1.8} />
          </ButtonLink>
          {tool.project_url &&
          tool.repository_url &&
          tool.project_url !== tool.repository_url ? (
            <a
              className="text-link"
              href={tool.repository_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              Source repository
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

const FORMAT_LABELS: Record<string, string> = {
  xlsx: "Excel (.xlsx)",
  docx: "Word (.docx)",
};

const INPUT_LABELS: Record<string, string> = {
  framework: "Catalog or program context",
  baseline: "Baseline selection",
  control_family: "Control family filter",
  selected_controls: "Specific controls",
  selected_stigs: "STIG references",
  environment_archetype: "Environment type",
};

const FORMAT_HELP: Record<string, string> = {
  xlsx: "Excel workbook - an editable working register with print-ready sheets.",
  docx: "Word document - a branded starter narrative with headings and working tables.",
};

function TemplateDocumentPreview({ doc, format }: { doc: any; format: string }) {
  return (
    <section aria-labelledby="document-preview-heading" className="template-document-preview">
      <header className="template-document-preview-header">
        <div>
          <p>Control Atlas</p>
          <h3 id="document-preview-heading">{doc.title}</h3>
        </div>
        <span>{FORMAT_LABELS[format] || format}</span>
      </header>
      <div className="template-document-preview-body">
        <p className="template-document-preview-description">{doc.description}</p>
        <p className="template-document-preview-disclaimer">
          Starter document. The selected inputs and cited sources appear in the file.
        </p>
        <p className="template-document-preview-disclaimer">
          {STARTER_DOCUMENT_REVIEW_NOTICE}
        </p>
        {(doc.sections || []).map((section: any) => (
          <section className="template-document-preview-section" key={section.heading}>
            <h4>{section.heading}</h4>
            {section.type === "text" ? (
              <p>{section.content}</p>
            ) : (
              <>
                <div className="template-document-preview-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(section.headers || []).map((header: string) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(section.rows || []).slice(0, 3).map((row: any[], index: number) => (
                        <tr key={index}>
                          {(section.headers || []).map((_: string, cellIndex: number) => (
                            <td key={cellIndex}>{row[cellIndex] || ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {section.rows?.length > 3 ? (
                  <p className="template-document-preview-more">
                    Plus {section.rows.length - 3} more rows in the downloaded document.
                  </p>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

const BASELINE_LABELS: Record<string, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  PRIVACY: "Privacy",
  "LI-SAAS": "LI-SaaS",
};

export function TemplatesPage(props: {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "templates" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { bundle, state, onNavigate } = props;
  const generationRef = useRef<HTMLElement | null>(null);
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowDetailRef = useRef<HTMLElement | null>(null);
  const categoryFilter = state.category;
  const queryFilter = state.query;
  const [showAllOfficialResources, setShowAllOfficialResources] =
    useState(false);
  const [showCompleteOfficialCatalog, setShowCompleteOfficialCatalog] =
    useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationTone, setGenerationTone] = useState<"trust" | "warning">(
    "trust",
  );
  const templates = (bundle.templateRegistry.templates || []) as TemplateRecord[];
  const officialArtifacts = (bundle.officialArtifactRegistry?.artifacts ||
    []) as OfficialArtifact[];
  const workflows = (bundle.complianceWorkflowRegistry?.workflows ||
    []) as ComplianceWorkflow[];
  const complianceTools = (bundle.complianceToolRegistry?.tools ||
    []) as ComplianceTool[];
  const fedrampTransition =
    bundle.fedrampTransitionIndex as FedrampTransitionIndex | undefined;
  const selectedWorkflow =
    workflows.find(
      (workflow) => workflow.workflow_id === state.task,
    ) || null;
  const documentBrowser = state.buildSection === "documents";
  const buildOverview = state.buildSection === "overview";
  const workflowArtifacts = selectedWorkflow
    ? officialArtifacts.filter((artifact) =>
        selectedWorkflow.artifact_ids?.includes(artifact.artifact_id),
      )
    : officialArtifacts;
  const workflowTools = selectedWorkflow
    ? complianceTools.filter((tool) =>
        selectedWorkflow.tool_ids?.includes(tool.tool_id),
      )
    : complianceTools;
  const officialArtifactPool = showCompleteOfficialCatalog
    ? officialArtifacts
    : workflowArtifacts;
  const visibleOfficialArtifacts = showAllOfficialResources
    ? officialArtifactPool
    : officialArtifactPool.slice(0, 8);
  const visibleTools = showAllTools ? workflowTools : workflowTools.slice(0, 8);
  // Commons folded in (W4): every non-tool Commons resource, grouped by kind,
  // as the third peer section alongside official resources and tools above.
  // Tool-type Commons resources are excluded — they already surface in the
  // Tools section so the same resource does not appear twice.
  const communityResources = (bundle.commonsDataset?.resources || []).filter(
    (resource) => resource.resourceType !== "tool",
  );
  const communityResourceGroups = groupResourcesByKind(communityResources).map(
    (group: { id: string; label: string; blurb: string; resources: typeof communityResources }) => ({
      ...group,
      resources: group.resources.slice(0, 3),
    }),
  );
  const workflowReferenceIds = new Set([
    ...(selectedWorkflow?.artifact_ids || []),
    ...(selectedWorkflow?.tool_ids || []),
  ]);
  // A workflow names its own companions in `companion_template_ids`. Trust
  // that first: matching on shared official resources instead returned nine
  // loosely-related documents for "Create or update a POA&M" — none of them
  // the POA&M — which is how a stated intent turned into a search problem.
  const declaredCompanions = selectedWorkflow
    ? templates.filter((template) =>
        (selectedWorkflow.companion_template_ids || []).includes(
          template.template_id,
        ),
      )
    : [];
  const relatedByResource = selectedWorkflow
    ? templates.filter((template) =>
        template.official_resource_ids?.some((id) =>
          workflowReferenceIds.has(id),
        ),
      )
    : templates;
  const companionPool = !selectedWorkflow
    ? templates
    : declaredCompanions.length > 0
      ? declaredCompanions
      : relatedByResource.length > 0
        ? relatedByResource
        : templates;
  // Searching and filtering a set you can already see is busywork.
  const showCompanionFilters = companionPool.length > 4;
  // Anything the task does not declare stays reachable behind one disclosure.
  // Two templates (Hardware/Software Baseline) are declared by no workflow at
  // all, so without this they would be unreachable whenever a task is picked.
  const otherTemplates = selectedWorkflow
    ? templates.filter(
        (template) =>
          !companionPool.some((inPool) => inPool.name === template.name),
      )
    : [];
  const filteredTemplates = useMemo(
    () =>
      filterByCategoryAndQuery(
        companionPool,
        TEMPLATE_CATEGORIES,
        (template: any) => template.name,
        (template: any) =>
          `${template.display_name} ${template.description} ${template.name}`,
        { category: categoryFilter, query: queryFilter },
      ),
    [categoryFilter, queryFilter, companionPool],
  );
  const groupedTemplates = useMemo(
    () =>
      groupItemsByCategory(
        filteredTemplates,
        TEMPLATE_CATEGORIES,
        (template: any) => template.name,
      ),
    [filteredTemplates],
  );
  const selectedTemplate =
    templates.find((template) => template.name === state.templateType) || null;
  const selectedTemplateArtifactIds = selectedTemplate
    ? [
        ...(selectedTemplate.official_artifact_ids || []),
        ...(selectedTemplate.official_resource_ids || []),
      ]
    : [];
  const selectedTemplateArtifacts = selectedTemplate
    ? officialArtifacts.filter((artifact) => {
        if (selectedTemplateArtifactIds.includes(artifact.artifact_id)) {
          return true;
        }
        return (
          selectedTemplateArtifactIds.length === 0 &&
          normalizedFamily(artifact.artifact_family) ===
            normalizedFamily(selectedTemplate.artifact_type)
        );
      })
    : [];
  const selectedTemplateTools = selectedTemplate
    ? complianceTools.filter((tool) => {
        if (
          selectedTemplate.related_tool_ids?.includes(tool.tool_id) ||
          selectedTemplateArtifactIds.includes(tool.tool_id)
        ) {
          return true;
        }
        const family = normalizedFamily(selectedTemplate.artifact_type);
        return Boolean(
          family &&
            tool.artifact_families?.some(
              (toolFamily) => normalizedFamily(toolFamily) === family,
            ),
        );
      })
    : [];
  const buildContextIds = new Set(
    BUILD_SOURCE_CONTEXTS.map((context) => context.id),
  );
  const catalogOptions = bundle.runtime
    .getCatalogs()
    .filter((catalog: any) => buildContextIds.has(catalog.id))
    .map((catalog: any) => ({ value: catalog.id, label: catalog.name }));
  // The registry is the source of truth: every visible download is a polished
  // Word or Excel document, never a raw serialization format.
  const supportedFormats = selectedTemplate?.supported_formats || ["docx"];
  const activeFormat = supportedFormats.includes(state.format || "")
    ? state.format || supportedFormats[0]
    : supportedFormats[0];

  const inputOptions = selectedTemplate?.input_options || [];
  const datasetNodes = (bundle.runtime.dataset?.nodes || []) as any[];
  const datasetSources = (bundle.runtime.dataset?.sources || []) as any[];
  const activeFramework = state.framework || "";

  // A baseline is an applicability selection under the chosen catalog or
  // program context, never a peer context and never a tree parent.
  const baselineCatalog = baselineCatalogForBuildContext(activeFramework);
  const baselineOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const node of datasetNodes) {
      if (node.node_type !== "baseline") continue;
      if (node.metadata?.catalog_id !== baselineCatalog) continue;
      const id = String(node.metadata?.item_id || "").toUpperCase();
      if (id && !seen.has(id)) {
        seen.set(id, BASELINE_LABELS[id] || node.metadata?.title || id);
      }
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, label]) => ({ value, label }));
  }, [datasetNodes, baselineCatalog]);

  const familyOptions = useMemo(() => {
    const families = new Set<string>();
    for (const node of datasetNodes) {
      if (node.node_type !== "control") continue;
      if (node.metadata?.catalog_id !== activeFramework) continue;
      const family = node.metadata?.family || node.metadata?.control_family;
      if (family) families.add(family);
    }
    return [...families]
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ value: family, label: family }));
  }, [datasetNodes, activeFramework]);

  const primarySourceRef = selectedTemplate?.source_refs?.[0];
  const catalogSource = primarySourceRef
    ? datasetSources.find((source) => source.id === primarySourceRef)
    : null;

  // The on-screen preview and downloaded files use this exact structured
  // document, so a practitioner can review real headings, prompts, and rows
  // before starting a download.
  const generationSnapshot = useMemo(() => {
    if (!selectedTemplate) return null;
    return buildTemplateGenerationSnapshot({
      template: selectedTemplate,
      routeState: {
        framework: state.framework || "",
        baseline: state.baseline || "",
        controlFamily: state.controlFamily || "",
        environment: state.environment || "",
        format: activeFormat,
      },
      selectionOptions: {
        framework: BUILD_SOURCE_CONTEXTS.map((context) => context.id),
        baseline: ["ALL", ...baselineOptions.map((option) => option.value)],
        control_family: familyOptions.map((option) => option.value),
      },
    });
  }, [
    activeFormat,
    baselineOptions,
    familyOptions,
    selectedTemplate,
    state.baseline,
    state.controlFamily,
    state.environment,
    state.framework,
  ]);
  const selectedFrameworkSourceId = activeFramework
    ? datasetNodes.find(
        (node) => node.metadata?.catalog_id === activeFramework,
      )?.source_id
    : "";
  const generationOptions = useMemo(() => {
    if (!selectedTemplate || !generationSnapshot?.validation.valid) return null;
    const sourceRefs = [
      selectedFrameworkSourceId,
      ...(selectedTemplate.source_refs || []),
    ].filter(
      (sourceId, index, values) =>
        sourceId && values.indexOf(sourceId) === index,
    );
    return {
      ...generationSnapshot.options,
      includePlaceholders: true,
      includeImplementationPrompts: true,
      includeEvidenceExpectations: true,
      includeInheritancePrompts: true,
      includeReciprocityPrompts: true,
      includeSourceFootnotes: true,
      includeStigReferences: true,
      sourceRefs,
      sources: bundle.runtime.dataset?.sources || [],
    };
  }, [
    bundle.runtime.dataset?.sources,
    generationSnapshot,
    selectedFrameworkSourceId,
    selectedTemplate,
  ]);
  const generationResult = useMemo(() => {
    if (!generationOptions) return { preview: null, error: "" };
    try {
      return {
        preview: buildTemplateDocument(generationOptions, bundle.runtime.dataset),
        error: "",
      };
    } catch (error) {
      return {
        preview: null,
        error:
          error instanceof Error
            ? error.message
            : "The document could not be prepared.",
      };
    }
  }, [bundle.runtime.dataset, generationOptions]);
  const documentPreview = generationResult.preview;
  const generationState = generationSnapshot
    ? resolveTemplateGenerationState(generationSnapshot, generationResult)
    : null;

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (generationRef.current) {
      scrollElementBelowHeader(
        generationRef.current,
        reducedMotion ? "auto" : "smooth",
      );
    }
    generateButtonRef.current?.focus();
  }, [selectedTemplate?.name]);

  async function createTemplate() {
    if (!selectedTemplate || generating) {
      return;
    }
    setGenerating(true);
    setGenerationStatus("");
    let downloadDispatched = false;
    const confirmDownload = (filename: string) => {
      downloadDispatched = true;
      setGenerationTone("trust");
      setGenerationStatus(
        `Download started for ${filename}. Check your downloads folder.`,
      );
    };
    try {
      if (!documentPreview || !generationState?.downloadEnabled) {
        setGenerationTone("warning");
        setGenerationStatus(
          generationState?.status ||
            "The document preview could not be prepared. Review the selected options and try again.",
        );
        return;
      }
      const { doc } = documentPreview;
      // Serializers are loaded only when a user asks to create a document;
      // nothing is uploaded or generated server-side.
      const { renderOfficeDocument } =
        await import("../../app/office-export.mjs");
      const rendered = renderOfficeDocument(
        doc,
        activeFormat as "xlsx" | "docx",
      );
      const filename = templateFilename(selectedTemplate.name, rendered.extension);
      downloadBlobFile(
        filename,
        new Blob([new Uint8Array(rendered.bytes)], { type: rendered.mimeType }),
        () => confirmDownload(filename),
      );
    } catch {
      setGenerationTone("warning");
      setGenerationStatus("The document could not be prepared in this browser. Try again or choose another format.");
    } finally {
      if (downloadDispatched) {
        // Keep the button briefly disabled after a real download so a rapid
        // double-click can't fire a second identical generate (CATL-67).
        window.setTimeout(() => setGenerating(false), 1200);
      } else {
        setGenerating(false);
      }
    }
  }

  return (
    <div className="templates-page ca-mission-page" data-visual-identity="staged-production-workflow">
      {!buildOverview ? (
        <BuildLocalNav
          active={documentBrowser || selectedTemplate ? "documents" : "tasks"}
          onNavigate={onNavigate}
        />
      ) : null}
      <PageHeader
        primary
        action={
          selectedTemplate ? (
            <AppLink onNavigate={onNavigate} patch={{ templateType: "" }} variant="secondary" view="templates">
              Back to starter documents
            </AppLink>
          ) : undefined
        }
        eyebrow={
          buildOverview
            ? "DOCUMENT WORKFLOWS / 3 PRODUCTION LANES"
            : selectedTemplate
              ? "STARTER DOCUMENT / CONFIGURE"
              : documentBrowser
                ? `STARTER DOCUMENTS / ${templates.length} AVAILABLE`
                : `TASK WORKFLOWS / ${workflows.length} TASKS`
        }
        summary={buildOverview
          ? SITE_COPY.routes.documents.purpose
          : selectedTemplate
            ? selectedTemplate.description
            : documentBrowser
              ? "Choose what you need to produce, configure parameters, and download starter files."
              : "Pick a task to see its public references and starter documents."}
        title={
          buildOverview
            ? "Documents"
            : selectedTemplate
              ? selectedTemplate.display_name
              : documentBrowser
                ? "Documents"
                : "Tasks"
        }
      />

      {buildOverview ? (
        <section aria-label="Build lanes" className="build-lane-grid">
          {BUILD_LANES.map((lane) => {
            const Icon =
              lane.id === "tasks"
                ? IconCompass
                : lane.id === "documents"
                  ? IconFileDescription
                  : IconExternalLink;
            return (
              <QuickIntentCard
                actionLabel={`Open ${lane.label}`}
                body={lane.description}
                icon={<Icon aria-hidden="true" size={22} stroke={1.8} />}
                key={lane.id}
                onNavigate={onNavigate}
                patch={lane.id === "resources" ? undefined : { buildSection: lane.id, task: "", templateType: "" }}
                title={lane.label}
                view={lane.id === "resources" ? "commons" : "templates"}
              />
            );
          })}
        </section>
      ) : null}

      {!selectedTemplate && !buildOverview ? (
        <div className="stack">
          {!selectedWorkflow && !documentBrowser ? (
          <div className="build-start-layout">
          <section aria-labelledby="workflow-heading" className="nexus-section">
            <div className="section-header nexus-section-header">
              <div>
                <p className="eyebrow">Task workflows</p>
                <h2 id="workflow-heading">Tasks by outcome</h2>
                <p className="page-summary">
                  Each task groups related public sources, starter documents,
                  and external tools.
                </p>
              </div>
            </div>
            <div className="intent-grid template-featured-tasks">
              {workflows.slice(0, 4).map((workflow) => (
                <QuickIntentCard
                  key={workflow.workflow_id}
                  title={workflow.title}
                  body={workflow.summary}
                  icon={<IconCompass aria-hidden="true" size={20} stroke={1.8} />}
                  actionLabel="Open task"
                  selected={state.task === workflow.workflow_id}
                  onNavigate={onNavigate}
                  onBeforeNavigate={() => {
                    setShowAllOfficialResources(false);
                    setShowCompleteOfficialCatalog(false);
                    setShowAllTools(false);
                    window.setTimeout(
                      () => workflowDetailRef.current?.focus(),
                      0,
                    );
                  }}
                  patch={{ buildSection: "tasks", task: workflow.workflow_id, templateType: "" }}
                  view="templates"
                />
              ))}
            </div>
            {workflows.length > 4 ? (
              <details className="other-templates template-more-tasks">
                <summary>More document tasks ({workflows.length - 4})</summary>
            <div className="intent-grid">
                  {workflows.slice(4).map((workflow) => (
                    <QuickIntentCard
                      key={workflow.workflow_id}
                      title={workflow.title}
                      body={workflow.summary}
                      icon={<IconCompass aria-hidden="true" size={20} stroke={1.8} />}
                      actionLabel="Open task"
                      selected={state.task === workflow.workflow_id}
                      onNavigate={onNavigate}
                      onBeforeNavigate={() => {
                        setShowAllOfficialResources(false);
                        setShowCompleteOfficialCatalog(false);
                        setShowAllTools(false);
                        window.setTimeout(
                          () => workflowDetailRef.current?.focus(),
                          0,
                        );
                      }}
                      patch={{ buildSection: "tasks", task: workflow.workflow_id, templateType: "" }}
                      view="templates"
                    />
                  ))}
                </div>
              </details>
            ) : null}
            {workflows.length === 0 ? (
              <div className="notice" role="status">
                <p>
                  Workflow guidance is temporarily unavailable. Official
                  resources and starter documents remain available below.
                </p>
              </div>
            ) : null}
          </section>
            <aside aria-labelledby="optional-resources-heading" className="build-resource-rail">
              <div className="section-header nexus-section-header">
                <div>
                  <p className="eyebrow">Optional reference</p>
                  <h2 id="optional-resources-heading">Related resources</h2>
                  <p className="page-summary">
                    These external references remain available independently of any task.
                  </p>
                </div>
              </div>
              <ContextualCommonsModule
                bundle={bundle}
                contextType="template"
                onNavigate={onNavigate}
                title="Optional reference material"
              />
            </aside>
          </div>
          ) : null}

          {selectedWorkflow ? (
            <section
              aria-labelledby="selected-workflow-heading"
              className="nexus-section workflow-detail"
              ref={workflowDetailRef}
              tabIndex={-1}
            >
              <div className="section-header nexus-section-header">
                <div>
                  <p className="eyebrow">Selected task</p>
                  <h2 id="selected-workflow-heading">
                    {selectedWorkflow.title}
                  </h2>
                  <p className="page-summary">{selectedWorkflow.summary}</p>
                </div>
                <AppLink onNavigate={onNavigate} patch={{ buildSection: "tasks", task: "", templateType: "" }} variant="secondary" view="templates">
                  Browse tasks
                </AppLink>
              </div>
              {/* The method — outcomes, steps, readiness — is reference, not a
                  gate. It used to sit between the user's stated intent and the
                  artifact they asked for, so choosing "Create a POA&M" meant
                  reading an essay before reaching anything buildable. */}
              <details className="workflow-method">
                <summary>Reference steps and handoff checks</summary>
              {selectedWorkflow.outcomes?.length ? (
                <SummaryCard title="Intended output">
                  <ul className="nexus-list">
                    {selectedWorkflow.outcomes.map((outcome) => (
                      <li key={outcome}>{outcome}</li>
                    ))}
                  </ul>
                </SummaryCard>
              ) : null}
              {selectedWorkflow.steps?.length ? (
                <ol className="workflow-steps">
                  {[...selectedWorkflow.steps]
                    .sort((a, b) => a.order - b.order)
                    .map((step) => (
                      <li key={`${step.order}-${step.title}`}>
                        <span
                          aria-hidden="true"
                          className="workflow-step-number"
                        >
                          {step.order}
                        </span>
                        <div>
                          <h3>{step.title}</h3>
                          <p>{step.action}</p>
                          {step.completion_signal ? (
                            <p className="support-meta">
                              Handoff check: {step.completion_signal}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                </ol>
              ) : null}
              {selectedWorkflow.readiness_checks?.length ? (
                <SummaryCard title="Handoff checks" tone="trust">
                  <ul className="nexus-list">
                    {selectedWorkflow.readiness_checks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                </SummaryCard>
              ) : null}
              </details>
              {selectedWorkflow.boundary_note ? (
                <p className="nexus-limitation">
                  <IconShieldCheck
                    aria-hidden="true"
                    size={17}
                    stroke={1.8}
                  />
                  {selectedWorkflow.boundary_note}
                </p>
              ) : null}
            </section>
          ) : null}

          {selectedWorkflow || documentBrowser ? (
            <>
          <section
            aria-labelledby="companion-heading"
            className="nexus-section"
            id="companion-templates"
          >
            <div className="section-header nexus-section-header">
              <div>
                <h2 id="companion-heading">
                  {selectedWorkflow && declaredCompanions.length === 1
                    ? `Create ${declaredCompanions[0].display_name}`
                    : "Starter documents"}
                </h2>
                <p className="page-summary">
                  Start with the basic structure and prompts already in place.
                </p>
                <p className="template-document-preview-disclaimer">
                  {STARTER_DOCUMENT_REVIEW_NOTICE}
                </p>
              </div>
            </div>
            {showCompanionFilters ? (
              <CatalogFilterBar
                category={categoryFilter}
                categoryOptions={Object.keys(TEMPLATE_CATEGORIES)}
                countLabel={`${filteredTemplates.length} starter document${filteredTemplates.length === 1 ? "" : "s"}${selectedWorkflow ? " connected to this task" : ""} in ${groupedTemplates.size} categor${groupedTemplates.size === 1 ? "y" : "ies"}`}
                onCategoryChange={(category) =>
                  onNavigate("templates", { ...state, category })
                }
                onQueryChange={(query) =>
                  onNavigate("templates", { ...state, query })
                }
                query={queryFilter}
                queryPlaceholder="Search starter documents by name or purpose"
              />
            ) : null}

            {[...groupedTemplates.entries()].map(
              ([category, categoryTemplates]) => (
                <section className="catalog-group" key={category}>
                  <h3 className="catalog-group-title">{category}</h3>
                  <div className="intent-grid">
                    {categoryTemplates.map((template: TemplateRecord) => (
                      <QuickIntentCard
                        actionLabel="Open document"
                        body={template.description}
                        icon={<IconFileDescription size={20} stroke={1.8} />}
                        key={template.name}
                        onNavigate={onNavigate}
                        patch={{ buildSection: "documents", task: "", templateType: template.name, framework: state.framework || "", format: template.supported_formats?.[0] || "docx", environment: state.environment || "", baseline: "", controlFamily: "" }}
                        title={template.display_name}
                        view="templates"
                      />
                    ))}
                  </div>
                </section>
              ),
            )}

            {otherTemplates.length ? (
              <details className="other-templates">
                <summary>
                  Other starter documents ({otherTemplates.length})
                </summary>
                <div className="intent-grid">
                  {otherTemplates.map((template: TemplateRecord) => (
                    <QuickIntentCard
                      actionLabel="Open document"
                      body={template.description}
                      icon={<IconFileDescription size={20} stroke={1.8} />}
                      key={template.name}
                      onNavigate={onNavigate}
                      patch={{ buildSection: "documents", task: "", templateType: template.name, framework: state.framework || "", format: template.supported_formats?.[0] || "docx", environment: state.environment || "", baseline: "", controlFamily: "" }}
                      title={template.display_name}
                      view="templates"
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </section>
          <details className="workflow-reference">
            <summary>{selectedWorkflow ? "Official sources, tools, and resources for this task" : "Official sources, tools, and related resources"}</summary>
            <div className="stack disclosure-content">
          <section aria-labelledby="official-heading" className="nexus-section">
            <div className="section-header nexus-section-header">
              <div>
                <p className="eyebrow">Published sources</p>
                <h2 id="official-heading">
                  {selectedWorkflow
                    ? `Official resources for ${selectedWorkflow.title}`
                    : "Official federal resources"}
                </h2>
                <p className="page-summary">
                  Publisher material and lifecycle labels are shown together.
                  Current, legacy, and guidance-only items remain distinct.
                </p>
              </div>
            </div>
            <FedrampCurrentTruthPanel transition={fedrampTransition} />
            <Button
              variant="secondary"
              className="nexus-show-more"
              onClick={() => {
                setShowCompleteOfficialCatalog((value) => !value);
                setShowAllOfficialResources(false);
              }}
            >
              {showCompleteOfficialCatalog
                ? "Show resources for this task"
                : "Browse complete official catalog"}
            </Button>
            <div className="nexus-grid">
              {visibleOfficialArtifacts.map((artifact) => (
                <OfficialArtifactCard
                  artifact={artifact}
                  fedrampTransition={fedrampTransition}
                  key={artifact.artifact_id}
                />
              ))}
            </div>
            {workflowArtifacts.length === 0 ? (
              <div className="notice" role="status">
                <p>
                  No source is linked to this task yet. You can still browse the
                  full source list and starter documents.
                </p>
              </div>
            ) : null}
            {officialArtifactPool.length > 8 ? (
              <Button
                variant="secondary"
                className="nexus-show-more"
                onClick={() => setShowAllOfficialResources((value) => !value)}
              >
                {showAllOfficialResources
                  ? "Show fewer official resources"
                  : `Show all ${officialArtifactPool.length} official resources`}
              </Button>
            ) : null}
          </section>

          <section aria-labelledby="tools-heading" className="nexus-section">
            <div className="section-header nexus-section-header">
              <div>
                <p className="eyebrow">Working tools</p>
                <h2 id="tools-heading">
                  {selectedWorkflow
                    ? "Tools for this workflow"
                    : "Federal and open-source tools"}
                </h2>
                <p className="page-summary">
                  See each tool's owner, inputs, outputs, and access
                  requirements.
                </p>
              </div>
            </div>
            <div className="nexus-grid">
              {visibleTools.map((tool) => (
                <ToolCard key={tool.tool_id} tool={tool} />
              ))}
            </div>
            {workflowTools.length === 0 ? (
              <div className="notice" role="status">
                <p>
                  No tool is linked to this step yet. You can still use the
                  official resources and starter documents.
                </p>
              </div>
            ) : null}
            {workflowTools.length > 8 ? (
              <Button
                variant="secondary"
                className="nexus-show-more"
                onClick={() => setShowAllTools((value) => !value)}
              >
                {showAllTools
                  ? "Show fewer tools"
                  : `Show all ${workflowTools.length} tools`}
              </Button>
            ) : null}
          </section>

          <section aria-labelledby="community-heading" className="nexus-section">
            <div className="section-header nexus-section-header">
              <div>
                <p className="eyebrow">External resources</p>
                <h2 id="community-heading">Training and communities</h2>
                <p className="page-summary">
                  Training, communities, and other external material, grouped
                  by type and linked to its owner.
                </p>
              </div>
            </div>
            {communityResourceGroups.length === 0 ? (
              <div className="notice" role="status">
                <p>No resources are loaded yet.</p>
              </div>
            ) : (
              <>
                {communityResourceGroups.map((group) => (
                  <div className="commons-group" key={group.id}>
                    <div className="commons-group-header">
                      <h3 className="commons-group-title">{group.label}</h3>
                      <span className="commons-group-count">
                        {group.resources.length}
                      </span>
                    </div>
                    <p className="commons-group-blurb">{group.blurb}</p>
                    <div className="nexus-grid">
                      {group.resources.map((resource) => (
                        <CommonsResourceCard
                          key={resource.id}
                          onNavigate={onNavigate}
                          resource={resource}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <AppLink
                  className="nexus-show-more"
                  onNavigate={onNavigate}
                  variant="secondary"
                  view="commons"
                >
                  Browse all {communityResources.length} resources
                </AppLink>
              </>
            )}
          </section>
            </div>
          </details>

            </>
          ) : null}
        </div>
      ) : null}

      {selectedTemplate ? (
        <section className="stack header-offset-target" ref={generationRef}>
          <div className="section-header">
            <div>
              <p className="eyebrow">Starter document</p>
              <h2>{selectedTemplate.display_name}</h2>
            </div>
            <Badge
              tone={compatibilityTone(
                selectedTemplate.compatibility?.classification ||
                  selectedTemplate.compatibility_level,
              )}
            >
              {compatibilityLabel(
                selectedTemplate.compatibility?.classification ||
                  selectedTemplate.compatibility_level,
              )}
            </Badge>
          </div>

          <nav aria-label="Step progress" className="progress-trajectory progress-trajectory--step-2">
            <div className="step done">01 / Choose document</div>
            <div className="step active">02 / Configure inputs</div>
            <div className="step">03 / Preview &amp; download</div>
          </nav>

          <section aria-label="Document configuration" className="template-flow-grid">
            <article className="panel template-inputs-panel">
              <span className="label">02 / INPUTS</span>
              <h3 className="template-step-title">Configure parameters</h3>
              <p className="template-step-desc">
                Select the catalog scope and target parameters for this document.
              </p>
              <div className="form-grid template-essential-options">
                {inputOptions.includes("framework") ? (
                  <div className="field full">
                    <SelectField
                      emptyLabel="Select a catalog or program"
                      hint="Which control catalog the starter document should reference."
                      label="Catalog or program"
                      onChange={(value) =>
                        onNavigate("templates", {
                          framework: value,
                          baseline: "",
                          controlFamily: "",
                        })
                      }
                      options={catalogOptions}
                      value={state.framework || ""}
                    />
                  </div>
                ) : null}
                {inputOptions.includes("baseline") ? (
                  <div className="field full">
                    <SelectField
                      emptyLabel="Select a baseline"
                      hint="Required. Choose a published baseline or All controls."
                      label="Baseline"
                      onChange={(value) =>
                        onNavigate("templates", {
                          baseline: value,
                        })
                      }
                      options={[
                        { value: "ALL", label: "All controls" },
                        ...baselineOptions,
                      ]}
                      value={state.baseline || ""}
                    />
                  </div>
                ) : null}
                {inputOptions.includes("environment_archetype") ? (
                  <div className="field full">
                    <SelectField
                      emptyLabel="Not selected"
                      hint="Where the system runs — cloud, on-premises, or hybrid."
                      label="Environment"
                      onChange={(value) => onNavigate("templates", { environment: value })}
                      options={[
                        { value: "Generic", label: "Generic" },
                        { value: "Cloud SaaS", label: "Cloud SaaS" },
                        { value: "Platform service", label: "Platform service" },
                        { value: "Enclave", label: "Enclave" },
                        { value: "On-premises", label: "On-premises" },
                        { value: "Hybrid", label: "Hybrid" },
                        { value: "Enterprise service", label: "Enterprise service" },
                      ]}
                      value={state.environment || ""}
                    />
                  </div>
                ) : null}
                {inputOptions.includes("control_family") ? (
                  <div className="field full">
                    <SelectField
                      emptyLabel="All families"
                      hint="Limit to one control family (e.g. Access Control)."
                      label="Control family"
                      onChange={(value) =>
                        onNavigate("templates", {
                          controlFamily: value,
                        })
                      }
                      options={familyOptions}
                      value={state.controlFamily || ""}
                    />
                  </div>
                ) : null}
              </div>
            </article>

            <aside aria-label="Preserved context" className="panel route-preview surface-blueprint template-context-panel">
              <span className="label">SELECTED CONTEXT</span>
              <div className="system-stat" style={{ marginTop: 8 }}>
                <span>Document</span>
                <strong>{selectedTemplate.display_name}</strong>
              </div>
              {catalogSource ? (
                <div className="system-stat">
                  <span>Source publication</span>
                  <strong>
                    {catalogSource.display_name || catalogSource.name}
                    {catalogSource.version ? ` (v${catalogSource.version})` : ""}
                  </strong>
                </div>
              ) : activeFramework ? (
                <div className="system-stat">
                  <span>Source publication</span>
                  <strong>
                    {catalogOptions.find((c: any) => c.value === activeFramework)?.label || activeFramework}
                  </strong>
                </div>
              ) : (
                <div className="system-stat">
                  <span>Source publication</span>
                  <strong style={{ color: "var(--ca-text-muted)" }}>Select a catalog</strong>
                </div>
              )}
              <div className="system-stat">
                <span>Format</span>
                <strong>{FORMAT_LABELS[activeFormat] || activeFormat}</strong>
              </div>

              <div className="template-format-field" style={{ marginTop: 12 }}>
                <SelectField
                  hint={FORMAT_HELP[activeFormat] || "File type for the downloaded template."}
                  label="Download format"
                  onChange={(value) => onNavigate("templates", { format: value })}
                  options={supportedFormats.map((format: string) => ({
                    value: format,
                    label: FORMAT_LABELS[format] || format,
                  }))}
                  value={activeFormat}
                />
              </div>

              {selectedTemplate.compatibility?.classification || selectedTemplate.compatibility_level ? (
                <div className="system-stat" style={{ marginTop: 8 }}>
                  <span>Compatibility</span>
                  <strong>
                    {compatibilityLabel(
                      selectedTemplate.compatibility?.classification ||
                        selectedTemplate.compatibility_level,
                    )}
                  </strong>
                </div>
              ) : null}

              {selectedTemplate.limitations?.length ? (
                <p className="nexus-limitation" style={{ marginTop: 12 }}>
                  <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
                  {selectedTemplate.limitations[0]}
                </p>
              ) : selectedTemplate.compatibility?.limitations ? (
                <p className="nexus-limitation" style={{ marginTop: 12 }}>
                  <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
                  {selectedTemplate.compatibility.limitations}
                </p>
              ) : null}
            </aside>
          </section>

          <section aria-labelledby="document-preview-heading-wrapper" className="template-preview-section">
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div>
                <p className="eyebrow">03 / PREVIEW &amp; DOWNLOAD</p>
                <h3 id="document-preview-heading-wrapper" className="template-step-title">
                  Document preview
                </h3>
              </div>
            </div>
            {documentPreview?.doc && generationState?.previewAvailable ? (
              <TemplateDocumentPreview doc={documentPreview.doc} format={activeFormat} />
            ) : (
              <p className="generation-status tone-warning" role="status">
                {generationState?.status ||
                  "Select the required inputs before previewing or downloading."}
              </p>
            )}
            <div className="actions" style={{ marginTop: 20 }}>
              <Button
                variant="primary"
                disabled={generating || !generationState?.downloadEnabled}
                onClick={createTemplate}
                ref={generateButtonRef}
              >
                {generating
                  ? "Preparing download…"
                  : `Download ${selectedTemplate.display_name} (${FORMAT_LABELS[activeFormat] || activeFormat})`}
              </Button>
            </div>
            {generationStatus ? (
              <p className={`generation-status tone-${generationTone}`} role="status" style={{ marginTop: 12 }}>
                {generationStatus}
              </p>
            ) : null}
          </section>

          {selectedTemplateArtifacts.length > 0 ? (
            <details className="template-supporting-details" style={{ marginTop: 16 }}>
              <summary>Sources used by this document</summary>
              <section aria-labelledby="template-official-heading" className="stack disclosure-content">
                <div>
                  <p className="eyebrow">Published sources</p>
                  <h3 id="template-official-heading">Sources used by this document</h3>
                </div>
                <div className="nexus-grid">
                  {selectedTemplateArtifacts.map((artifact) => (
                    <OfficialArtifactCard
                      artifact={artifact}
                      fedrampTransition={fedrampTransition}
                      key={artifact.artifact_id}
                    />
                  ))}
                </div>
              </section>
            </details>
          ) : selectedTemplate.official_alternative ? (
            <SummaryCard title="Official resource">
              <p>
                Publisher material for this document:{" "}
                <a
                  href={selectedTemplate.official_alternative.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {selectedTemplate.official_alternative.label}
                  <IconExternalLink
                    aria-hidden="true"
                    size={14}
                    stroke={1.8}
                    style={{ verticalAlign: "text-bottom", marginLeft: 4 }}
                  />
                </a>
                .
              </p>
            </SummaryCard>
          ) : null}

          {activeFramework ? (
            <ContextualTaxonomyLinks
              catalogIds={[activeFramework]}
              contextLabel={selectedTemplate.display_name}
              onNavigate={onNavigate}
              runtime={bundle.runtime}
              subjectLabel="starter document"
            />
          ) : null}

          {selectedTemplateTools.length > 0 ? (
            <section aria-labelledby="template-tools-heading" className="stack" style={{ marginTop: 16 }}>
              <div>
                <p className="eyebrow">Related tooling</p>
                <h3 id="template-tools-heading">Tools that use this artifact family</h3>
              </div>
              <div className="nexus-grid">
                {selectedTemplateTools.map((tool) => (
                  <ToolCard key={tool.tool_id} tool={tool} />
                ))}
              </div>
            </section>
          ) : null}

          <Accordion.Root className="accordion-root" collapsible type="single">
            <DisclosurePanel title="More options" value="options">
              {supportedFormats.length > 1 ? (
                <ul className="format-help-list">
                  {supportedFormats.map((format: string) => (
                    <li key={format}>
                      <strong>{FORMAT_LABELS[format] || format}:</strong>{" "}
                      {FORMAT_HELP[format] || "Downloadable file format."}
                    </li>
                  ))}
                </ul>
              ) : null}
            </DisclosurePanel>
          </Accordion.Root>
        </section>
      ) : null}
    </div>
  );
}
