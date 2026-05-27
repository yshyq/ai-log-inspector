export function summarizeRecords(records, options = {}) {
  const top = Number(options.top || 12);
  const clusters = new Map();
  const services = new Map();
  const levels = new Map();
  const timeline = new Map();

  for (const record of records) {
    inc(services, record.service);
    inc(levels, record.level);
    addTimeline(timeline, record);

    const cluster = clusters.get(record.pattern) || {
      pattern: record.pattern,
      count: 0,
      score: 0,
      firstAt: record.ts,
      lastAt: record.ts,
      levels: new Map(),
      services: new Map(),
      samples: [],
    };
    cluster.count += 1;
    cluster.firstAt = record.ts < cluster.firstAt ? record.ts : cluster.firstAt;
    cluster.lastAt = record.ts > cluster.lastAt ? record.ts : cluster.lastAt;
    inc(cluster.levels, record.level);
    inc(cluster.services, record.service);
    if (cluster.samples.length < 3) cluster.samples.push(record.message.slice(0, 240));
    clusters.set(record.pattern, cluster);
  }

  const topClusters = [...clusters.values()].map((cluster) => ({
    ...cluster,
    score: cluster.count + weightedLevelScore(cluster.levels),
    levels: topEntries(cluster.levels, 5),
    services: topEntries(cluster.services, 8),
  })).sort((a, b) => b.score - a.score || b.count - a.count).slice(0, top);

  return {
    total: records.length,
    distributions: {
      services: topEntries(services, 20),
      levels: topEntries(levels, 10),
    },
    timeline: [...timeline.values()].sort((a, b) => a.minute.localeCompare(b.minute)),
    topClusters,
    suspectedChain: inferChain(topClusters),
  };
}

function addTimeline(map, record) {
  const minute = record.ts.slice(0, 16);
  const item = map.get(minute) || { minute, total: 0, error: 0, warn: 0 };
  item.total += 1;
  if (record.level === 'ERROR' || record.level === 'FATAL') item.error += 1;
  if (record.level === 'WARN') item.warn += 1;
  map.set(minute, item);
}

function inferChain(clusters) {
  const seen = new Set();
  const chain = [];
  for (const cluster of clusters) {
    const service = cluster.services[0]?.key;
    if (service && !seen.has(service)) {
      seen.add(service);
      chain.push({ service, firstAt: cluster.firstAt, count: cluster.count });
    }
  }
  return chain.sort((a, b) => a.firstAt.localeCompare(b.firstAt)).slice(0, 8);
}

function weightedLevelScore(levels) {
  return (levels.get('FATAL') || 0) * 8
    + (levels.get('ERROR') || 0) * 5
    + (levels.get('WARN') || 0) * 2;
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
