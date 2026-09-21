import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { learnArticles } from '../src/app/learn-content.mjs';
import { buildTemplateDocument } from '../src/app/template-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(join(__dirname, '../data/template-registry.json'), 'utf8'));
const appShell = readFileSync('src/ui/App.tsx', 'utf8');

const PROHIBITED_CLAIMS = [
  /guarantees?\s+compliance/i,
  /recommend(s|ation)?\s+(an?\s+)?authorization/i,
  /you\s+(will|should)\s+receive\s+an?\s+ato/i,
  /determines?\s+compliance\s+status/i,
  /makes?\s+authorization\s+decisions/i,
];

const ADVISORY_FIELDS = ['title', 'summary', 'explanation', 'limitations'];
const RAW_SCHEMA_SLUGS = /\b(includePlaceholders|artifact_type|templateType|security_plan_starter|implementation_statement_worksheet)\b/;
const ABSTRACT_SUMMARY_LEADS = /^(understand|leverage|utilize|establish|centralize|facilitate|use task-focused)\b/i;
const DETERMINATION_BOUNDARY = [
  /controls?\s+you\s+can\s+inherit/i,
  /claim\s+the\s+controls?/i,
  /reuse\s+another\s+team['’]s\s+authorization/i,
  /before\s+you\s+inherit/i,
  /assessors?\s+expect/i,
];
const BANNED_SITE_COPY = [
  /the public map for federal cyber compliance/i,
  /like a family tree/i,
  /family tree/i,
  /what do you need to get done/i,
  /start with a compliance task/i,
  // 2026-08-03 UX copy correction. These are the exact constructions the
  // interface used to narrate itself with: route descriptions that explained
  // when to click, and doctrine pasted out of docs/ into page bodies.
  /for when you/i,
  /we point you at/i,
  /a compact chain/i,
  /relationship classes in plain language/i,
  /one hierarchy, (?:two|three) relationships/i,
  /everything it connects to beyond that/i,
  /if the official text is not the thing you need/i,
  // Generic product language: accurate but bloodless. The site speaks like a
  // practitioner, so these constructions stay out of rendered copy.
  /explore a published chain/i,
  /see what comes next/i,
  /choices you make explicitly/i,
  /make explicit choices/i,
  /follow published connections/i,
  /navigate the ecosystem/i,
  /explore the ecosystem/i,
  /unlock insights/i,
  /seamlessly trace/i,
];

// The 2026-08-03 public names. Old surface names are internal route keys only
// and must not appear as rendered labels again.
const RETIRED_SURFACE_LABELS = [
  />Browse Catalog</,
  /Find Tools &amp; Resources/,
  /Back to Learn/,
  /Open in Explore/,
  /Open Explore</,
  />Loading Catalog</,
];

const dataset = {
  nodes: [
    {
      id: 'nist-800-53:AC-2',
      node_type: 'control',
      label: 'AC-2 Account Management',
      metadata: {
        catalog_id: 'nist-800-53',
        item_id: 'AC-2',
        title: 'Account Management',
        control_family: 'Access Control',
      },
    },
  ],
  sources: [
    {
      id: 'nist-oscal',
      display_name: 'SP 800-53 Rev. 5',
      version: '2026-06-09',
    },
  ],
};

test('Learn articles include limitations, citations, and a concrete next action', () => {
  for (const article of learnArticles) {
    assert.ok(article.limitations?.trim(), `Article ${article.id} must include limitations`);
    assert.ok(article.citations?.length, `Article ${article.id} must include citations`);
    assert.ok(article.nextAction?.label, `Article ${article.id} must include a next action`);
  }
});

test('Learn explanation copy avoids prohibited compliance or authorization claims', () => {
  for (const pattern of learnArticles) {
    for (const field of ADVISORY_FIELDS) {
      const text = String(pattern[field] || '');
      for (const claim of PROHIBITED_CLAIMS) {
        assert.doesNotMatch(text, claim, `Pattern ${pattern.id}.${field} contains prohibited claim`);
      }
    }
  }
});

// 2026-08-03: the owner asked for a two-step guided flow, superseding the
// session-15 "no questions at all" rule. The boundary it was protecting is
// unchanged and still enforced: the flow may route, never determine.
test('Start here guides in two steps without making a determination', () => {
  const startHere = readFileSync('src/ui/pages/StartHerePage.tsx', 'utf8');
  assert.match(startHere, /What are you trying to do\?/);
  assert.match(startHere, /What kind of system are you working with\?/);
  assert.match(startHere, /SITE_COPY\.product\.boundary/);
  assert.doesNotMatch(startHere, /applicability recommendation|not a framework or baseline/i);
  assert.doesNotMatch(startHere, /System type|Data sensitivity|Operational environment/);
  for (const claim of DETERMINATION_BOUNDARY) {
    assert.doesNotMatch(startHere, claim, `Start Here contains a determination-like claim: ${claim}`);
  }
});

test('Start here plans are traceable to real publications and routes', async () => {
  const guide = await import('../src/app/start-here-guide.mjs');
  assert.deepEqual(guide.validateStartHereGuide(), []);

  const catalogIds = new Set(
    JSON.parse(
      readFileSync('data/generated/catalog-bootstrap.json', 'utf8'),
    ).catalog_bootstrap.catalogs.map((catalog) => catalog.id),
  );
  const routeIdentity = readFileSync('src/ui/lib/routeIdentity.ts', 'utf8');

  for (const goal of guide.START_HERE_GOALS) {
    for (const context of guide.START_HERE_CONTEXTS) {
      const plan = guide.startingPlanFor(goal.id, context.id);
      assert.ok(plan, `no plan for ${goal.id}/${context.id}`);
      for (const step of [plan.startWith, plan.thenReview]) {
        assert.ok(
          catalogIds.has(step.catalogId),
          `${goal.id}/${context.id} names an unknown publication: ${step.catalogId}`,
        );
      }
      assert.match(
        routeIdentity,
        new RegExp(`"?${plan.action.view}"?:`),
        `${goal.id} next action targets an unknown route: ${plan.action.view}`,
      );
    }
  }

  // Start here renders without the runtime bundle, so every publication it can
  // name needs a static display name — otherwise the plan prints a raw catalog
  // id, which is exactly what the live browser showed on 2026-08-03.
  const catalogNames = new Map(
    JSON.parse(
      readFileSync('data/generated/catalog-bootstrap.json', 'utf8'),
    ).catalog_bootstrap.catalogs.map((catalog) => [catalog.id, catalog.name]),
  );
  for (const [catalogId, name] of Object.entries(guide.PUBLICATION_NAMES)) {
    assert.equal(
      name,
      catalogNames.get(catalogId),
      `${catalogId} display name has drifted from the generated catalog data`,
    );
    assert.doesNotMatch(name, /^[a-z0-9-]+$/, `${catalogId} renders a raw id`);
  }

  // A half-answered flow must never render a plan.
  assert.equal(guide.startingPlanFor('understand', ''), null);
  assert.equal(guide.startingPlanFor('', 'federal'), null);
  assert.equal(guide.startingPlanFor('not-a-goal', 'federal'), null);
});

test('navigation exposes Templates directly and keeps Guides in overflow', () => {
  const routeIdentity = readFileSync('src/ui/lib/routeIdentity.ts', 'utf8');
  for (const [view, label] of [
    ['start-here', 'Start here'],
    ['search', 'Library'],
    ['templates', 'Templates'],
    ['patterns', 'Guides'],
    ['sources', 'Sources'],
    ['about', 'About'],
  ]) {
    assert.match(
      routeIdentity,
      new RegExp(`"?${view}"?: \\{[^}]*label: "${label}"`),
      `${view} must render as "${label}"`,
    );
  }
  assert.match(routeIdentity, /search: "search"/);

  const navigation = readFileSync('src/ui/lib/navigation.ts', 'utf8');
  const primaryItems = navigation.match(
    /export const PRIMARY_NAV_ITEMS: NavItem\[\] = \[(.*?)\n\];/s,
  );
  assert.ok(primaryItems, 'primary navigation items must remain explicitly declared');
  const primaryViews = [...primaryItems[1].matchAll(/view: "([a-z-]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(primaryViews, ['start-here', 'atlas-map', 'search', 'matrix', 'commons']);
  assert.match(primaryItems[1], /view: "commons"[\s\S]*TEMPLATES_NAV_ITEM/);

  const overflowItems = navigation.match(
    /export const OVERFLOW_NAV_ITEMS: NavItem\[\] = \[(.*?)\n\];/s,
  );
  assert.ok(overflowItems, 'overflow navigation items must remain explicitly declared');
  assert.match(overflowItems[1], /GUIDES_NAV_ITEM/);
  assert.doesNotMatch(overflowItems[1], /TEMPLATES_NAV_ITEM/);
  assert.match(navigation, /UTILITY_NAV_ITEMS[\s\S]*view: "sources"[\s\S]*view: "about"/);
  assert.match(navigation, /MOBILE_NAV_SECTIONS[\s\S]*TOOLKIT_SECTION_LABEL[\s\S]*TEMPLATES_NAV_ITEM, GUIDES_NAV_ITEM[\s\S]*UTILITY_SECTION_LABEL/);
});

test('old public paths redirect into the Phase 3 canonical hierarchy', () => {
  const routeIdentity = readFileSync('src/ui/lib/routeIdentity.ts', 'utf8');
  for (const [alias, canonical] of [
    ['/explore', '/atlas'],
    ['/search', '/library'],
    ['/learn', '/guides'],
    ['/help', '/about'],
  ]) {
    assert.match(
      routeIdentity,
      new RegExp(`"${alias}": "${canonical}"`),
      `${alias} must resolve to ${canonical} so both URLs work`,
    );
  }
  // Start Here's guided answers must survive canonicalization, or the flow is
  // dead on a shared link (the atlasLimb regression, 2026-08-01).
  assert.match(routeIdentity, /const START_PARAMS = new Set\(\["goal", "context"\]\)/);
});

test('Home is an entry surface, not a lesson about the data model', () => {
  const homePage = readFileSync('src/ui/pages/HomePage.tsx', 'utf8');
  const homeContent = readFileSync('src/shared/home-content.mjs', 'utf8');
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  assert.match(homeContent, /SITE_COPY\.home/);
  assert.match(homePage, /HOME_CONTENT\.headline/);
  assert.match(homePage, /home-library-discovery/);
  assert.match(homePage, /BROWSE THE LIBRARY/);
  // Cards lead with the practitioner question and the collection name; the
  // record count is supporting metadata, never the headline.
  assert.match(homePage, /home-library-kpi__question/);
  assert.match(homePage, /home-library-kpi__label/);
  assert.doesNotMatch(homePage, /More records, bigger tag|data-tag-count-scale|--tag-scale/);
  assert.doesNotMatch(
    readFileSync('src/ui/lib/homeTagConstellation.ts', 'utf8'),
    /scale:|logRange|minimumLogCount|maximumLogCount|Math\.log10/,
  );
  assert.doesNotMatch(homePage, /home-ecosystem-authorities|Federal cybersecurity ecosystem preview/);
  assert.match(viteConfig, /renderStaticHome/);
  for (const path of ['src/ui/pages/HomePage.tsx', 'src/index.html']) {
    const home = readFileSync(path, 'utf8');
    assert.doesNotMatch(home, /home-spine/, `${path} still renders the nine-area directory`);
    assert.doesNotMatch(home, /home-thesis/, `${path} still renders the hierarchy lesson`);
    // A real record may appear in a preview, never as a hierarchy lesson.
    assert.doesNotMatch(home, /AC-2 is selected into|AC-2 lives under|one hierarchy/, `${path} still teaches the AC-2 example`);
    assert.doesNotMatch(home, /which baseline to use/, `${path} repeats the About trust boundary`);
    // Searching is the field above; no card may repeat it.
    assert.doesNotMatch(home, /Find a requirement/, `${path} duplicates the search entrance`);
    assert.doesNotMatch(home, /guidance that applies to your work/, `${path} implies an applicability decision`);
  }
});

test('retired surface labels never return to rendered copy', () => {
  const uiFiles = readdirSync('src/ui', { recursive: true })
    .map(String)
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .map((path) => [`src/ui/${path}`, readFileSync(`src/ui/${path}`, 'utf8')]);
  uiFiles.push(['src/index.html', readFileSync('src/index.html', 'utf8')]);

  for (const [path, contents] of uiFiles) {
    for (const label of RETIRED_SURFACE_LABELS) {
      assert.doesNotMatch(contents, label, `${path} renders a retired surface label: ${label}`);
    }
  }
});

test('site-wide UI copy rule rejects canned metaphors and compliance-only prompts', () => {
  const uiFiles = readdirSync('src/ui', { recursive: true })
    .map(String)
    .filter((path) => /\.(?:ts|tsx|html)$/.test(path))
    .map((path) => readFileSync(`src/ui/${path}`, 'utf8'));
  const siteCopy = [readFileSync('src/index.html', 'utf8'), ...uiFiles].join('\n');
  for (const phrase of BANNED_SITE_COPY) {
    assert.doesNotMatch(siteCopy, phrase, `Banned canned or compliance-only copy: ${phrase}`);
  }
});

test('Mission-level UI keeps implementation vocabulary behind technical details', () => {
  const visibleCopyFiles = [
    'src/ui/components/ContextualTaxonomyLinks.tsx',
    'src/ui/components/LoadStatusPanel.tsx',
    'src/ui/components/RelationshipExplorer.tsx',
    'src/ui/components/RelationshipGraphTable.tsx',
    'src/ui/pages/AtlasMapPage.tsx',
  ];
  const visibleCopy = visibleCopyFiles
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  for (const phrase of [
    /governed record tags/i,
    /source registry/i,
    /source basis/i,
  ]) {
    assert.doesNotMatch(visibleCopy, phrase, `Mission copy exposes implementation vocabulary: ${phrase}`);
  }
});

// The internal structural vocabulary in docs/DATA_POLICY.md is how the team reasons
// about the corpus. It is not how a visitor talks, and in 2026-08 it leaked
// into Home, Explore and Start Here as "nine limbs". Internal identifiers keep
// it (atlas:LIMB-*, class names); rendered text must not.
test('the internal tree vocabulary never reaches rendered copy', () => {
  const TREE_WORDS = /\b(limbs?|trunks?|twigs?|acorns?)\b/i;
  const files = readdirSync('src/ui', { recursive: true })
    .map(String)
    .filter((path) => /\.(?:tsx|html)$/.test(path))
    .map((path) => [`src/ui/${path}`, readFileSync(`src/ui/${path}`, 'utf8')]);
  files.push(['src/index.html', readFileSync('src/index.html', 'utf8')]);

  for (const [path, contents] of files) {
    // Strip engineering surface — comments, class names, identifiers and data
    // attributes — leaving the words a visitor actually reads.
    const rendered = contents
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/(?:class|className)=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g, ' ')
      .replace(/[A-Za-z_]*(?:LIMB|Limb|limb)[A-Za-z_]*/g, ' ')
      .replace(/treeSpine\.\w+/g, ' ')
      .replace(/model\.trunk(?:\.id)?/g, ' ')
      .replace(/data-[\w-]+="[^"]*"/g, ' ');
    const match = rendered.match(TREE_WORDS);
    assert.ok(
      !match,
      `${path} renders the internal tree vocabulary: ${match && match[0]}`,
    );
  }
});

test('Learn summaries name a concrete reading job', () => {
  for (const pattern of learnArticles) {
    const summary = String(pattern.summary || '').trim();
    const wordCount = summary.split(/\s+/).filter(Boolean).length;
    assert.ok(summary, `Pattern ${pattern.id} must have a summary`);
    assert.doesNotMatch(
      summary,
      ABSTRACT_SUMMARY_LEADS,
      `Pattern ${pattern.id} starts with abstract UI copy`,
    );
    assert.ok(
      wordCount <= 20,
      `Pattern ${pattern.id} summary has ${wordCount} words; expected 20 or fewer`,
    );
  }
});

test('template registry requires disclaimers on every artifact', () => {
  for (const template of registry.templates) {
    assert.equal(template.disclaimer_required, true, `${template.name} must require a disclaimer`);
  }
});

test('generated templates use plain-language prompts without raw schema slugs', () => {
  for (const template of registry.templates) {
    const { doc } = buildTemplateDocument(
      {
        templateType: template.name,
        framework: 'nist-800-53',
        environment: 'Cloud SaaS',
        includePlaceholders: true,
        includeImplementationPrompts: true,
        includeSourceFootnotes: true,
      },
      dataset,
    );
    const content = JSON.stringify(doc);

    assert.match(content, /Source Metadata/, `${template.name} must include source metadata`);
    assert.match(content, /Limit:/, `${template.name} must state its limitation`);
    assert.doesNotMatch(content, RAW_SCHEMA_SLUGS, `${template.name} exposes raw schema slug in output`);
    const hasPlainLanguage = /How is|Describe|What|Who|When|Why|List|Document|Assessment Method|Observations|Weakness|Remediation|\[[^\]]+\]/i.test(content);
    assert.ok(hasPlainLanguage, `${template.name} should include plain-language prompts`);
  }
});

test('react shell footer uses the approved open-source guidance disclaimer', () => {
  const footer = readFileSync('src/ui/components/SiteFooter.tsx', 'utf8');
  const identity = readFileSync('src/shared/product-identity.ts', 'utf8');
  const siteCopy = readFileSync('src/shared/site-copy.mjs', 'utf8');
  assert.match(footer, /PRODUCT_FOOTER_NOTICE/);
  assert.match(identity, /SITE_COPY\.product\.footer/);
  assert.match(siteCopy, /Free and open source\. Not a government system\./);
});

test('starter documents use the same direct decision boundary as the public product', () => {
  const disclaimer = readFileSync('src/shared/disclaimer.mjs', 'utf8');
  assert.match(
    disclaimer,
    /The people using it decide what applies, which baseline to use, and what counts for compliance, inheritance, authorization, or an ATO\./,
  );
  assert.doesNotMatch(disclaimer, /owns any .* conclusions/i);
});

test('about page states the exact product definition and decision boundary without architecture narration', () => {
  const aboutPage = readFileSync('src/ui/pages/AboutPage.tsx', 'utf8');
  assert.match(appShell, /AboutPage/);
  assert.match(aboutPage, /PRODUCT_DEFINITION/);
  assert.match(aboutPage, /PRODUCT_DECISION_BOUNDARY/);
  for (const heading of [
    'Why Control Atlas exists',
    "What's in here",
    'Built for the people doing the work',
    'Follow it back to the source',
    'About the project',
  ]) {
    assert.match(aboutPage, new RegExp(`<h2>${heading}</h2>`));
  }
  assert.doesNotMatch(aboutPage, /SummaryCard|about-card-grid/);
  assert.doesNotMatch(aboutPage, /organizing spine|Control Atlas overlay|publisher hierarchy|provenance|confidence|trust register|ontology|taxonomy architecture/i);
  assert.doesNotMatch(aboutPage, /Path shows|Map and List show|graph parenting|not as parents|focus semantics/i);
  assert.doesNotMatch(aboutPage, /\b(?:Roots|Trunk|Twigs|Leaves|Fruit|Acorns)\b/);
  assert.doesNotMatch(aboutPage, /plain English|right starting point/i);
  // About tells the practitioner story; it is not the flourish-shortcut page.
  assert.doesNotMatch(aboutPage, /Ctrl \+|keyboard shortcut/i);
  assert.doesNotMatch(aboutPage, /Where to go next/i);
  assert.ok(
    (aboutPage.match(/AC-2/g) || []).length <= 2,
    'About should carry at most one AC-2 example',
  );
});

test('selected Guides use a knowledge-base article instead of a card stack', () => {
  const guidesPage = readFileSync('src/ui/pages/PlaybooksPage.tsx', 'utf8');
  assert.match(guidesPage, /data-page-template="knowledge-base"/);
  assert.match(guidesPage, /Guide contents and source/);
  assert.match(guidesPage, />When it matters</);
  assert.match(guidesPage, />What this means</);
  assert.match(guidesPage, />Official references</);
  assert.doesNotMatch(guidesPage, /<Panel|<SummaryCard/);
});

test('architecture narration and teaching examples stay out of product UI copy', () => {
  const uiFiles = readdirSync('src/ui', { recursive: true })
    .map(String)
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .map((path) => [
      `src/ui/${path}`.split(sep).join('/'),
      readFileSync(`src/ui/${path}`, 'utf8'),
    ]);
  uiFiles.push(['src/index.html', readFileSync('src/index.html', 'utf8')]);

  const withHierarchyExplanation = uiFiles.filter(([, contents]) =>
    /Path shows where a publisher placed a record|Map and List show\s+cited links/.test(contents),
  );
  assert.deepEqual(withHierarchyExplanation, []);

  // ComparePage uses AC-2 as an input placeholder, not as a lesson; only
  // explanatory prose is restricted.
  const withAcExample = uiFiles.filter(([, contents]) =>
    /AC-2 is selected into|AC-2 lives under/.test(contents),
  );
  assert.deepEqual(withAcExample, []);
});
