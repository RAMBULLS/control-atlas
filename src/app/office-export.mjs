/**
 * Client-side Office Open XML (OOXML) serializers for generated templates.
 *
 * Renders the structured template document from {@link buildTemplateDocument}
 * into real `.xlsx` (spreadsheet) and `.docx` (word-processing) files, entirely
 * in the browser — no upload, no server round-trip, matching the tool's
 * browser-only posture (CATL-73).
 *
 * We hand-write the minimal OOXML parts and zip them with `fflate` (a single
 * zero-dependency MIT library) rather than pulling in a heavy office toolkit
 * with a large transitive dependency/licence surface. The same code runs in
 * Node (tests) and the browser.
 */

import { strToU8, zipSync } from "fflate";
import { GENERATED_FILE_NOTICE } from "../shared/disclaimer.mjs";
import {
  DATE_MAX_SERIAL,
  DATE_MIN_SERIAL,
  defineColumns,
} from "./template-columns.mjs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Escape a value for XML text/attribute content, dropping XML-1.0-illegal control chars. */
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip characters illegal in XML 1.0 (tab/newline/CR are kept).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Zero-based column index → spreadsheet column letter (0 → A, 26 → AA). */
function columnLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Excel sheet names: ≤31 chars, no \ / ? * [ ] :, and unique (case-insensitive). */
function sanitizeSheetName(name, used) {
  const base =
    String(name || "Sheet")
      .replace(/[\\/?*[\]:]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${counter++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function worksheetCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { value, editable: false };
  const text = String(value ?? "");
  const placeholder = /^\[[\s\S]*\]$/.test(text.trim());
  return {
    value: placeholder ? "" : text,
    editable: placeholder || text === "",
  };
}

/** Sheet name reserved for the workbook's own long controlled-value lists. */
const LISTS_SHEET_NAME = "_Lists";

/**
 * A restrained federal-workbook palette. CellXfs:
 * 0 reference/body, 1 table header, 2 notes label, 3 notes value,
 * 4 optional entry, 5 required entry, 6 optional date entry,
 * 7 required date entry, 8+ header per column group.
 */
const GROUP_FILLS = ["1F4E79", "1E6B52", "6B3FA0", "8A4B0F", "9B2C4A", "4A5568"];
const GROUP_XF_BASE = 8;

function expectedEntry(column, representative) {
  const parts = [];
  if (column.help) parts.push(column.help);
  const rule = column.validation;
  if (rule?.kind === "list") {
    parts.push(`${rule.strict === false ? "Suggested values" : "Choose one"}: ${rule.values.join(" | ")}`);
  } else if (rule?.kind === "date" && !column.help) {
    parts.push("A date, for example 2026-09-30.");
  }
  if (parts.length) return parts.join(" ");
  return (typeof representative === "string" && representative) || "Enter the value named by this field.";
}

/** Map the typed document sections to one authoritative sheet per table. */
export function officeDocumentToSheets(doc) {
  const used = new Set();
  const dataSheets = [];
  const tables = (doc.sections || []).filter((section) => section.type === "table");
  // Group colors are shared across the workbook so one group keeps one color.
  const groups = [];
  for (const section of tables) {
    for (const column of section.columns || []) {
      if (column.group && !groups.includes(column.group)) groups.push(column.group);
    }
  }
  if (groups.length > GROUP_FILLS.length) {
    throw new Error(`A workbook may use at most ${GROUP_FILLS.length} column groups.`);
  }
  const guideRows = [["Sheet", "Field", "Group", "Required", "What to enter"]];
  const guideStyles = {};
  for (const section of tables) {
    const headers = section.headers || [];
    const rows = section.rows || [];
    const columns = section.columns || defineColumns(headers);
    const representative = rows.find((row) =>
      (row || []).some((cell) => String(cell ?? "").trim()),
    ) || [];
    const sheetName = sanitizeSheetName(section.heading, used);
    columns.forEach((column, index) => {
      guideRows.push([
        sheetName,
        column.header,
        column.group,
        column.required ? "Yes" : "",
        expectedEntry(column, representative[index]),
      ]);
      if (column.group) {
        guideStyles[guideRows.length - 1] = { 2: GROUP_XF_BASE + groups.indexOf(column.group) };
      }
    });
    const normalizedRows = rows.map((row) =>
      headers.map((_, index) => worksheetCell(row?.[index])),
    );
    dataSheets.push({
      name: sheetName,
      heading: section.heading,
      kind: "data",
      freezeColumns: section.freezeColumns ?? 1,
      headers,
      columns,
      groups,
      rows: [
        headers,
        ...normalizedRows.map((row) => row.map((cell) => cell.value)),
      ],
      editableRows: [
        headers.map(() => false),
        ...normalizedRows.map((row) => row.map((cell) => cell.editable)),
      ],
    });
  }
  const fieldGuide = {
    name: sanitizeSheetName("Field Guide", used),
    kind: "guide",
    headers: guideRows[0],
    rows: guideRows,
    styleOverrides: guideStyles,
  };

  const anyRequired = dataSheets.some((sheet) => sheet.columns.some((c) => c.required));
  const notesRows = [
    ["Read Me", doc.title],
    ["Purpose", doc.description],
  ];
  for (const section of doc.sections || []) {
    if (section.type === "text" && !section.role) {
      notesRows.push([section.heading, section.content]);
    }
  }
  notesRows.push([
    "Cell colors",
    `${anyRequired ? "Amber cells are required. " : ""}Pale blue cells are for your entries. White cells came from the cited sources; leave them as they are.${groups.length ? " Header colors mark column groups; the Field Guide lists each column's group." : ""}`,
  ]);
  for (const section of doc.sections || []) {
    if (section.type !== "text" || !section.role) continue;
    const label = section.role === "interop" ? "Interoperability" : section.role === "source" ? "Source" : section.heading;
    notesRows.push([label, section.role === "interop" ? section.content.replace(/^Interoperability: /, "") : section.content]);
  }
  notesRows.push(["Notice", GENERATED_FILE_NOTICE]);
  const readMe = {
    name: sanitizeSheetName("Read Me", used),
    kind: "notes",
    headers: notesRows[0],
    rows: notesRows,
  };
  return [readMe, ...dataSheets, fieldGuide];
}

/**
 * Approximate per-column widths (Excel character units) from the widest cell
 * in each column, clamped so ID columns stay readable (~12) and prompt-length
 * text wraps inside a bounded column instead of stretching the sheet.
 */
function columnWidths(sheet) {
  if (sheet.kind === "notes") return [26, 110];
  if (sheet.kind === "guide") return [24, 30, 20, 10, 90];
  const widths = [];
  for (const row of sheet.rows || []) {
    (row || []).forEach((cell, i) => {
      const len = String(cell ?? "").length;
      if (widths[i] === undefined || len > widths[i]) widths[i] = len;
    });
  }
  return widths.map((len, i) => {
    const custom = sheet.columns?.[i]?.width;
    // A one-word header (camelCase field names) cannot wrap, so it sets a floor.
    const header = String(sheet.headers?.[i] ?? "");
    const floor = /s/.test(header) ? 0 : header.length + 4;
    return Math.max(floor, custom || Math.min(52, Math.max(12, len + 2)));
  });
}

function stylesXml() {
  const groupFills = GROUP_FILLS.map(
    (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`,
  ).join("");
  const groupXfs = GROUP_FILLS.map(
    (_, index) =>
      `<xf numFmtId="0" fontId="1" fillId="${6 + index}" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
  ).join("");
  const entry = (fill, numFmt) =>
    `<xf numFmtId="${numFmt}" fontId="0" fillId="${fill}" borderId="1" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ""} applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`;
  return (
    `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
    '<fonts count="3"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos Display"/><family val="2"/></font><font><b/><color rgb="FF17365D"/><sz val="10"/><name val="Aptos"/><family val="2"/></font></fonts>' +
    `<fills count="${6 + GROUP_FILLS.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F8FC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CC"/><bgColor indexed="64"/></patternFill></fill>${groupFills}</fills>` +
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD6DEE8"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFB8C5D6"/></left><right style="thin"><color rgb="FFB8C5D6"/></right><top style="thin"><color rgb="FFB8C5D6"/></top><bottom style="thin"><color rgb="FFB8C5D6"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${GROUP_XF_BASE + GROUP_FILLS.length}">` +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    `${entry(4, 0)}${entry(5, 0)}${entry(4, 164)}${entry(5, 164)}` +
    `${groupXfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

const XLSX_STYLES_XML = stylesXml();

const truncateAt = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function validationXml(sheet, ctx) {
  const validations = [];
  const lastRow = Math.max(250, (sheet.rows || []).length + 50);
  for (const [index, column] of (sheet.columns || []).entries()) {
    const rule = column.validation;
    if (!rule && !column.help) continue;
    const ref = columnLetter(index);
    const sqref = `${ref}2:${ref}${lastRow}`;
    const prompt = column.help
      ? ` showInputMessage="1" promptTitle="${escapeXml(truncateAt(column.header, 32))}" prompt="${escapeXml(truncateAt(column.help, 255))}"`
      : "";
    if (rule?.kind === "list") {
      const inline = rule.values.join(",");
      const canInline = inline.length <= 250 && !rule.values.some((value) => /[,"]/.test(value));
      const formula = canInline ? `&quot;${escapeXml(inline)}&quot;` : escapeXml(ctx.rangeFor(rule.values));
      const style = rule.strict === false
        ? ' errorStyle="warning" errorTitle="Not in the suggested list" error="This value is not one of the suggested values. Keep it only if your organization uses it."'
        : ' errorTitle="Choose a listed value" error="Use one of the values in the dropdown."';
      validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1"${style}${prompt} sqref="${sqref}"><formula1>${formula}</formula1></dataValidation>`);
    } else if (rule?.kind === "range") {
      const owner = (ctx.sheets || []).find((candidate) => candidate.heading === rule.sheet);
      const from = owner ? owner.headers.indexOf(rule.header) : -1;
      if (from < 0) throw new Error(`Column "${column.header}" lists values from "${rule.sheet}" / "${rule.header}", which does not exist.`);
      const letter = columnLetter(from);
      const formula = escapeXml(`'${owner.name.replaceAll("'", "''")}'!$${letter}$2:$${letter}$${Math.max(250, owner.rows.length + 50)}`);
      validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" errorTitle="Not in the list yet" error="This ID is not on the ${escapeXml(owner.name)} sheet yet. Add it there, or keep this entry if it is correct."${prompt} sqref="${sqref}"><formula1>${formula}</formula1></dataValidation>`);
    } else if (rule?.kind === "date") {
      validations.push(`<dataValidation type="date" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Enter a date" error="Enter a date such as 2026-09-30."${prompt} sqref="${sqref}"><formula1>${DATE_MIN_SERIAL}</formula1><formula2>${DATE_MAX_SERIAL}</formula2></dataValidation>`);
    } else {
      validations.push(`<dataValidation allowBlank="1"${prompt} sqref="${sqref}"/>`);
    }
  }
  return validations.length
    ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`
    : "";
}

function entryStyle(column, editable) {
  if (!editable) return 0;
  const isDate = column?.validation?.kind === "date";
  const required = column?.required === true;
  return 4 + (required ? 1 : 0) + (isDate ? 2 : 0);
}

function sheetXml(sheet, ctx) {
  const rows = sheet.rows || [];
  let out = `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
  // Excel only honors fitToWidth consistently when fit-to-page is enabled in
  // sheet properties. This keeps every keyed view on one landscape page wide
  // while allowing as many vertical pages as its records require.
  out += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  // Wide working registers keep both the header and identity column visible.
  // Guidance sheets only need their header row frozen.
  const frozen = sheet.kind === "data" ? sheet.freezeColumns ?? 1 : 0;
  const pane = frozen > 0
    ? `<pane xSplit="${frozen}" ySplit="1" topLeftCell="${columnLetter(frozen)}2" activePane="bottomRight" state="frozen"/>`
    : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  out +=
    '<sheetViews><sheetView workbookViewId="0">' +
    '<showGridLines val="0"/>' +
    pane +
    "</sheetView></sheetViews>";
  out += '<sheetFormatPr defaultRowHeight="18"/>';
  const widths = columnWidths(sheet);
  if (widths.length > 0) {
    out += `<cols>${widths
      .map((w, i) => {
        const column = sheet.columns?.[i];
        // Date columns carry their date format down the whole column.
        const style = column?.validation?.kind === "date" ? ` style="${entryStyle(column, true)}"` : "";
        return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${style}/>`;
      })
      .join("")}</cols>`;
  }
  out += "<sheetData>";
  rows.forEach((row, rowIndex) => {
    const height = rowIndex === 0 ? ' ht="34" customHeight="1"' : "";
    out += `<row r="${rowIndex + 1}"${height}>`;
    (row || []).forEach((cell, colIndex) => {
      const ref = `${columnLetter(colIndex)}${rowIndex + 1}`;
      const column = sheet.columns?.[colIndex];
      let style;
      if (rowIndex === 0) {
        const group = column?.group ? sheet.groups.indexOf(column.group) : -1;
        style = group >= 0 ? GROUP_XF_BASE + group : 1;
      } else if (sheet.kind === "data") {
        style = entryStyle(column, sheet.editableRows?.[rowIndex]?.[colIndex]);
      } else {
        style = sheet.styleOverrides?.[rowIndex]?.[colIndex] ?? (colIndex === 0 ? 2 : 3);
      }
      const styleAttr = style ? ` s="${style}"` : "";
      if (typeof cell === "number") {
        out += `<c r="${ref}"${styleAttr}><v>${cell}</v></c>`;
        return;
      }
      out += cell === "" || cell == null
        ? `<c r="${ref}"${styleAttr}/>`
        : `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
    });
    out += "</row>";
  });
  out += "</sheetData>";
  if (sheet.kind === "data" && rows.length > 0 && (sheet.headers || []).length > 0) {
    const lastColumn = columnLetter(sheet.headers.length - 1);
    out += `<autoFilter ref="A1:${lastColumn}${Math.max(1, rows.length)}"/>`;
    out += validationXml(sheet, ctx);
  }
  out += '<printOptions horizontalCentered="0" verticalCentered="0"/>';
  out += '<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>';
  out += '<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  out += '<headerFooter><oddFooter>&amp;LControl Atlas reference aid&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>';
  out += "</worksheet>";
  return out;
}

/** A hidden sheet that holds controlled-value lists too long to write inline. */
function listsSheetXml(lists) {
  const height = Math.max(...lists.map((values) => values.length));
  let out = `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
  for (let r = 0; r < height; r += 1) {
    out += `<row r="${r + 1}">`;
    lists.forEach((values, c) => {
      if (values[r] !== undefined) {
        out += `<c r="${columnLetter(c)}${r + 1}" t="inlineStr"><is><t>${escapeXml(values[r])}</t></is></c>`;
      }
    });
    out += "</row>";
  }
  return `${out}</sheetData></worksheet>`;
}

const CORE_PROPS_CT = "application/vnd.openxmlformats-package.core-properties+xml";
const APP_PROPS_CT = "application/vnd.openxmlformats-officedocument.extended-properties+xml";

/** Document properties shared by both formats: title, subject, author. */
function addDocumentProperties(files, doc) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(doc.title)}</dc:title><dc:subject>${escapeXml(doc.description)}</dc:subject><dc:creator>Control Atlas</dc:creator><cp:lastModifiedBy>Control Atlas</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  files["docProps/app.xml"] = strToU8(
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Control Atlas</Application></Properties>`,
  );
  return {
    overrides:
      `<Override PartName="/docProps/core.xml" ContentType="${CORE_PROPS_CT}"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="${APP_PROPS_CT}"/>`,
    relationships:
      '<Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
  };
}

/**
 * Serialize the document to a `.xlsx` workbook.
 * @param {any} doc
 * @returns {Uint8Array}
 */
export function docToXlsx(doc) {
  const sheets = officeDocumentToSheets(doc);
  /** @type {import("fflate").Zippable} */
  const files = {};

  const lists = [];
  const ctx = {
    sheets,
    rangeFor(values) {
      let index = lists.findIndex((known) => JSON.stringify(known) === JSON.stringify(values));
      if (index < 0) index = lists.push(values) - 1;
      return `${LISTS_SHEET_NAME}!$${columnLetter(index)}$1:$${columnLetter(index)}$${values.length}`;
    },
  };

  let overrides = "";
  let workbookSheets = "";
  let workbookRels = "";
  let definedNames = "";
  sheets.forEach((sheet, i) => {
    const index = i + 1;
    const rid = `rId${index}`;
    overrides += `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    workbookSheets += `<sheet name="${escapeXml(sheet.name)}" sheetId="${index}" r:id="${rid}"/>`;
    const formulaSheetName = String(sheet.name).replaceAll("'", "''");
    definedNames += `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${escapeXml(`'${formulaSheetName}'!$1:$1`)}</definedName>`;
    workbookRels += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index}.xml"/>`;
    files[`xl/worksheets/sheet${index}.xml`] = strToU8(sheetXml(sheet, ctx));
  });

  let nextRel = sheets.length + 1;
  if (lists.length > 0) {
    const index = sheets.length + 1;
    nextRel = index + 1;
    overrides += `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    workbookSheets += `<sheet name="${LISTS_SHEET_NAME}" sheetId="${index}" state="hidden" r:id="rId${index}"/>`;
    workbookRels += `<Relationship Id="rId${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index}.xml"/>`;
    files[`xl/worksheets/sheet${index}.xml`] = strToU8(listsSheetXml(lists));
  }

  const stylesRid = `rId${nextRel}`;
  workbookRels += `<Relationship Id="${stylesRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  files["xl/styles.xml"] = strToU8(XLSX_STYLES_XML);
  const props = addDocumentProperties(files, doc);

  files["[Content_Types].xml"] = strToU8(
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      `${props.overrides}${overrides}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      `${props.relationships}</Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView activeTab="0"/></bookViews><sheets>${workbookSheets}</sheets><definedNames>${definedNames}</definedNames></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`,
  );

  return zipSync(files);
}


// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

function cleanInlineMarkdown(text) {
  return String(text ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function docxParagraph(text, opts = {}) {
  const runProps = ['<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'];
  if (opts.bold) runProps.push("<w:b/>");
  if (opts.italic) runProps.push("<w:i/>");
  if (opts.size) {
    runProps.push(`<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>`);
  }
  if (opts.color) runProps.push(`<w:color w:val="${opts.color}"/>`);
  const pProps = [];
  if (opts.style) pProps.push(`<w:pStyle w:val="${opts.style}"/>`);
  const before = opts.spacingBefore ?? 0;
  const after = opts.spacingAfter ?? 100;
  pProps.push(`<w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>`);
  if (opts.keepNext) pProps.push("<w:keepNext/>");
  if (opts.pageBreakBefore) pProps.push("<w:pageBreakBefore/>");
  if (opts.indentLeft) pProps.push(`<w:ind w:left="${opts.indentLeft}" w:hanging="${opts.hanging || 0}"/>`);
  if (opts.bullet) pProps.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  return `<w:p><w:pPr>${pProps.join("")}</w:pPr><w:r><w:rPr>${runProps.join("")}</w:rPr><w:t xml:space="preserve">${escapeXml(
    cleanInlineMarkdown(text),
  )}</w:t></w:r></w:p>`;
}

function docxTextBlock(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return docxParagraph("", { spacingAfter: 40 });
      if (/^[-*]\s+/.test(trimmed)) {
        return docxParagraph(trimmed.replace(/^[-*]\s+/, ""), {
          bullet: true,
          spacingAfter: 60,
        });
      }
      return docxParagraph(trimmed);
    })
    .join("");
}

function docxPromptBlock(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.includes(" | ") || /\r|\n/.test(trimmed)) {
    return null;
  }
  const content = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const rows = content
    .split(" | ")
    .map((rawField) => {
      const field = rawField.trim();
      const separator = field.indexOf(":");
      return separator > 0
        ? [field.slice(0, separator).trim(), field.slice(separator + 1).trim()]
        : [field, ""];
    });
  return docxTable(["Field", "Response"], rows);
}

/** Usable page width in twips — keep in sync with the <w:sectPr> page size and margins below. */
const DOCX_CONTENT_WIDTH_TWIPS = 12240 - 1440 - 1440;

/**
 * Distribute the usable page width across columns, weighting each column by
 * its widest cell (clamped) so ID columns stay narrow and prompt columns get
 * room. The rounding remainder lands on the last column so the grid always
 * sums to the full content width.
 */
function docxColumnWidths(headers, rows) {
  const weights = (headers || []).map((h) => String(h ?? "").length);
  for (const row of rows || []) {
    (row || []).forEach((cell, i) => {
      const len = String(cell ?? "").length;
      if (weights[i] === undefined || len > weights[i]) weights[i] = len;
    });
  }
  const clamped = weights.map((len) => Math.min(50, Math.max(10, len)));
  const total = clamped.reduce((a, b) => a + b, 0) || 1;
  let widths = clamped.map((w) =>
    Math.floor((DOCX_CONTENT_WIDTH_TWIPS * w) / total),
  );
  if (widths.length > 0) {
    // Guarantee every column a readable floor (~0.5", capped at an equal
    // share) so ID columns never collapse to slivers next to prompt columns;
    // shrink the above-floor columns proportionally to pay for it.
    const floor = Math.min(
      720,
      Math.floor(DOCX_CONTENT_WIDTH_TWIPS / widths.length),
    );
    let deficit = 0;
    let pool = 0;
    for (const w of widths) {
      if (w < floor) deficit += floor - w;
      else pool += w - floor;
    }
    if (deficit > 0 && pool > 0) {
      widths = widths.map((w) =>
        w < floor
          ? floor
          : floor + Math.floor(((w - floor) * (pool - deficit)) / pool),
      );
    }
    const used = widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += DOCX_CONTENT_WIDTH_TWIPS - used;
  }
  return widths;
}

function docxTable(headers, rows, opts = {}) {
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map(
      (edge) =>
        `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="C7D1DE"/>`,
    )
    .join("");
  const widths = docxColumnWidths(headers, rows);
  const cell = (text, colIndex, isHeader, keepNext = false) => {
    const rPr = isHeader
      ? '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>'
      : '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>';
    const shd = isHeader
      ? '<w:shd w:val="clear" w:color="auto" w:fill="17365D"/>'
      : "";
    const tcPr = `<w:tcPr><w:tcW w:w="${widths[colIndex] ?? 0}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/>${shd}</w:tcPr>`;
    return `<w:tc>${tcPr}<w:p><w:pPr>${keepNext ? "<w:keepNext/>" : ""}<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(
      cleanInlineMarkdown(text),
    )}</w:t></w:r></w:p></w:tc>`;
  };
  // Fixed layout + explicit grid: Word renders the table at page width instead
  // of auto-sizing ~1,000-row tables (which collapses/clips columns).
  let out = `<w:tbl><w:tblPr><w:tblW w:w="${DOCX_CONTENT_WIDTH_TWIPS}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>`;
  out += `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  // <w:tblHeader/> repeats the header row at the top of every page.
  out += `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${(headers || [])
    .map((h, i) => cell(h, i, true, opts.keepTogether))
    .join("")}</w:tr>`;
  for (const [rowIndex, row] of (rows || []).entries()) {
    const keepNext = opts.keepTogether && rowIndex < rows.length - 1;
    out += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${(row || [])
      .map((c, i) => cell(c, i, false, keepNext))
      .join("")}</w:tr>`;
  }
  out += "</w:tbl>";
  return out;
}

function docxRecordCards(section) {
  const headers = section.headers || [];
  const rows = section.rows || [];
  let out = "";
  for (const [index, row] of rows.entries()) {
    const titleBits = [row[0], row[1]].filter(Boolean);
    out += docxParagraph(titleBits.join(" — ") || `Record ${index + 1}`, {
      style: "Heading2",
      bold: true,
      color: "1F4D78",
      size: 26,
      spacingBefore: index === 0 ? 40 : 160,
      spacingAfter: 60,
      keepNext: true,
    });
    const detailHeaders = ["Field", "Response or guidance"];
    const detailRows = headers.slice(2).map((header, detailIndex) => [
      header,
      row[detailIndex + 2] ?? "",
    ]);
    out += docxTable(detailHeaders, detailRows, { keepTogether: true });
  }
  return out;
}

const DOCX_STYLES_XML =
  `${XML_DECL}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="20242C"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="17365D"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="1F4D78"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs><w:spacing w:after="80"/></w:pPr></w:style>' +
  '</w:styles>';

const DOCX_NUMBERING_XML =
  `${XML_DECL}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const DOCX_HEADER_XML =
  `${XML_DECL}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:t>CONTROL ATLAS  |  REFERENCE AID</w:t></w:r></w:p></w:hdr>`;

const DOCX_FOOTER_XML =
  `${XML_DECL}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:t>Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

const DOCX_SETTINGS_XML =
  `${XML_DECL}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
  '<w:defaultTabStop w:val="720"/>' +
  '</w:settings>';

function docxPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function docxContents(sections) {
  return (sections || [])
    .map((section) =>
      docxParagraph(section.heading, {
        style: "TOC1",
        color: "1F4D78",
        size: 22,
        spacingAfter: 80,
      }),
    )
    .join("");
}

/**
 * Serialize the document to a `.docx` word-processing file.
 * @param {any} doc
 * @returns {Uint8Array}
 */
export function docToDocx(doc) {
  let body = "";
  body += docxParagraph(doc.title, {
    style: "Title",
    bold: true,
    size: 44,
    color: "17365D",
    spacingBefore: 120,
    spacingAfter: 100,
  });
  if (doc.description) {
    body += docxParagraph(doc.description, {
      size: 22,
      color: "475467",
      spacingAfter: 220,
    });
  }
  if (doc.cover?.facts?.length) {
    body += docxTable(["Selected for this file", ""], doc.cover.facts);
    body += docxParagraph("", { spacingAfter: 120 });
  }
  body += `<w:tbl><w:tblPr><w:tblW w:w="${DOCX_CONTENT_WIDTH_TWIPS}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="D6DEE8"/><w:left w:val="single" w:sz="6" w:color="D6DEE8"/><w:bottom w:val="single" w:sz="6" w:color="D6DEE8"/><w:right w:val="single" w:sz="6" w:color="D6DEE8"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/><w:shd w:val="clear" w:fill="F4F6F9"/><w:tcMar><w:top w:w="140" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="140" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr>${docxParagraph(GENERATED_FILE_NOTICE, { size: 18, color: "475467", spacingAfter: 0 })}</w:tc></w:tr></w:tbl>`;
  body += docxPageBreak();
  body += docxParagraph("Contents", {
    style: "Heading1",
    bold: true,
    size: 32,
    color: "2E74B5",
    spacingAfter: 200,
  });
  body += docxContents(doc.sections);
  body += docxPageBreak();
  for (const section of doc.sections || []) {
    body += docxParagraph(section.heading, {
      style: "Heading1",
      bold: true,
      size: 32,
      color: "2E74B5",
      spacingBefore: 360,
      spacingAfter: 200,
      keepNext: true,
    });
    if (section.type === "text") {
      const promptBlock = docxPromptBlock(section.content);
      body += promptBlock || docxTextBlock(section.content);
      if (promptBlock) body += "<w:p/>";
    } else if (section.type === "table") {
      body += section.heading === "Control Baseline"
        ? docxRecordCards(section)
        : docxTable(section.headers, section.rows);
      // Word requires a paragraph between/after tables.
      body += "<w:p/>";
    }
  }

  const documentXml =
    `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    body +
    '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>';

  const documentXmlWithRelationships = documentXml.replace(
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  );

  /** @type {import("fflate").Zippable} */
  const files = {};
  const props = addDocumentProperties(files, doc);
  files["[Content_Types].xml"] = strToU8(
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      `${props.overrides}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      `${props.relationships}</Relationships>`,
  );
  files["word/_rels/document.xml.rels"] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      "</Relationships>",
  );
  files["word/document.xml"] = strToU8(documentXmlWithRelationships);
  files["word/styles.xml"] = strToU8(DOCX_STYLES_XML);
  files["word/numbering.xml"] = strToU8(DOCX_NUMBERING_XML);
  files["word/settings.xml"] = strToU8(DOCX_SETTINGS_XML);
  files["word/header1.xml"] = strToU8(DOCX_HEADER_XML);
  files["word/footer1.xml"] = strToU8(DOCX_FOOTER_XML);

  return zipSync(files);
}

/**
 * Render a document to the requested office format.
 * @param {any} doc
 * @param {"xlsx" | "docx"} format
 * @returns {{ bytes: Uint8Array, mimeType: string, extension: string }}
 */
export function renderOfficeDocument(doc, format) {
  if (format === "xlsx") {
    return { bytes: docToXlsx(doc), mimeType: XLSX_MIME, extension: "xlsx" };
  }
  if (format === "docx") {
    return { bytes: docToDocx(doc), mimeType: DOCX_MIME, extension: "docx" };
  }
  throw new Error(`Unsupported office format: ${format}`);
}

export const OFFICE_MIME_TYPES = { xlsx: XLSX_MIME, docx: DOCX_MIME };
