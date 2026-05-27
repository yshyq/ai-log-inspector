export function formatMarkdownReport(result) {
  const lines = [];
  lines.push('# 智能日志巡检报告');
  lines.push('');
  lines.push(`时间范围：${formatTime(result.range.from)} ~ ${formatTime(result.range.to)}`);
  lines.push(`扫描结果：${result.totals.linesScanned} 行日志，命中时间范围 ${result.totals.linesInRange} 行，涉及 ${result.distributions.services.length} 个服务。`);
  lines.push('');

  lines.push('## 总体判断');
  lines.push('');
  lines.push(...summaryLines(result));
  lines.push('');

  lines.push('## 异常事件 Top');
  lines.push('');
  if (result.topClusters.length === 0) {
    lines.push('未在指定时间范围内发现可分析日志。');
  } else {
    result.topClusters.forEach((cluster, index) => {
      const services = cluster.services.map((item) => `${item.key}(${item.count})`).join(', ');
      const levels = cluster.levels.map((item) => `${item.key}(${item.count})`).join(', ');
      lines.push(`${index + 1}. ${cluster.pattern}`);
      lines.push(`   - 次数：${cluster.count}，级别：${levels || 'UNKNOWN'}，服务：${services || 'unknown'}`);
      lines.push(`   - 首次：${formatTime(cluster.firstAt)}，最后：${formatTime(cluster.lastAt)}`);
      lines.push(`   - 样例：${cluster.samples[0]}`);
    });
  }
  lines.push('');

  lines.push('## 服务与级别分布');
  lines.push('');
  lines.push(`服务：${formatEntries(result.distributions.services) || '无'}`);
  lines.push(`级别：${formatEntries(result.distributions.levels) || '无'}`);
  lines.push(`关键词：${formatEntries(result.distributions.keywords) || '无明显关键字'}`);
  lines.push('');

  lines.push('## 异常时间线');
  lines.push('');
  const hotTimeline = result.timeline
    .filter((item) => item.error > 0 || item.warn > 0)
    .slice(0, 30);
  if (hotTimeline.length === 0) {
    lines.push('未发现 ERROR/WARN 时间点。');
  } else {
    for (const item of hotTimeline) {
      lines.push(`- ${item.minute}: total=${item.total}, error=${item.error}, warn=${item.warn}`);
    }
  }
  lines.push('');

  lines.push('## 疑似传播链路');
  lines.push('');
  if (result.suspectedChain.length === 0) {
    lines.push('暂未形成明显服务传播链路。');
  } else {
    const chain = result.suspectedChain
      .map((item) => `${item.service}@${item.firstBadAt || item.peakAt}`)
      .join(' -> ');
    lines.push(chain);
  }
  lines.push('');

  lines.push('## 建议排查');
  lines.push('');
  lines.push(...adviceLines(result));

  if (result.samplesWithoutTime.length > 0) {
    lines.push('');
    lines.push('## 时间解析提示');
    lines.push('');
    lines.push(`有 ${result.totals.linesWithoutTimestamp} 行未解析到时间戳，样例：`);
    for (const sample of result.samplesWithoutTime) lines.push(`- ${sample}`);
  }

  return lines.join('\n');
}

function summaryLines(result) {
  if (result.totals.linesInRange === 0) {
    return ['指定时间范围内没有命中日志，请检查时间格式、时区或日志目录。'];
  }

  const errors = findCount(result.distributions.levels, 'ERROR') + findCount(result.distributions.levels, 'FATAL');
  const warns = findCount(result.distributions.levels, 'WARN');
  const top = result.topClusters[0];
  const lines = [];

  if (errors > 0) {
    lines.push(`- 发现 ${errors} 条 ERROR/FATAL 日志，建议优先处理。`);
  } else if (warns > 0) {
    lines.push(`- 未发现 ERROR/FATAL，但有 ${warns} 条 WARN，需要结合业务影响确认。`);
  } else {
    lines.push('- 未发现明显错误级别日志，当前窗口风险较低。');
  }

  if (top) {
    const topService = top.services[0]?.key || 'unknown';
    lines.push(`- 最突出的事件来自 ${topService}，出现 ${top.count} 次。`);
  }

  if (result.suspectedChain.length >= 2) {
    lines.push('- 多个服务在相邻时间点出现异常，存在链路传播或共同依赖异常的可能。');
  }

  return lines;
}

function adviceLines(result) {
  const keywords = new Set(result.distributions.keywords.map((item) => item.key));
  const advice = [];

  if (keywords.has('timeout')) advice.push('- 存在 timeout，优先检查下游接口延迟、线程池、连接池和网络抖动。');
  if (keywords.has('connection refused') || keywords.has('refused')) advice.push('- 存在连接拒绝，检查目标服务存活、端口监听、防火墙和服务注册状态。');
  if (keywords.has('pool exhausted')) advice.push('- 存在连接池耗尽，检查连接泄漏、慢查询、池大小和并发峰值。');
  if (keywords.has('oom') || keywords.has('outofmemory')) advice.push('- 存在内存异常，检查堆内存、容器限制、近期发布和大对象分配。');
  if (keywords.has('502') || keywords.has('503')) advice.push('- 存在网关 5xx，沿入口服务向下游按时间线逐层反查。');

  if (result.suspectedChain.length > 0) {
    const first = result.suspectedChain[0];
    advice.push(`- 优先查看最早异常服务 ${first.service} 在 ${first.firstBadAt || first.peakAt} 附近的指标和发布记录。`);
  }

  if (advice.length === 0) {
    advice.push('- 建议扩大时间窗口，并结合 CPU、内存、磁盘、网络和发布记录做交叉验证。');
  }

  return advice;
}

function formatEntries(entries) {
  return entries.map((item) => `${item.key}(${item.count})`).join(', ');
}

function findCount(entries, key) {
  return entries.find((item) => item.key === key)?.count || 0;
}

function formatTime(value) {
  if (!value) return 'N/A';
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
