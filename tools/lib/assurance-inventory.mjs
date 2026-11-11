export function assertRegistryInventory(templates, guides) {
  if (!Array.isArray(templates) || templates.length !== 10 || new Set(templates.map(t => t.template_id)).size !== 10 || new Set(templates.map(t => t.name)).size !== 10) throw new Error('Expected ten unique registered templates');
  if (!Array.isArray(guides) || guides.length !== 11 || new Set(guides.map(g => g.id)).size !== 11) throw new Error('Expected eleven unique registered guides');
  for (const template of templates) {
    if (!template.template_id || !template.name || !Array.isArray(template.supported_formats) || !template.supported_formats.length || new Set(template.supported_formats).size !== template.supported_formats.length || template.supported_formats.some(f => !['xlsx', 'docx'].includes(f))) throw new Error('Invalid template identity or format');
  }
  if (guides.some(g => typeof g.id !== 'string' || !g.id.trim())) throw new Error('Empty guide ID');
}
export function assertSearchInventory(benchmark) {
  if (!Array.isArray(benchmark?.queries) || !benchmark.queries.length) throw new Error('Empty reviewed search inventory');
  const ids = new Set();
  for (const fixture of benchmark.queries) {
    if (typeof fixture.id !== 'string' || !fixture.id.trim() || ids.has(fixture.id)) throw new Error('Missing or duplicate reviewed search ID');
    ids.add(fixture.id);
    if (typeof fixture.query !== 'string' || !fixture.query.trim() || !Number.isInteger(fixture.top_k) || fixture.top_k < 1) throw new Error('Invalid reviewed query or top-k');
    if (!Array.isArray(fixture.expected_ids) || new Set(fixture.expected_ids).size !== fixture.expected_ids.length || fixture.expected_ids.some(id => typeof id !== 'string' || !id.trim()) || fixture.expected_ids.length > fixture.top_k) throw new Error('Invalid expected search identity set');
    if (!fixture.expected_ids.length && fixture.expect_no_results !== true) throw new Error('Zero-result fixture requires explicit intent');
    if (fixture.expected_ids.length && fixture.expect_no_results === true) throw new Error('Contradictory zero-result intent');
  }
}
