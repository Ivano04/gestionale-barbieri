'use client';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Clock, CheckCircle, Loader2 } from 'lucide-react';

const sourceIcons: Record<string, string> = {
  widget: '\u{1F4F1}', manual: '\u{270D}\u{FE0F}', phone: '\u{1F4DE}', google: '\u{1F50D}',
  treatwell: '\u{1F4CB}', walk_in: '\u{1F6B6}', whatsapp: '\u{1F4AC}',
};

interface Props {
  appointment: Appointment;
  onClick: (e?: React.MouseEvent) => void;
}

export function AppointmentCard({ appointment, onClick }: Props) {
  const color = appointment.service?.color_hex || '#60a5fa';
  const synced = Boolean(appointment.treatwell_appointment_id || appointment.ghl_appointment_id || appointment.source === 'treatwell' || appointment.source === 'manual');

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className="rounded-md p-1.5 cursor-pointer text-xs border-l-[3px] hover:shadow-md transition-shadow bg-white border border-gray-100 mb-0.5"
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium truncate text-[11px]">{appointment.client?.first_name} {appointment.client?.last_name || ''}</span>
        <span className="text-[10px]" title={appointment.source}>{sourceIcons[appointment.source] || '\u{270D}\u{FE0F}'}</span>
      </div>
      <div className="text-gray-500 truncate text-[10px]">{appointment.service?.name}</div>
      <div className="flex items-center justify-between mt-0.5 text-gray-400 text-[10px]">
        <span className="flex items-center gap-0.5"><Clock size={9} /> {format(parseISO(appointment.start_time), 'HH:mm')} - {format(parseISO(appointment.end_time), 'HH:mm')}</span>
        {synced ? <CheckCircle size={9} className="text-green-500" /> : <Loader2 size={9} className="animate-spin text-yellow-500" />}
      </div>
    </div>
  );
}
