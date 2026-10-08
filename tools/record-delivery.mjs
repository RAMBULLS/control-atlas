import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const normalized = value => value.replace(/\\/g, '/').split('?')[0].replace(/\/$/, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

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

export function recordChunkGroups(rootDir) {
  const ui = new Set(RECORD_UI_MODULES.map(path => `${normalized(rootDir)}/${path}`));
  return [
    { name: 'record-ui', test: id => ui.has(normalized(id)), priority: 10,
      minShareCount: 1, entriesAware: false, includeDependenciesRecursively: false },
    { name: 'record-icons', test: id => RECORD_ICON_MODULES.some(path => normalized(id).endsWith(path)), priority: 20,
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
    groups: chunks.filter(chunk => ['record-ui', 'record-icons'].includes(chunk.name)).map(chunk => ({ name: chunk.name, file: chunk.fileName, modules: Object.keys(chunk.modules).map(normalized), imports: chunk.imports })),
    fontHashes: [...new Set(ORBITAL_FONT_HASHES)],
  };
}
