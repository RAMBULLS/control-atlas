/**
 * Repair encoding sequences observed in publisher text that was decoded as
 * Windows-1252 after first being encoded as UTF-8. Keep this list narrow so
 * source punctuation is changed only when a known broken byte sequence exists.
 */
export function repairKnownSourceEncoding(value) {
  return String(value ?? "")
    .replaceAll("â€˜", "'")
    .replaceAll("â€™", "'")
    .replaceAll("â€œ", '"')
    .replaceAll("\u00e2\u20ac\u009d", '"')
    .replaceAll("â€?", '"')
    .replaceAll("â€“", "–")
    .replaceAll("â€”", "—");
}
