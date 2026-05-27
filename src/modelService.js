import { summarizeRecords } from './summary.js';

export async function analyzeWithSmallModel(records, options = {}) {
  const summary = summarizeRecords(records, { top: options.top || 12 });
  const modelServiceUrl = process.env.MODEL_SERVICE_URL;
  if (modelServiceUrl) {
    try {
      const response = await fetch(`${modelServiceUrl.replace(/\/$/, '')}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!response.ok) throw new Error(`Model service HTTP ${response.status}`);
      const body = await response.json();
      return {
        provider: body.provider || 'model-service',
        text: body.text || builtinAnalysis(summary),
        summary,
      };
    } catch (error) {
      return {
        provider: 'builtin-cpu-fallback',
        text: `${builtinAnalysis(summary)}\n\n模型服务不可用，已使用内置分析。原因：${error.message}`,
        summary,
      };
    }
  }

  const ollamaUrl = process.env.OLLAMA_URL;
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

  if (!ollamaUrl) {
    return {
      provider: 'builtin-cpu',
      text: builtinAnalysis(summary),
      summary,
    };
  }

  const prompt = buildPrompt(summary);
  try {
    const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_ctx: 2048,
        },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body = await response.json();
    return {
      provider: `ollama:${model}`,
      text: body.response || builtinAnalysis(summary),
      summary,
    };
  } catch (error) {
    return {
      provider: 'builtin-cpu-fallback',
      text: `${builtinAnalysis(summary)}\n\n小模型服务不可用，已使用内置分析。原因：${error.message}`,
      summary,
    };
  }
}

function buildPrompt(summary) {
  return [
    '你是一个中文运维日志分析助手。请基于以下结构化日志摘要，输出：异常概览、影响服务、疑似根因、排查建议。不要编造不存在的证据。',
    JSON.stringify(summary, null, 2),
  ].join('\n\n');
}

function builtinAnalysis(summary) {
  const errors = countLevel(summary, 'ERROR') + countLevel(summary, 'FATAL');
  const warns = countLevel(summary, 'WARN');
  const top = summary.topClusters[0];
  const chain = summary.suspectedChain.map((item) => `${item.service}@${item.firstAt.slice(11, 16)}`).join(' -> ');
  const lines = [];

  lines.push(`本次命中 ${summary.total} 条日志，ERROR/FATAL ${errors} 条，WARN ${warns} 条。`);
  if (top) {
    lines.push(`最主要异常模式：${top.pattern}，出现 ${top.count} 次，主要服务：${top.services[0]?.key || 'unknown'}。`);
  }
  if (chain) {
    lines.push(`疑似异常链路：${chain}。`);
  }
  lines.push('建议优先按时间线查看最早异常服务的发布、依赖、CPU/内存、连接池和下游调用指标。');
  return lines.join('\n');
}

export function analyzeSummaryBuiltin(summary) {
  return builtinAnalysis(summary);
}

function countLevel(summary, level) {
  return summary.distributions.levels.find((item) => item.key === level)?.count || 0;
}
