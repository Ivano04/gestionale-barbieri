'use client';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Clock, CheckCircle, Loader2 } from 'lucide-react';

const sourceConfig: Record<string, { icon: string; color: string; bg: string }> = {
  walk_in:   { icon: '\u{1F6B6}', color: '#059669', bg: '#ecfdf5' },
  phone:     { icon: '\u{1F4DE}', color: '#2563eb', bg: '#eff6ff' },
  whatsapp:  { icon: '\u{1F4AC}', color: '#0d9488', bg: '#f0fdfa' },
  widget:    { icon: '\u{1F4F1}', color: '#7c3aed', bg: '#f5f3ff' },
  treatwell: { icon: '\u{1F4CB}', color: '#ea580c', bg: '#fff7ed' },
  google:    { icon: '\u{1F50D}', color: '#dc2626', bg: '#fef2f2' },
  manual:    { icon: '\u{270D}\u{FE0F}', color: '#6b7280', bg: '#f9fafb' },
};

interface Props {
  appointment: Appointment;
  onClick: (e?: React.MouseEvent) => void;
}

export function AppointmentCard({ appointment, onClick }: Props) {
  const cfg = sourceConfig[appointment.source] || sourceConfig.manual;
  const synced = appointment.source !== 'treatwell' || Boolean(appointment.treatwell_appointment_id);

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className="rounded-md p-1.5 cursor-pointer text-xs border-l-[3px] hover:shadow-md transition-all duration-200 mb-0.5"
      style={{ borderLeftColor: cfg.color, backgroundColor: cfg.bg }}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium truncate text-[11px]">
          {appointment.client?.first_name} {appointment.client?.last_name || ''}
        </span>
        <span className="text-[10px]" title={appointment.source}>{cfg.icon}</span>
      </div>
      <div className="text-gray-500 truncate text-[10px]">{appointment.service?.name}</div>
      <div className="flex items-center justify-between mt-0.5 text-gray-400 text-[10px]">
        <span className="flex items-center gap-0.5">
          <Clock size={9} /> {format(parseISO(appointment.start_time), 'HH:mm')} - {format(parseISO(appointment.end_time), 'HH:mm')}
        </span>
        {synced
          ? <CheckCircle size={9} className="text-green-500" />
          : <Loader2 size={9} className="animate-spin text-yellow-500" />}
      </div>
    </div>
  );
}
