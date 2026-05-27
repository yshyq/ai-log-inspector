import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, extname, join, relative, sep } from 'node:path';
import { inferLevel, normalizeMessage, parseTimestamp, tokenize } from './text.js';

const LOG_EXTENSIONS = new Set(['.log', '.txt', '.out', '.err', '.trace']);

export async function analyzeLogs(options) {
  const dir = options.dir || './logs';
  if (!existsSync(dir)) {
    throw new Error(`日志目录不存在: ${dir}`);
  }

  const range = buildRange(options);
  const files = await listLogFiles(dir);
  const state = createState(options.top || 12, range);

  for (const file of files) {
    await scanFile(file, dir, range, state);
  }

  return finalize(state, files, dir);
}

function buildRange(options) {
  if (options.around) {
    const center = parseTimestamp(options.around);
    if (!center) throw new Error(`无法解析 around 时间: ${options.around}`);
    const windowMs = Number(options.windowMinutes || 15) * 60 * 1000;
    return {
      from: new Date(center.getTime() - windowMs),
      to: new Date(center.getTime() + windowMs),
    };
  }

  const from = options.from ? parseTimestamp(options.from) : null;
  const to = options.to ? parseTimestamp(options.to) : null;
  if (!from || !to) {
    throw new Error('请提供 --from/--to，或使用 --around 配合 --window-minutes。');
  }
  if (from > to) throw new Error('--from 不能晚于 --to。');
  return { from, to };
}

async function listLogFiles(root) {
  const output = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (LOG_EXTENSIONS.has(extension) || extension === '') output.push(fullPath);
      }
    }
  }
  await walk(root);
  return output;
}

function createState(top, range) {
  return {
    top,
    range,
    totalLines: 0,
    parsedLines: 0,
    inRangeLines: 0,
    unparsedTimeLines: 0,
    filesSeen: new Set(),
    services: new Map(),
    hosts: new Map(),
    levels: new Map(),
    clusters: new Map(),
    timeline: new Map(),
    serviceTimeline: new Map(),
    keywordHits: new Map(),
    firstEventAt: null,
    lastEventAt: null,
    samplesWithoutTime: [],
  };
}

async function scanFile(file, root, range, state) {
  const fileInfo = await stat(file);
  if (fileInfo.size === 0) return;

  const serviceFromPath = inferServiceFromPath(file, root);
  const reader = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    state.totalLines += 1;
    if (!line.trim()) continue;

    const timestamp = parseTimestamp(line);
    if (!timestamp) {
      state.unparsedTimeLines += 1;
      if (state.samplesWithoutTime.length < 5) state.samplesWithoutTime.push(line.slice(0, 180));
      continue;
    }
    state.parsedLines += 1;
    if (timestamp < range.from || timestamp > range.to) continue;

    const service = inferService(line, serviceFromPath);
    const host = inferHost(line) || 'unknown';
    const level = inferLevel(line);
    const normalized = normalizeMessage(line);
    const cluster = state.clusters.get(normalized) || createCluster(normalized, line, timestamp);

    state.inRangeLines += 1;
    state.filesSeen.add(file);
    inc(state.services, service);
    inc(state.hosts, host);
    inc(state.levels, level);
    inc(state.keywordHits, matchKeyword(line));
    addTimeline(state.timeline, timestamp, level);
    addServiceTimeline(state.serviceTimeline, service, timestamp, level);
    updateCluster(cluster, { line, timestamp, service, host, level });
    state.clusters.set(normalized, cluster);

    if (!state.firstEventAt || timestamp < state.firstEventAt) state.firstEventAt = timestamp;
    if (!state.lastEventAt || timestamp > state.lastEventAt) state.lastEventAt = timestamp;
  }
}

function inferServiceFromPath(file, root) {
  const rel = relative(root, file);
  const parts = rel.split(sep).filter(Boolean);
  if (parts.length > 1) return parts[0];
  return parts[0]?.replace(/\.(log|txt|out|err|trace)$/i, '') || 'unknown';
}

function inferService(line, fallback) {
  const patterns = [
    /\bservice[=:]\s*([A-Za-z0-9_.-]+)/i,
    /\bsvc[=:]\s*([A-Za-z0-9_.-]+)/i,
    /\bapp[=:]\s*([A-Za-z0-9_.-]+)/i,
    /\[([A-Za-z0-9_.-]+-service)]/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return match[1];
  }
  return fallback || 'unknown';
}

function inferHost(line) {
  const match = line.match(/\b(host|node|instance)[=:]\s*([A-Za-z0-9_.-]+)/i);
  return match?.[2] || null;
}

function createCluster(normalized, line, timestamp) {
  return {
    key: normalized,
    tokens: tokenize(normalized),
    count: 0,
    score: 0,
    levels: new Map(),
    services: new Map(),
    hosts: new Map(),
    firstAt: timestamp,
    lastAt: timestamp,
    samples: [line.slice(0, 240)],
  };
}

function updateCluster(cluster, event) {
  cluster.count += 1;
  inc(cluster.levels, event.level);
  inc(cluster.services, event.service);
  inc(cluster.hosts, event.host);
  if (event.timestamp < cluster.firstAt) cluster.firstAt = event.timestamp;
  if (event.timestamp > cluster.lastAt) cluster.lastAt = event.timestamp;
  if (cluster.samples.length < 3 && !cluster.samples.includes(event.line)) {
    cluster.samples.push(event.line.slice(0, 240));
  }
}

function addTimeline(map, timestamp, level) {
  const key = minuteKey(timestamp);
  const item = map.get(key) || { minute: key, total: 0, error: 0, warn: 0 };
  item.total += 1;
  if (level === 'ERROR' || level === 'FATAL') item.error += 1;
  if (level === 'WARN') item.warn += 1;
  map.set(key, item);
}

function addServiceTimeline(map, service, timestamp, level) {
  const serviceMap = map.get(service) || new Map();
  addTimeline(serviceMap, timestamp, level);
  map.set(service, serviceMap);
}

function finalize(state, files, root) {
  const clusters = [...state.clusters.values()].map((cluster) => {
    const levelWeight = weightedLevelScore(cluster.levels);
    const burstWeight = burstScore(cluster.firstAt, cluster.lastAt, cluster.count);
    cluster.score = cluster.count + levelWeight + burstWeight;
    return {
      pattern: cluster.key,
      count: cluster.count,
      score: Number(cluster.score.toFixed(2)),
      firstAt: formatLocalDateTime(cluster.firstAt),
      lastAt: formatLocalDateTime(cluster.lastAt),
      levels: topEntries(cluster.levels, 5),
      services: topEntries(cluster.services, 8),
      hosts: topEntries(cluster.hosts, 5),
      samples: cluster.samples,
    };
  }).sort((a, b) => b.score - a.score || b.count - a.count);

  const topClusters = clusters.slice(0, state.top);
  const timeline = [...state.timeline.values()].sort((a, b) => a.minute.localeCompare(b.minute));
  const serviceTimeline = [...state.serviceTimeline.entries()].map(([service, map]) => ({
    service,
    timeline: [...map.values()].sort((a, b) => a.minute.localeCompare(b.minute)),
  }));

  return {
    range: {
      from: formatLocalDateTime(state.range.from),
      to: formatLocalDateTime(state.range.to),
      firstEventAt: state.firstEventAt ? formatLocalDateTime(state.firstEventAt) : null,
      lastEventAt: state.lastEventAt ? formatLocalDateTime(state.lastEventAt) : null,
    },
    source: {
      root,
      filesFound: files.length,
      filesWithEvents: state.filesSeen.size,
      files: files.slice(0, 100).map((file) => relative(root, file)),
    },
    totals: {
      linesScanned: state.totalLines,
      linesWithTimestamp: state.parsedLines,
      linesInRange: state.inRangeLines,
      linesWithoutTimestamp: state.unparsedTimeLines,
    },
    distributions: {
      services: topEntries(state.services, 20),
      hosts: topEntries(state.hosts, 20),
      levels: topEntries(state.levels, 10),
      keywords: topEntries(state.keywordHits, 20).filter((item) => item.key !== 'none'),
    },
    topClusters,
    timeline,
    serviceTimeline,
    suspectedChain: inferSuspectedChain(topClusters, serviceTimeline),
    samplesWithoutTime: state.samplesWithoutTime,
  };
}

function inferSuspectedChain(clusters, serviceTimeline) {
  const starts = serviceTimeline.map(({ service, timeline }) => {
    const firstBad = timeline.find((item) => item.error > 0 || item.warn > 2);
    const peak = timeline.reduce((best, item) => {
      const score = item.error * 3 + item.warn + item.total * 0.1;
      return score > best.score ? { minute: item.minute, score } : best;
    }, { minute: null, score: 0 });
    return { service, firstBadAt: firstBad?.minute || null, peakAt: peak.minute, score: peak.score };
  }).filter((item) => item.firstBadAt || item.score > 0)
    .sort((a, b) => (a.firstBadAt || a.peakAt).localeCompare(b.firstBadAt || b.peakAt));

  const mentionedServices = new Set();
  for (const cluster of clusters.slice(0, 8)) {
    for (const item of cluster.services) mentionedServices.add(item.key);
  }

  return starts
    .filter((item) => mentionedServices.has(item.service) || item.score > 2)
    .slice(0, 8);
}

function weightedLevelScore(levels) {
  return (levels.get('FATAL') || 0) * 8
    + (levels.get('ERROR') || 0) * 5
    + (levels.get('WARN') || 0) * 2;
}

function burstScore(firstAt, lastAt, count) {
  const minutes = Math.max(1, (lastAt.getTime() - firstAt.getTime()) / 60000);
  return count / minutes;
}

function matchKeyword(line) {
  const lowered = line.toLowerCase();
  const keywords = [
    'timeout',
    'connection refused',
    'refused',
    'oom',
    'outofmemory',
    'deadlock',
    'disk full',
    'pool exhausted',
    'reset',
    '502',
    '503',
    'fatal',
    'exception',
  ];
  return keywords.find((keyword) => lowered.includes(keyword)) || 'none';
}

function minuteKey(date) {
  return formatLocalDateTime(date).slice(0, 16);
}

function inc(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function formatLocalDateTime(date) {
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
