#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyPublishedSite } from "./lib/site-payload.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] ?? "";
}

const expectedSha = argumentValue("--sha") || process.env.GITHUB_SHA || "";
if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
  throw new Error("verify-site-artifact requires a full 40-character commit SHA");
}

const path = join(process.cwd(), "dist", "site", "release.json");
const release = JSON.parse(readFileSync(path, "utf8"));
if (
  release.schema_version !== "1.1" ||
  release.commit_sha !== expectedSha ||
  !/^\d{4}-\d{2}-\d{2}T/.test(release.released_at || "") ||
  !/^\d{4}-\d{2}-\d{2}T/.test(release.source_data_generated_at || "")
) {
  throw new Error(
    `Site artifact SHA mismatch: expected ${expectedSha}, found ${release.commit_sha || "missing"}`,
  );
}

const published = verifyPublishedSite(join(process.cwd(), "dist", "site"));
console.log(`Verified site artifact for ${expectedSha}: ${published.files} files, ${published.bytes}/${published.maxBytes} bytes`);
