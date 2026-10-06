import { createHash } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';

function text(value) {
  return value == null ? '' : String(value).replace(/\r/g, '').trim();
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function columnName(index) {
  let number = index + 1;
  let output = '';
  while (number > 0) {
    number -= 1;
    output = String.fromCharCode(65 + (number % 26)) + output;
    number = Math.floor(number / 26);
  }
  return output;
}

function cellFragment(sourceKey, sheet, rowIndex, columnIndex, field, value) {
  const normalized = text(value);
  return {
    field,
    source_key: sourceKey,
    sheet,
    cell: `${columnName(columnIndex)}${rowIndex + 1}`,
    text: normalized,
    checksum: checksum(normalized),
    extraction_method: 'read-excel-file-9.2.0-cell',
  };
}

function findColumn(headers, pattern) {
  return headers.findIndex((header) => pattern.test(text(header)));
}

function mappingTargetIds(value, kind) {
  const patterns = {
    csf_2: /\b[A-Z]{2}[.-][A-Z]{2}(?:-\d{2})?\b/g,
    csf_1_1: /\b[A-Z]{2}[.-][A-Z]{2}(?:-\d+)?\b/g,
    sp_800_53: /\b[A-Z]{2,3}-\d+(?:\(\d+\))?\b/g,
    critical_software: /\bSM\s+\d+\.\d+\b/g,
  };
  const matches = text(value).match(patterns[kind]);
  return [...new Set((matches || []).map((entry) => entry
    .replace(/\s+/, '-')
    .replace(/^([A-Z]{2})-([A-Z]{2}(?:-\d+)?)/, '$1.$2')))];
}

/** Parse only the publisher's leading relationship clause, never prose or IDs.
 * NIST SP 1800-35 uses supportive concept mappings (IR 8477), including
 * "Supported by" without "Is", and explicit compound relationships.
 * Unrecognized shorthand stays unresolved instead of defaulting to Supports.
 */
export function relationDetails(value) {
  const prefix = text(value).split(':', 1)[0];
  const clauses = [];
  let rest = prefix;
  const clause = /^(supports|(?:is\s+)?supported\s+by|equivalent)\b\s*(?:\(([^)]+)\))?/i;
  while (true) {
    const match = clause.exec(rest);
    if (!match) break;
    const relationshipType = /^supports$/i.test(match[1]) ? 'supports'
      : /supported/i.test(match[1]) ? 'supported_by' : 'equivalent';
    const property = text(match[2]).toLowerCase();
    const strength = /^integral(?: to)?$/.test(property) ? 'integral'
      : /^example(?: of)?$/.test(property) ? 'example'
        : property === 'precedes' ? 'precedes' : 'unspecified';
    clauses.push({ relationship_type: relationshipType, property: property || null, strength });
    rest = rest.slice(match[0].length).trimStart();
    if (!/^and\s+(?:supports|(?:is\s+)?supported\s+by|equivalent)\b/i.test(rest)) break;
    rest = rest.replace(/^and\s+/i, '');
  }
  return {
    raw_relationship_type: prefix,
    direction: clauses.length > 1 ? 'compound'
      : clauses[0]?.relationship_type === 'supported_by' ? 'component_supported_by_target'
        : clauses[0]?.relationship_type === 'supports' ? 'component_supports_target'
          : clauses[0]?.relationship_type === 'equivalent' ? 'equivalent' : 'unresolved',
    strength: clauses.length === 1 ? clauses[0].strength : 'unspecified',
    relationship_clauses: clauses,
    relationship_parse_status: clauses.length ? 'explicit' : 'unresolved',
  };
}

export async function parseNistZeroTrustMappingWorkbook(bytes, source) {
  const workbook = await readXlsxFile(bytes);
  const mappings = [];
  const sheets = [];
  for (const worksheet of workbook) {
    const headerRow = worksheet.data.findIndex((row) => row.some((value) => /zta .*architecture component/i.test(text(value)))
      && row.some((value) => /relationship/i.test(text(value))));
    if (headerRow < 0) throw new Error(`${source.source_key} worksheet ${worksheet.sheet} has no mapping header`);
    const headers = worksheet.data[headerRow];
    const componentColumn = findColumn(headers, /architecture component/i);
    const productColumn = findColumn(headers, /^product$/i);
    const functionColumn = findColumn(headers, /component.s function/i);
    const relationshipColumn = findColumn(headers, /relationship/i);
    const explanationColumn = findColumn(headers, /relationship explanation/i);
    if ([componentColumn, functionColumn, relationshipColumn, explanationColumn].some((index) => index < 0)) {
      throw new Error(`${source.source_key} worksheet ${worksheet.sheet} is missing required columns`);
    }

    const carried = new Map();
    let previousMapping = null;
    let sheetMappings = 0;
    for (let rowIndex = headerRow + 1; rowIndex < worksheet.data.length; rowIndex += 1) {
      const row = worksheet.data[rowIndex];
      for (const [field, column] of [['architecture_component', componentColumn], ['product', productColumn], ['component_function', functionColumn]]) {
        if (column < 0) continue;
        const value = text(row[column]);
        if (value) carried.set(field, { value, rowIndex, column });
      }
      const sourceRelationship = text(row[relationshipColumn]);
      if (!sourceRelationship) continue;
      const repeatsPrevious = /^same as previous row\.?$/i.test(sourceRelationship);
      if (repeatsPrevious && !previousMapping) {
        throw new Error(`${source.source_key} ${worksheet.sheet} row ${rowIndex + 1} refers to a missing previous mapping`);
      }
      const relationship = repeatsPrevious ? previousMapping.relationship : sourceRelationship;
      const explanation = /^see previous row\.?$/i.test(text(row[explanationColumn]))
        ? previousMapping?.explanation
        : text(row[explanationColumn]);
      const targetIds = mappingTargetIds(relationship, source.mapping_kind);
      if (!targetIds.length) {
        throw new Error(`${source.source_key} ${worksheet.sheet}!${columnName(relationshipColumn)}${rowIndex + 1} has no parseable target identifier`);
      }
      const component = carried.get('architecture_component');
      const componentFunction = carried.get('component_function');
      if (!component || !componentFunction) {
        throw new Error(`${source.source_key} ${worksheet.sheet} row ${rowIndex + 1} has a mapping without its component context`);
      }
      const product = carried.get('product');
      for (const targetId of targetIds) {
        const fragments = [
          cellFragment(source.source_key, worksheet.sheet, component.rowIndex, component.column, 'architecture_component', component.value),
          product ? cellFragment(source.source_key, worksheet.sheet, product.rowIndex, product.column, 'product', product.value) : null,
          cellFragment(source.source_key, worksheet.sheet, componentFunction.rowIndex, componentFunction.column, 'component_function', componentFunction.value),
          cellFragment(source.source_key, worksheet.sheet, rowIndex, relationshipColumn, repeatsPrevious ? 'relationship_notation' : 'relationship', sourceRelationship),
          cellFragment(source.source_key, worksheet.sheet, rowIndex, explanationColumn, 'relationship_explanation', row[explanationColumn]),
          ...(repeatsPrevious ? previousMapping.source_fragments : []),
        ].filter(Boolean);
        mappings.push({
          id: `MAP-${checksum(`${source.source_key}\0${worksheet.sheet}\0${rowIndex}\0${targetId}`).slice(7, 23)}`,
          mapping_kind: source.mapping_kind,
          collaborator: productColumn >= 0 ? worksheet.sheet : null,
          architecture_component: component.value,
          product: product?.value || null,
          component_function: componentFunction.value,
          target_id: targetId,
          relationship,
          relationship_explanation: explanation,
          source_notation: repeatsPrevious ? sourceRelationship : null,
          ...relationDetails(relationship),
          locator: `${source.url}#sheet=${encodeURIComponent(worksheet.sheet)}&row=${rowIndex + 1}`,
          source_fragments: fragments,
        });
        sheetMappings += 1;
      }
      previousMapping = {
        relationship,
        explanation,
        source_fragments: [
          cellFragment(source.source_key, worksheet.sheet, rowIndex, relationshipColumn, 'relationship', sourceRelationship),
          cellFragment(source.source_key, worksheet.sheet, rowIndex, explanationColumn, 'relationship_explanation', row[explanationColumn]),
        ],
      };
    }
    sheets.push({ name: worksheet.sheet, rows: worksheet.data.length, mappings: sheetMappings });
  }
  if (!mappings.length) throw new Error(`${source.source_key} contained no mappings`);
  const ids = new Set(mappings.map((entry) => entry.id));
  if (ids.size !== mappings.length) throw new Error(`${source.source_key} produced duplicate mapping IDs`);
  return { mappings, sheets };
}

export async function parseMicrosoftZeroTrustQuestionnaire(bytes, source) {
  const workbook = await readXlsxFile(bytes);
  const questions = [];
  const sheets = [];
  for (const worksheet of workbook.filter((entry) => /^\d+-/.test(entry.sheet))) {
    const headerRow = worksheet.data.findIndex((row) => row.some((value) => text(value) === 'Question'));
    if (headerRow < 0) throw new Error(`${source.source_key} worksheet ${worksheet.sheet} has no question header`);
    const headers = worksheet.data[headerRow];
    const questionColumn = findColumn(headers, /^question$/i);
    const answerColumn = findColumn(headers, /^answer$/i);
    const optionsColumn = findColumn(headers, /^answers$/i);
    const informationColumn = findColumn(headers, /^more information$/i);
    const linkColumn = findColumn(headers, /^links$/i);
    const categoryColumn = questionColumn > 1 ? questionColumn - 1 : -1;
    let category = null;
    let sheetQuestions = 0;
    for (let rowIndex = headerRow + 1; rowIndex < worksheet.data.length; rowIndex += 1) {
      const row = worksheet.data[rowIndex];
      const idColumn = row.slice(0, questionColumn).findIndex((value) => Number.isInteger(value));
      const question = text(row[questionColumn]);
      if (idColumn < 0 || !question) continue;
      if (categoryColumn >= 0 && text(row[categoryColumn])) category = text(row[categoryColumn]);
      const number = row[idColumn];
      const pillar = worksheet.sheet.replace(/^\d+-/, '');
      const fieldColumns = [
        ['question', questionColumn],
        ['default_answer', answerColumn],
        ['answer_options', optionsColumn],
        ['more_information', informationColumn],
        ['link_label', linkColumn],
      ].filter(([, column]) => column >= 0 && text(row[column]));
      questions.push({
        id: `MSZT-${worksheet.sheet.match(/^\d+/)[0]}-${number}`,
        pillar,
        number,
        category,
        question,
        answer_options: text(row[optionsColumn]).split('/').map((entry) => entry.trim()).filter(Boolean),
        more_information: text(row[informationColumn]),
        link_label: text(row[linkColumn]) || null,
        publisher_default_answer: text(row[answerColumn]) || null,
        locator: `${source.url}#sheet=${encodeURIComponent(worksheet.sheet)}&row=${rowIndex + 1}`,
        source_fragments: fieldColumns.map(([field, column]) => cellFragment(source.source_key, worksheet.sheet, rowIndex, column, field, row[column])),
      });
      sheetQuestions += 1;
    }
    sheets.push({ name: worksheet.sheet, rows: worksheet.data.length, questions: sheetQuestions });
  }
  if (sheets.length !== 6) throw new Error(`Expected 6 Microsoft Zero Trust questionnaire pillar sheets; found ${sheets.length}`);
  if (!questions.length) throw new Error('Microsoft Zero Trust questionnaire contained no questions');
  const ids = new Set(questions.map((entry) => entry.id));
  if (ids.size !== questions.length) throw new Error('Microsoft Zero Trust questionnaire produced duplicate question IDs');
  return { questions, sheets };
}

export function workbookSha256(bytes) {
  return checksum(bytes);
}
