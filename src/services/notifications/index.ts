import { Resend } from 'resend';
import { ResendProvider } from './resend';
import type { EmailProvider } from './types';

export type { EmailProvider } from './types';

export interface EmailConfig {
  apiKey?: string;
  from?: string;
}

// Mittente di default: il dominio di test di Resend (funziona senza verifica dominio).
const DEFAULT_FROM = 'onboarding@resend.dev';

export function createEmailProvider(config: EmailConfig): EmailProvider {
  if (!config.apiKey) {
    throw new Error('Configurazione email incompleta: manca RESEND_API_KEY');
  }
  return new ResendProvider(new Resend(config.apiKey), config.from || DEFAULT_FROM);
}

type EnvSource = Record<string, string | undefined>;

export function emailConfigFromEnv(env: EnvSource = process.env): EmailConfig {
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM,
  };
}
