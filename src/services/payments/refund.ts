import type { PaymentProvider } from './types';
import type { PaymentsRepo } from './service';

// Rimborsa un pagamento: chiama lo storno del provider e segna la riga come 'refunded'.
// Idempotente: se il pagamento e' gia' 'refunded' non fa nulla.
export async function refundPayment(args: {
  provider: PaymentProvider;
  repo: PaymentsRepo;
  providerRef: string;
}): Promise<void> {
  const { provider, repo, providerRef } = args;

  const payment = await repo.getByProviderRef(providerRef);
  if (!payment) throw new Error(`Pagamento non trovato: ${providerRef}`);
  if (payment.status === 'refunded') return; // gia' rimborsato

  await provider.refund(providerRef, payment.amount_cents);
  await repo.updateByProviderRef(providerRef, { status: 'refunded' });
}
