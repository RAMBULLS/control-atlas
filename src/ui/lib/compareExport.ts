import { officialSourceFor } from "./officialSource";

export const CROSSWALK_COLUMNS = [
  "Source Publication",
  "Source Version",
  "Source ID",
  "Source Title",
  "Relationship",
  "Target Publication",
  "Target Version",
  "Target ID",
  "Target Title",
  "Crosswalk Source",
  "Crosswalk Source Version",
  "Crosswalk URL",
  "Evidence / Locator",
  "Published Source ID",
  "Published Relationship",
  "Published Target ID",
  "Publisher Relationship Text",
] as const;

export const SOURCES_COLUMNS = [
  "Source",
  "Publisher",
  "Version",
  "Official URL",
  "Retrieved/last checked",
  "Status",
] as const;

type Catalog = {
  display_group?: string;
  id?: string;
  name?: string;
  source_id?: string;
  source_review?: { reviewed_at?: string };
  source_version?: string;
};

type Source = {
  access_status?: string;
  artifact_url?: string;
  catalog_browse_url?: string;
  display_group?: string;
  display_name?: string;
  id?: string;
  last_checked?: string;
  lifecycle_status?: string;
  name?: string;
  owner?: string;
  retrieved_at?: string;
  version?: string;
};

type SourceRef = {
  locator?: string;
  source_id?: string;
  sourceId?: string;
  source_name?: string;
  source_version?: string;
};

export type AggregatedCompareRow = {
  from_id?: string;
  from_item_id?: string;
  from_title?: string;
  targets?: Array<{
    edge_id?: string;
    relationship_type?: string;
    published_source_id?: string;
    published_target_id?: string;
    published_relationship_type?: string;
    raw_relationship_type?: string;
    publisher_assertions?: Array<{ relationship: string; property?: string | null; locator?: string }>;
    source_refs?: SourceRef[];
    to_id?: string;
    to_item_id?: string;
    to_title?: string;
  }>;
};

export type CompareExportInput = {
  buildLabel: string;
  generatedAt: string;
  resolveSource: (sourceId: string) => Source | null | undefined;
  rows: AggregatedCompareRow[];
  sourceCatalog: Catalog;
  targetCatalog: Catalog;
};

export type CompareExportData = {
  about: string[][];
  crosswalk: string[][];
  mappingCount: number;
  sources: string[][];
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function value(value: unknown) {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function officialUrl(source?: Source | null) {
  return officialSourceFor(source).url;
}

function sourceName(sourceId: string, source?: Source | null, ref?: SourceRef) {
  return source?.display_name || source?.name || ref?.source_name || sourceId;
}

function sourceVersion(source?: Source | null, ref?: SourceRef) {
  return source?.version || ref?.source_version || "";
}

function sourcePublisher(source?: Source | null, fallback = "") {
  return source?.owner || source?.display_group || fallback;
}

function sourceChecked(source?: Source | null, catalog?: Catalog) {
  return (
    source?.last_checked ||
    source?.retrieved_at ||
    catalog?.source_review?.reviewed_at ||
    ""
  );
}

function sourceStatus(source?: Source | null) {
  return source?.lifecycle_status || source?.access_status || "";
}

function compareNeedle(valueToNormalize: unknown) {
  return String(valueToNormalize ?? "").trim().toLocaleLowerCase();
}

function includesNeedle(needle: string, ...candidates: unknown[]) {
  return candidates.some((candidate) =>
    compareNeedle(candidate).includes(needle),
  );
}

/** Search both sides by publisher identifier or title without hiding matching targets. */
export function filterCompareRows(
  rows: AggregatedCompareRow[],
  query: string,
): AggregatedCompareRow[] {
  const needle = compareNeedle(query);
  if (!needle) return rows;
  return rows.flatMap((row) => {
    if (includesNeedle(needle, row.from_item_id, row.from_title)) return [row];
    const targets = (row.targets || []).filter((target) =>
      includesNeedle(needle, target.to_item_id, target.to_title),
    );
    return targets.length ? [{ ...row, targets }] : [];
  });
}

export function countCompareMappings(rows: AggregatedCompareRow[]) {
  return rows.reduce((total, row) => total + (row.targets?.length || 0), 0);
}

export function buildCompareExportData(
  input: CompareExportInput,
): CompareExportData {
  const sourceCatalogSource = input.resolveSource(
    input.sourceCatalog.source_id || input.sourceCatalog.id || "",
  );
  const targetCatalogSource = input.resolveSource(
    input.targetCatalog.source_id || input.targetCatalog.id || "",
  );
  const mappingSources = new Map<string, Source>();
  const crosswalk: string[][] = [Array.from(CROSSWALK_COLUMNS)];

  for (const row of input.rows) {
    for (const target of row.targets || []) {
      const references = target.source_refs || [];
      const referenceDetails = references.map((reference) => {
        const sourceId = reference.source_id || reference.sourceId || "";
        const mappingSource = sourceId ? input.resolveSource(sourceId) : null;
        if (sourceId && mappingSource) mappingSources.set(sourceId, mappingSource);
        const locator = reference.locator || "";
        return {
          locator,
          name: sourceName(sourceId, mappingSource, reference),
          url: officialUrl(mappingSource) || (/^https?:\/\//i.test(locator) ? locator : ""),
          version: sourceVersion(mappingSource, reference),
        };
      });
      const joined = (field: "locator" | "name" | "version") =>
        unique(referenceDetails.map((detail) => detail[field])).join(" | ");
      const firstUrl = unique(referenceDetails.map((detail) => detail.url))[0] || "";
      crosswalk.push([
        input.sourceCatalog.name || input.sourceCatalog.id || "",
        input.sourceCatalog.source_version || sourceCatalogSource?.version || "",
        row.from_item_id || row.from_id || "",
        row.from_title || "",
        target.relationship_type || "",
        input.targetCatalog.name || input.targetCatalog.id || "",
        input.targetCatalog.source_version || targetCatalogSource?.version || "",
        target.to_item_id || target.to_id || "",
        target.to_title || "",
        joined("name"),
        joined("version"),
        firstUrl,
        joined("locator"),
        target.published_source_id || row.from_id || "",
        target.published_relationship_type || target.relationship_type || "",
        target.published_target_id || target.to_id || "",
        unique((target.publisher_assertions || []).map((entry) => entry.relationship)
          .concat(target.raw_relationship_type || [])).join(" | "),
      ]);
    }
  }

  const sources: string[][] = [Array.from(SOURCES_COLUMNS)];
  const addSource = (
    role: string,
    catalog: Catalog,
    source?: Source | null,
  ) => {
    sources.push([
      `${role}: ${catalog.name || catalog.id || ""}`,
      sourcePublisher(source, catalog.display_group || ""),
      catalog.source_version || source?.version || "",
      officialUrl(source),
      sourceChecked(source, catalog),
      sourceStatus(source),
    ]);
  };
  addSource("Publication A", input.sourceCatalog, sourceCatalogSource);
  addSource("Publication B", input.targetCatalog, targetCatalogSource);
  for (const [sourceId, source] of [...mappingSources.entries()].sort((left, right) =>
    sourceName(left[0], left[1]).localeCompare(sourceName(right[0], right[1])),
  )) {
    sources.push([
      `Crosswalk source: ${sourceName(sourceId, source)}`,
      sourcePublisher(source),
      source.version || "",
      officialUrl(source),
      sourceChecked(source),
      sourceStatus(source),
    ]);
  }

  const about = [
    ["Field", "Value"],
    ["Generated by", "Control Atlas"],
    [
      "Published mapping != equivalence/compliance",
      "A published crosswalk shows a cited relationship; it does not by itself establish equivalence or compliance.",
    ],
    ["Relationship direction", "Source and target columns follow the selected view. Published Source ID, Published Relationship, and Published Target ID preserve the original assertion."],
    ["Generated date / build", `${input.generatedAt} / ${input.buildLabel}`],
  ];

  return {
    about,
    crosswalk,
    mappingCount: countCompareMappings(input.rows),
    sources,
  };
}

function csvCell(cell: unknown) {
  return `"${value(cell).replaceAll('"', '""')}"`;
}

export function compareExportToCsv(data: CompareExportData) {
  return `\uFEFF${data.crosswalk
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}`;
}

type WorkbookSheet = {
  hyperlinkColumns: number[];
  idColumns: number[];
  name: string;
  rows: string[][];
  tableName: string;
  widths: number[];
  wrapColumns: number[];
};

const WORKBOOK_SHEETS = (data: CompareExportData): WorkbookSheet[] => [
  {
    name: "Crosswalk",
    tableName: "CrosswalkTable",
    rows: data.crosswalk,
    widths: [24, 18, 18, 34, 18, 24, 18, 18, 34, 28, 18, 42, 42, 24, 20, 24, 54],
    idColumns: [2, 7, 13, 15],
    wrapColumns: [3, 8, 9, 11, 12, 13, 15, 16],
    hyperlinkColumns: [11],
  },
  {
    name: "Sources",
    tableName: "SourcesTable",
    rows: data.sources,
    widths: [34, 24, 20, 48, 22, 18],
    idColumns: [],
    wrapColumns: [0, 3],
    hyperlinkColumns: [3],
  },
  {
    name: "About",
    tableName: "AboutTable",
    rows: data.about,
    widths: [40, 90],
    idColumns: [],
    wrapColumns: [0, 1],
    hyperlinkColumns: [],
  },
];

function isExternalUrl(candidate: string) {
  return /^https?:\/\/[^\s]+$/i.test(candidate);
}

export async function compareExportToXlsx(data: CompareExportData) {
  // Dynamic import keeps ExcelJS out of the initial Compare route chunk. The
  // established MIT library owns OOXML packaging and Excel compatibility;
  // this helper owns only the Control Atlas workbook contract.
  const excelJsModule = await import("exceljs");
  const ExcelJS = (excelJsModule.default || excelJsModule) as typeof import("exceljs");
  const { Workbook } = ExcelJS;
  const workbook = new Workbook();
  workbook.creator = "Control Atlas";
  workbook.subject = "Published crosswalk export";
  workbook.company = "Control Atlas";
  const sheets = WORKBOOK_SHEETS(data);
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    });
    const protectedRows = sheet.rows.slice(1).map((row) => row.map(value));
    worksheet.addTable({
      name: sheet.tableName,
      ref: "A1",
      headerRow: true,
      columns: sheet.rows[0].map((header) => ({
        filterButton: true,
        name: value(header),
      })),
      rows: protectedRows,
      style: {
        showColumnStripes: false,
        showFirstColumn: false,
        showLastColumn: false,
        showRowStripes: true,
        theme: "TableStyleMedium2",
      },
    });
    sheet.widths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFF2EBDD" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF26343D" },
    };
    worksheet.getRow(1).alignment = { vertical: "top", wrapText: true };
    for (const columnIndex of sheet.idColumns) {
      worksheet.getColumn(columnIndex + 1).numFmt = "@";
    }
    for (const columnIndex of sheet.wrapColumns) {
      worksheet.getColumn(columnIndex + 1).alignment = {
        vertical: "top",
        wrapText: true,
      };
    }
    for (const columnIndex of sheet.hyperlinkColumns) {
      worksheet.getColumn(columnIndex + 1).eachCell((cell, rowNumber) => {
        const url = String(cell.value || "");
        if (rowNumber <= 1 || !isExternalUrl(url)) return;
        cell.value = { hyperlink: url, text: url };
        cell.font = { color: { argb: "FF056A73" }, underline: true };
        cell.alignment = { vertical: "top", wrapText: true };
      });
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export const COMPARE_EXPORT_MIME_TYPES = Object.freeze({
  csv: "text/csv;charset=utf-8",
  xlsx: XLSX_MIME,
});
