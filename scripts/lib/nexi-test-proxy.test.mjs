import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNexiTestProxy } from './nexi-test-proxy.mjs';
const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });
async function proxy() {
  const upstream = vi.fn(async () => new Response('private diagnostic', { status: 400 }));
  const server = createNexiTestProxy(upstream); servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { upstream, base: 'http://127.0.0.1:' + server.address().port };
}
describe('restricted Nexi TEST proxy', () => {
  it('blocks staff pages and unsupported methods', async () => {
    const { upstream, base } = await proxy();
    expect((await fetch(base + '/calendar')).status).toBe(404);
    expect((await fetch(base + '/api/webhooks/payments/nexi')).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards only form notifications and hides private upstream errors', async () => {
    const { upstream, base } = await proxy();
    const response = await fetch(base + '/api/webhooks/payments/nexi', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-internal-secret': 'untrusted' }, body: 'mac=invalid' });
    expect(response.status).toBe(400); expect(await response.text()).toBe('Webhook refused');
    expect(upstream.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/webhooks/payments/nexi');
    expect(upstream.mock.calls[0][1].headers).not.toHaveProperty('x-internal-secret');
  });
  it('rejects oversized bodies without contacting the app', async () => {
    const { upstream, base } = await proxy();
    const response = await fetch(base + '/api/webhooks/payments/nexi', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(8193) });
    expect(response.status).toBe(413); expect(upstream).not.toHaveBeenCalled();
  });
});
