import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startRoutePrefetch } from '../src/shared/route-prefetch.mjs';

const require = createRequire(import.meta.url);
const normalized = value => value.replace(/\\/g, '/').split('?')[0].replace(/\/$/, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Keep the exact arrival script in the document, admitted by its own CSP hash.
 * @param {string} html
 * @param {Record<string, any>} bundle
 * @param {string} rootDir
 * @param {{version: string, shardCount: number}} options
 * @param {string} shell */
export function inlineArrivalDelivery(html, bundle, rootDir, options, shell) {
  const report = verifyRecordDelivery(bundle, rootDir);
  const modules = ['renderer', 'data-warmup', 'interactive-shell'].map(name => {
    const chunk = Object.values(bundle).find(output => output.type === 'chunk' && output.name === name);
    if (!chunk) throw new Error(`Early route delivery is missing ${name}.`);
    return chunk.fileName;
  });
  const routeModules = Object.fromEntries([['record', 'ObjectDetailPage.tsx'], ['resource-detail', 'CommonsDetailPage.tsx']].map(([route, page]) => {
    const entry = report.pages.find(entry => entry.id.endsWith(`/pages/${page}`));
    if (!entry) throw new Error(`Initial route entry is missing: ${page}`);
    const files = new Set();
    const visit = file => {
      if (files.has(file)) return;
      files.add(file);
      const chunk = bundle[file];
      if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
    };
    visit(entry.file);
    return [route, [...files]];
  }));
  const source = `(${startRoutePrefetch.toString()})(${JSON.stringify({ ...options, modules, routeModules })});\n${shell}\ndocument.addEventListener("DOMContentLoaded", window.controlAtlasSyncFirstPaintShell, {once:true});\n`;
  if (/<\/script/i.test(source)) throw new Error('Arrival source cannot contain a script end tag.');
  const digest = createHash('sha256').update(source).digest('base64');
  if (!html.includes("script-src 'self'") || !html.includes('<title>Control Atlas</title>')) throw new Error('Arrival delivery requires the existing CSP and title.');
  return html.replace('<script src="./progressive-shell.js"></script>', '')
    .replace('<link rel="preload" href="./progressive-shell.js" as="script">', '')
    .replace(/script-src ([^;]+);/, `script-src $1 'sha256-${digest}';`)
    .replace('<title>Control Atlas</title>', `<title>Control Atlas</title>\n<script data-arrival-delivery>${source}</script>`);
}

export const HOME_SHELL_MODULES = Object.freeze([
  'src/shared/atlas-presentation.ts',
  'src/shared/brand-rotation.ts',
  'src/shared/navigation-events.ts',
  'src/shared/route-prefetch.mjs',
  'src/ui/lib/homeDisclosure.ts',
]);

export const RECORD_UI_MODULES = Object.freeze([
  'src/app/display-names.mjs',
  'src/shared/record-taxonomy.mjs',
  'src/ui/components/AppLink.tsx',
  'src/ui/components/DimensionGlyph.tsx',
  'src/ui/components/ProvenanceTerm.tsx',
  'src/ui/components/TaxonomyContext.tsx',
  'src/ui/lib/areaVisualLanguage.ts',
  'src/ui/lib/catalogProfiles.ts',
  'src/ui/lib/officialSource.ts',
  'src/ui/lib/pagePrimitives.tsx',
  'src/ui/lib/recordTitle.ts',
  'src/ui/lib/sourcePresentation.ts',
  'src/ui/lib/waitForRecordPaint.ts',
  'src/ui/lib/taxonomyContext.ts',
]);
export const RECORD_ICON_MODULES = Object.freeze([
  'IconBook2', 'IconInfoCircle', 'IconExternalLink', 'IconCheck',
  'IconTool', 'IconFlag', 'IconFileText',
].map(name => `/node_modules/@tabler/icons-react/dist/esm/icons/${name}.mjs`));

/** @param {Iterable<string>} moduleIds
 * @param {(id: string) => {importedIds?: readonly string[]} | null | undefined} info
 * @param {string} rootDir */
export function planInteractiveDelivery(moduleIds, info, rootDir) {
  const ids = [...moduleIds];
  const source = path => ids.find(id => normalized(id) === `${normalized(rootDir)}/${path}`);
  for (const path of ['src/main.tsx', 'src/ui/App.tsx', 'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/hashRoutes.ts', 'src/ui/pages/ObjectDetailPage.tsx', 'src/ui/lib/recordRouteModule.ts']) {
    if (!source(path)) throw new Error(`Interactive delivery graph is missing ${path}.`);
  }
  /** @param {(string | undefined)[]} entries */
  const closure = entries => {
    /** @type {Set<string>} */
    const seen = new Set();
    const visit = id => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      for (const dependency of info(id)?.importedIds ?? []) visit(dependency);
    };
    entries.forEach(visit);
    return seen;
  };
  // Use the bundler's resolved static graph. Dynamic page imports stay separate,
  // and shared Home/data modules cannot acquire a dependency on React.
  const home = closure([source('src/main.tsx')]);
  const warmup = closure([source('src/ui/lib/runtimeLoader.ts'), source('src/ui/lib/hashRoutes.ts')]);
  const renderer = new Set(ids.filter(id => /\/node_modules\/(?:react(?:-dom)?|scheduler)\//.test(normalized(id))));
  const interactive = closure([source('src/ui/App.tsx'), ...renderer]);
  const record = closure([source('src/ui/pages/ObjectDetailPage.tsx')]);
  for (const id of record) {
    if (/\/node_modules\/@tabler\/icons-react\//.test(normalized(id))) {
      for (const dependency of closure([id])) interactive.add(dependency);
    }
  }
  for (const id of home) { interactive.delete(id); warmup.delete(id); }
  for (const id of warmup) interactive.delete(id);
  for (const id of renderer) interactive.delete(id);
  // This tiny route import must remain available before the renderer arrives.
  interactive.delete(source('src/ui/lib/recordRouteModule.ts'));
  const support = entries => new Set([...closure(entries)].filter(id =>
    !home.has(id) && !warmup.has(id) && !interactive.has(id) && !renderer.has(id) &&
    id !== source('src/ui/lib/recordRouteModule.ts') &&
    !/\/src\/ui\/pages\/[^/]+Page\.tsx$/.test(normalized(id))));
  const recordSupport = support([source('src/ui/pages/ObjectDetailPage.tsx')]);
  const resourceSupport = support([source('src/ui/pages/CommonsPage.tsx')]);
  for (const id of recordSupport) resourceSupport.delete(id);
  // Their real publication/task consumers still own the full descriptions.
  // Route validation's build-time names/formats/ids must not pin those source
  // authorities into an arrival group after its fallback branch is folded.
  for (const path of ['data/template-registry.json', 'data/compliance-workflows.json']) {
    const id = source(path);
    if (!id) continue;
    for (const group of [warmup, interactive, recordSupport, resourceSupport]) group.delete(id);
  }
  return { interactive, warmup, renderer, recordSupport, resourceSupport };
}

/** @param {string} rootDir
 * @param {{interactive: Set<string>, warmup: Set<string>, renderer?: Set<string>, recordSupport?: Set<string>, resourceSupport?: Set<string>}} delivery */
export function recordChunkGroups(rootDir, delivery = { interactive: new Set(), warmup: new Set() }) {
  const ui = new Set(RECORD_UI_MODULES.map(path => `${normalized(rootDir)}/${path}`));
  const home = new Set(HOME_SHELL_MODULES.map(path => `${normalized(rootDir)}/${path}`));
  return [
    // Bundle the already-required static support closure, rather than making
    // each small shared formatter or renderer a separate arrival request.
    // Other page entries and every dynamic import remain independent.
    { name: 'record-ui', test: id => ui.has(normalized(id)) || (delivery.recordSupport?.has(id) ?? false), priority: 30,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'resources-ui', test: id => delivery.resourceSupport?.has(id) ?? false, priority: 25,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'record-icons', test: id => RECORD_ICON_MODULES.some(path => normalized(id).endsWith(path)), priority: 20,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    // Keep the entry in its natural chunk. Capturing it here creates an extra
    // entry facade and a cycle through the HTML/CSS entry. The shared preload
    // helper belongs with these finite non-React shell dependencies.
    { name: 'home-shell', test: id => home.has(normalized(id)) || id === '\0vite/preload-helper.js', priority: 10,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'interactive-shell', test: id => delivery.interactive.has(id), priority: 40,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'renderer', test: id => delivery.renderer?.has(id) ?? false, priority: 45,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'data-warmup', test: id => delivery.warmup.has(id), priority: 50,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
  ];
}

// These are the existing pinned Orbital v1.8.0 font bytes, in declaration order.
// Duplicate Oswald weights intentionally share one font file, as upstream does.
export const ORBITAL_FONT_HASHES = Object.freeze([
  '08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7',
  '0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83',
  '571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed',
  '571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed',
  'e6c72ea4702249202bcdd79d3343057e4e25ef1f04e3fcffd8602ab53b40b4cc',
]);

export function orbitalFontPreloads(bundle) {
  return [ORBITAL_FONT_HASHES[0]].map(digest => {
    const asset = Object.values(bundle).find(output => output.type === 'asset' && output.fileName.endsWith('.woff2') && hash(output.source) === digest);
    if (!asset) throw new Error('A first-paint Orbital font asset is missing.');
    return { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `./${asset.fileName}`, crossorigin: 'anonymous' }, injectTo: 'head-prepend' };
  });
}

export function externalizeOrbitalFonts(css) {
  const fonts = new Map();
  const observed = [];
  const output = css.replace(/url\((['"]?)data:font\/woff2;base64,([A-Za-z0-9+/=]+)\1\)/g, (_all, _quote, encoded) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2' || bytes.toString('base64') !== encoded) {
      throw new Error('Invalid embedded Orbital font bytes.');
    }
    const digest = hash(bytes);
    observed.push(digest);
    fonts.set(digest, bytes);
    return `url('./${digest}.woff2?no-inline')`;
  });
  if (JSON.stringify(observed) !== JSON.stringify(ORBITAL_FONT_HASHES) || /url\([^)]*data:/i.test(output)) {
    throw new Error('Pinned Orbital font declarations changed; review the source bytes before updating the adapter.');
  }
  return { css: output, fonts };
}

export function materializeOrbitalFonts(rootDir) {
  const { css, fonts } = externalizeOrbitalFonts(readFileSync(require.resolve('orbital-archive-no-01/fonts.css'), 'utf8'));
  const directory = resolve(rootDir, '.local/orbital-fonts-v1.8.0');
  mkdirSync(directory, { recursive: true });
  for (const [digest, bytes] of fonts) writeFileSync(resolve(directory, `${digest}.woff2`), bytes);
  const stylesheet = resolve(directory, 'fonts.css');
  writeFileSync(stylesheet, css);
  return stylesheet;
}

export function verifyRecordDelivery(bundle, rootDir) {
  const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
  const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const owns = (chunk, path) => Object.keys(chunk.modules).some(id => normalized(id) === `${normalized(rootDir)}/${path}`);
  const closure = start => {
    const seen = new Set();
    const visit = name => {
      if (seen.has(name)) return;
      const chunk = byName.get(name);
      if (!chunk) return;
      seen.add(name);
      chunk.imports.forEach(visit);
    };
    visit(start.fileName);
    return [...seen].map(name => byName.get(name));
  };
  const home = chunks.find(chunk => owns(chunk, 'src/main.tsx'));
  const loader = chunks.find(chunk => owns(chunk, 'src/ui/lib/runtimeLoader.ts'));
  if (!home || !loader) throw new Error('Record delivery entry or loader chunk is missing.');
  const homeEntries = chunks.filter(chunk => chunk.isEntry && closure(chunk).includes(home));
  if (!homeEntries.length) throw new Error('Home has no emitted entry closure.');
  const forbidden = /\/node_modules\/react(?:-dom)?\/|\/src\/ui\/pages\/|\/src\/ui\/App\.tsx$/;
  for (const [name, entry] of [['Home', home], ...homeEntries.map(entry => ['Home entry', entry]), ['Runtime preloader', loader]]) {
    for (const chunk of closure(entry)) {
      if (['record-ui', 'record-icons'].includes(chunk.name) || Object.keys(chunk.modules).some(id => forbidden.test(normalized(id)))) {
        throw new Error(`${name} statically imports route UI or React through ${chunk.fileName}.`);
      }
      if (Object.entries(chunk.modules).some(([id, module]) => /\/data\/(?:template-registry|compliance-workflows)\.json$/.test(normalized(id)) && module.renderedLength > 0)) {
        throw new Error(`${name} includes full task descriptions instead of compiled route choices.`);
      }
    }
  }
  // The classic progressive-shell script is the fourth allowed request.
  // Count the actual emitted entry, including a facade if one is present.
  for (const entry of homeEntries) {
    const entryClosure = closure(entry);
    if (entryClosure.length > 3) {
      const diagnostic = JSON.stringify({
        totalChunks: entryClosure.length,
        chunks: entryClosure.slice(0, 8).map(chunk => ({
          file: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code),
          importCount: chunk.imports.length,
          imports: chunk.imports.slice(0, 8),
          moduleCount: Object.keys(chunk.modules).length,
          modules: Object.keys(chunk.modules).slice(0, 16)
            .map(id => normalized(id).replace(`${normalized(rootDir)}/`, '')),
        })),
        omittedChunks: Math.max(0, entryClosure.length - 8),
      });
      throw new Error(`Home entry exceeds three module scripts: ${entry.fileName}.\n${diagnostic.slice(0, 12_000)}${diagnostic.length > 12_000 ? '\n[closure diagnostic truncated at 12000 characters]' : ''}`);
    }
  }
  const pages = chunks.flatMap(chunk => Object.keys(chunk.modules).filter(id => /\/src\/ui\/pages\/[^/]+Page\.tsx$/.test(normalized(id)))
    .map(id => ({ id: normalized(id), file: chunk.fileName })));
  if (new Set(pages.map(page => page.file)).size !== pages.length) throw new Error('Page entries were coalesced.');
  const emittedFontHashes = new Set(Object.values(bundle).filter(output => output.type === 'asset' && output.fileName.endsWith('.woff2'))
    .map(output => hash(output.source)));
  if (ORBITAL_FONT_HASHES.some(digest => !emittedFontHashes.has(digest))) throw new Error('An exact Orbital font asset was omitted or changed.');
  const describeClosure = entry => closure(entry).map(chunk => ({
    file: chunk.fileName, name: chunk.name, bytes: Buffer.byteLength(chunk.code), imports: chunk.imports,
    modules: Object.keys(chunk.modules).map(id => normalized(id).replace(`${normalized(rootDir)}/`, '')),
  }));
  // Include an emitted entry facade when present, not just the chunk containing
  // main.tsx. Its extra request is part of the real Home bootstrap cost.
  return { home: home.fileName, runtimeLoader: loader.fileName, pages,
    homeEntryClosures: homeEntries.map(entry => ({ entry: entry.fileName, chunks: describeClosure(entry) })),
    runtimeLoaderClosure: describeClosure(loader),
    initialRouteClosures: pages.filter(page => /\/(?:ObjectDetail|Commons)Page\.tsx$/.test(page.id)).map(page => ({
      page: normalized(page.id).replace(`${normalized(rootDir)}/`, ''),
      chunks: closure(byName.get(page.file)).map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code) })),
    })),
    groups: chunks.filter(chunk => ['record-ui', 'resources-ui', 'record-icons', 'interactive-shell', 'renderer', 'data-warmup'].includes(chunk.name)).map(chunk => ({ name: chunk.name, file: chunk.fileName, bytes: Buffer.byteLength(chunk.code),
      modules: Object.keys(chunk.modules).map(normalized), moduleLengths: Object.entries(chunk.modules).map(([id, module]) => ({ id: normalized(id), renderedLength: Number.isFinite(module.renderedLength) ? module.renderedLength : null })), imports: chunk.imports })),
    fontHashes: [...new Set(ORBITAL_FONT_HASHES)],
  };
}
