'use client';
import { useEffect, useRef, useState } from 'react';
import { LogIn, Receipt, FileText } from 'lucide-react';
export function FinanceMenu({ disabled, onSelect }: { disabled: boolean; onSelect: (mode: 'checkout' | 'quote') => void }) {
 const [open,setOpen]=useState(false); const root=useRef<HTMLDivElement>(null); const trigger=useRef<HTMLButtonElement>(null); const first=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ if(!open)return; const close=(event:PointerEvent)=>{ if(event.target instanceof Node && !root.current?.contains(event.target))setOpen(false); }; document.addEventListener('pointerdown',close); return()=>document.removeEventListener('pointerdown',close); },[open]);
 return <div ref={root} className="relative mr-auto" onMouseEnter={()=>{if(!disabled)setOpen(true);}} onMouseLeave={()=>setOpen(false)}
 onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}
 onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();} if(e.key==='ArrowDown'&&!disabled){e.preventDefault();setOpen(true);requestAnimationFrame(()=>first.current?.focus());}}}>
  <button ref={trigger} type="button" disabled={disabled} aria-label="Cassa e preventivo" aria-haspopup="menu" aria-expanded={open} title={disabled?'Salva prima le modifiche all’appuntamento':'Cassa e preventivo'} onClick={()=>setOpen(true)} className="p-2 border rounded-lg text-blue-700 hover:bg-blue-50 disabled:opacity-40"><LogIn size={21}/></button>
  {open&&!disabled&&<div role="menu" aria-label="Operazioni appuntamento" className="absolute bottom-full left-0 pb-2 z-20 min-w-52"><div className="bg-white border rounded-xl shadow-xl p-1">
   <button ref={first} role="menuitem" type="button" onClick={()=>{setOpen(false);onSelect('checkout');}} className="flex items-center gap-2 px-3 py-3 text-sm hover:bg-blue-50 rounded-lg w-full"><Receipt size={17}/>Vai alla cassa</button>
   <button role="menuitem" type="button" onClick={()=>{setOpen(false);onSelect('quote');}} className="flex items-center gap-2 px-3 py-3 text-sm hover:bg-blue-50 rounded-lg w-full"><FileText size={17}/>Crea preventivo</button>
  </div></div>}
 </div>;
}
