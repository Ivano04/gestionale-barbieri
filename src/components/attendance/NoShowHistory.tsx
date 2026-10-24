'use client';
import { useEffect,useState } from 'react';
import { attendanceEmailLabel } from '@/services/attendance/types';
interface Visit {id:string;visit_start:string;visit_end:string;activeCount:number;members:{serviceName:string;appointment_id:string;marked_at:string;restored_at:string|null}[];events:{actor_name:string|null;action:string;created_at:string;actor:{full_name:string}|{full_name:string}[]|null}[];email:{state:string;available_at:string;sent_at:string|null;last_error_code:string|null}|null}
export function NoShowHistory({clientId}:{clientId:string}){
 const [data,setData]=useState<{visits:Visit[];hasMore:boolean}|null>(null);const [error,setError]=useState(false);
 useEffect(()=>{const c=new AbortController();fetch(`/api/clients/${clientId}/no-shows`,{signal:c.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(value=>{if(!c.signal.aborted){setData(value);setError(false);}}).catch(()=>{if(!c.signal.aborted)setError(true);});return()=>c.abort();},[clientId]);
 if(error)return <p className="mb-3 text-xs text-red-700">Storico delle assenze temporaneamente non disponibile.</p>;
 if(!data)return <p className="mb-3 text-xs text-slate-500">Caricamento storico assenze…</p>;
 const count=data.visits.filter(v=>v.activeCount>0).length;
 return <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><h4 className="text-sm font-semibold text-amber-950">{count} {count===1?'visita mancata':'visite mancate'}{data.hasMore?' nelle ultime 100 segnalazioni':''}</h4>
 {data.visits.length>0&&<details className="mt-2 text-xs"><summary className="cursor-pointer text-amber-900">Dettagli e correzioni</summary><div className="mt-2 space-y-3">{data.visits.map(v=><div key={v.id} className="rounded-md bg-white p-2">
 <p className="font-medium">{new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(v.visit_start))} · {v.activeCount?`${v.activeCount} appuntamenti segnati`:'Segnalazione rimossa'}</p>
 <ul className="mt-1 space-y-1 text-slate-600">{v.members.map(m=><li key={m.appointment_id}>{m.serviceName} · {m.restored_at?'Presenza ripristinata':'Mancata presenza'}</li>)}</ul>
 {v.email&&<p className="mt-1 text-slate-500">{attendanceEmailLabel({state:v.email.state,availableAt:v.email.available_at,sentAt:v.email.sent_at,reason:v.email.last_error_code})}</p>}
 {v.events.sort((a,b)=>a.created_at.localeCompare(b.created_at)).map((e,i)=>{const actor=Array.isArray(e.actor)?e.actor[0]:e.actor;return <p key={i} className="mt-1 text-slate-500">{e.action==='mark'?'Segnata':e.action==='restore'?'Corretta':'Importata'} · {new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(new Date(e.created_at))}{(e.actor_name??actor?.full_name)?` · ${e.actor_name??actor?.full_name}`:''}</p>;})}
 </div>)}</div></details>}</section>;
}
