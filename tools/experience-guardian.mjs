#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const configDir = join(root, "config", "experience-guardian");
const reportDir = join(root, "artifacts", "experience-guardian");
const ownershipPath = join(configDir, "copy-ownership.json");
const matrixPath = join(configDir, "route-matrix.json");
const routeIdentityPath = join(root, "src", "ui", "lib", "routeIdentity.ts");
const authorityPaths = [
  "docs/PRD.md",
  "docs/vision.md",
  "docs/DESIGN_PRINCIPLES.md",
  "docs/PAGE_CONTRACTS.md",
  "docs/design/design-system.md",
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    )
  ).flat();
}

const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
await Promise.all(authorityPaths.map((path) => readFile(join(root, path), "utf8")));

const findings = [];
function add(severity, rule, file, line, target, message) {
  findings.push({ severity, rule, file, line, target, message });
}

function clean(value) {
  return value.replace(/\s+/g, " ").trim();
}

const canonicalBreakpoints = [320, 375, 390, 768, 1024, 1440];
if (JSON.stringify(matrix.canonicalBreakpoints) !== JSON.stringify(canonicalBreakpoints)) {
  add("error", "responsive-breakpoints", "config/experience-guardian/route-matrix.json", 1, "canonicalBreakpoints", "Keep the canonical 320, 375, 390, 768, 1024, and 1440 pixel acceptance widths.");
}
const layoutFamilies = new Set(matrix.layoutFamilies || []);
const stateIds = new Set();
for (const state of matrix.states || []) {
  if (stateIds.has(state.id)) {
    add("error", "duplicate-state", "config/experience-guardian/route-matrix.json", 1, state.id, "Every rendered acceptance state needs a unique ID.");
  }
  stateIds.add(state.id);
  if (!layoutFamilies.has(state.layoutFamily)) {
    add("error", "layout-family", "config/experience-guardian/route-matrix.json", 1, state.id, "Rendered state must name a governed layout family.");
  }
  if (!matrix.keyboardContracts?.[state.keyboardContract]) {
    add("error", "keyboard-contract", "config/experience-guardian/route-matrix.json", 1, state.id, "Rendered state must reference a defined keyboard contract.");
  }
  if (!matrix.recoveryContracts?.[state.recoveryContract]) {
    add("error", "recovery-contract", "config/experience-guardian/route-matrix.json", 1, state.id, "Rendered state must reference a defined recovery contract.");
  }
  if (!state.primaryJourney?.trim()) {
    add("error", "primary-journey", "config/experience-guardian/route-matrix.json", 1, state.id, "Rendered state must name the user journey being protected.");
  }
}
for (const family of layoutFamilies) {
  const representative = matrix.states.find((state) =>
    state.layoutFamily === family &&
    JSON.stringify(state.breakpointSample) === JSON.stringify(canonicalBreakpoints));
  if (!representative) {
    add("error", "family-breakpoint-sample", "config/experience-guardian/route-matrix.json", 1, family, "Every layout family needs one representative state sampled at all canonical widths.");
  }
}

const copyPropertyNames = new Set([
  "action",
  "description",
  "detail",
  "eyebrow",
  "label",
  "placeholder",
  "summary",
  "title",
]);

function visibleCopy(sourceFile, file) {
  const entries = [];
  function capture(node, value, target) {
    const text = clean(value);
    if (!/[A-Za-z]{2}/.test(text)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    entries.push({
      file: relative(root, file).replaceAll("\\", "/"),
      line: position.line + 1,
      target,
      text,
    });
  }
  function visit(node, inJsxExpression = false) {
    if (ts.isJsxText(node)) capture(node, node.getText(sourceFile), "visible text");
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      ["aria-label", "alt", "placeholder", "title"].includes(node.name.getText(sourceFile))
    ) {
      capture(node, node.initializer.text, node.name.getText(sourceFile));
    }
    if (inJsxExpression && ts.isStringLiteral(node)) {
      let expression = node.parent;
      while (expression && !ts.isJsxExpression(expression)) {
        expression = expression.parent;
      }
      let parent = node.parent;
      let rendered = !(
        expression &&
        ts.isJsxAttribute(expression.parent) &&
        !["aria-label", "alt", "placeholder", "title"].includes(
          expression.parent.name.getText(sourceFile),
        )
      );
      while (parent && !ts.isJsxExpression(parent)) {
        if (
          ts.isBinaryExpression(parent) ||
          ts.isCallExpression(parent) ||
          ts.isObjectLiteralExpression(parent) ||
          ts.isArrayLiteralExpression(parent)
        ) {
          rendered = false;
          break;
        }
        parent = parent.parent;
      }
      if (rendered) capture(node, node.text, "rendered expression");
    }
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const property = node.name.getText(sourceFile).replaceAll(/["']/g, "");
      if (copyPropertyNames.has(property)) capture(node, node.initializer.text, property);
    }
    const nextInJsx = inJsxExpression || ts.isJsxExpression(node);
    ts.forEachChild(node, (child) => visit(child, nextInJsx));
  }
  visit(sourceFile);
  return entries;
}

const uiFiles = (await filesUnder(join(root, "src", "ui"))).filter((file) =>
  [".tsx"].includes(extname(file)),
);
const allCopy = [];
for (const file of uiFiles) {
  const source = await readFile(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  allCopy.push(...visibleCopy(parsed, file));
  for (const match of source.matchAll(/(?:text|bg|border)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    add("error", "semantic-color-token", relative(root, file), line, match[0], "Use an approved semantic token instead of an inline color.");
  }
}

const prohibited = [
  ["generic-saas", /\b(?:best-in-class|game-changing|one-stop shop|seamless(?:ly)?|supercharge|unlock the power|single pane of glass)\b/i],
  ["generic-action", /^(?:click here|learn more|view details|get started)$/i],
  ["vague-related", /^related content$/i],
];
const internalTerms = /\b(?:control_atlas_derived|federal_published|official_current|node_type|source_class|relationshipView|atlasLimb)\b/;
for (const entry of allCopy) {
  for (const [rule, pattern] of prohibited) {
    if (pattern.test(entry.text)) {
      add("error", rule, entry.file, entry.line, entry.target, `Replace or delete generic copy: "${entry.text}"`);
    }
  }
  if (internalTerms.test(entry.text)) {
    add("error", "internal-vocabulary", entry.file, entry.line, entry.target, `Internal schema vocabulary is exposed: "${entry.text}"`);
  }
  if (entry.text.length > 300) {
    add("warning", "long-introduction", entry.file, entry.line, entry.target, "Visible copy exceeds 300 characters; confirm the structure and action can carry this meaning first.");
  }
}

const duplicates = new Map();
for (const entry of allCopy) {
  if (entry.text.length < 90 || ownership.sharedLabels.includes(entry.text)) continue;
  const key = entry.text.toLowerCase();
  duplicates.set(key, [...(duplicates.get(key) || []), entry]);
}
for (const entries of duplicates.values()) {
  const locations = new Set(entries.map((entry) => `${entry.file}:${entry.line}`));
  if (locations.size > 1) {
    const entry = entries[0];
    add("warning", "duplicate-explanation", entry.file, entry.line, entry.target, `The same explanatory copy appears ${locations.size} times. Keep one canonical instance or justify the repetition.`);
  }
}

const routeSource = await readFile(routeIdentityPath, "utf8");
const routeKeys = [...routeSource.matchAll(/^\s*(?:"([^"]+)"|([\w-]+)):\s*\{\s*path:/gm)].map(
  (match) => match[1] || match[2],
);
const configuredRoutes = new Set(matrix.activeRoutes);
const coveredRoutes = new Set(matrix.states.map((state) => state.route));
for (const route of routeKeys) {
  if (!configuredRoutes.has(route)) {
    add("error", "route-register", "config/experience-guardian/route-matrix.json", 1, route, "Active route is missing from the Guardian register.");
  }
  if (!coveredRoutes.has(route)) {
    add("error", "route-coverage", "config/experience-guardian/route-matrix.json", 1, route, "Active route has no rendered review state.");
  }
}
for (const route of configuredRoutes) {
  if (!routeKeys.includes(route)) {
    add("error", "route-drift", "config/experience-guardian/route-matrix.json", 1, route, "Guardian route no longer exists in routeIdentity.ts.");
  }
}

const correctionContracts = [
  {
    file: "src/shared/navigation-events.ts",
    rule: "route-transition-feedback",
    pattern: /beginRouteTransition[\s\S]*data-route-transition/,
    message: "Shared navigation must expose immediate visible transition feedback and double-navigation protection.",
  },
  {
    file: "src/ui/lib/recordTitle.ts",
    rule: "duplicate-record-identifiers",
    pattern: /formatRecordTitle[\s\S]*leadingIdentifier/,
    message: "Record titles must use the shared duplicate-identifier formatter.",
  },
  {
    file: "src/ui/components/SearchOverlay.tsx",
    rule: "keyboard-search-submission",
    pattern: /onSubmit[\s\S]*onCompositionStart[\s\S]*Clear search/,
    message: "Global Search must submit by form, protect IME composition, and keep Clear separate from Close.",
  },
  {
    file: "src/ui/pages/StartHerePage.tsx",
    rule: "wizard-route-integrity",
    pattern: /StepIndicator(?=[\s\S]*Back to context)(?=[\s\S]*Then act)(?=[\s\S]*<strong>Next:)/,
    message: "Start Here must retain progressive steps, explicit back behavior, and a named final destination.",
  },
  {
    file: "src/ui/pages/ExplorePage.tsx",
    rule: "ranked-search-contract",
    pattern: /WorkspaceTemplate(?=[\s\S]*workspace-result-list)(?=[\s\S]*rows\.slice\(0, visibleCount\))(?=[\s\S]*setVisibleCount)/,
    message: "Search must expose visible filters, one ranked list, and bounded incremental rendering.",
  },
  {
    file: "src/ui/components/WorkspaceTemplate.tsx",
    rule: "responsive-filter-contract",
    pattern: /workspace-mobile-filter-button[\s\S]*workspace-filter-sheet[\s\S]*workspace-facet-rail/,
    message: "Browse workspaces must expose a compact filter sheet and a visible desktop filter rail.",
  },
  {
    file: "src/ui/pages/AtlasTerritoryPage.tsx",
    rule: "atlas-promised-feature",
    pattern: /JourneyBar[\s\S]*ConnectionList[\s\S]*<TerritoryMap/,
    message: "The Atlas route must deliver the territory map, practitioner journeys and a native full connection list.",
  },
  {
    file: "src/index.html",
    rule: "static-react-shell-parity",
    pattern: /data-static-header[\s\S]*data-route-transition[\s\S]*data-react-root/,
    message: "The static shell must reserve the same header and transition contract React hydrates.",
  },
  {
    file: "src/ui/lib/hashRoutes.ts",
    rule: "obsolete-public-parameters",
    pattern: /hasRetiredMode[\s\S]*params\.has\("mode"\)/,
    message: "Legacy public mode parameters must be removed during canonicalization.",
  },
];
for (const contract of correctionContracts) {
  const source = await readFile(join(root, contract.file), "utf8");
  if (!contract.pattern.test(source)) {
    add("error", contract.rule, contract.file, 1, contract.file, contract.message);
  }
}

for (const entry of allCopy) {
  if (/^Open full record$/i.test(entry.text)) {
    add("error", "redundant-open-action", entry.file, entry.line, entry.target, "Use the title or primary row as the record-opening control; retain only context-specific secondary actions.");
  }
}

const requiredClasses = [
  "product-interface",
  "official-source",
  "legal-license",
  "accessibility-label",
  "test-developer",
];
for (const ownershipClass of requiredClasses) {
  if (!ownership.classes[ownershipClass]) {
    add("error", "copy-ownership", "config/experience-guardian/copy-ownership.json", 1, ownershipClass, "Required ownership class is missing.");
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  command: "review:experience:fast",
  status: findings.some((finding) => finding.severity === "error") ? "failed" : "passed",
  summary: {
    routes: routeKeys.length,
    reviewStates: matrix.states.length,
    copyEntries: allCopy.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  },
  findings,
};

await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = findings.length
  ? findings.map((finding) => `| ${finding.severity} | ${finding.rule} | ${finding.file}:${finding.line} | ${finding.target} | ${finding.message.replaceAll("|", "\\|")} |`).join("\n")
  : "| note | clean | - | - | No deterministic findings. |";
await writeFile(
  join(reportDir, "report.md"),
  `# Control Atlas Experience Guardian\n\nStatus: **${report.status.toUpperCase()}**\n\nRoutes: ${report.summary.routes}; review states: ${report.summary.reviewStates}; copy entries: ${report.summary.copyEntries}; errors: ${report.summary.errors}; warnings: ${report.summary.warnings}.\n\n| Severity | Rule | Location | Target | Finding |\n|---|---|---|---|---|\n${rows}\n`,
);

console.log(`Experience Guardian ${report.status}: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.reviewStates} rendered states registered.`);
if (report.status === "failed") process.exitCode = 1;
