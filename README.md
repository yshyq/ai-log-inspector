# AI Log Inspector

轻量级智能日志巡检与故障预判助手，面向独立环境、无 GPU、资源有限的客户现场。

它不要求日志格式统一。用户给定一个时间范围后，工具会扫描多服务日志，做弱解析、自动聚类、异常统计、时间线分析，并输出中文巡检报告。

## 快速开始

```powershell
npm run demo
```

Linux 解压包后运行：

```bash
tar -xzf ai-log-inspector-0.1.0.tgz
cd package
npm run test
npm run demo
```

也可以不安装，直接调用：

```bash
node ./src/cli.js analyze --dir ./logs --from "2026-05-07 10:00:00" --to "2026-05-07 10:30:00"
```

分析指定日志目录：

```powershell
node .\src\cli.js analyze --dir .\logs --from "2026-05-07 10:00:00" --to "2026-05-07 10:30:00"
```

输出 JSON：

```powershell
node .\src\cli.js analyze --dir .\logs --from "2026-05-07 10:00:00" --to "2026-05-07 10:30:00" --format json
```

指定故障点，自动分析前后窗口：

```powershell
node .\src\cli.js analyze --dir .\logs --around "2026-05-07 10:08:00" --window-minutes 15
```

## 能力

- 多文件、多服务日志扫描
- 不统一格式的弱解析
- 按时间范围过滤
- 自动识别日志级别、服务名、主机名
- 归一化相似日志并聚类
- 统计新增/高频/错误/突增事件
- 分钟级异常时间线
- 疑似服务传播链路
- 中文 Markdown 巡检报告

## Docker 部署

构建镜像：

```bash
docker build -t ai-log-inspector:0.3.5 .
```

运行 demo：

```bash
docker run --rm ai-log-inspector:0.3.5 demo
```

挂载宿主机日志目录并输出报告：

```bash
mkdir -p ./reports
docker run --rm \
  -v /path/to/host/logs:/logs:ro \
  -v "$(pwd)/reports:/reports" \
  ai-log-inspector:0.3.5 \
  analyze --dir /logs \
  --from "2026-05-07 10:00:00" \
  --to "2026-05-07 10:30:00" \
  --out /reports/report.md
```

故障点反查：

```bash
docker run --rm \
  -v /path/to/host/logs:/logs:ro \
  ai-log-inspector:0.3.5 \
  analyze --dir /logs \
  --around "2026-05-07 10:08:00" \
  --window-minutes 15
```

使用 Compose：

```bash
docker compose run --rm log-inspector
```

## 服务模式

启动中心 API 和 Web UI：

```bash
docker run --rm -p 8080:8080 \
  -v "$(pwd)/data:/data" \
  -e MAX_QUERY_HOURS=6 \
  ai-log-inspector:0.3.5 server
```

浏览器打开：

```text
http://localhost:8080
```

启动节点采集 Agent：

```bash
docker run --rm \
  -v /var/log/paas:/host/var/log/paas:ro \
  -v /var/lib/log-inspector-agent:/state \
  -e API_URL=http://your-api:8080 \
  -e LOG_DIR=/host/var/log/paas \
  -e NODE_NAME=$(hostname) \
  ai-log-inspector:0.3.5 agent
```

服务端会强制限制查询时间范围，默认最大 6 小时：

```bash
-e MAX_QUERY_HOURS=6
```

## K8S 部署

构建并推送镜像后，修改 `k8s/log-inspector.yaml` 里的镜像地址：

```bash
docker build -t ai-log-inspector:0.3.5 .
```

部署中心服务和 DaemonSet Agent：

```bash
kubectl apply -f k8s/log-inspector.yaml
```

每个节点会启动一个 Agent，挂载宿主机：

```text
/var/log/paas -> /host/var/log/paas
```

访问 UI：

```bash
kubectl -n log-inspector port-forward svc/log-inspector-api 8080:8080
```

然后打开：

```text
http://localhost:8080
```

## CPU 小模型

系统默认使用内置 CPU 规则分析，不依赖 GPU。若要接入真正的小模型，可部署 Ollama CPU 服务：

```bash
kubectl apply -f k8s/ollama-cpu.yaml
```

进入 Ollama Pod 拉取小模型，例如：

```bash
kubectl -n log-inspector exec -it deploy/ollama-cpu -- ollama pull qwen2.5:0.5b
```

中心服务通过环境变量接入：

```text
OLLAMA_URL=http://ollama-cpu:11434
OLLAMA_MODEL=qwen2.5:0.5b
```

资源有限时建议从 `0.5b` 或 `1.5b` 量级开始，CPU 环境更稳。

## 设计原则

小模型或本地 LLM 不直接读取全部日志，而是读取本工具压缩后的异常证据：

```text
原始日志 -> 弱解析 -> 时间窗口过滤 -> 归一化聚类 -> 异常摘要 -> 小模型解释
```

当前版本已经能独立生成可读报告。后续可以把 `--format json` 的结果喂给本地 Qwen/Phi/MiniCPM 小模型，让它生成更自然的根因分析和处置建议。
