/** Quote a literal CSV field without changing identifiers or publisher text. */
export function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}
export const csvRow = (values) => `${values.map(csvCell).join(',')}\r\n`;
