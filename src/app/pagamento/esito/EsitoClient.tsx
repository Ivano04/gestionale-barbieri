'use client';
import { useSearchParams } from 'next/navigation';
import { Check, X } from 'lucide-react';

// Pagina su cui Nexi rimanda il cliente al termine del pagamento.
// NB: la fonte di verita' dell'esito e' la notifica server-to-server (webhook),
// non questa pagina, che serve solo per il messaggio all'utente.
export function EsitoClient() {
  const params = useSearchParams();
  const esito = (params.get('esito') || '').toUpperCase();
  const ok = esito === 'OK';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="text-center max-w-sm">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${ok ? 'bg-green-100' : 'bg-red-100'}`}>
          {ok ? <Check size={32} className="text-green-600" /> : <X size={32} className="text-red-600" />}
        </div>
        <h2 className="text-2xl font-bold mb-2">{ok ? 'Pagamento riuscito!' : 'Pagamento non riuscito'}</h2>
        <p className="text-gray-600">
          {ok
            ? 'Grazie, abbiamo ricevuto il tuo pagamento. Riceverai la conferma della prenotazione.'
            : 'Il pagamento non è andato a buon fine. Puoi riprovare o contattare il salone.'}
        </p>
      </div>
    </div>
  );
}
