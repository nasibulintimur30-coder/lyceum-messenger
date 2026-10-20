/**
 * Работа с телефонными номерами.
 *
 * Номер хранится цифрами без знака «+» в формате 11 цифр (7 + десять):
 * «+7 (999) 123-45-67» → 79991234567.
 */

/** Приводит ввод к каноническому виду. Возвращает null, если номер некорректен. */
export function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');

  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11) {
    if (digits.startsWith('8')) return `7${digits.slice(1)}`;
    if (digits.startsWith('7')) return digits;
  }
  return null;
}

/** Человекочитаемый вид: +7 (999) 123-45-67. */
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length !== 11) return phone || '';
  return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(
    9,
    11
  )}`;
}
