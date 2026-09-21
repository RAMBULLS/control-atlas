import * as Accordion from "@radix-ui/react-accordion";
import {
  IconCompass,
  IconExternalLink,
  IconFileDescription,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SITE_COPY } from "../../shared/site-copy.mjs";

import {
  CROSS_REF_TEMPLATES,
  buildTemplateDocument,
  getControlCrossRefIndex,
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
import { BuildLocalNav } from "../components/BuildLocalNav";
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
  Field,
  MissionPage,
  PageHeader,
  ScrollableRegion,
  SelectField,
  StepIndicator,
  SummaryCard,
  downloadBlobFile,
  scrollElementBelowHeader,
} from "../lib/pagePrimitives";
import { Button, ButtonLink } from "../components/lsm";
import { AppLink } from "../components/AppLink";
import { AtlasTag } from "../components/AtlasTag";
import { taxonomyTagsForTemplate } from "../../shared/record-taxonomy.mjs";

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
  usage?: { use_for: string; not_for: string };
  provenance?: { basis?: string; verified_interchange?: boolean };
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
  if (normalized === "official_current" || normalized === "verified_interchange") {
    return "success" as const;
  }
  if (normalized === "official_legacy" || normalized.includes("unverified")) {
    return "warning" as const;
  }
  if (
    normalized === "official_guidance" ||
    normalized === "schema_aligned" ||
    normalized === "field_aligned"
  ) {
    return "info" as const;
  }
  return "default" as const;
}

function compatibilityLabel(value?: string) {
  if (value && /[A-Z ]/.test(value)) return value;
  return value
    ? COMPATIBILITY_LABELS[value] || value.replaceAll("_", " ")
    : "Template";
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


const FORMAT_LABELS: Record<string, string> = {
  xlsx: "Excel (.xlsx)",
  docx: "Word (.docx)",
};

const FORMAT_SHORT: Record<string, string> = {
  xlsx: "Excel",
  docx: "Word",
};

const FORMAT_HELP: Record<string, string> = {
  xlsx: "Excel workbook - an editable working register with print-ready sheets.",
  docx: "Word document - a branded starter narrative with headings and working tables.",
};

function TemplateMetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-[6px] py-[2px] rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--ca-surface-raised)] border border-[var(--ca-border-strong)] text-[var(--ca-text-muted)]">
      {children}
    </span>
  );
}

const TEMPLATE_TAG_PRIORITY = ["tool", "framework", "program"];

function templateMeta(template: TemplateRecord, onNavigate?: (view: ViewState["view"], patch?: Partial<ViewState>) => void) {
  const formats = template.supported_formats || ["docx"];
  const basis = compatibilityLabel(template.compatibility?.classification || template.compatibility_level);
  const tagIds = onNavigate
    ? TEMPLATE_TAG_PRIORITY.flatMap((dim) =>
        taxonomyTagsForTemplate(template)
          .filter((t: { kind?: string }) => t.kind === dim)
          .map((t: { id: string }) => t.id),
      ).slice(0, 2)
    : [];
  return (
    <>
      {formats.map((f) => <TemplateMetaChip key={f}>{FORMAT_SHORT[f] || f.toUpperCase()}</TemplateMetaChip>)}
      {basis && basis !== "Template" ? <TemplateMetaChip>{basis}</TemplateMetaChip> : null}
      {tagIds.map((tagId) => <AtlasTag key={tagId} onNavigate={onNavigate!} showIdentity size="sm" tagId={tagId} />)}
    </>
  );
}

function templateDetails(template: TemplateRecord) {
  const inputCount = template.required_input_options?.length || 0;
  const formats = template.supported_formats || ["docx"];
  const output = formats.length === 1
    ? FORMAT_HELP[formats[0]] || `${FORMAT_LABELS[formats[0]] || formats[0]} file`
    : `${formats.length} editable download formats`;
  return (
    <>
      {template.usage ? (
        <>
          <span><strong>Use it to:</strong> {template.usage.use_for}</span>
          <span><strong>Not a replacement for:</strong> {template.usage.not_for}</span>
        </>
      ) : null}
      <span><strong>Setup:</strong> {inputCount ? `${inputCount} required input${inputCount === 1 ? "" : "s"}` : "no required inputs"}</span>
      <span><strong>Output:</strong> {output}</span>
    </>
  );
}

function TemplateDocumentPreview({ doc, format }: { doc: any; format: string }) {
  const sections = doc.sections || [];
  const tableSections = sections.filter((section: any) => section.type === "table");
  const representativeTable = tableSections.find((section: any) => section.rows?.length) || tableSections[0];
  const totalRows = tableSections.reduce((sum: number, section: any) => sum + (section.rows?.length || 0), 0);
  const visibleHeaders = representativeTable?.headers?.slice(0, 4) || [];
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
        {/* The header already labels this a template and the preview shows
            the inputs and sources, so the sentence saying both was pure
            restatement. The review notice is a dated evidence boundary and
            stays until that review completes. */}
        <p className="template-document-preview-disclaimer">
          {STARTER_DOCUMENT_REVIEW_NOTICE}
        </p>
        <dl className="template-document-preview-summary">
          <div><dt>Sections</dt><dd>{sections.length}</dd></div>
          <div><dt>Working tables</dt><dd>{tableSections.length}</dd></div>
          <div><dt>Prepared rows</dt><dd>{totalRows}</dd></div>
        </dl>
        <section className="template-document-preview-section">
          <h4>Inside this file</h4>
          <ol className="template-document-preview-outline">
            {sections.map((section: any) => (
              <li key={section.heading}>
                <span>{section.heading}</span>
                <small>{section.type === "table" ? `${section.rows?.length || 0} prepared row${section.rows?.length === 1 ? "" : "s"}` : "Guidance or narrative section"}</small>
              </li>
            ))}
          </ol>
        </section>
        {representativeTable ? (
          <section className="template-document-preview-section">
            <h4>Representative table: {representativeTable.heading}</h4>
            <p>This sample shows the working structure. The downloaded file contains every section, column, and prepared row listed above.</p>
            <ScrollableRegion
              className="template-document-preview-table-wrap"
              label={`${representativeTable.heading} sample table, scrolls horizontally`}
            >
              <table>
                <thead><tr>{visibleHeaders.map((header: string) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>
                  {(representativeTable.rows || []).slice(0, 3).map((row: any[], index: number) => (
                    <tr key={index}>{visibleHeaders.map((_: string, cellIndex: number) => <td key={cellIndex}>{row[cellIndex] || ""}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </ScrollableRegion>
            {(representativeTable.headers?.length || 0) > visibleHeaders.length ? (
              <p className="template-document-preview-more">The downloaded table includes {representativeTable.headers.length - visibleHeaders.length} additional columns.</p>
            ) : null}
          </section>
        ) : null}
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
  const documentSelectionMountedRef = useRef(false);
  const workflowDetailRef = useRef<HTMLElement | null>(null);
  const categoryFilter = state.category;
  const queryFilter = state.query;
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
  const fedrampTransition =
    bundle.fedrampTransitionIndex as FedrampTransitionIndex | undefined;
  const selectedWorkflow =
    workflows.find(
      (workflow) => workflow.workflow_id === state.task,
    ) || null;
  const documentBrowser = state.buildSection === "documents";
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
  // A template that lets the reader pick a program shows that program's own
  // resources only when it is picked. Without a program choice (hardware and
  // software baselines) every listed resource stays visible.
  const programChoiceOffered = Boolean(selectedTemplate?.input_options?.includes("framework"));
  const fedrampSelected = /^fedramp/i.test(state.framework || "");
  const selectedTemplateArtifacts = selectedTemplate
    ? officialArtifacts.filter((artifact) => {
        if (
          programChoiceOffered &&
          !fedrampSelected &&
          /^fedramp/i.test(artifact.artifact_id)
        ) {
          return false;
        }
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
  const documentFlowStep = !selectedTemplate
    ? 1
    : generationState?.downloadEnabled
      ? 3
      : 2;
  const controlSourceLabel = activeFramework
    ? catalogOptions.find((option) => option.value === activeFramework)?.label || activeFramework
    : "Select a catalog or program";
  // What the reader chose, in one line: for example
  // "SP 800-53 Rev. 5 · Moderate baseline".
  const selectedContextLabel =
    [
      activeFramework ? controlSourceLabel : "",
      state.baseline
        ? state.baseline === "ALL"
          ? "All controls"
          : `${BASELINE_LABELS[state.baseline] || state.baseline} baseline`
        : "",
      state.controlFamily,
      state.environment,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing selected yet";
  // What the file itself is built on. It comes from the template's own
  // provenance, never from the first entry of a source list, so an SP 800-53
  // file is not described as a FedRAMP template.
  const artifactBasisLabel = selectedTemplate?.provenance?.basis || "";

  // Build the control to CCI to STIG index while the reader is still choosing
  // options, so the preview does not wait for it. It is built once per loaded
  // dataset and reused for every later option change.
  useEffect(() => {
    const dataset = bundle.runtime.dataset;
    if (!dataset || !selectedTemplate || !CROSS_REF_TEMPLATES.includes(selectedTemplate.name)) {
      return undefined;
    }
    const timer = window.setTimeout(() => getControlCrossRefIndex(dataset), 100);
    return () => window.clearTimeout(timer);
  }, [bundle.runtime.dataset, selectedTemplate?.name]);

  useEffect(() => {
    if (!documentSelectionMountedRef.current) {
      documentSelectionMountedRef.current = true;
      return;
    }
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
    generationRef.current?.focus();
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
    <MissionPage
      className="flow-shell templates-page"
      data-visual-identity="staged-production-workflow"
      maxWidth="workspace"
    >
      <BuildLocalNav
        active={documentBrowser || selectedTemplate ? "documents" : "tasks"}
        onNavigate={onNavigate}
      />
      <PageHeader
        primary
        eyebrow={selectedTemplate ? `CURRENT DOCUMENT / ${selectedTemplate.display_name}` : undefined}
        action={
          selectedTemplate ? (
            <AppLink onNavigate={onNavigate} patch={{ templateType: "" }} variant="secondary" view="templates">
              Back to Templates
            </AppLink>
          ) : undefined
        }
        summary={
          documentBrowser || selectedTemplate
            ? SITE_COPY.routes.documents.purpose
            : "Pick a task to see its public references and templates."
        }
        title={
          documentBrowser || selectedTemplate
            ? SITE_COPY.routes.documents.title
            : "Tasks"
        }
      />

      {documentBrowser || selectedTemplate ? (
        <StepIndicator
          currentStep={documentFlowStep}
          steps={[
            { id: "choose", label: "Choose" },
            { id: "set-up", label: "Set up" },
            { id: "review", label: "Review & download" },
          ]}
        />
      ) : null}

      {!selectedTemplate ? (
        <div className="stack">
          {!selectedWorkflow && !documentBrowser ? (
          <section aria-labelledby="workflow-heading" className="nexus-section">
            <div className="section-header nexus-section-header">
              <div>
                <p className="eyebrow">Task workflows</p>
                <h2 id="workflow-heading">Tasks by outcome</h2>
                <p className="page-summary">
                  Each task groups related public sources, templates,
                  and external tools.
                </p>
              </div>
            </div>
            <div className="intent-grid template-featured-tasks">
              {workflows.map((workflow) => (
                <QuickIntentCard
                  key={workflow.workflow_id}
                  title={workflow.title}
                  body={workflow.summary}
                  icon={<IconCompass aria-hidden="true" size={20} stroke={1.8} />}
                  actionLabel="Open task"
                  selected={state.task === workflow.workflow_id}
                  onNavigate={onNavigate}
                  onBeforeNavigate={() => {
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
            {workflows.length === 0 ? (
              <div className="notice" role="status">
                <p>
                  Workflow guidance is temporarily unavailable. Official
                  resources and templates remain available below.
                </p>
              </div>
            ) : null}
          </section>
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
              <div className="workflow-method">
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
              </div>
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
            {/* The page title, its summary, and the "01 / Document" step all
                already say this is where a template is chosen. A second
                heading, a restatement, and the review notice repeated from the
                preview stacked five lines of preamble above the first
                template. Only a specific companion name adds anything, so the
                generic heading stays for the landmark and is not shown. */}
            <div className="section-header nexus-section-header">
              <div>
                <h2
                  className={
                    selectedWorkflow && declaredCompanions.length === 1
                      ? undefined
                      : "visually-hidden"
                  }
                  id="companion-heading"
                >
                  {selectedWorkflow && declaredCompanions.length === 1
                    ? `Create ${declaredCompanions[0].display_name}`
                    : "Choose a template"}
                </h2>
              </div>
            </div>
            {showCompanionFilters ? (
              <CatalogFilterBar
                category={categoryFilter}
                categoryOptions={Object.keys(TEMPLATE_CATEGORIES)}
                countLabel={`${filteredTemplates.length} working file${filteredTemplates.length === 1 ? "" : "s"}${selectedWorkflow ? " connected to this task" : ""} in ${groupedTemplates.size} group${groupedTemplates.size === 1 ? "" : "s"}`}
                onCategoryChange={(category) =>
                  onNavigate("templates", { ...state, category })
                }
                onQueryChange={(query) =>
                  onNavigate("templates", { ...state, query })
                }
                query={queryFilter}
                queryPlaceholder="Search templates by name or purpose"
              />
            ) : null}

            {[...groupedTemplates.entries()].map(
              ([category, categoryTemplates]) => (
                <section className="catalog-group" key={category}>
                  <h3 className="catalog-group-title">{category}</h3>
                  <div className={`intent-grid${categoryTemplates.length === 1 ? " intent-grid--solo" : ""}`}>
                    {categoryTemplates.map((template: TemplateRecord) => (
                      <QuickIntentCard
                        actionLabel="Open document"
                        body={template.description}
                        icon={<IconFileDescription size={20} stroke={1.8} />}
                        key={template.name}
                        meta={templateMeta(template, onNavigate)}
                        details={templateDetails(template)}
                        onNavigate={onNavigate}
                        patch={{ buildSection: "documents", task: "", templateType: template.name, framework: state.framework || "", format: template.supported_formats?.[0] || "docx", environment: state.environment || "", baseline: "", controlFamily: "", stig: "" }}
                        title={template.display_name}
                        view="templates"
                      />
                    ))}
                  </div>
                </section>
              ),
            )}

            {otherTemplates.length ? (
              <div className="other-templates">
                <div className="intent-grid">
                  {otherTemplates.map((template: TemplateRecord) => (
                    <QuickIntentCard
                      actionLabel="Open document"
                      body={template.description}
                      icon={<IconFileDescription size={20} stroke={1.8} />}
                      key={template.name}
                      meta={templateMeta(template, onNavigate)}
                      details={templateDetails(template)}
                      onNavigate={onNavigate}
                      patch={{ buildSection: "documents", task: "", templateType: template.name, framework: state.framework || "", format: template.supported_formats?.[0] || "docx", environment: state.environment || "", baseline: "", controlFamily: "", stig: "" }}
                      title={template.display_name}
                      view="templates"
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
            </>
          ) : null}
        </div>
      ) : null}

      {selectedTemplate ? (
        <section className="stack header-offset-target" ref={generationRef} tabIndex={-1}>
          <section className="compare-flow-grid">
            <section aria-labelledby="document-inputs-heading" className="compare-flow-task panel">
              <span className="label">02 / Set up</span>
              <h2 id="document-inputs-heading">Set up your file</h2>
              <p>{selectedTemplate.description}</p>
              <div className="compare-step-fields template-essential-options">
              {inputOptions.includes("framework") ? (
                <SelectField
                  hint="Which control catalog the template should reference."
                  label="Catalog or program"
                  emptyLabel="Select a catalog or program"
                  onChange={(value) =>
                    onNavigate("templates", {
                      framework: value,
                      baseline: "",
                      controlFamily: "",
                    })
                  }
                  options={catalogOptions}
                  required
                  value={state.framework || ""}
                />
              ) : null}
              {inputOptions.includes("baseline") ? (
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
              ) : null}
              {inputOptions.includes("environment_archetype") ? (
                <SelectField
                  hint="Where the system runs — cloud, on-premises, or hybrid."
                  label="Environment"
                  emptyLabel="Not selected"
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
              ) : null}
              <SelectField
                    emptyLabel={`Select a STIG (${stigOptions.length} shown)`}
                    hint="One STIG per file. The file lists that STIG's real rules under the 12 STIG Viewer CSV columns."
                    label="STIG"
                    onChange={(value) => onNavigate("templates", { stig: value })}
                    options={stigOptions}
                    required
                    value={state.stig || ""}
                  />
                </>
              ) : null}
              <SelectField
                hint={FORMAT_HELP[activeFormat] || "File type for the downloaded template."}
                label="Format"
                onChange={(value) => onNavigate("templates", { format: value })}
                options={supportedFormats.map((format: string) => ({ value: format, label: FORMAT_LABELS[format] || format }))}
                value={activeFormat}
              />
              </div>
              <Accordion.Root className="accordion-root" collapsible type="single">
                <DisclosurePanel title="More options" value="options">
                  <div className="filter-grid">
                    {inputOptions.includes("control_family") ? (
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
                    ) : null}
                  </div>
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

            <aside aria-labelledby="document-context-heading" className="compare-flow-support panel">
              <span className="label">Selected context</span>
              <h2 id="document-context-heading">Current document</h2>
              <dl className="compare-scope-list">
                <div>
                  <dt>Document</dt>
                  <dd>{selectedTemplate.display_name}</dd>
                </div>
                <div>
                  <dt>Selected context</dt>
                  <dd>{selectedContextLabel}</dd>
                </div>
                <div>
                  <dt>Artifact basis</dt>
                  <dd>{artifactBasisLabel || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{FORMAT_LABELS[activeFormat] || activeFormat}</dd>
                </div>
              </dl>
              <details className="template-supporting-details">
                <summary>What this template is for</summary>
                <div className="disclosure-content">
                  <p>{selectedTemplate.description}</p>
                  {selectedTemplate.compatibility?.claim ? (
                    <p>{selectedTemplate.compatibility.claim}</p>
                  ) : null}
                  {selectedTemplate.limitations?.length ? (
                    <ul className="nexus-list">
                      {selectedTemplate.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
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
              {selectedTemplateArtifacts.length > 0 ? (
                <section aria-labelledby="template-official-heading" className="template-sources-panel">
                  <h3 id="template-official-heading">Published sources</h3>
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
            </aside>
          </section>

          <section aria-labelledby="document-preview-section-heading" className="stack">
            <div className="section-header">
              <div>
                <p className="eyebrow">03 / Review & download</p>
                <h2 id="document-preview-section-heading">Review and download</h2>
              </div>
            </div>
            {documentPreview?.doc && generationState?.previewAvailable ? (
              <TemplateDocumentPreview doc={documentPreview.doc} format={activeFormat} />
            ) : (
              <p className="generation-status tone-warning" id="document-download-reason" role="status">
                {generationState?.status ||
                  "Choose a catalog or program to enable the download."}
              </p>
            )}
            <div className="card-actions">
              <Button
                id="document-download-action"
                variant="primary"
                // A disabled control has to say why. Without this a
                // screen-reader user heard "Download, button, dimmed" and had
                // no path to the reason, and the visible line above it was not
                // programmatically connected to the control it blocks.
                aria-describedby={
                  generationState?.downloadEnabled ? undefined : "document-download-reason"
                }
                disabled={generating || !generationState?.downloadEnabled}
                onClick={createTemplate}
              >
                {generating ? "Preparing download…" : `Download ${selectedTemplate.display_name} (${FORMAT_SHORT[activeFormat] || activeFormat})`}
              </Button>
            </div>
            <span aria-live="polite" className="visually-hidden">
              {generationState?.downloadEnabled ? "Download ready." : ""}
            </span>
            {generationStatus ? <p className={`generation-status tone-${generationTone}`} role="status">{generationStatus}</p> : null}
          </section>
        </section>
      ) : null}
    </MissionPage>
  );
}
