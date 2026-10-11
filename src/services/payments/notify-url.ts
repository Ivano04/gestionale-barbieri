export function nexiNotifyUrl(base: string, env: Record<string, string | undefined> = process.env): string {
  const override = env.NEXI_TEST_NOTIFY_URL?.trim();
  if (!override) return `${base}/api/webhooks/payments/nexi`;
  if (env.PAYMENT_PROVIDER !== 'nexi' || env.NEXI_ENV !== 'test') throw new Error('Public TEST callback requires Nexi sandbox');
  const url = new URL(override);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/api/webhooks/payments/nexi' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Invalid HTTPS Nexi TEST callback');
  }
  return url.toString();
}
