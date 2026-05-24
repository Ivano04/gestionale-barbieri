'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { format, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { ArrowLeft, Check, Clock } from 'lucide-react';
import type { Service } from '@/lib/types';
import { countryCodes, formatPhone } from '@/lib/utils';

/** Compute client-visible duration (excludes buffer, respects phases) */
function getClientDuration(s: Service): number {
  const hasPhases = s.duration_application != null || s.duration_processing != null || s.duration_finishing != null;
  if (hasPhases) {
    return (s.duration_application ?? 0) + (s.duration_processing ?? 0) + (s.duration_finishing ?? 0);
  }
  return s.duration_minutes;
}

export default function BookPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const salon = params.salon as string;

  const [step, setStep] = useState<'service' | 'datetime' | 'details' | 'waitlist'>('service');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<{ time: string; stylist_id: string; stylist_name: string } | null>(null);
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [phonePrefix, setPhonePrefix] = useState('+39');
  const [slots, setSlots] = useState<{ time: string; stylist_id: string; stylist_name: string }[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [salonData, setSalonData] = useState<{ id: string; name: string; address?: string; phone?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [selectedStylist, setSelectedStylist] = useState<string | null>(null);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistSaving, setWaitlistSaving] = useState(false);

  const preselectedService = searchParams.get('service');

  useEffect(() => {
    fetch(`/api/book/${salon}`).then(r => r.json()).then(data => {
      setSalonData(data.salon);
      setServices(data.services || []);
      if (preselectedService) {
        const svc = (data.services || []).find((s: Service) =>
          s.name.toLowerCase().replace(/\s+/g, '-') === preselectedService);
        if (svc) { setSelectedService(svc); setStep('datetime'); }
      }
    });
  }, [salon]);

  useEffect(() => {
    if (selectedService && salonData?.id && step === 'datetime') {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      fetch(`/api/slots?salon_id=${salonData.id}&service_id=${selectedService.id}&date=${dateStr}`)
        .then(r => r.json()).then(setSlots);
    }
  }, [selectedService, selectedDate, step, salonData?.id]);

  async function handleBook() {
    if (!salonData) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon_id: salonData.id,
          service_id: selectedService!.id,
          stylist_id: selectedSlot!.stylist_id,
          start_time: `${format(selectedDate, 'yyyy-MM-dd')}T${selectedSlot!.time}:00+02:00`,
          source: 'widget',
          client: { first_name: name, last_name: surname, phone: formatPhone(phonePrefix + phone) },
          notes: note,
        }),
      });
      if (res.ok) { setDone(true); }
      else { const err = await res.json(); setError(err.error || 'Errore nella prenotazione'); }
    } catch { setError('Errore di connessione'); }
    setLoading(false);
  }

  async function handleJoinWaitlist() {
    if (!salonData || !selectedService) return;
    setWaitlistSaving(true);
    setError('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon_id: salonData.id,
          service_id: selectedService.id,
          stylist_id: selectedStylist || null,
          preferred_date: format(selectedDate, 'yyyy-MM-dd'),
          first_name: name,
          last_name: surname,
          phone: formatPhone(phonePrefix + phone),
        }),
      });
      if (res.ok) { setWaitlistDone(true); }
      else { const err = await res.json(); setError(err.error || 'Errore'); }
    } catch { setError('Errore di connessione'); }
    setWaitlistSaving(false);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Prenotazione Confermata!</h2>
          <p className="text-gray-600 mb-4">{selectedService?.name} &mdash; {format(selectedDate, 'EEEE d MMMM', { locale: it })} alle {selectedSlot?.time}</p>
          <p className="text-sm text-gray-500">Riceverai una conferma via SMS</p>
        </div>
      </div>
    );
  }

  if (waitlistDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock size={32} className="text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Lista d'attesa!</h2>
          <p className="text-gray-600 mb-4">{selectedService?.name} &mdash; {format(selectedDate, 'EEEE d MMMM', { locale: it })}</p>
          <p className="text-sm text-gray-500">Ti avviseremo via SMS quando si libera uno slot</p>
        </div>
      </div>
    );
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

        {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        {step === 'service' && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-3">Scegli il servizio</h3>
            {services.length === 0 && <p className="text-gray-400 text-center py-4">Nessun servizio disponibile</p>}
            <div className="space-y-2">
              {services.map(s => {
                const clientDuration = getClientDuration(s);
                return (
                  <button key={s.id} onClick={() => { setSelectedService(s); setStep('datetime'); }}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color_hex }} />
                      <div>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-sm text-gray-500 flex items-center gap-1"><Clock size={12} />{clientDuration} min</div>
                      </div>
                    </div>
                    <div className="font-semibold">&euro;{(s.price_cents / 100).toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'datetime' && selectedService && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('service')} className="flex items-center gap-1 text-sm text-gray-500 mb-3 hover:text-gray-700">
              <ArrowLeft size={14} /> {selectedService.name} &middot; {getClientDuration(selectedService)}min &middot; &euro;{(selectedService.price_cents / 100).toFixed(2)}
            </button>
            <div className="flex gap-2 overflow-x-auto mb-4 pb-2">
              {Array.from({ length: 14 }, (_, i) => addDays(new Date(), i)).map(d => (
                <button key={d.toISOString()} onClick={() => setSelectedDate(d)}
                  className={`flex-shrink-0 w-14 py-2 rounded-lg text-center text-sm ${
                    format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd') ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <div className="text-xs">{format(d, 'EEE', { locale: it })}</div>
                  <div className="font-semibold">{format(d, 'd')}</div>
                </button>
              ))}
            </div>
            {/* Stylist filter */}
            {slots.length > 0 && (() => {
              const stylistNames = [...new Set(slots.map(s => s.stylist_name))];
              return (
                <div className="mb-3">
                  <div className="font-semibold mb-2 text-sm">Operatore</div>
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
            <h3 className="font-semibold mb-2 text-sm">Orari disponibili</h3>
            {slots.length === 0 && (
              <div className="text-center py-4 space-y-3">
                <p className="text-gray-400 text-sm">Nessuno slot disponibile</p>
                <button onClick={() => setStep('waitlist')}
                  className="px-6 py-2.5 bg-amber-500 text-white rounded-xl font-medium text-sm hover:bg-amber-600 transition-colors">
                  Entra in lista d'attesa
                </button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {slots.filter(s => !selectedStylist || s.stylist_name === selectedStylist).map((s, i) => (
                <button key={`${s.time}-${s.stylist_id}-${i}`} onClick={() => { setSelectedSlot(s); setStep('details'); }}
                  className="p-3 border border-green-300 bg-green-50 rounded-lg text-center hover:bg-green-100 text-sm">
                  <div className="font-medium">{s.time}</div>
                  <div className="text-xs text-gray-500">{s.stylist_name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'details' && selectedSlot && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('datetime')} className="flex items-center gap-1 text-sm text-gray-500 mb-3">
              <ArrowLeft size={14} /> {format(selectedDate, 'EEEE d MMMM', { locale: it })} alle {selectedSlot.time} &middot; {selectedSlot.stylist_name}
            </button>
            <h3 className="font-semibold mb-3">I tuoi dati</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Nome *" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <input type="text" placeholder="Cognome *" value={surname} onChange={e => setSurname(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <div className="flex gap-2">
                <select value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)}
                  className="px-2 py-3 border rounded-lg text-sm bg-gray-50 w-24">
                  {countryCodes.slice(0, 8).map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input type="tel" placeholder="Telefono *" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/[^\d\s\-\(\)]/g, ''))}
                  className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <textarea placeholder="Note (opzionale)" value={note} onChange={e => setNote(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2} />
              <button onClick={handleBook} disabled={!name || !surname || !phone || loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Prenotazione...' : 'Conferma Prenotazione'}
              </button>
              <p className="text-xs text-center text-gray-400">Riceverai conferma via SMS</p>
            </div>
          </div>
        )}

        {step === 'waitlist' && selectedService && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('datetime')} className="flex items-center gap-1 text-sm text-gray-500 mb-3">
              <ArrowLeft size={14} /> {selectedService.name} &middot; {format(selectedDate, 'EEEE d MMMM', { locale: it })}
            </button>
            <div className="bg-amber-50 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <p className="font-medium mb-1">Lista d'attesa</p>
              <p>Ti avviseremo via SMS appena si libera uno slot per questo servizio.</p>
            </div>
            <h3 className="font-semibold mb-3">I tuoi dati</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Nome *" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg text-sm" />
              <input type="text" placeholder="Cognome *" value={surname} onChange={e => setSurname(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg text-sm" />
              <div className="flex gap-2">
                <select value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)}
                  className="px-2 py-3 border rounded-lg text-sm bg-gray-50 w-24">
                  {countryCodes.slice(0, 8).map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input type="tel" placeholder="Telefono *" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/[^\d\s\-\(\)]/g, ''))}
                  className="flex-1 px-4 py-3 border rounded-lg text-sm" />
              </div>
              <button onClick={handleJoinWaitlist} disabled={!name || !phone || waitlistSaving}
                className="w-full bg-amber-500 text-white py-3 rounded-lg font-semibold hover:bg-amber-600 disabled:opacity-50">
                {waitlistSaving ? 'Salvataggio...' : 'Entra in lista d\'attesa'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
