'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
interface Info { serviceName: string; salonName: string; stylistName: string; startTime: string; canModify: boolean; slots: { time: string }[] }
const format = (iso: string) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
const today = (days = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
export function ModificaClient() {
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [refresh, setRefresh] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/appointments/reschedule?token=${encodeURIComponent(token)}&date=${date}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data as Info; })
      .then(data => { setInfo(data); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Servizio non disponibile'); setLoading(false); } });
    return () => controller.abort();
  }, [token, date, refresh]);
  async function confirm() {
    if (!info || !time || saving) return;
    setSaving(true); setError('');
    const key = `${date}/${time}/${info.startTime}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const r = await fetch('/api/appointments/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, date, time, expectedStart: info.startTime, requestId: request.current.id }) });
      const result = await r.json();
      if (!r.ok) {
        if (r.status === 409) { setTime(''); request.current = null; setLoading(true); setRefresh(value => value + 1); }
        throw new Error(result.error ?? 'Spostamento non confermato');
      }
      setDone(result.startTime);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connessione interrotta. Riprova con la stessa selezione.'); }
    finally { setSaving(false); }
  }
  return <main className="min-h-screen bg-blue-50 flex justify-center items-start p-5 pt-12"><section className="bg-white rounded-2xl shadow-sm p-6 w-full max-w-lg">
    <h1 className="text-2xl font-bold mb-2">{done ? 'Appuntamento spostato' : 'Modifica data e ora'}</h1>
    {error && <p role="alert" className="bg-red-50 text-red-700 rounded-lg p-3 my-3">{error}</p>}
    {done ? <><p className="mt-4 font-medium">{format(done)}</p><p className="mt-3 text-gray-600">Il pagamento rimane associato alla prenotazione. Riceverai una mail con il nuovo orario.</p></> : loading ? <p role="status">Caricamento degli orari...</p> : info && <>
      <p className="text-gray-600">{info.salonName}</p>
      <div className="bg-gray-50 rounded-lg p-3 my-4"><p>{info.serviceName} con {info.stylistName}</p><p className="font-medium">{format(info.startTime)}</p></div>
      {!info.canModify ? <p>Questa prenotazione non puo essere modificata online. Contatta il salone.</p> : <>
        <p className="text-sm text-gray-600 mb-4">Scegli un nuovo slot per lo stesso servizio e operatore. Il pagamento resta valido. Lo spostamento non prolunga il termine per ottenere un rimborso in caso di disdetta.</p>
        <label className="block font-medium">Nuova data<input type="date" min={today()} max={today(365)} value={date} disabled={saving} onChange={e => { if (!e.target.value) return; setDate(e.target.value); setTime(''); setLoading(true); setError(''); request.current = null; }} className="block border rounded-lg p-2 mt-2 w-full" /></label>
        <fieldset className="my-4"><legend className="font-medium mb-2">Orari disponibili</legend><div className="grid grid-cols-4 gap-2">{info.slots.map(slot => <button type="button" aria-pressed={time === slot.time} disabled={saving} key={slot.time} onClick={() => { setTime(slot.time); request.current = null; }} className={`border rounded-lg p-2 ${time === slot.time ? 'bg-blue-600 text-white' : 'bg-white'}`}>{slot.time}</button>)}</div>{!info.slots.length && <p className="text-gray-500">Nessuno slot disponibile. Scegli un altro giorno.</p>}</fieldset>
        <button onClick={confirm} disabled={!time || saving} className="w-full bg-blue-600 text-white rounded-lg p-3 font-semibold disabled:opacity-50">{saving ? 'Conferma in corso...' : 'Conferma nuovo orario'}</button>
      </>}
    </>}
  </section></main>;
}
