"use client";
import { useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { dailyStateLabel, type DailyHistoryRow } from '@/services/notifications/daily/types';
interface History { notifications: DailyHistoryRow[]; hasMore: boolean }
const dateTime = (value: string) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
export function DailyNotificationHistory({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ clientId: string; value: History } | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/clients/${clientId}/notifications`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Storico temporaneamente non disponibile'); return response.json() as Promise<History>; })
      .then(value => { if (!controller.signal.aborted) { setResult({ clientId, value }); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    const timer = setTimeout(() => setRevision(n => n + 1), 30000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [clientId, open, revision]);
  const data = result?.clientId === clientId ? result.value : null;
  return <section className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-slate-800"><Mail size={16} /> Promemoria e recensioni <span className="ml-auto text-xs">{open ? 'Chiudi' : 'Mostra'}</span></button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-600">Una email per tipo e giornata della visita. Gli invii si aggiornano automaticamente; la presenza regolare non richiede conferme dello staff.</p>
      <button type="button" className="flex items-center gap-1 text-xs text-blue-700" onClick={() => setRevision(n => n + 1)}><RefreshCw size={12} /> Aggiorna</button>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Caricamento…</p>}
      {data?.notifications.length === 0 && <p className="text-xs text-slate-500">Nessuna comunicazione giornaliera registrata. Le nuove prenotazioni vengono elaborate entro circa un minuto.</p>}
      {data?.notifications.map(row => <article key={row.id} className="rounded-md border border-slate-100 bg-white p-2 text-xs">
        <p className="font-semibold">{new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(row.visit_date + 'T12:00:00Z'))} · {row.type === 'review' ? 'Richiesta di recensione' : 'Promemoria riepilogativo'}</p>
        <p className={`mt-1 ${['uncertain', 'blocked', 'unavailable'].includes(row.state) ? 'text-amber-800' : 'text-slate-600'}`}>{dailyStateLabel(row)}</p>
        {row.sent_at ? <p className="mt-1 text-slate-500">Inviato il {dateTime(row.sent_at)}</p> : row.state === 'pending' && row.due_at ? <p className="mt-1 text-slate-500">Previsto dal {dateTime(row.due_at)}</p> : null}
        {row.last_error_code === 'LEGACY_DELIVERY' && <p className="mt-1 text-slate-500">Invio precedente all’introduzione del riepilogo.</p>}
      </article>)}
      {data?.hasMore && <p className="text-xs text-slate-500">Mostrate le ultime 100 comunicazioni.</p>}
    </div>}
  </section>;
}
