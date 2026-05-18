export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
    else if (cleaned.startsWith('3')) cleaned = '+39' + cleaned;
    else if (cleaned.length <= 10) cleaned = '+39' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}
