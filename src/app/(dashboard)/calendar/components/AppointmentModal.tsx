'use client';
import { NoShowControl } from '@/components/attendance/NoShowControl';
import { clientServiceDuration } from '@/lib/booking-services';
import { FinancialStatus } from './FinancialStatus';
import type { CalendarFinance } from '@/lib/calendar-finance';
import { FinanceMenu } from './FinanceMenu';
import { FinanceDialog } from './FinanceDialog';
import { useState, useEffect } from 'react';
import { X, Trash2, Loader2, ChevronDown, Plus, Clock, Scissors, Search } from 'lucide-react';
import type { Appointment, Service, ServiceCategory, Client, User, AddedService } from '@/lib/types';
import { format, parseISO, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { formatPhone, countryCodes } from '@/lib/utils';
import { todayDateStr, buildSlotTime } from '@/lib/date-utils';
import { toast } from 'sonner';

interface Props {
  appointment: Appointment | null;
  finance?: CalendarFinance;
  onFinanceChange?: () => void;
  onAttendanceChange?: () => void;
  services: Service[];
  categories: ServiceCategory[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name'>[];
  salonId: string;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onAddService?: (appointmentId: string, serviceId: string) => Promise<any>;
}

export function AppointmentModal({ appointment, finance, onFinanceChange, onAttendanceChange, services, categories, clients, stylists, salonId, onClose, onSave, onDelete, onAddService }: Props) {
  const [financeMode, setFinanceMode] = useState<'checkout' | 'quote' | null>(null);
  const [form, setForm] = useState<Partial<Appointment>>({});
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [newClient, setNewClient] = useState({ first_name: '', last_name: '', phone: '' });
  const [clientPrefix, setClientPrefix] = useState('+39');
  const [slots, setSlots] = useState<{ time: string; stylist_id: string; stylist_name: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(!appointment?.id);
  const [slotsError, setSlotsError] = useState('');
  const [slotDate, setSlotDate] = useState(todayDateStr());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addingService, setAddingService] = useState(false);
  const [newServiceId, setNewServiceId] = useState('');
  const [filteredStylists, setFilteredStylists] = useState<Pick<User, 'id' | 'full_name'>[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [showServiceList, setShowServiceList] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientList, setShowClientList] = useState(false);
  const isNew = !appointment?.id;
  const selectedServiceIds = [...new Set([form.service_id, ...(appointment?.added_services ?? []).map(s => s.service_id)].filter(Boolean))].join(',');

  // Servizi filtrati per ricerca
  const filteredServices = serviceSearch
    ? services.filter(s => s.name.toLowerCase().includes(serviceSearch.toLowerCase()))
    : services;
  // Raggruppa per categoria
  const servicesByCat = new Map<string | null, Service[]>();
  for (const s of filteredServices) {
    const key = s.category_id || null;
    if (!servicesByCat.has(key)) servicesByCat.set(key, []);
    servicesByCat.get(key)!.push(s);
  }

  useEffect(() => {
    setForm(appointment || {});
    setFilteredStylists(stylists);
    setServiceSearch('');
    setClientSearch('');
    setShowServiceList(false);
    setShowClientList(false);
    setTimePickerOpen(!appointment?.id);
    setSlotsError('');
    if (appointment?.client_id) setClientMode('existing');
    if (appointment?.start_time) setSlotDate(format(parseISO(appointment.start_time), 'yyyy-MM-dd'));
  }, [appointment]);

  useEffect(() => {
    if (!timePickerOpen || !salonId || !form.service_id || !form.stylist_id || !slotDate) return;
    const controller = new AbortController();
    setSlotsLoading(true);
    setSlotsError('');
    fetch(`/api/slots?salon_id=${salonId}&service_id=${form.service_id}&stylist_id=${form.stylist_id}&date=${slotDate}${appointment?.id ? `&appointment_id=${appointment.id}` : ''}`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!controller.signal.aborted) setSlots(Array.isArray(d) ? d : []); })
      .catch(() => { if (!controller.signal.aborted) { setSlots([]); setSlotsError('Impossibile caricare gli orari. Chiudi e riapri per riprovare.'); } })
      .finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    return () => controller.abort();
  }, [timePickerOpen, salonId, form.service_id, form.stylist_id, slotDate, appointment?.id]);

  // Load filtered stylists when service changes
  useEffect(() => {
    if (!salonId || !form.service_id) {
      setFilteredStylists(stylists);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/stylist-services?salon_id=${salonId}&service_ids=${selectedServiceIds}`, { signal: controller.signal })
      .then(r => r.json())
      .then(ids => {
        if (!Array.isArray(ids)) {
          setFilteredStylists(stylists);
        } else {
          setFilteredStylists(stylists.filter(s => ids.includes(s.id)));
        }
      })
      .catch(() => setFilteredStylists(stylists));
    return () => controller.abort();
  }, [salonId, form.service_id, selectedServiceIds, stylists]);

  // Reset stylist if no longer valid for selected service
  useEffect(() => {
    if (form.stylist_id && filteredStylists.length > 0 &&
        !filteredStylists.find(s => s.id === form.stylist_id)) {
      setForm(f => ({ ...f, stylist_id: '', start_time: '' }));
    }
  }, [filteredStylists, form.stylist_id]);

  if (!appointment) return null;

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  async function handleSave() {
    const errs: Record<string, string> = {};
    if (!form.service_id) errs.service = 'Seleziona un servizio';
    if (!form.stylist_id) errs.stylist = 'Seleziona un operatore';
    if (!form.start_time) errs.time = 'Seleziona un orario';
    if (clientMode === 'new') {
      if (!newClient.first_name) errs.clientFirst = 'Nome richiesto';
      if (!newClient.last_name) errs.clientLast = 'Cognome richiesto';
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); if (errs.time) setTimePickerOpen(true); return; }

    setSaving(true);
    try {
      const data = clientMode === 'new'
        ? { ...form, client_id: undefined, client: { ...newClient, phone: formatPhone(clientPrefix + newClient.phone.replace(/\s/g, '')) } }
        : form;
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddService() {
    if (!newServiceId || !appointment?.id || !onAddService) return;
    setAddingService(true);
    try {
      const updated = await onAddService(appointment.id, newServiceId);
      setForm(updated);
      setNewServiceId('');
      toast.success('Servizio aggiunto in poltrona');
    } catch {
      toast.error('Errore aggiunta servizio');
    }
    setAddingService(false);
  }

  const addedServices: AddedService[] = Array.isArray(appointment.added_services) ? appointment.added_services : [];
  const isInProgress = appointment.status === 'confirmed' &&
    appointment.start_time && new Date(appointment.start_time) < new Date() &&
    appointment.end_time && new Date(appointment.end_time) > new Date();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? 'Nuovo Appuntamento' : 'Modifica Appuntamento'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>

        <div className="space-y-4 max-h-[80vh] overflow-y-auto">

          {!isNew && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><FinancialStatus finance={finance ?? appointment.finance} expanded /></div>}
          {!isNew && <NoShowControl appointmentId={appointment.id} status={appointment.status} onChanged={onAttendanceChange ?? onClose}
            disabled={saving || ['client_id','service_id','stylist_id','start_time','end_time','status','source','notes'].some(key => (form[key as keyof Appointment] ?? '') !== (appointment[key as keyof Appointment] ?? ''))} />}
          {/* 1. Cliente */}
          <div>
            <label className="text-sm font-medium text-gray-700">Cliente</label>
            <div className="flex bg-gray-100 rounded-lg p-0.5 mt-1.5 mb-2">
              <button onClick={() => setClientMode('existing')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'existing' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Cliente esistente
              </button>
              <button onClick={() => setClientMode('new')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'new' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Nuovo cliente
              </button>
            </div>

            {clientMode === 'existing' ? (
              <div>
                <button type="button"
                  onClick={() => { setShowClientList(!showClientList); setClientSearch(''); }}
                  className="w-full px-3 py-2 border rounded-lg text-sm text-left flex items-center justify-between hover:bg-gray-50">
                  <span className={form.client_id ? 'text-gray-900' : 'text-gray-400'}>
                    {form.client_id ? (() => { const c = clients.find(x => x.id === form.client_id); return c ? `${c.first_name} ${c.last_name}` : 'Cliente'; })() : 'Seleziona cliente...'}
                  </span>
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${showClientList ? 'rotate-180' : ''}`} />
                </button>
                {showClientList && (
                  <div className="border rounded-lg mt-1 overflow-hidden">
                    <div className="relative p-2 border-b">
                      <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" placeholder="Cerca cliente..." value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)} autoFocus
                        className="w-full pl-7 pr-3 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {clients.filter(c => !clientSearch ||
                        `${c.first_name} ${c.last_name} ${c.phone||''}`.toLowerCase().includes(clientSearch.toLowerCase())
                      ).map(c => (
                        <button key={c.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, client_id: c.id })); setShowClientList(false); setClientSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50">
                          {c.first_name} {c.last_name}{c.phone ? <span className="text-gray-400 ml-1">· {c.phone}</span> : ''}
                        </button>
                      ))}
                      {clients.filter(c => !clientSearch || `${c.first_name} ${c.last_name} ${c.phone||''}`.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-3">Nessun cliente trovato</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input type="text" placeholder="Nome *" value={newClient.first_name}
                      onChange={e => { setNewClient({ ...newClient, first_name: e.target.value }); clearError('clientFirst'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientFirst ? 'border-red-400' : ''}`} />
                    {errors.clientFirst && <p className="text-red-500 text-xs mt-0.5">{errors.clientFirst}</p>}
                  </div>
                  <div className="flex-1">
                    <input type="text" placeholder="Cognome *" value={newClient.last_name}
                      onChange={e => { setNewClient({ ...newClient, last_name: e.target.value }); clearError('clientLast'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientLast ? 'border-red-400' : ''}`} />
                    {errors.clientLast && <p className="text-red-500 text-xs mt-0.5">{errors.clientLast}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <select value={clientPrefix} onChange={e => setClientPrefix(e.target.value)}
                    className="px-2 py-2 border rounded-lg text-sm bg-gray-50 w-24">
                    {countryCodes.slice(0, 8).map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <input type="tel" placeholder="Telefono" value={newClient.phone}
                    onChange={e => setNewClient({ ...newClient, phone: e.target.value.replace(/[^\d\s\-\(\)]/g, '') })}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* 2. Servizio + Duration Preview */}
          <div>
            <label className="text-sm font-medium text-gray-700">Servizio</label>
            {/* Bottone/tendina richiudibile */}
            <button type="button" disabled={!!appointment.booked_services?.length}
              onClick={() => { setShowServiceList(!showServiceList); setServiceSearch(''); }}
              className={`w-full mt-1 px-3 py-2 border rounded-lg text-sm text-left flex items-center justify-between hover:bg-gray-50 ${errors.service ? 'border-red-400' : ''}`}>
              <span className={form.service_id ? 'text-gray-900' : 'text-gray-400'}>
                {form.service_id ? appointment.booked_services?.[0]?.name || services.find(s => s.id === form.service_id)?.name || 'Servizio' : 'Seleziona servizio...'}
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${showServiceList ? 'rotate-180' : ''}`} />
            </button>
            {showServiceList && (
              <div className="border rounded-lg mt-1 overflow-hidden">
                <div className="relative p-2 border-b">
                  <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Cerca servizio..." value={serviceSearch}
                    onChange={e => setServiceSearch(e.target.value)} autoFocus
                    className="w-full pl-7 pr-3 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {categories.filter(c => servicesByCat.has(c.id)).map(cat => (
                    <div key={cat.id}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border-b flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color_hex }} />{cat.name}
                      </div>
                      {(servicesByCat.get(cat.id) || []).map(s => (
                        <button key={s.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, service_id: s.id })); clearError('service'); setShowServiceList(false); setServiceSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 flex justify-between items-center">
                          <span>{s.name} <span className="text-gray-400 text-xs">{s.duration_minutes}min</span></span>
                          <span className="text-xs font-semibold">€{(s.price_cents/100).toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {(servicesByCat.get(null) || []).length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border-b">Altro</div>
                      {(servicesByCat.get(null) || []).map(s => (
                        <button key={s.id} type="button"
                          onClick={() => { setForm(f => ({ ...f, service_id: s.id })); clearError('service'); setShowServiceList(false); setServiceSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 flex justify-between items-center">
                          <span>{s.name} <span className="text-gray-400 text-xs">{s.duration_minutes}min</span></span>
                          <span className="text-xs font-semibold">€{(s.price_cents/100).toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {filteredServices.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-3">Nessun servizio trovato</p>
                  )}
                </div>
              </div>
            )}
            {errors.service && <p className="text-red-500 text-xs mt-1">{errors.service}</p>}

            {/* Duration + buffer display */}
            {form.service_id && (() => {
              const svc = services.find(s => s.id === form.service_id);
              if (!svc) return null;
              const storedDuration = !isNew && form.service_id === appointment.service_id ? (new Date(appointment.end_time).getTime()-new Date(appointment.start_time).getTime())/60000 : null;
              const buf = storedDuration !== null ? Math.max(0, (new Date(appointment.buffer_end_time ?? appointment.end_time).getTime()-new Date(appointment.end_time).getTime())/60000) : svc.buffer_time_minutes ?? 0;
              return (
                <div className="mt-2 p-2 bg-gray-50 rounded-lg text-xs flex items-center justify-between">
                  <span className="font-medium text-gray-700">Durata: {storedDuration ?? clientServiceDuration(svc)} min</span>
                  {buf > 0 && (
                    <span className="text-gray-400 flex items-center gap-1">
                      <Clock size={10} /> +{buf} min buffer
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* 3. Operatore */}
          <div>
            <label className="text-sm font-medium text-gray-700">Operatore</label>
            <select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.stylist ? 'border-red-400' : ''}`}
              value={form.stylist_id || ''}
              onChange={e => { setForm(f => ({ ...f, stylist_id: e.target.value, start_time: '' })); setTimePickerOpen(true); clearError('stylist'); }}>
              <option value="">Seleziona operatore...</option>
              {filteredStylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            {errors.stylist && <p className="text-red-500 text-xs mt-1">{errors.stylist}</p>}
          </div>

          {/* 4. Data e Orario */}
          <div>
            <label className="text-sm font-medium text-gray-700">Data e orario</label>
            {errors.time && <p className="text-red-500 text-xs mt-1">{errors.time}</p>}

            <button type="button" aria-expanded={timePickerOpen} aria-controls="appointment-time-picker"
              onClick={() => setTimePickerOpen(open => !open)}
              className="w-full mt-1.5 px-3 py-2 border rounded-lg text-sm text-left flex items-center justify-between gap-2 hover:bg-gray-50">
              <span className="flex items-center gap-2"><Clock size={15} className="text-gray-400" />
                {form.start_time ? format(parseISO(form.start_time), 'EEE dd/MM/yyyy HH:mm', { locale: it }) : 'Seleziona data e orario'}
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${timePickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {timePickerOpen && <div id="appointment-time-picker">
            <input type="date" aria-label="Data appuntamento" value={slotDate} min={todayDateStr()}
              onChange={e => { setSlotDate(e.target.value); setForm(f => ({ ...f, start_time: '' })); clearError('time'); }}
              className="w-full mt-2 px-3 py-2 border rounded-lg text-sm" />
            <div className="flex gap-1.5 overflow-x-auto mt-1.5 mb-2">
              {Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)).map(d => {
                const ds = format(d, 'yyyy-MM-dd');
                return (
                  <button key={ds} type="button"
                    onClick={() => { setSlotDate(ds); setForm(f => ({ ...f, start_time: '' })); clearError('time'); }}
                    className={`flex-shrink-0 w-14 py-2 rounded-xl text-center transition-colors ${
                      ds === slotDate ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    <div className="text-[10px] leading-tight">{format(d, 'EEE', { locale: it })}</div>
                    <div className="font-bold text-base leading-tight">{format(d, 'd')}</div>
                  </button>
                );
              })}
            </div>

            {!form.service_id || !form.stylist_id ? (
              <div className="text-center py-2">
                {form.start_time ? (
                  <p className="text-sm font-medium text-blue-600">
                    Orario: {format(parseISO(form.start_time), 'HH:mm')}
                  </p>
                ) : null}
                <p className="text-xs text-gray-400">Seleziona servizio e operatore</p>
              </div>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center py-3"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : slotsError ? (
              <p role="alert" className="text-xs text-red-600 py-2">{slotsError}</p>
            ) : slots.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Nessuno slot disponibile</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {slots.map((s, i) => {
                  const svc = services.find(svc => svc.id === form.service_id);
                  const duration = !isNew && form.service_id === appointment.service_id ? (new Date(appointment.end_time).getTime()-new Date(appointment.start_time).getTime())/60000 : svc ? clientServiceDuration(svc) : 0;
                  const [h, m] = s.time.split(':').map(Number);
                  const endM = h * 60 + m + duration;
                  const endTime = `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;

                  const isSelected = form.start_time
                    ? new Date(form.start_time).getTime() === new Date(buildSlotTime(slotDate, s.time)).getTime()
                    : false;
                  return (
                    <button key={i} type="button"
                      onClick={() => { setForm(f => ({ ...f, start_time: buildSlotTime(slotDate, s.time) })); setTimePickerOpen(false); clearError('time'); }}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-md scale-[1.02]'
                          : 'bg-white border border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                      }`}>
                      <span>{s.time}</span>
                      <span className={`text-xs ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                        → {endTime}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            </div>}
          </div>

          {/* 5. In-chair added services */}
          {!isNew && addedServices.length > 0 && (
            <div className="p-3 bg-amber-50 rounded-lg">
              <h4 className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                <Scissors size={12} /> Servizi aggiuntivi
              </h4>
              {addedServices.map((as, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-amber-700 py-0.5">
                  <span>{as.name}</span>
                  <span className="text-amber-500">+{as.duration_added} min</span>
                </div>
              ))}
            </div>
          )}

          {/* 6. Add service (in-chair upselling) — only for existing, in-progress appointments */}
          {!isNew && appointment.status!=='no_show' && isInProgress && onAddService && (
            <div className="border-t pt-3">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                <Plus size={14} /> Aggiungi servizio in poltrona
              </label>
              <div className="flex gap-2 mt-1.5">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm"
                  value={newServiceId}
                  onChange={e => setNewServiceId(e.target.value)}>
                  <option value="">Seleziona servizio...</option>
                  {services.filter(s => s.id !== form.service_id).map(s => (
                    <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min</option>
                  ))}
                </select>
                <button onClick={handleAddService} disabled={!newServiceId || addingService}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium flex items-center gap-1">
                  {addingService ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Aggiungi
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Il servizio parte dalla fine dell'appuntamento corrente e blocca immediatamente gli slot esterni
              </p>
            </div>
          )}

          {/* 7. Collapsible: Canale + Note */}
          <div>
            <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <ChevronDown size={14} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              Dettagli aggiuntivi
            </button>
            {advancedOpen && (
              <div className="space-y-3 mt-2 pl-1">
                <div>
                  <label className="text-sm text-gray-500">Canale</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                    value={form.source || 'manual'}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value as any }))}>
                    <option value="walk_in">🚶 Walk-in</option>
                    <option value="phone">📞 Telefono</option>
                    <option value="whatsapp">💬 WhatsApp</option>
                    <option value="widget">📱 Sito/Widget</option>
                    <option value="manual">✍️ Manuale</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Note</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" rows={2}
                    value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          {financeMode && appointment.id && <FinanceDialog key={appointment.id + financeMode} appointmentId={appointment.id} initialMode={financeMode} onClose={() => { setFinanceMode(null); onFinanceChange?.(); }} />}
          {/* Actions */}
          <div className="flex items-center gap-2 justify-end pt-2 border-t">
            {!isNew && <FinanceMenu disabled={saving || ['client_id','service_id','stylist_id','start_time','end_time','status','source','notes'].some(key => (form[key as keyof Appointment] ?? '') !== (appointment[key as keyof Appointment] ?? ''))} onSelect={setFinanceMode} />}
            {!isNew && appointment.status !== 'no_show' && (
              <button
                onClick={() => { if (confirm('Sicuro di voler cancellare questo appuntamento?')) onDelete(appointment.id); }}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 text-sm">
                <Trash2 size={16} /> Elimina
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
