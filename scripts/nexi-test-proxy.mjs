import assert from 'node:assert/strict';
import { createNexiTestProxy } from './lib/nexi-test-proxy.mjs';
assert.equal(process.env.PAYMENT_PROVIDER, 'nexi');
assert.equal(process.env.NEXI_ENV, 'test');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
const server = createNexiTestProxy();
server.listen(3001, '127.0.0.1', () => console.log('Nexi TEST webhook proxy ready on 127.0.0.1:3001'));
server.on('error', () => { console.error('Nexi TEST proxy unavailable'); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
