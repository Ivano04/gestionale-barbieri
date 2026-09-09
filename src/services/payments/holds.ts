// Blocco slot temporaneo: un pagamento "pending" recente riserva lo slot finche'
// non viene completato o scade. Concilia "niente in appointments finche' non paga"
// con la protezione dello slot durante il pagamento.

// TTL del blocco: allineare al timeout della sessione di pagamento (Nexi xpayTimeout).
export const HOLD_TTL_MS = 15 * 60 * 1000; // 15 minuti

export interface HoldRow {
  status: string;
  created_at: string;
  metadata: any;
}

export interface HoldBlock {
  stylist_id: string | null;
  start_time: Date;
  end_time: Date;
}

// Trasforma i pagamenti pending recenti in blocchi occupati.
// Scarta: non-pending, scaduti (oltre il TTL), privi di dati slot.
export function activeHoldsToBlocks(rows: HoldRow[], now: Date, ttlMs: number = HOLD_TTL_MS): HoldBlock[] {
  const cutoff = now.getTime() - ttlMs;
  const blocks: HoldBlock[] = [];
  for (const r of rows) {
    if (r.status !== 'pending') continue;
    if (new Date(r.created_at).getTime() < cutoff) continue;
    const slot = r.metadata?.slot;
    if (!slot?.start_time || !slot?.end_time) continue;
    blocks.push({
      stylist_id: slot.stylist_id ?? null,
      start_time: new Date(slot.start_time),
      end_time: new Date(slot.end_time),
    });
  }
  return blocks;
}
