import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_IMPORT = 'orbital-archive-no-01/fonts.css';
const EMBEDDED_FONT = /url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g;
const FAMILY_NOTICES = {
  'IBM Plex Mono': 'ibmplexmono-OFL.txt',
  Oswald: 'oswald-OFL.txt',
  Silkscreen: 'silkscreen-OFL.txt',
};

/** Preserve the upstream stylesheet except for its embedded font URLs. */
export function externalizeOrbitalFonts(stylesheet) {
  const assets = new Map();
  let declarations = 0;
  const css = stylesheet.replace(EMBEDDED_FONT, (_url, encoded) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.subarray(0, 4).toString() !== 'wOF2') {
      throw new Error('Orbital font payload is not a valid encoded WOFF2 file.');
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    const filename = `orbital-font-${digest}.woff2`;
    assets.set(filename, bytes);
    declarations += 1;
    return `url("./${filename}")`;
  });
  if (!declarations || css.includes('data:font/')) {
    throw new Error('Orbital embedded font declarations are missing or unsupported.');
  }
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => {
    const value = property => block.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1].trim().replace(/^['"]|['"]$/g, '');
    const family = value('font-family');
    const filename = block.match(/url\("\.\/([^"/]+\.woff2)"\)/)?.[1];
    if (!FAMILY_NOTICES[family] || !assets.has(filename)) throw new Error('Unsupported Orbital font face.');
    return { family, style: value('font-style'), weight: value('font-weight'), display: value('font-display'), filename };
  });
  if (faces.length !== declarations) throw new Error('Orbital font declaration inventory does not reconcile.');
  return { css, assets, declarations, faces };
}

/**
 * Stage reproducible build inputs in the ignored cache. Vite's normal CSS asset
 * pipeline owns URL resolution, hashing and emission; no bundle is changed after
 * hashing. Development continues to use the unmodified upstream stylesheet.
 * @returns {import('vite').Plugin}
 */
export function orbitalFontAssetsPlugin(rootDirectory) {
  const cacheDirectory = resolve(rootDirectory, '.local/orbital-font-assets');
  const stylesheetPath = join(cacheDirectory, 'fonts.css');
  const upstreamPath = fileURLToPath(import.meta.resolve(FONT_IMPORT));
  const upstreamDirectory = dirname(dirname(upstreamPath));
  let extracted;
  return {
    name: 'control-atlas-orbital-font-assets',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      for (const filename of Object.values(FAMILY_NOTICES)) {
        this.emitFile({ type: 'asset', fileName: `assets/font-licenses/${filename}`,
          source: readFileSync(join(rootDirectory, 'styles/font-notices', filename)) });
      }
      this.emitFile({ type: 'asset', fileName: 'assets/font-licenses/orbital-LICENSE.txt',
        source: readFileSync(join(upstreamDirectory, 'LICENSE')) });
    },
    config() {
      return {
        build: {
          assetsInlineLimit(filePath) {
            // Only extracted Orbital fonts must stay external. Other assets keep
            // Vite's configured default behavior.
            if (resolve(filePath).startsWith(`${cacheDirectory}${sep}`)) return false;
          },
        },
      };
    },
    resolveId(source) {
      if (source !== FONT_IMPORT) return;
      extracted = externalizeOrbitalFonts(readFileSync(upstreamPath, 'utf8'));
      const { css, assets } = extracted;
      mkdirSync(cacheDirectory, { recursive: true });
      for (const [filename, bytes] of assets) writeFileSync(join(cacheDirectory, filename), bytes);
      writeFileSync(stylesheetPath, css);
      this.addWatchFile(upstreamPath);
      return stylesheetPath;
    },
    generateBundle(_options, bundle) {
      if (!extracted) throw new Error('Orbital font stylesheet was not included in the build.');
      const emitted = Object.values(bundle).filter(output => output.type === 'asset' && output.fileName.endsWith('.woff2'));
      const assets = [...extracted.assets].map(([filename, bytes]) => {
        const matches = emitted.filter(output => Buffer.from(output.source).equals(bytes));
        if (matches.length !== 1) throw new Error(`Orbital font emission does not reconcile: ${filename}.`);
        const faces = extracted.faces.filter(face => face.filename === filename).map(({ filename: _filename, ...face }) => face);
        return { fileName: matches[0].fileName, byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'), faces,
          license: `assets/font-licenses/${FAMILY_NOTICES[faces[0].family]}` };
      });
      const upstream = JSON.parse(readFileSync(join(upstreamDirectory, 'package.json'), 'utf8'));
      this.emitFile({ type: 'asset', fileName: 'assets/font-licenses/font-assets.json', source: `${JSON.stringify({
        upstreamPackage: upstream.name, upstreamVersion: upstream.version,
        upstreamLicense: 'assets/font-licenses/orbital-LICENSE.txt', assets,
      }, null, 2)}\n` });
    },
  };
}
