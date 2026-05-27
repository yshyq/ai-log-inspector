#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { analyzeLogs } from './logAnalyzer.js';
import { formatMarkdownReport } from './report.js';
import { createDemoLogs, demoDir } from './demoData.js';
import { runTests } from './selfTest.js';
import { startServer } from './server.js';
import { startAgent } from './agent.js';
import { startModelServer } from './modelServer.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return [
    '用法:',
    '  node ./src/cli.js analyze --dir <日志目录> --from "2026-05-07 10:00:00" --to "2026-05-07 10:30:00"',
    '  node ./src/cli.js analyze --dir <日志目录> --around "2026-05-07 10:08:00" --window-minutes 15',
    '  node ./src/cli.js server',
    '  node ./src/cli.js agent',
    '  node ./src/cli.js model-server',
    '  node ./src/cli.js demo',
    '',
    '参数:',
    '  --dir              日志目录，默认 ./logs',
    '  --from             开始时间',
    '  --to               结束时间',
    '  --around           故障点时间，配合 --window-minutes 使用',
    '  --window-minutes   around 前后窗口分钟数，默认 15',
    '  --format           markdown 或 json，默认 markdown',
    '  --top              输出 Top 聚类数量，默认 12',
    '  --out              写入报告文件',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';

  if (command === 'help' || args.help) {
    console.log(usage());
    return;
  }

  if (command === 'demo') {
    mkdirSync(demoDir, { recursive: true });
    createDemoLogs(demoDir);
    const result = await analyzeLogs({
      dir: demoDir,
      from: '2026-05-07 10:00:00',
      to: '2026-05-07 10:30:00',
      top: Number(args.top || 12),
    });
    console.log(formatMarkdownReport(result));
    return;
  }

  if (command === 'server') {
    startServer();
    return;
  }

  if (command === 'agent') {
    startAgent();
    return;
  }

  if (command === 'model-server') {
    startModelServer();
    return;
  }

  if (command === 'test') {
    await runTests();
    console.log('Self tests passed.');
    return;
  }

  if (command !== 'analyze') {
    console.error(`未知命令: ${command}\n`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const result = await analyzeLogs({
    dir: args.dir || './logs',
    from: args.from,
    to: args.to,
    around: args.around,
    windowMinutes: Number(args['window-minutes'] || 15),
    top: Number(args.top || 12),
  });

  const output = args.format === 'json'
    ? JSON.stringify(result, null, 2)
    : formatMarkdownReport(result);

  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : join(process.cwd(), args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output, 'utf8');
  } else {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
