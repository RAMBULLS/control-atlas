import templateRegistry from "../../../data/template-registry.json";
import workflowRegistry from "../../../data/compliance-workflows.json";
import { buildRouteChoices } from "../../shared/build-route-choices.mjs";

declare const __CONTROL_ATLAS_BUILD_ROUTE_CHOICES__: ReturnType<typeof buildRouteChoices>;
declare const __CONTROL_ATLAS_BUILD_ROUTE_CHOICES_COMPILED__: boolean;
// Node contracts use the real registries. Production replaces this branch
// with the exact names/formats/ids computed from those same build inputs.
const routeChoices = typeof __CONTROL_ATLAS_BUILD_ROUTE_CHOICES_COMPILED__ !== "undefined" && __CONTROL_ATLAS_BUILD_ROUTE_CHOICES_COMPILED__
  ? __CONTROL_ATLAS_BUILD_ROUTE_CHOICES__
  : buildRouteChoices(templateRegistry, workflowRegistry);

const TEMPLATE_NAMES = new Set(
  routeChoices.templates.map((template) => template.name),
);
const WORKFLOW_IDS = new Set(
  routeChoices.workflowIds,
);
const FORMAT_BY_TEMPLATE = new Map(
  routeChoices.templates.map((template) => [
    template.name,
    new Set(template.supported_formats),
  ]),
);
export const BUILD_SOURCE_CONTEXTS = Object.freeze([
  {
    id: "nist-800-53",
    baselineCatalogId: "nist-800-53b",
  },
  {
    id: "fedramp-rev5",
    baselineCatalogId: "fedramp-rev5",
  },
]);

export const BUILD_LANES = Object.freeze([
  {
    id: "tasks",
    label: "Tasks",
    description: "Start with a task and review what it requires.",
  },
  {
    id: "documents",
    label: "Templates",
    description: "Choose a template directly, then provide only its required inputs.",
  },
  {
    id: "resources",
    label: "Resources",
    description: "Find external tools, templates, datasets, training, and communities.",
  },
] as const);

const SOURCE_CONTEXT_IDS = new Set(
  BUILD_SOURCE_CONTEXTS.map((context) => context.id),
);

export function isKnownBuildTask(value: string): boolean {
  return WORKFLOW_IDS.has(value);
}

export function isKnownBuildDocument(value: string): boolean {
  return TEMPLATE_NAMES.has(value);
}

export function isValidBuildFormat(
  documentName: string,
  format: string,
): boolean {
  if (!format) return true;
  return FORMAT_BY_TEMPLATE.get(documentName)?.has(format) ?? false;
}

export function isValidBuildSourceContext(value: string): boolean {
  return !value || SOURCE_CONTEXT_IDS.has(value);
}

export function baselineCatalogForBuildContext(value: string): string {
  return (
    BUILD_SOURCE_CONTEXTS.find((context) => context.id === value)
      ?.baselineCatalogId || ""
  );
}
