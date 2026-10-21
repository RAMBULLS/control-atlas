import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export function readGeneratedCollection(root, name, { compressed = false } = {}) {
  const artifactPath = join(root, "data", "generated", `${name}.json`);
  if (!existsSync(artifactPath)) return null;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const collection = name === "graph-health"
    ? "findings"
    : name === "library-search"
      ? "library_search"
      : name;
  const shards = artifact.sharded_collection?.shards;
  if (!Array.isArray(shards)) return artifact;
  const readShard = shard => {
    const path = join(root, "data", "generated", shard.path);
    // Published packages omit verified raw duplicates. Source-generation reads
    // retain their required raw-file contract unless this mode is explicit.
    return JSON.parse(compressed && !existsSync(path)
      ? gunzipSync(readFileSync(`${path}.gz`)).toString("utf8")
      : readFileSync(path, "utf8"));
  };
  if (collection === "library_search") {
    return {
      ...artifact,
      library_search: {
        ...artifact.library_search,
        documents: shards.flatMap((shard) => {
          const chunk = readShard(shard);
          return chunk.library_search?.documents || [];
        }),
      },
    };
  }

  const values = shards.flatMap((shard) => {
      const shardArtifact = readShard(shard);
      if (!Array.isArray(shardArtifact[collection]) || (shard.record_count !== undefined && shardArtifact[collection].length !== shard.record_count)) {
        throw new Error(`Invalid ${collection} shard ${shard.path}: count or collection missing`);
      }
      return shardArtifact[collection];
    });
  if (artifact.sharded_collection.record_count !== undefined && values.length !== artifact.sharded_collection.record_count) {
    throw new Error(`Incomplete ${collection} collection: shard total differs from the manifest`);
  }
  return { ...artifact, [collection]: values };
}
