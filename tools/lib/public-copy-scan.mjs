// Pulls the authored strings out of a source file so the public-copy contract
// checks copy and not code.
//
// Scanning raw file text made `quarantine.map(...)` and a parameter named
// `quarantine` look like public copy, which is how phrase lists turn into
// noise that people switch off. This looks at quoted strings and JSX text
// only. It is deliberately small: it does not parse, and it does not try to
// know which strings reach a screen. Being slightly over-inclusive among
// *authored strings* is fine; matching identifiers is not.

const STRING_LITERAL = /(?<!\\)(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
// JSX text: what sits between a closing > and the next opening <, with no
// braces in it (an expression is scanned as its own literals instead).
const JSX_TEXT = />([^<>{}]{3,})</g;

const CODE_ISH = [
  /^[\w./#@-]+$/,          // identifiers, paths, class names, ids
  /^[\s\d.,:;|/-]*$/,      // punctuation and numbers only
  /^(?:https?:|data:|#\/)/i,
  /^[A-Z][A-Z0-9_]*$/,     // SCREAMING_CASE constants
];

function isCodeIsh(value) {
  const trimmed = value.trim();
  if (trimmed.length < 3) return true;
  return CODE_ISH.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {string} source file contents
 * @returns {{text: string, line: number}[]} authored strings with 1-based lines
 */
export function extractAuthoredStrings(source) {
  const found = [];
  const lineAt = (index) => source.slice(0, index).split("\n").length;

  for (const match of source.matchAll(STRING_LITERAL)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isCodeIsh(value)) found.push({ text: value, line: lineAt(match.index) });
  }
  for (const match of source.matchAll(JSX_TEXT)) {
    const value = match[1];
    if (!isCodeIsh(value)) found.push({ text: value, line: lineAt(match.index) });
  }
  return found;
}

/**
 * @returns {{file: string, line: number, pattern: string, text: string}[]}
 */
export function findProhibitedCopy(files, patterns, read) {
  const violations = [];
  for (const file of files) {
    for (const { text, line } of extractAuthoredStrings(read(file))) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          violations.push({ file, line, pattern: String(pattern), text: text.trim().slice(0, 160) });
        }
      }
    }
  }
  return violations;
}
