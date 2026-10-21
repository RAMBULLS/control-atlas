/** Preserve gzip delivery when a browser lacks the native decoding API. */
export async function decompressArtifactResponse(response) {
  if (typeof DecompressionStream !== 'undefined' && response.body) {
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
  }
  // Already used by Office exports. Keep this off modern browsers' arrival path.
  const { gunzipSync } = await import('fflate');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new Response(Uint8Array.from(gunzipSync(bytes)).buffer);
}
