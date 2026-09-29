'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, X, AlertTriangle } from 'lucide-react';

interface Info {
  serviceName: string;
  salonName: string;
  dateText: string;
  timeText: string;
  alreadyCancelled: boolean;
  refundEligible: boolean;
  amountCents: number | null;
}

export function AnnullaClient() {
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState<{ refunded: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/appointments/cancel?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Link non valido'); }
        return r.json();
      })
      .then((d) => setInfo(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function confirmCancel() {
    setCancelling(true);
    setError('');
    try {
      const r = await fetch('/api/appointments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Errore'); }
      const d = await r.json();
      setDone({ refunded: !!d.refunded });
    } catch (e: any) {
      setError(e.message || 'Errore di connessione');
    } finally {
      setCancelling(false);
    }
  }

  const box = 'min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4';
  const card = 'bg-white rounded-2xl shadow-sm p-6 max-w-sm w-full text-center';

  if (loading) return <div className={box}><div className={card}>Caricamento…</div></div>;

  if (error) return (
    <div className={box}><div className={card}>
      <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><X className="text-red-600" /></div>
      <h2 className="text-xl font-bold mb-1">Ops</h2>
      <p className="text-gray-600 text-sm">{error}</p>
    </div></div>
  );

  if (done) return (
    <div className={box}><div className={card}>
      <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><Check className="text-green-600" /></div>
      <h2 className="text-xl font-bold mb-1">Prenotazione annullata</h2>
      <p className="text-gray-600 text-sm">{done.refunded ? 'Ti abbiamo rimborsato: vedrai l\'accredito entro qualche giorno.' : 'Nessun rimborso previsto per questo annullo.'}</p>
    </div></div>
  );

  if (info?.alreadyCancelled) return (
    <div className={box}><div className={card}>
      <h2 className="text-xl font-bold mb-1">Già annullata</h2>
      <p className="text-gray-600 text-sm">Questa prenotazione risulta già annullata.</p>
    </div></div>
  );

  const eur = info?.amountCents != null ? `€${(info.amountCents / 100).toFixed(2)}` : null;

  return (
    <div className={box}><div className={card}>
      <h2 className="text-xl font-bold mb-1">Annullare la prenotazione?</h2>
      <p className="text-gray-500 text-sm mb-4">{info?.salonName}</p>
      <div className="text-left bg-gray-50 rounded-lg p-3 text-sm mb-4">
        <div><strong>Servizio:</strong> {info?.serviceName}</div>
        <div><strong>Data:</strong> {info?.dateText}</div>
        <div><strong>Ora:</strong> {info?.timeText}</div>
      </div>
      <div className={`flex items-start gap-2 text-sm p-3 rounded-lg mb-4 ${info?.refundEligible ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          {info?.refundEligible
            ? `Annullando ora ti verrà rimborsato${eur ? ' ' + eur : ' l\'importo pagato'}.`
            : 'Sei a ridosso dell\'appuntamento: l\'annullo non prevede rimborso.'}
        </span>
      </div>
      <button onClick={confirmCancel} disabled={cancelling}
        className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50">
        {cancelling ? 'Annullamento…' : 'Conferma annullamento'}
      </button>
    </div></div>
  );
}
