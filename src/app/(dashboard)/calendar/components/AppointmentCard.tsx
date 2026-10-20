'use client';
import { appointmentServiceName } from '@/lib/booking-services';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { financeDescription, paymentAppearance } from '@/lib/calendar-finance';
import { FinancialStatus, BookingSource } from './FinancialStatus';
interface Props { appointment: Appointment; onClick: (e?: React.MouseEvent) => void }
export function AppointmentCard({ appointment, onClick }: Props) {
  const cfg = paymentAppearance[appointment.finance?.payment ?? 'unknown'];
  return <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    onClick={e => { e.stopPropagation(); onClick(e); }} title={financeDescription(appointment.finance)}
    className="rounded-md p-1.5 cursor-pointer text-xs border-l-[3px] hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 mb-0.5"
    style={{ borderLeftColor: cfg.border, backgroundColor: cfg.bg }}>
    <div className="flex items-center justify-between gap-1"><span className="font-medium truncate text-[11px]">{appointment.client?.first_name} {appointment.client?.last_name}</span><FinancialStatus finance={appointment.finance} /></div>
    <div className="text-slate-600 truncate text-[10px]">{appointmentServiceName(appointment)}</div>
    <div className="flex items-center justify-between mt-0.5 text-slate-600 text-[10px]"><span className="flex items-center gap-0.5"><Clock size={9} />{format(parseISO(appointment.start_time), 'HH:mm')} – {format(parseISO(appointment.end_time), 'HH:mm')}</span><BookingSource source={appointment.source} /></div>
  </div>;
}
