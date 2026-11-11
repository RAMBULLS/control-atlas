import assert from 'node:assert/strict';
import test from 'node:test';
import { learnArticles, practitionerGuides } from '../src/app/learn-content.mjs';

const prohibited = [/guarantees?\s+compliance/i, /recommend(s|ation)?\s+(an?\s+)?authorization/i, /you\s+(will|should)\s+receive\s+an?\s+ato/i, /determines?\s+compliance\s+status/i, /makes?\s+authorization\s+decisions/i];
function fields(value, path = '') {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((entry, i) => fields(entry, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => fields(entry, `${path}.${key}`));
  return [];
}
test('assurance guides: prohibited claim lint includes every procedural field', () => {
  for (const guide of [...learnArticles, ...practitionerGuides]) {
    for (const [field, value] of fields(guide)) for (const expression of prohibited) assert.doesNotMatch(value, expression, `${guide.id}${field}`);
  }
});
test('assurance guides: procedures retain their independent-source-review boundary', () => {
  for (const guide of practitionerGuides) {
    for (const field of ['goal', 'output', 'limitations']) assert.ok(guide[field]?.trim(), `${guide.id}.${field}`);
    for (const field of ['prerequisites', 'steps', 'validation', 'citations']) assert.ok(guide[field]?.length, `${guide.id}.${field}`);
    for (const citation of guide.citations) {
      assert.ok(citation.supports?.trim(), `${guide.id}: missing bounded support claim`);
      assert.match(citation.url, /^https:\/\//);
    }
  }
  // This proves structure and prohibited phrases only, never source meaning.
});
