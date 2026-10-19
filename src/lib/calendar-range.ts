// At 00:00 UTC Rome is still before any seasonal clock change on that date.
const midnightOffset = (date: string) => '+' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${date}T00:00:00Z`)) + ':00';
export function calendarRange(date: string, endDate = date) {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(date) || !valid(endDate)) throw new Error('Periodo non valido');
  const days = (Date.parse(endDate) - Date.parse(date)) / 86400000;
  if (days < 0 || days > 6) throw new Error('Seleziona un periodo massimo di sette giorni');
  const nextDate = new Date(Date.parse(endDate) + 86400000).toISOString().slice(0, 10);
  return { start: new Date(`${date}T00:00:00${midnightOffset(date)}`).toISOString(), end: new Date(`${nextDate}T00:00:00${midnightOffset(nextDate)}`).toISOString() };
}
