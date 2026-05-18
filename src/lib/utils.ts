export const countryCodes = [
  { code: '+39', flag: '🇮🇹', name: 'Italia' },
  { code: '+49', flag: '🇩🇪', name: 'Germania' },
  { code: '+44', flag: '🇬🇧', name: 'Regno Unito' },
  { code: '+33', flag: '🇫🇷', name: 'Francia' },
  { code: '+34', flag: '🇪🇸', name: 'Spagna' },
  { code: '+41', flag: '🇨🇭', name: 'Svizzera' },
  { code: '+1', flag: '🇺🇸', name: 'Stati Uniti' },
  { code: '+30', flag: '🇬🇷', name: 'Grecia' },
  { code: '+32', flag: '🇧🇪', name: 'Belgio' },
  { code: '+31', flag: '🇳🇱', name: 'Paesi Bassi' },
  { code: '+351', flag: '🇵🇹', name: 'Portogallo' },
  { code: '+43', flag: '🇦🇹', name: 'Austria' },
  { code: '+48', flag: '🇵🇱', name: 'Polonia' },
  { code: '+40', flag: '🇷🇴', name: 'Romania' },
  { code: '+386', flag: '🇸🇮', name: 'Slovenia' },
  { code: '+385', flag: '🇭🇷', name: 'Croazia' },
];

export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!cleaned.startsWith('+') && !cleaned.startsWith('00')) {
    if (cleaned.length <= 10) cleaned = '+39' + cleaned;
    else cleaned = '+' + cleaned;
  }
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  // Keep only + and digits
  cleaned = '+' + cleaned.replace(/[^\d]/g, '');
  return cleaned;
}

export function parsePhoneParts(phone: string): { prefix: string; number: string } {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  // Try to match known prefixes
  for (const country of countryCodes) {
    if (cleaned.startsWith(country.code)) {
      return { prefix: country.code, number: cleaned.slice(country.code.length) };
    }
  }
  // Default: return as-is
  if (cleaned.startsWith('+')) return { prefix: '', number: cleaned };
  return { prefix: '+39', number: cleaned };
}
