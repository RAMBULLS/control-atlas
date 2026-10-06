import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { externalizeOrbitalFonts } from "../tools/orbital-font-assets.mjs";

const orbitalPackage = JSON.parse(
  readFileSync("node_modules/orbital-archive-no-01/package.json", "utf8"),
);
const projectPackage = JSON.parse(readFileSync("package.json", "utf8"));
const upstream = JSON.parse(
  readFileSync("node_modules/orbital-archive-no-01/tokens/tokens.json", "utf8"),
);
const tokens = readFileSync("styles/tokens.css", "utf8");

const PALETTE = {
  orbit: "--lsm-orbit",
  graphite: "--lsm-graphite",
  slate: "--lsm-slate",
  alloy: "--lsm-alloy",
  gridline: "--lsm-grid-line",
  dust: "--lsm-dust",
  bone: "--lsm-bone",
  teal: "--lsm-teal",
  gold: "--lsm-gold",
  orange: "--lsm-orange",
  signal: "--lsm-signal",
  rust: "--lsm-rust",
  fault: "--lsm-fault",
};

test("Control Atlas pins the official Orbital v1.8.0 release", () => {
  assert.equal(orbitalPackage.name, "orbital-archive-no-01");
  assert.equal(orbitalPackage.version, "1.8.0");
  assert.match(
    projectPackage.dependencies["orbital-archive-no-01"],
    /\/v1\.8\.0\.tar\.gz$/,
  );
});

test("Control Atlas palette aliases resolve to official Orbital variables", () => {
  for (const [key, alias] of Object.entries(PALETTE)) {
    assert.ok(upstream.color.palette[key], `Orbital palette missing ${key}`);
    assert.match(
      tokens,
      new RegExp(`${alias}:\\s*var\\(--lsm-color-palette-${key}\\)`),
      `${alias} must resolve to Orbital color.palette.${key}`,
    );
  }
});

test("relay stays a documented Control Atlas data-only extension", () => {
  assert.match(tokens, /--lsm-relay:\s*#54bcd9/i);
  assert.equal(upstream.color.palette.relay?.$value, "{color.palette.teal}");
});

test("Orbital font externalization preserves every declared face and exact upstream bytes", () => {
  const stylesheet = readFileSync("node_modules/orbital-archive-no-01/assets/fonts.css", "utf8");
  const originalUrls = [...stylesheet.matchAll(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)];
  const { css, assets, declarations, faces } = externalizeOrbitalFonts(stylesheet);
  assert.equal(originalUrls.length, 5);
  assert.equal(declarations, originalUrls.length);
  assert.equal(assets.size, 4, "the two Oswald weights share exactly one font asset");
  let index = 0;
  const restored = css.replace(/url\("\.\/([^"/]+\.woff2)"\)/g, (_url, filename) => {
    const original = originalUrls[index++];
    assert.deepEqual(assets.get(filename), Buffer.from(original[1], "base64"));
    return original[0];
  });
  assert.equal(index, 5);
  assert.equal(restored, stylesheet, "all faces, weights, styles, display rules and notices stay byte-for-byte intact");
  assert.doesNotMatch(css, /data:font/);
  assert.deepEqual(faces.map(({ filename: _filename, ...face }) => face), [
    { family: "IBM Plex Mono", style: "normal", weight: "400", display: "swap" },
    { family: "IBM Plex Mono", style: "normal", weight: "600", display: "swap" },
    { family: "Oswald", style: "normal", weight: "600", display: "swap" },
    { family: "Oswald", style: "normal", weight: "700", display: "swap" },
    { family: "Silkscreen", style: "normal", weight: "400", display: "swap" },
  ]);
});

test("Orbital font extraction rejects missing or malformed upstream payloads", () => {
  assert.throws(() => externalizeOrbitalFonts("/* No font declarations */"), /missing or unsupported/);
  assert.throws(() => externalizeOrbitalFonts("url(data:font/woff2;base64,bm90LWEtZm9udA==)"), /valid encoded WOFF2/);
  assert.throws(() => externalizeOrbitalFonts("url(data:font/woff2;base64,d09GMg==) url(data:font/unsupported;base64,AA==)"), /missing or unsupported/);
});
