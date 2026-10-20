'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { format, addDays, addWeeks, startOfWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import { ArrowLeft, Check, Clock, Plus, X } from 'lucide-react';
import type { Service } from '@/lib/types';
import { countryCodes, formatPhone } from '@/lib/utils';
import { getRomeOffset } from '@/lib/date-utils';
import { clientServiceDuration as getClientDuration, MAX_BOOKING_SERVICES } from '@/lib/booking-services';

export default function BookPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const salon = params.salon as string;

  const [step, setStep] = useState<'service' | 'datetime' | 'details'>('service');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const selectedIds = selectedServices.map(s => s.id).join(',');
  const totalPrice = selectedServices.reduce((n,s) => n+s.price_cents, 0);
  const totalDuration = selectedServices.reduce((n,s) => n+getClientDuration(s), 0);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [slotsError, setSlotsError] = useState('');
  const [slotsRetry, setSlotsRetry] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
  const [selectedSlot, setSelectedSlot] = useState<{ time: string; stylist_id: string; stylist_name: string } | null>(null);
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('+39');
  const [slots, setSlots] = useState<{ time: string; stylist_id: string; stylist_name: string }[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [salonData, setSalonData] = useState<{ id: string; name: string; address?: string; phone?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [anyStylist, setAnyStylist] = useState(false);
  const [stylistLoad, setStylistLoad] = useState<Record<string, number>>({});
  const [selectedStylist, setSelectedStylist] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string; color_hex: string }[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  const preselectedService = searchParams.get('service');

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset request state when the salon changes
    setCatalogLoading(true);
    fetch(`/api/book/${salon}`, { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
      setSalonData(data.salon);
      setServices(data.services || []);
      setCategories(data.categories || []);
      if (preselectedService) {
        const svc = (data.services || []).find((s: Service) => s.name.toLowerCase().replace(/\s+/g, '-') === preselectedService);
        if (svc && getClientDuration(svc) > 0 && svc.price_cents > 0) setSelectedServices([svc]);
      }
    }).catch(() => { if (!controller.signal.aborted) setError('Impossibile caricare i servizi. Ricarica la pagina.'); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [salon, preselectedService]);

  useEffect(() => {
    if (!selectedIds || !salonData?.id || step !== 'datetime') return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate times while a new availability request is pending
    setSlots([]);
    setSlotsLoading(true);
    setSlotsError('');
    setSelectedSlot(null);
    setSelectedStylist(null);
    const query = new URLSearchParams({ salon_id: salonData.id, service_ids: selectedIds, date: format(selectedDate, 'yyyy-MM-dd') });
    fetch(`/api/slots?${query}`, { signal: controller.signal }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Impossibile caricare gli orari');
      return data;
    }).then(data => {
      if (controller.signal.aborted) return;
      setSlots(data.slots || []);
      setStylistLoad(data.stylistLoad || {});
    }).catch(e => { if (!controller.signal.aborted) setSlotsError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    return () => controller.abort();
  }, [selectedIds, selectedDate, step, salonData?.id, slotsRetry]);

  function toggleService(service: Service) {
    setError('');
    setSelectedSlot(null);
    setSlots([]);
    setSelectedServices(current => current.some(s => s.id === service.id)
      ? current.filter(s => s.id !== service.id)
      : current.length < MAX_BOOKING_SERVICES ? [...current, service] : current);
  }
  function serviceButton(service: Service) {
    const selected = selectedServices.some(s => s.id === service.id);
    const available = getClientDuration(service) > 0 && service.price_cents > 0;
    return <button key={service.id} type="button" aria-pressed={selected}
      disabled={!available || (!selected && selectedServices.length >= MAX_BOOKING_SERVICES)} onClick={() => toggleService(service)}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors disabled:opacity-45 ${selected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 bg-white hover:border-blue-300'}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{selected ? <Check size={15} /> : <Plus size={15} />}</span>
      <span className="min-w-0 flex-1"><span className="block font-medium text-sm">{service.name}</span>
        <span className="block text-xs text-gray-500 mt-1">{available ? `${getClientDuration(service)} min` : 'Non prenotabile online'}</span></span>
      <span className="font-semibold text-sm shrink-0">€{(service.price_cents/100).toFixed(2)}</span>
    </button>;
  }
  const selectionSummary = <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 mb-4">
    <div className="font-semibold text-sm mb-2">{selectedServices.length === 1 ? 'Il tuo servizio' : `I tuoi ${selectedServices.length} servizi`}</div>
    <ul className="space-y-2 max-h-40 overflow-y-auto">{selectedServices.map(s => <li key={s.id} className="flex items-center gap-2 text-sm">
      <span className="flex-1">{s.name}<span className="text-xs text-gray-500 ml-2">{getClientDuration(s)} min</span></span>
      <span>€{(s.price_cents/100).toFixed(2)}</span>
      {step === 'service' && <button type="button" onClick={() => toggleService(s)} aria-label={`Rimuovi ${s.name}`} className="p-1 text-gray-500 hover:text-red-600"><X size={16}/></button>}
    </li>)}</ul>
    <div className="mt-3 border-t border-blue-200 pt-3 flex justify-between font-semibold text-sm"><span className="flex items-center gap-1"><Clock size={14}/> {totalDuration} min totali</span><span>€{(totalPrice/100).toFixed(2)}</span></div>
  </div>;

  // Paga per confermare: NON crea subito l'appuntamento. Avvia il pagamento
  // (che riserva lo slot) e reindirizza alla pagina di cassa. L'appuntamento
  // viene creato solo a pagamento riuscito (webhook).
  async function handlePayAndBook() {
    if (!salonData || !selectedSlot || !selectedServices.length || loading) return;
    if (!name || !surname || !phone || !email) {
      setError('Compila tutti i campi obbligatori (Nome, Cognome, Telefono, Email)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const booking = {
        salon_id: salonData.id,
        service_id: selectedServices[0].id,
        service_ids: selectedServices.map(s => s.id),
        stylist_id: selectedSlot!.stylist_id,
        start_time: `${format(selectedDate, 'yyyy-MM-dd')}T${selectedSlot.time}:00${getRomeOffset(format(selectedDate, 'yyyy-MM-dd'))}`,
        source: 'widget',
        client: { first_name: name, last_name: surname, phone: formatPhone(phonePrefix + phone), email: email || null },
        notes: note,
      };
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking, expectedAmountCents: totalPrice, expectedDurationMinutes: totalDuration }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Errore avvio pagamento');
        if (err.code === 'SLOT_UNAVAILABLE') { setSelectedSlot(null); setStep('datetime'); }
        setLoading(false);
        return;
      }
      const result = await res.json();
      if (result.method === 'POST' && result.fields) {
        // Reindirizza via form POST verso la pagina di cassa (Nexi)
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = result.url;
        for (const [k, v] of Object.entries(result.fields as Record<string, string>)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = k;
          input.value = v;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      } else {
        window.location.href = result.url;
      }
    } catch {
      setError('Errore di connessione');
      setLoading(false);
    }
  }


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">{salonData?.name || 'Prenota'}</h1>
          {salonData?.address && <p className="text-sm text-gray-500">{salonData.address}</p>}
          {salonData?.phone && <p className="text-sm text-gray-500">{salonData.phone}</p>}
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map(i => (
            <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              (i === 1 && step === 'service') || (i === 2 && step === 'datetime') || (i === 3 && step === 'details')
                ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{i}</div>
          ))}
        </div>

        {error && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        {step === 'service' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="font-semibold">Scegli i tuoi servizi</h2>
              <p className="text-sm text-gray-500 mt-1 mb-4">Puoi aggiungere più servizi alla stessa prenotazione. Li eseguirà lo stesso collaboratore.</p>
              {catalogLoading && <p className="text-sm text-gray-500 py-4">Caricamento servizi...</p>}
              {!catalogLoading && !services.length && <p className="text-gray-500 py-4">Nessun servizio disponibile</p>}
              {services.some(s => ['Taglio Uomo', 'Taglio donna', 'Piega', 'Piega Capelli Lunghi', 'Permanente'].includes(s.name)) && <>
                <h3 className="font-medium text-sm mb-2">Più richiesti</h3>
                <div className="space-y-2 mb-5">{services.filter(s => ['Taglio Uomo', 'Taglio donna', 'Piega', 'Piega Capelli Lunghi', 'Permanente'].includes(s.name)).map(serviceButton)}</div>
              </>}
              {categories.map(cat => {
                const list = services.filter(s => s.category_id === cat.id);
                if (!list.length) return null;
                return <div key={cat.id} className="mb-2">
                  <button type="button" aria-expanded={expandedCat === cat.id} onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)} className="w-full flex justify-between items-center py-3 text-left font-medium text-sm">
                    <span>{cat.name} <span className="text-gray-400">({list.length})</span></span><span>{expandedCat === cat.id ? '−' : '+'}</span>
                  </button>
                  {expandedCat === cat.id && <div className="space-y-2">{list.map(serviceButton)}</div>}
                </div>;
              })}
              <div className="space-y-2">{services.filter(s => (!s.category_id || !categories.some(c => c.id === s.category_id)) && !['Taglio Uomo', 'Taglio donna', 'Piega', 'Piega Capelli Lunghi', 'Permanente'].includes(s.name)).map(serviceButton)}</div>
            </div>
            <div className="sticky bottom-3 rounded-xl bg-white p-3 shadow-lg border border-gray-100">
              {selectedServices.length > 0 ? selectionSummary : <p className="text-sm text-gray-500 p-2 mb-2">Seleziona almeno un servizio per continuare.</p>}
              {selectedServices.length >= MAX_BOOKING_SERVICES && <p className="text-xs text-gray-500 mb-2">Massimo {MAX_BOOKING_SERVICES} servizi per prenotazione.</p>}
              <button type="button" disabled={!selectedServices.length} onClick={() => { setError(''); setStep('datetime'); }} className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Scegli data e orario</button>
            </div>
          </div>
        )}

        {step === 'datetime' && selectedServices.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('service')} className="flex items-center gap-1 text-sm text-gray-500 mb-3 hover:text-gray-700">
              <ArrowLeft size={14} /> Modifica i servizi
            </button>
            {selectionSummary}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setWeekOffset(w => w - 1)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
                  <ArrowLeft size={16} />
                </button>
                <span className="text-sm font-medium text-gray-700 capitalize">
                  {format(weekStart, 'MMMM yyyy', { locale: it })}
                </span>
                <button onClick={() => setWeekOffset(w => w + 1)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
                  <ArrowLeft size={16} className="rotate-180" />
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-2">
                {Array.from({ length: 14 }, (_, i) => addDays(weekStart, i)).map(d => {
                  const isPast = format(d, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd');
                  return (
                    <button key={d.toISOString()} onClick={() => { if (!isPast) setSelectedDate(d); }}
                      disabled={isPast}
                      className={`flex-shrink-0 w-14 py-2 rounded-lg text-center text-sm ${
                        format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd') ? 'bg-blue-600 text-white' : isPast ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      <div className="text-xs">{format(d, 'EEE', { locale: it })}</div>
                      <div className="font-semibold">{format(d, 'd')}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Toggle: Qualsiasi collaboratore */}
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Orari disponibili</h3>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
                <span>Qualsiasi collaboratore</span>
                <button type="button" onClick={() => { setAnyStylist(!anyStylist); setSelectedStylist(null); }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${anyStylist ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                    style={{ transform: anyStylist ? 'translateX(16px)' : 'translateX(0)' }} />
                </button>
              </label>
            </div>

            {/* Stylist filter (solo se NON "qualsiasi") */}
            {!anyStylist && slots.length > 0 && (() => {
              const stylistNames = [...new Set(slots.map(s => s.stylist_name))];
              return (
                <div className="mb-3">
                  <div className="flex gap-2 flex-wrap">
                    {stylistNames.map(st => (
                      <button key={st} onClick={() => setSelectedStylist(selectedStylist === st ? null : st)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          selectedStylist === st ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>{st}</button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {!slotsLoading && !slotsError && slots.length === 0 && (
              <div className="text-center py-4">
                <p className="text-gray-400 text-sm">Nessun orario disponibile per tutti i servizi selezionati</p>
              </div>
            )}
            {slotsLoading && <p role="status" className="text-sm text-gray-500 py-4">Cerchiamo un orario per tutti i servizi...</p>}
            {slotsError && <div role="alert" className="text-sm text-red-600 py-4">{slotsError} <button onClick={() => setSlotsRetry(n => n+1)} className="underline">Riprova</button></div>}
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {(() => {
                if (anyStylist) {
                  // Raggruppa per orario, niente duplicati. Assegna al meno carico.
                  const byTime = new Map<string, typeof slots>();
                  for (const s of slots) {
                    if (!byTime.has(s.time)) byTime.set(s.time, []);
                    byTime.get(s.time)!.push(s);
                  }
                  const merged = [...byTime.entries()].map(([, stylists]) => {
                    stylists.sort((a, b) => {
                      const la = stylistLoad[a.stylist_id] || 0;
                      const lb = stylistLoad[b.stylist_id] || 0;
                      if (la !== lb) return la - lb;
                      return a.stylist_name.localeCompare(b.stylist_name);
                    });
                    return stylists[0];
                  }).sort((a, b) => a.time.localeCompare(b.time));
                  return merged.map((s, i) => (
                    <button key={`${s.time}-${i}`} onClick={() => { setSelectedSlot(s); setStep('details'); }}
                      className="p-3 border border-green-300 bg-green-50 rounded-lg text-center hover:bg-green-100 text-sm">
                      <div className="font-medium">{s.time}</div>
                    </button>
                  ));
                }
                // Modalità normale: mostra tutti gli slot
                return slots.filter(s => !selectedStylist || s.stylist_name === selectedStylist).map((s, i) => (
                  <button key={`${s.time}-${s.stylist_id}-${i}`} onClick={() => { setSelectedSlot(s); setStep('details'); }}
                    className="p-3 border border-green-300 bg-green-50 rounded-lg text-center hover:bg-green-100 text-sm">
                    <div className="font-medium">{s.time}</div>
                    <div className="text-xs text-gray-500">{s.stylist_name}</div>
                  </button>
                ));
              })()}
            </div>
          </div>
        )}

        {step === 'details' && selectedSlot && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('datetime')} className="flex items-center gap-1 text-sm text-gray-500 mb-3">
              <ArrowLeft size={14} /> {format(selectedDate, 'EEEE d MMMM', { locale: it })} alle {selectedSlot.time}{!anyStylist ? ` · ${selectedSlot.stylist_name}` : ''}
            </button>
            {selectionSummary}
            <h3 className="font-semibold mb-3">I tuoi dati</h3>
            <div className="space-y-3">
              <input type="text" aria-label="Nome" autoComplete="given-name" maxLength={80} placeholder="Nome *" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <input type="text" aria-label="Cognome" autoComplete="family-name" maxLength={80} placeholder="Cognome *" value={surname} onChange={e => setSurname(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <div className="flex gap-2">
                <select value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)}
                  className="px-2 py-3 border rounded-lg text-sm bg-gray-50 w-24">
                  {countryCodes.slice(0, 8).map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input type="tel" aria-label="Telefono" maxLength={25} placeholder="Telefono *" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/[^\d\s\-\(\)]/g, ''))}
                  className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <input type="email" aria-label="Email" autoComplete="email" maxLength={254} placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <textarea maxLength={1000} placeholder="Note (opzionale)" value={note} onChange={e => setNote(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2} />
              <button onClick={handlePayAndBook} disabled={!name || !surname || !phone || !email || loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Reindirizzamento al pagamento...' : `Paga e conferma €${(totalPrice / 100).toFixed(2)}`}
              </button>
              <p className="text-xs text-center text-gray-400">Il pagamento online conferma la prenotazione</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
