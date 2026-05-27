import { basename } from 'node:path';
import { inferLevel, normalizeMessage, parseTimestamp } from './text.js';

export function parseLogRecord(line, context = {}) {
  const timestamp = parseTimestamp(line);
  if (!timestamp) return null;

  const service = inferService(line, context.service || inferServiceFromPath(context.file));
  const host = inferField(line, ['host', 'node', 'instance']) || context.host || 'unknown';
  const node = context.node || inferField(line, ['k8s_node', 'node']) || host;
  const namespace = inferField(line, ['namespace', 'ns']) || context.namespace || 'default';
  const pod = inferField(line, ['pod', 'pod_name']) || context.pod || inferPodFromPath(context.file);
  const level = inferLevel(line);

  return {
    ts: formatLocalDateTime(timestamp),
    epochMs: timestamp.getTime(),
    service,
    host,
    node,
    namespace,
    pod,
    level,
    pattern: normalizeMessage(line),
    message: line,
    source: context.file || 'unknown',
  };
}

export function formatLocalDateTime(date) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

function inferService(line, fallback) {
  const explicit = inferField(line, ['service', 'svc', 'app', 'application']);
  if (explicit) return explicit;
  const bracket = line.match(/\[([A-Za-z0-9_.-]+-service)]/i);
  if (bracket) return bracket[1];
  return fallback || 'unknown';
}

function inferField(line, names) {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}[=:]\\s*([^\\s,;\\]]+)`, 'i');
    const match = line.match(pattern);
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function inferServiceFromPath(file) {
  if (!file) return 'unknown';
  const parts = String(file).split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2];
    if (parent && parent !== 'logs' && parent !== 'containers' && parent !== 'pods') return parent;
  }
  return basename(file).replace(/\.(log|txt|out|err|trace)$/i, '') || 'unknown';
}

function inferPodFromPath(file) {
  if (!file) return 'unknown';
  const parts = String(file).split(/[\\/]/).filter(Boolean);
  const podsIndex = parts.findIndex((part) => part === 'pods');
  if (podsIndex >= 0 && parts[podsIndex + 1]) return parts[podsIndex + 1];
  return 'unknown';
}
