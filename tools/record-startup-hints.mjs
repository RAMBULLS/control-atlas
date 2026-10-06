export const RECORD_STARTUP_ENTRIES = [
  { key: 'artifacts', module: 'src/ui/lib/runtimeArtifacts.ts', publicExport: 'preloadRuntimeArtifacts' },
  { key: 'routes', module: 'src/ui/lib/hashRoutes.ts', publicExport: 'parseHashLocation' },
];

/** Locate the existing source preloader's public entry points in this build. */
export function recordStartupHints(bundle) {
  const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
  const entries = {};
  for (const { key, module, publicExport } of RECORD_STARTUP_ENTRIES) {
    const chunk = chunks.find(output => output.facadeModuleId?.replaceAll('\\', '/').endsWith(`/${module}`));
    if (!chunk) throw new Error(`Record startup module is absent from the build: ${module}`);
    if (!/^assets\/[\w.-]+\.js$/.test(chunk.fileName) || bundle[chunk.fileName] !== chunk) {
      throw new Error(`Record startup references an invalid emitted chunk: ${chunk.fileName}`);
    }
    if (!chunk.exports.includes(publicExport)) {
      throw new Error(`Record startup module has no public ${publicExport} export.`);
    }
    entries[key] = `./${chunk.fileName}`;
  }
  return entries;
}
