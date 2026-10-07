import { describe, expect, it } from 'vitest';
import {
  addMoney,
  fromDecimalString,
  money,
  MoneyError,
  moneyEquals,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  toDecimalString,
} from './money.js';

describe('money', () => {
  it('accepts integer minor units', () => {
    expect(money(12345, 'ILS')).toEqual({ amountMinor: 12345, currency: 'ILS' });
  });

  it('rejects fractional, unsafe and non-finite amounts', () => {
    expect(() => money(10.5, 'ILS')).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'ILS')).toThrow(MoneyError);
    expect(() => money(Number.NaN, 'ILS')).toThrow(MoneyError);
    expect(() => money(Number.POSITIVE_INFINITY, 'ILS')).toThrow(MoneyError);
  });

  it('rejects unsupported currencies', () => {
    expect(() => money(100, 'GBP' as never)).toThrow(/Unsupported currency/);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and multiplies in the same currency', () => {
    const price = money(24900, 'ILS');
    expect(addMoney(price, money(3500, 'ILS'))).toEqual(money(28400, 'ILS'));
    expect(subtractMoney(price, money(900, 'ILS'))).toEqual(money(24000, 'ILS'));
    expect(multiplyMoney(price, 3)).toEqual(money(74700, 'ILS'));
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(1, 'ILS'), money(1, 'USD'))).toThrow(/Currency mismatch/);
  });

  it('refuses fractional quantities', () => {
    expect(() => multiplyMoney(money(100, 'USD'), 1.5)).toThrow(MoneyError);
  });

  it('sums a list, including an empty one', () => {
    expect(sumMoney([], 'EUR')).toEqual(money(0, 'EUR'));
    expect(sumMoney([money(1, 'EUR'), money(2, 'EUR')], 'EUR')).toEqual(money(3, 'EUR'));
  });

  it('compares amount and currency', () => {
    expect(moneyEquals(money(1, 'ILS'), money(1, 'ILS'))).toBe(true);
    expect(moneyEquals(money(1, 'ILS'), money(1, 'USD'))).toBe(false);
  });
});

describe('decimal strings', () => {
  it.each([
    [12345, '123.45'],
    [5, '0.05'],
    [0, '0.00'],
    [-150, '-1.50'],
    [100000000, '1000000.00'],
  ])('formats %i as %s', (amountMinor, expected) => {
    expect(toDecimalString(money(amountMinor, 'USD'))).toBe(expected);
  });

  it.each([
    ['123.45', 12345],
    ['123.4', 12340],
    ['123', 12300],
    ['0.07', 7],
    [' 9.99 ', 999],
    ['-1.50', -150],
    ['-0.00', 0],
  ])('parses %s without floating point', (value, amountMinor) => {
    expect(fromDecimalString(value, 'ILS')).toEqual(money(amountMinor, 'ILS'));
  });

  it('rejects extra precision instead of rounding', () => {
    expect(() => fromDecimalString('1.005', 'ILS')).toThrow(/minor digits/);
  });

  it.each(['', 'abc', '1,000.00', '1e3', '.5', '1.'])('rejects %j', (value) => {
    expect(() => fromDecimalString(value, 'ILS')).toThrow(MoneyError);
  });

  it('round-trips', () => {
    for (const amountMinor of [0, 1, 99, 100, 101, 2499900]) {
      const amount = money(amountMinor, 'EUR');
      expect(fromDecimalString(toDecimalString(amount), 'EUR')).toEqual(amount);
    }
  });
});
