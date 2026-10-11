export interface FiscalTestEmailConfig { apiKey: string; from: string; to: string }
export function fiscalTestEmailConfig(env: Record<string, string | undefined> = process.env): FiscalTestEmailConfig | null {
  if (env.FISKALY_TEST_EMAIL_ENABLED !== 'true') return null;
  if (env.FISKALY_ENV !== 'test' || env.NEXI_ENV !== 'test') throw new Error('Fiscal email requires TEST');
  const to = env.FISKALY_TEST_EMAIL_TO?.trim();
  const from = env.RESEND_FROM?.trim() || 'onboarding@resend.dev';
  if (!env.RESEND_API_KEY || !to || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(to) || /[\r\n]/.test(from)) {
    throw new Error('Configure RESEND_API_KEY and one authorized FISKALY_TEST_EMAIL_TO');
  }
  return { apiKey: env.RESEND_API_KEY, from, to };
}
