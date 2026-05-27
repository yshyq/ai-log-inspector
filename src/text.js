const TIMESTAMP_PATTERNS = [
  /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?\b/,
  /\b(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?\b/,
  /\b(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?\b/,
];

export function parseTimestamp(text) {
  if (text instanceof Date) return text;
  const value = String(text);

  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;

    let year;
    let month;
    let day;
    let hour;
    let minute;
    let second;
    let millis;

    if (pattern === TIMESTAMP_PATTERNS[2]) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
      hour = Number(match[4]);
      minute = Number(match[5]);
      second = Number(match[6]);
      millis = normalizeMillis(match[7]);
    } else {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4]);
      minute = Number(match[5]);
      second = Number(match[6]);
      millis = normalizeMillis(match[7]);
    }

    const date = new Date(year, month - 1, day, hour, minute, second, millis);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function inferLevel(line) {
  const upper = line.toUpperCase();
  if (/\b(FATAL|CRITICAL|PANIC)\b/.test(upper)) return 'FATAL';
  if (/\b(ERROR|ERR|EXCEPTION|FAIL|FAILED)\b/.test(upper)) return 'ERROR';
  if (/\b(WARN|WARNING)\b/.test(upper)) return 'WARN';
  if (/\b(DEBUG|TRACE)\b/.test(upper)) return 'DEBUG';
  if (/\b(INFO|NOTICE)\b/.test(upper)) return 'INFO';
  return 'UNKNOWN';
}

export function normalizeMessage(line) {
  return line
    .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\b/g, '<time>')
    .replace(/\b\d{2}-\d{2}-\d{4}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\b/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\b\d+(?:\.\d+)?(ms|s|mb|gb|kb|%)\b/gi, '<num>$1')
    .replace(/\b\d+\.\d+\b/g, '<num>')
    .replace(/\b\d+\b/g, '<num>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/\b(user|order|trace|span|request|req|session|task|job|id)[_-]?id[=:][^\s,;]+/gi, '$1_id=<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function tokenize(text) {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9_\u4e00-\u9fa5]+/).filter(Boolean))];
}

function normalizeMillis(value) {
  if (!value) return 0;
  return Number(value.padEnd(3, '0').slice(0, 3));
}
