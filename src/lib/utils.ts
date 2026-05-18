export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!cleaned.startsWith('+') && !cleaned.startsWith('00')) {
    if (cleaned.length <= 10) cleaned = '+39' + cleaned;
    else cleaned = '+' + cleaned;
  }
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  return cleaned;
}
