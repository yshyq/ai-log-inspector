import { createServer } from 'node:http';
import { analyzeSummaryBuiltin } from './modelService.js';

const PORT = Number(process.env.MODEL_PORT || 8090);

export function startModelServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, { ok: true, provider: 'builtin-cpu-model' });
      }
      if (request.method === 'POST' && url.pathname === '/analyze') {
        const body = await readJson(request);
        return json(response, {
          provider: 'builtin-cpu-model',
          text: analyzeSummaryBuiltin(body.summary || { total: 0, distributions: { levels: [] }, topClusters: [], suspectedChain: [] }),
        });
      }
      return json(response, { error: 'not found' }, 404);
    } catch (error) {
      return json(response, { error: error.message }, 500);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`log-inspector model service listening on :${PORT}`);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
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
