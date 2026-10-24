'use client';
import { useEffect, useState } from 'react';
import { UserRoundX, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { attendanceEmailLabel, type AttendanceContext } from '@/services/attendance/types';
import type { parseAttendanceRequest } from '@/services/attendance/validation';
type Command=ReturnType<typeof parseAttendanceRequest>;
const time=(iso:string)=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
export function NoShowControl({appointmentId,status,onChanged,disabled=false}:{appointmentId:string;status:string;onChanged:()=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(status==='no_show');
  const [context,setContext]=useState<AttendanceContext|null>(null);
  const [action,setAction]=useState<'mark'|'restore'>(status==='no_show'?'restore':'mark');
  const [selected,setSelected]=useState<string[]>([]);
  const [pending,setPending]=useState<Command|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [reload,setReload]=useState(0);
  const key='attendance-request/'+appointmentId;
  useEffect(()=>{if(!open)return;const controller=new AbortController();
    fetch(`/api/appointments/${appointmentId}/no-show`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);return data as AttendanceContext;}).then(data=>{
      if(controller.signal.aborted)return;setContext(data);setError('');
      const stored=sessionStorage.getItem(key);let previous:Command|null=null;
      if(stored){try{previous=JSON.parse(stored);if(previous?.appointmentId!==appointmentId)previous=null;}catch{sessionStorage.removeItem(key);}}
      setPending(previous);if(previous){setAction(previous.action);setSelected(previous.ids);}
      else setSelected(data.members.filter(a=>action==='mark'?['confirmed','completed'].includes(a.status):a.status==='no_show').map(a=>a.id));
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Impossibile caricare la visita');});
    return()=>controller.abort();
  },[appointmentId,open,key,reload,action]);
  useEffect(()=>{if(!open||!context||context.canMark)return;const timer=setInterval(()=>setReload(n=>n+1),30000);return()=>clearInterval(timer);},[open,context]);
  async function submit(){
    if(!context||busy)return;
    const command=pending??{requestId:crypto.randomUUID(),appointmentId,action,ids:[...selected].sort(),expected:context.members.map(a=>({id:a.id,updatedAt:a.updatedAt})).sort((a,b)=>a.id.localeCompare(b.id))};
    setBusy(true);setError('');
    try{
      sessionStorage.setItem(key,JSON.stringify(command));setPending(command);
      const r=await fetch(`/api/appointments/${appointmentId}/no-show`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});
      const data=await r.json();
      if(!r.ok){if(r.status<500){sessionStorage.removeItem(key);setPending(null);setContext(null);}throw new Error(data.error||'Operazione non completata');}
      sessionStorage.removeItem(key);setPending(null);toast.success(command.action==='mark'?'Mancata presenza registrata':'Segnalazione rimossa');onChanged();setReload(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:'Esito non disponibile. Riprova la stessa operazione.');}
    finally{setBusy(false);}
  }
  return <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
    <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-sm font-medium text-amber-950"><span className="flex items-center gap-2"><UserRoundX size={16}/> {status==='no_show'?'Mancata presenza segnalata':'Mancata presenza'}</span><ChevronDown size={14} className={open?'rotate-180':''}/></button>
    {open&&<div className="mt-3 space-y-3">
      <p className="text-xs text-slate-600">Intervieni solo se il cliente non si è presentato. Gli altri appuntamenti seguono normalmente le automazioni.</p>
      {error&&<div role="alert" className="text-xs text-red-700">{error} {!context&&<button type="button" className="underline" onClick={()=>setReload(n=>n+1)}>Ricarica</button>}</div>}
      {!context&&!error&&<p className="text-xs text-slate-500">Caricamento visita…</p>}
      {context&&<>
        {context.members.some(a=>a.status==='no_show')&&<div className="flex gap-2 text-xs">
          {(['mark','restore'] as const).map(mode=><button type="button" key={mode} disabled={!!pending||busy} onClick={()=>setAction(mode)} className={`rounded-md border px-2 py-1.5 ${action===mode?'border-amber-600 bg-white font-semibold':'border-transparent'}`}>{mode==='mark'?'Segnala assenza':'Rimuovi segnalazione'}</button>)}
        </div>}
        {context.members.map(a=>{const eligible=action==='mark'?['confirmed','completed'].includes(a.status):a.status==='no_show';return <label key={a.id} className={`flex items-start gap-2 rounded-md bg-white p-2 text-xs ${!eligible?'opacity-50':''}`}>
          <input type="checkbox" aria-label={`${action==='mark'?'Segnala':'Ripristina'} ${a.serviceName} ${time(a.startTime)}`} disabled={!eligible||busy||!!pending||(action==='mark'&&!context.canMark)} checked={selected.includes(a.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))} className="mt-0.5"/>
          <span><span className="font-medium">{time(a.startTime)}–{time(a.endTime)} · {a.serviceName}</span><span className="block text-slate-500">{a.stylistName}{a.status==='no_show'?' · Mancata presenza':''}</span></span>
        </label>;})}
        {action==='mark'&&!context.canMark&&<p className="text-xs text-amber-900">Disponibile dopo la fine dell’intera visita: {new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(context.visitEnd))}. Gli slot restano riservati.</p>}
        <p className="text-xs text-slate-600">{attendanceEmailLabel(context.email,context.hasEmail)}{context.email?.state==='pending'&&` · ${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(context.email.availableAt))}`}</p>
        {action==='restore'&&<p className="text-xs text-slate-600">Ripristina lo stato precedente e le automazioni pertinenti. Un’email già spedita non può essere ritirata. Gli orari prenotati restano gli stessi.</p>}
        {disabled&&<p className="text-xs text-amber-900">Prima salva o annulla le modifiche alla card.</p>}
        <button type="button" disabled={busy||disabled||!selected.length||(!pending&&action==='mark'&&!context.canMark)} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">{busy&&<Loader2 size={14} className="animate-spin"/>}{pending?'Riprendi la stessa operazione':action==='mark'?'Segna mancata presenza':'Rimuovi mancata presenza'}</button>
      </>}
    </div>}
  </section>;
}
