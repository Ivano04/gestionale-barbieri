export type N8nEvent =
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.cancelled'
  | 'time_block.created'
  | 'time_block.deleted';

interface N8nPayload {
  event: N8nEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Fire-and-forget webhook to n8n. Never throws — failures are silent
 * because n8n unavailability must not block salon operations.
 */
export function sendN8nEvent(event: N8nEvent, data: Record<string, unknown>): void {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) return;

  const payload: N8nPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    console.warn('[n8n] webhook send failed (salon operations unaffected):', err);
  });
}
