import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, extname, join } from 'node:path';
import { parseLogRecord } from './logRecord.js';

const LOG_EXTENSIONS = new Set(['.log', '.txt', '.out', '.err']);
const LOG_DIR = process.env.LOG_DIR || '/host/var/log/containers';
const API_URL = process.env.API_URL || 'http://log-inspector:8080';
const NODE_NAME = process.env.NODE_NAME || process.env.HOSTNAME || 'unknown-node';
const STATE_PATH = process.env.STATE_PATH || '/state/offsets.json';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 10000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

export function startAgent() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  console.log(`log agent watching ${LOG_DIR}, posting to ${API_URL}`);
  tick();
  setInterval(tick, INTERVAL_MS);
}

async function tick() {
  try {
    const state = loadState();
    const files = await listLogFiles(LOG_DIR);
    for (const file of files) {
      const records = await readNewRecords(file, state[file] || 0);
      if (records.items.length) {
        await postInChunks(records.items);
      }
      if (records.nextOffset !== state[file]) {
        state[file] = records.nextOffset;
        saveState(state);
      }
    }
  } catch (error) {
    console.error(`[agent] ${error.message}`);
  }
}

async function listLogFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (LOG_EXTENSIONS.has(ext) || ext === '') output.push(fullPath);
      }
    }
  }
  await walk(root);
  return output;
}

async function readNewRecords(file, offset) {
  const info = await stat(file);
  const start = info.size < offset ? 0 : offset;
  const stream = createReadStream(file, { encoding: 'utf8', start });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const items = [];
  let pending = null;
  for await (const line of reader) {
    const record = parseLogRecord(line, { file, node: NODE_NAME });
    if (record) {
      if (pending) items.push(pending);
      pending = record;
    } else if (pending && line.trim()) {
      pending.message += `\n${line}`;
      pending.pattern += '\n<continued>';
    }
  }
  if (pending) items.push(pending);
  return { items, nextOffset: info.size };
}

async function postBatch(records) {
  const response = await fetch(`${API_URL.replace(/\/$/, '')}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!response.ok) throw new Error(`ingest failed HTTP ${response.status}`);
  const body = await response.json();
  console.log(`[agent] posted ${body.inserted} records`);
}

async function postInChunks(records) {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    await postBatch(records.slice(i, i + BATCH_SIZE));
  }
}

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
