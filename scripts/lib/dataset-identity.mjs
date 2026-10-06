import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Identity of the accepted dataset: the content digests of the generated node and edge
 * collections. Atlas stamps it on shared views; Pulse stamps it on its artifact.
 */
export function datasetIdentity(root) {
  const digestOf = (name) => JSON.parse(readFileSync(join(root, `data/generated/${name}.json`), "utf8")).sharded_collection?.content_sha256 || "";
  if (!digestOf("nodes") || !digestOf("edges")) throw new Error("Missing collection digests; cannot identify the dataset.");
  return createHash("sha256").update(digestOf("nodes") + digestOf("edges")).digest("hex").slice(0, 12);
}
