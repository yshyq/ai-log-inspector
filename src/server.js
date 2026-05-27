import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonlLogStore } from './store.js';
import { summarizeRecords } from './summary.js';
import { analyzeWithSmallModel } from './modelService.js';
import { parseTimestamp } from './text.js';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';
const MAX_QUERY_HOURS = Number(process.env.MAX_QUERY_HOURS || 6);
const MAX_LIMIT = Number(process.env.MAX_LIMIT || 1000);
let store;

export function startServer() {
  mkdirSync(DATA_DIR, { recursive: true });
  store = new JsonlLogStore(join(DATA_DIR, 'logs.ndjson'));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/') return html(response);
      if (request.method === 'GET' && url.pathname === '/health') return json(response, { ok: true });
      if (request.method === 'POST' && url.pathname === '/api/ingest') return await ingest(request, response);
      if (request.method === 'GET' && url.pathname === '/api/search') return await search(url, response);
      if (request.method === 'GET' && url.pathname === '/api/analyze') return await analyze(url, response);
      if (request.method === 'GET' && url.pathname === '/api/download') return await download(url, response);
      return json(response, { error: 'not found' }, 404);
    } catch (error) {
      return json(response, { error: error.message }, 500);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`log-inspector server listening on :${PORT}`);
  });
}

async function ingest(request, response) {
  const body = await readJson(request);
  const records = Array.isArray(body.records) ? body.records : [];
  const result = await store.append(records);
  return json(response, result);
}

async function search(url, response) {
  const criteria = criteriaFromUrl(url);
  validateRange(criteria.from, criteria.to);
  criteria.limit = Math.min(Number(criteria.limit || 200), MAX_LIMIT);
  const records = await store.query(criteria);
  const publicRecords = records.map(toPublicRecord);
  return json(response, {
    range: { from: criteria.from, to: criteria.to, maxHours: MAX_QUERY_HOURS },
    count: publicRecords.length,
    records: publicRecords,
    summary: summarizeRecords(records),
  });
}

async function analyze(url, response) {
  const criteria = criteriaFromUrl(url);
  validateRange(criteria.from, criteria.to);
  criteria.limit = Math.min(Number(criteria.limit || MAX_LIMIT), MAX_LIMIT);
  const records = await store.query(criteria);
  const publicRecords = records.map(toPublicRecord);
  const result = await analyzeWithSmallModel(records);
  return json(response, {
    range: { from: criteria.from, to: criteria.to, maxHours: MAX_QUERY_HOURS },
    count: publicRecords.length,
    records: publicRecords,
    ...result,
  });
}

async function download(url, response) {
  const criteria = criteriaFromUrl(url);
  validateRange(criteria.from, criteria.to);
  criteria.limit = 0;
  const records = await store.query(criteria);
  const body = records.map((record) => [
    `[${record.ts}] [${record.level}] [${record.service}]`,
    record.message,
  ].join(' ')).join('\n\n');
  const filename = `service-logs-${criteria.from.replace(/[: ]/g, '-')}_${criteria.to.replace(/[: ]/g, '-')}.log`;
  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
  });
  response.end(body);
}

function toPublicRecord(record) {
  return {
    ts: record.ts,
    service: record.service,
    level: record.level,
    pattern: record.pattern,
    message: record.message,
  };
}

function criteriaFromUrl(url) {
  return {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    field: url.searchParams.get('field') || 'message',
    value: url.searchParams.get('value') || '',
    service: url.searchParams.get('service') || '',
    level: url.searchParams.get('level') || '',
    limit: url.searchParams.get('limit') || '200',
  };
}

function validateRange(fromValue, toValue) {
  const from = parseTimestamp(fromValue || '');
  const to = parseTimestamp(toValue || '');
  if (!from || !to) throw new Error('from/to 时间格式不正确');
  if (from > to) throw new Error('from 不能晚于 to');
  const hours = (to.getTime() - from.getTime()) / 3600000;
  if (hours > MAX_QUERY_HOURS) {
    throw new Error(`查询时间范围不能超过 ${MAX_QUERY_HOURS} 小时`);
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) {
        reject(new Error('request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
    request.on('error', reject);
  });
}

function json(response, payload, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(readFileSync(new URL('./ui.html', import.meta.url), 'utf8'));
}
