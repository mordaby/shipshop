/**
 * Money is an integer amount in minor units (agorot, cents) plus an ISO 4217
 * currency code. Never use floating point for money: convert to and from
 * decimal strings only at the edges (provider APIs, display).
 */

export const SUPPORTED_CURRENCIES = ['ILS', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Digits after the decimal point for each supported currency. */
const MINOR_UNIT_DIGITS: Record<CurrencyCode, number> = { ILS: 2, USD: 2, EUR: 2 };

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function minorUnitDigits(currency: CurrencyCode): number {
  return MINOR_UNIT_DIGITS[currency];
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError(
      `Amount must be a safe integer in minor units, got ${String(amountMinor)}`,
    );
  }
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Unsupported currency: ${String(currency)}`);
  }
  return { amountMinor, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, got ${String(quantity)}`);
  }
  return money(amount.amountMinor * quantity, amount.currency);
}

export function sumMoney(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce((total, item) => addMoney(total, item), money(0, currency));
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/** Formats as a plain decimal string, for example 12345 ILS -> "123.45". */
export function toDecimalString(amount: Money): string {
  const digits = minorUnitDigits(amount.currency);
  const sign = amount.amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amount.amountMinor)
    .toString()
    .padStart(digits + 1, '0');
  if (digits === 0) return sign + absolute;
  return `${sign}${absolute.slice(0, -digits)}.${absolute.slice(-digits)}`;
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal string such as "123.45" into minor units without floating
 * point. Rejects more fractional digits than the currency has, rather than
 * rounding silently.
 */
export function fromDecimalString(value: string, currency: CurrencyCode): Money {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new MoneyError(`Not a decimal amount: ${JSON.stringify(value)}`);
  }
  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = minorUnitDigits(currency);
  if (fraction.length > digits) {
    throw new MoneyError(`${currency} has ${digits} minor digits, got ${JSON.stringify(value)}`);
  }
  const amountMinor = Number(`${sign}${whole}${fraction.padEnd(digits, '0')}`);
  return money(amountMinor === 0 ? 0 : amountMinor, currency);
}
