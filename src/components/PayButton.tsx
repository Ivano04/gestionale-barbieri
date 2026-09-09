'use client';
import { useState } from 'react';

interface Props {
  salonId: string;
  amountCents: number;
  appointmentId?: string;
  clientId?: string;
  productName?: string;
  label?: string;
  className?: string;
}

// Bottone di pagamento riutilizzabile e agnostico rispetto al provider.
// Chiama /api/payments/create, poi raggiunge la pagina di pagamento:
//  - method 'POST' (Nexi): invia un form nascosto verso il DispatcherServlet
//  - altrimenti (Stripe): redirect GET verso l'URL restituito
export function PayButton({ salonId, amountCents, appointmentId, clientId, productName, label, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePay() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId, amountCents, appointmentId, clientId, productName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Errore avvio pagamento');
      }
      const result = await res.json();

      if (result.method === 'POST' && result.fields) {
        // Redirect via form POST verso la pagina di cassa del provider (Nexi)
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = result.url;
        for (const [name, value] of Object.entries(result.fields as Record<string, string>)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      } else {
        // Redirect GET (Stripe)
        window.location.href = result.url;
      }
    } catch (e: any) {
      setError(e?.message || 'Errore di connessione');
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handlePay}
        disabled={loading}
        className={className || 'w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50'}
      >
        {loading ? 'Reindirizzamento...' : label || `Paga €${(amountCents / 100).toFixed(2)}`}
      </button>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
