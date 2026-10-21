import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const datasetPath = join(ROOT, "data", "commons-resource-dataset.json");
const schemaPath = join(ROOT, "data", "schemas", "commons-resource-schema.json");
const outputPath = join(ROOT, "data", "generated", "commons-search-index.json");

const datasetRaw = readFileSync(datasetPath, "utf8");
const dataset = JSON.parse(datasetRaw);
const schemaRaw = readFileSync(schemaPath, "utf8");
const schema = JSON.parse(schemaRaw);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);
const valid = validate(dataset);

if (!valid) {
  console.error("Commons dataset validation failed:", validate.errors);
  process.exit(1);
}

console.log(`Validated dataset: ${dataset.resources.length} resources, ${dataset.collections.length} collections.`);

// Duplicate ID and Canonical URL checks
const ids = new Set();
const urls = new Set();
for (const res of dataset.resources) {
  if (ids.has(res.id)) {
    console.error(`Duplicate resource ID found: ${res.id}`);
    process.exit(1);
  }
  ids.add(res.id);

  if (!res.canonicalUrl) {
    console.error(`Missing canonicalUrl for resource: ${res.id}`);
    process.exit(1);
  }
  const canonicalUrl = new URL(res.canonicalUrl).toString();
  if (urls.has(canonicalUrl)) {
    console.error(`Duplicate canonicalUrl found: ${canonicalUrl}`);
    process.exit(1);
  }
  urls.add(canonicalUrl);
}

const collectionIds = new Set(dataset.collections.map((collection) => collection.id));
for (const collection of dataset.collections) {
  for (const resourceId of collection.resourceIds) {
    if (!ids.has(resourceId)) throw new Error(`Collection ${collection.id} references missing resource ${resourceId}`);
  }
}
for (const resource of dataset.resources) {
  for (const collectionId of resource.featuredCollections) {
    if (!collectionIds.has(collectionId)) throw new Error(`Resource ${resource.id} references missing collection ${collectionId}`);
  }
  if (resource.parentEcosystemId && !ids.has(resource.parentEcosystemId)) {
    throw new Error(`Resource ${resource.id} references missing parent ${resource.parentEcosystemId}`);
  }
  for (const childId of resource.childResourceIds) {
    if (!ids.has(childId)) throw new Error(`Resource ${resource.id} references missing child ${childId}`);
  }
}

// Build Search Index Documents
const indexDocuments = dataset.resources.map((res) => {
  const searchableText = [
    res.name,
    res.shortName,
    res.summary,
    res.cardPurpose,
    res.whyIncluded,
    res.publisher,
    res.maintainer || "",
    res.resourceType,
    res.publisherType,
    res.accessType,
    res.costType,
    res.officialStatus,
    ...(res.frameworks || []),
    ...(res.programs || []),
    ...(res.controlFamilies || []),
    ...(res.audiences || []),
    ...(res.lifecycleStages || []),
    ...(res.technologyScopes || []),
    ...(res.featuredCollections || []),
    ...dataset.collections.filter((collection) => res.featuredCollections.includes(collection.id)).flatMap((collection) => [collection.title, collection.summary]),
    ...(res.searchAliases || []),
    ...(res.searchKeywords || [])
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    id: res.id,
    name: res.name,
    shortName: res.shortName,
    cardPurpose: res.cardPurpose,
    slug: res.slug,
    summary: res.summary,
    whyIncluded: res.whyIncluded,
    canonicalUrl: res.canonicalUrl,
    publisher: res.publisher,
    publisherType: res.publisherType,
    resourceLane: res.resourceLane,
    resourceType: res.resourceType,
    frameworks: res.frameworks || [],
    programs: res.programs || [],
    lifecycleStages: res.lifecycleStages || [],
    audiences: res.audiences || [],
    artifactTypes: res.artifactTypes || [],
    technologyScopes: res.technologyScopes || [],
    accessType: res.accessType,
    costType: res.costType,
    maintenanceStatus: res.maintenanceStatus,
    lastCheckedAt: res.lastCheckedAt,
    accountRequired: res.accountRequired,
    authenticationRequired: res.authenticationRequired,
    origin: res.origin,
    claimEvidence: res.claimEvidence,
    openSource: res.openSource || false,
    popularitySignals: res.popularitySignals || {},
    companionResources: res.companionResources || [],
    featuredCollections: res.featuredCollections || [],
    searchAliases: res.searchAliases || [],
    searchKeywords: res.searchKeywords || [],
    searchableText
  };
});

const generatedArtifact = {
  // Keep the committed artifact reproducible. The source dataset owns the
  // freshness date; wall-clock build time would dirty the repository on every
  // otherwise identical build.
  builtAt: new Date(`${dataset.lastUpdated}T00:00:00.000Z`).toISOString(),
  totalCount: indexDocuments.length,
  collections: dataset.collections,
  documents: indexDocuments
};

if (!existsSync(dirname(outputPath))) {
  mkdirSync(dirname(outputPath), { recursive: true });
}

writeFileSync(outputPath, JSON.stringify(generatedArtifact, null, 2), "utf8");
console.log(`Successfully generated Commons Search Index artifact at ${outputPath}`);
