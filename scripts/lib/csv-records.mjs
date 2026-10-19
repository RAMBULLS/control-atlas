import { createReadStream } from 'node:fs';
import { csvRows } from './publisher-inventory.mjs';

/** Frame complete CSV records, then use the existing strict publisher CSV parser. */
export async function* csvRecords(path) {
  let record = ''; let quoted = false; let first = true; let skipLf = false;
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 256 * 1024 })) {
    for (const char of chunk) {
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (skipLf) { skipLf = false; if (char === '\n') continue; }
      record += char;
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === '\r' || char === '\n')) {
        const parsed = csvRows(record);
        if (parsed.length !== 1) throw new Error('CSV framing produced multiple records');
        yield parsed[0]; record = ''; skipLf = char === '\r';
      }
    }
  }
  if (record) {
    const parsed = csvRows(record);
    if (parsed.length !== 1) throw new Error('Invalid final CSV record');
    yield parsed[0];
  }
}
