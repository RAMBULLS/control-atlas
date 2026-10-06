const RECORD_MODULES = [
  '/src/ui/App.tsx',
  '/src/ui/pages/ObjectDetailPage.tsx',
  '/src/ui/lib/runtimeLoader.ts',
  '/src/ui/lib/runtimeArtifacts.ts',
  '/src/ui/lib/hashRoutes.ts',
  '/src/ui/lib/recordPageLoader.ts',
  '/node_modules/react-dom/client.js',
];

/** Build record hints from emitted modules, including only static imports. */
export function recordStartupHints(bundle) {
  const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
  const visited = new Set();
  const styles = new Set();
  const visit = filename => {
    if (visited.has(filename)) return;
    const chunk = bundle[filename];
    if (!chunk || chunk.type !== 'chunk' || !/^assets\/[\w.-]+\.js$/.test(filename)) {
      throw new Error(`Record startup references an invalid emitted chunk: ${filename}`);
    }
    visited.add(filename);
    for (const css of chunk.viteMetadata?.importedCss ?? []) {
      if (bundle[css]?.type !== 'asset' || !/^assets\/[\w.-]+\.css$/.test(css)) {
        throw new Error(`Record startup references an invalid emitted stylesheet: ${css}`);
      }
      styles.add(css);
    }
    for (const dependency of chunk.imports) visit(dependency);
  };
  for (const module of RECORD_MODULES) {
    const chunk = chunks.find(output => Object.keys(output.modules).some(
      id => id.replaceAll('\\', '/').endsWith(module),
    ));
    if (!chunk) throw new Error(`Record startup module is absent from the build: ${module}`);
    visit(chunk.fileName);
  }
  return {
    modules: [...visited].sort().map(filename => `./${filename}`),
    styles: [...styles].sort().map(filename => `./${filename}`),
  };
}
