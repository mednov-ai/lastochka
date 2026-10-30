// UI state is national digits; API transport remains the existing full phone string.
export const phoneTemplate = '___ ___-__-__';
export function formatPhone(digits: string): string {
  return digits.replace(
    /^(\d{0,3})(\d{0,3})(\d{0,2})(\d{0,2})$/,
    (_, a, b, c, d) => a + (b ? ' ' + b : '') + (c ? '-' + c : '') + (d ? '-' + d : ''),
  );
}

export function parsePhone(value: string, partial = false): string | null {
  const text = value.replace(/[\u00a0\u202f]/g, ' ').trim();
  if (!/^(?:\+7|[0-9(])[0-9() -]*$/.test(text)) return text === '' && partial ? '' : null;
  const digits = text.replace(/\D/g, '');
  if (digits.length === 11 && /^[78]/.test(digits)) return digits.substring(1);
  if (!text.startsWith('+') && (digits.length === 10 || (partial && digits.length < 10)))
    return digits;
  return null;
}

export function phoneFromForm(form: FormData): string | null {
  if (!form.has('phoneNational')) return String(form.get('phone') ?? '');
  const text = String(form.get('phoneNational') ?? '');
  if (!/^(?:[0-9]{10}|[0-9]{3} [0-9]{3}-[0-9]{2}-[0-9]{2})$/.test(text)) return null;
  const phone = '+7' + text.replace(/\D/g, '');
  if (form.has('phone')) {
    const previous = parsePhone(String(form.get('phone')));
    if (!previous || '+7' + previous !== phone) return null;
  }
  return phone;
}
