export const ATLAS_NEIGHBORHOOD_SHARD_COUNT = 2048;

/** Shared by the publisher build and the browser acquisition path. */
export function atlasNeighborhoodShardId(nodeId, shardCount = ATLAS_NEIGHBORHOOD_SHARD_COUNT) {
  let hash = 0x811c9dc5;
  for (const character of String(nodeId)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % shardCount).toString(16).padStart(2, '0');
}
