'use client';
import { QuoteList } from './QuoteList';
import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Receipt } from 'lucide-react';
type Document = { id: string; status: string; original_document_id: string | null; number: string | null; amount_cents: number; created_at: string; issued_at: string | null; mode: string;
  sale: { payment_method: string; state: string; kind: string; credit_cents: number; tender_cents: number } | null; operation: string; email_status: string; processing_status: string; pdf_available: boolean; pdf_last_error: string | null;
  last_error_code: string | null; payment: { status: string; refund_jobs: { state: string; reason: string }[] } | null };
const fiscalStates: Record<string, string> = { pending: 'Da emettere', processing: 'In elaborazione', completed: 'Emesso', retry: 'Nuovo tentativo previsto', uncertain: 'Esito da verificare', failed: 'Errore' };
const emailStates: Record<string, string> = { disabled: 'Non configurata', waiting_pdf: 'In attesa del PDF', pending: 'Da inviare', running: 'Invio in corso', sent: 'Inviata a Resend', retry: 'Nuovo tentativo previsto', uncertain: 'Esito da verificare', failed: 'Errore invio' };
const paymentStates: Record<string, string> = { pending: 'In attesa', authorized: 'Autorizzato', succeeded: 'Pagato online', failed: 'Fallito', canceled: 'Annullato', refunded: 'Rimborsato', partially_refunded: 'Rimborso parziale' };
const refundStates: Record<string,string> = { pending: 'Rimborso richiesto', running: 'Rimborso in corso', accepted: 'Rimborso accettato', failed: 'Rimborso fallito', uncertain: 'Rimborso da verificare' };
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export default function CassaPage() {
  const [view, setView] = useState<'receipts' | 'quotes'>('receipts');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/cassa?page=${page}`, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Impossibile caricare i documenti. Riprova.');
    return await response.json() as { documents: Document[]; total: number };
  }, [page]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) { setDocuments(data.documents); setTotal(data.total); setError(''); }
    }).catch(() => {
      if (!controller.signal.aborted) setError('Impossibile caricare i documenti. Riprova.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  async function refresh() {
    setLoading(true);
    try { const data = await load(); setDocuments(data.documents); setTotal(data.total); setError(''); }
    catch { setError('Impossibile caricare i documenti. Riprova.'); }
    finally { setLoading(false); }
  }
  return <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><Receipt size={26} /> Cassa</h1><a href="/benefits" className="text-sm text-blue-700 underline">Credito, promozioni e vendite in salone</a>
        <p className="text-gray-500 text-sm mt-1">Incassi e documenti commerciali</p></div>
      <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm disabled:opacity-50"><RefreshCw size={16} /> Aggiorna</button>
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      I documenti contrassegnati TEST non hanno valore fiscale. Il PDF sandbox e un esempio e puo mostrare dati diversi dalla transazione.
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    <div className="flex gap-2"><button onClick={() => setView('receipts')} className={`px-4 py-2 rounded-lg ${view === 'receipts' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Ricevute</button><button onClick={() => setView('quotes')} className={`px-4 py-2 rounded-lg ${view === 'quotes' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Preventivi</button></div>
    {view === 'quotes' ? <QuoteList /> : <section className="rounded-2xl border bg-white overflow-hidden">
      <div className="px-5 py-4 border-b"><h2 className="font-semibold">Ricevute emesse e operazioni in corso</h2><p className="text-sm text-gray-500">{total} documenti</p></div>
      {loading ? <p className="p-6 text-gray-500" role="status">Caricamento...</p> : !error && documents.length === 0 ? <p className="p-6 text-gray-500">Non ci sono ancora documenti.</p> : !error && <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <thead className="bg-gray-50 text-gray-500"><tr>{['Data', 'Documento', 'Importo', 'Pagamento', 'Stato fiscale', 'PDF', 'Email'].map(title => <th key={title} className="px-5 py-3 font-medium">{title}</th>)}</tr></thead>
        <tbody>{documents.map(document => <tr key={document.id} className="border-t">
          <td className="px-5 py-4 whitespace-nowrap">{new Date(document.issued_at ?? document.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}</td>
          <td className="px-5 py-4"><span className="font-medium">{document.operation === 'cancellation' ? 'Annullo' : document.sale?.kind === 'topup' ? 'Ricarica credito' : 'Ricevuta'}</span><span className={`ml-2 rounded px-2 py-0.5 text-xs ${document.mode === 'test' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>{document.mode.toUpperCase()}</span><div className="text-xs text-gray-400 mt-1">{document.number ?? document.id.slice(0, 8)}</div>{document.original_document_id && <div className="text-xs text-gray-400">Rif. {document.original_document_id.slice(0, 8)}</div>}</td>
          <td className="px-5 py-4 whitespace-nowrap font-medium">{euro.format(document.amount_cents / 100)}</td>
          <td className="px-5 py-4">{document.sale ? document.sale.credit_cents > 0 ? `Credito ${euro.format(document.sale.credit_cents / 100)} + ${euro.format(document.sale.tender_cents / 100)} ${document.sale.payment_method === 'cash' ? 'contanti' : 'POS'}` : document.sale.payment_method === 'cash' ? 'Contanti (salone)' : 'POS esterno' : document.payment ? paymentStates[document.payment.status] ?? document.payment.status : '-'}{document.sale?.state === 'review_required' && <div className="text-xs text-red-700 mt-1">Annullamento da verificare in salone</div>}{document.payment?.refund_jobs?.[0] && <div className="text-xs text-gray-500 mt-1">{refundStates[document.payment.refund_jobs[0].state]}{document.payment.refund_jobs[0].state === 'accepted' && document.payment.refund_jobs[0].reason === 'appointment_after_start' && <div>Reso fiscale da gestire</div>}</div>}</td>
          <td className="px-5 py-4"><span className={document.processing_status === 'failed' ? 'text-red-700' : document.processing_status === 'completed' ? 'text-green-700' : 'text-amber-700'}>{document.status === 'canceled' ? 'Annullato' : fiscalStates[document.processing_status] ?? document.processing_status}</span>{document.last_error_code && <div className="text-xs text-gray-500 mt-1">Richiede verifica</div>}</td>
          <td className="px-5 py-4">{document.pdf_available ? <a href={`/api/cassa/${document.id}/pdf`} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Download size={16} /> Scarica</a> : <span className="text-gray-400">{document.processing_status === 'completed' ? document.pdf_last_error ? 'Recupero in corso' : 'In preparazione' : '-'}</span>}</td>
          <td className="px-5 py-4"><span className={document.email_status === 'failed' || document.email_status === 'uncertain' ? 'text-red-700' : 'text-gray-500'}>{emailStates[document.email_status] ?? 'In attesa'}</span></td>
        </tr>)}</tbody>
      </table></div>}
      <div className="flex justify-between items-center border-t p-4 text-sm"><button disabled={page === 0 || loading} onClick={() => { setLoading(true); setPage(page - 1); }} className="disabled:opacity-40">Precedente</button><span>Pagina {page + 1}</span><button disabled={(page + 1) * 25 >= total || loading} onClick={() => { setLoading(true); setPage(page + 1); }} className="disabled:opacity-40">Successiva</button></div>
    </section>}
  </div>;
}
