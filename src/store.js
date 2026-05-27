import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { appendFile, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { parseTimestamp } from './text.js';

export class JsonlLogStore {
  constructor(path) {
    this.path = path;
    this.writeChain = Promise.resolve();
    mkdirSync(dirname(path), { recursive: true });
  }

  async append(records) {
    if (!records.length) return { inserted: 0 };
    const lines = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    this.writeChain = this.writeChain.then(() => appendFile(this.path, lines, 'utf8'));
    await this.writeChain;
    return { inserted: records.length };
  }

  async query(criteria) {
    if (!existsSync(this.path)) return [];
    const from = parseTimestamp(criteria.from);
    const to = parseTimestamp(criteria.to);
    const limit = Number(criteria.limit || 500);
    const field = criteria.field || 'message';
    const value = String(criteria.value || '').toLowerCase();
    const service = String(criteria.service || '').toLowerCase();
    const level = String(criteria.level || '').toUpperCase();
    const output = [];
    const fromMs = from.getTime();
    const toMs = to.getTime();

    for await (const line of readLinesReverse(this.path)) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.epochMs > toMs) continue;
      if (record.epochMs < fromMs) {
        if (output.length > 0 || isLikelyChronological(record, fromMs)) break;
        continue;
      }
      if (service && String(record.service).toLowerCase() !== service) continue;
      if (level && record.level !== level) continue;
      if (value && !String(record[field] || '').toLowerCase().includes(value)) continue;
      output.push(record);
      if (limit > 0 && output.length >= limit) break;
    }
    return output;
  }

  async queryForward(criteria) {
    if (!existsSync(this.path)) return [];
    const from = parseTimestamp(criteria.from);
    const to = parseTimestamp(criteria.to);
    const limit = Number(criteria.limit || 500);
    const field = criteria.field || 'message';
    const value = String(criteria.value || '').toLowerCase();
    const service = String(criteria.service || '').toLowerCase();
    const level = String(criteria.level || '').toUpperCase();
    const output = [];

    const reader = createInterface({
      input: createReadStream(this.path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.epochMs < from.getTime() || record.epochMs > to.getTime()) continue;
      if (service && String(record.service).toLowerCase() !== service) continue;
      if (level && record.level !== level) continue;
      if (value && !String(record[field] || '').toLowerCase().includes(value)) continue;
      output.push(record);
      if (limit > 0 && output.length >= limit) break;
    }
    return output;
  }

  async stats() {
    if (!existsSync(this.path)) return { bytes: 0 };
    const info = await stat(this.path);
    return { bytes: info.size };
  }
}

async function* readLinesReverse(path, chunkSize = Number(process.env.STORE_REVERSE_CHUNK_BYTES || 1024 * 1024)) {
  const info = await stat(path);
  const handle = await open(path, 'r');
  let position = info.size;
  let carry = '';
  try {
    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, position);
      const text = buffer.toString('utf8') + carry;
      const parts = text.split('\n');
      carry = parts.shift() || '';
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        if (parts[i]) yield parts[i].replace(/\r$/, '');
      }
    }
    if (carry) yield carry.replace(/\r$/, '');
  } finally {
    await handle.close();
  }
}

function isLikelyChronological(record, fromMs) {
  return fromMs - Number(record.epochMs || 0) > 60 * 60 * 1000;
}
