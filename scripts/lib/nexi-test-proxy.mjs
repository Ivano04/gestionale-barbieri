import { createServer } from 'node:http';
const path = '/api/webhooks/payments/nexi';
export function createNexiTestProxy(fetchImpl = fetch) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST' || request.url !== path) { response.writeHead(404); response.end('Not found'); return; }
    if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { response.writeHead(415); response.end('Unsupported content type'); return; }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) { response.writeHead(413); response.end('Payload too large'); return; }
        chunks.push(chunk);
      }
      const upstream = await fetchImpl('http://127.0.0.1:3000' + path, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: Buffer.concat(chunks),
        redirect: 'error', signal: AbortSignal.timeout(30_000) });
      response.writeHead(upstream.status);
      response.end(upstream.status === 200 ? 'OK' : upstream.status === 400 ? 'Webhook refused' : 'Webhook not processed');
    } catch { if (!response.headersSent) response.writeHead(503); response.end('Webhook unavailable'); }
  });
}
