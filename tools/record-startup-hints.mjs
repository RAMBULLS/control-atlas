export const RECORD_STARTUP_ENTRIES = [
  { key: 'artifacts', module: 'src/ui/lib/runtimeArtifacts.ts', publicExport: 'preloadRuntimeArtifacts' },
  { key: 'routes', module: 'src/ui/lib/hashRoutes.ts', publicExport: 'parseHashLocation' },
  { key: 'reader', module: 'src/ui/lib/publisherRecordReader.ts', publicExport: 'startPublisherRecordReader' },
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
  const reader = bundle[entries.reader.slice(2)];
  const styles = new Set();
  const visited = new Set();
  const visit = chunk => {
    if (!chunk || chunk.type !== 'chunk') throw new Error('Record reader references an absent static dependency.');
    if (visited.has(chunk.fileName)) return;
    visited.add(chunk.fileName);
    for (const module of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) {
      const path = module.replaceAll('\\', '/');
      if (/\/node_modules\/(?:react(?:-dom)?\/|@tabler\/icons-react\/)|\/src\/ui\/(?:App\.tsx|pages\/)/.test(path)) {
        throw new Error(`Record reader static dependency requires the interactive framework: ${chunk.fileName}`);
      }
    }
    for (const style of chunk.viteMetadata?.importedCss ?? []) {
      if (bundle[style]?.type !== 'asset' || !/^assets\/[\w.-]+\.css$/.test(style)) throw new Error('Record reader references an invalid stylesheet.');
      styles.add(`./${style}`);
    }
    for (const dependency of chunk.imports ?? []) visit(bundle[dependency]);
  };
  visit(reader);
  entries.styles = [...styles];
  return entries;
}
