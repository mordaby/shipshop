import { describe, expect, it } from 'vitest';
import { en, he } from './messages.js';
import { isLocale, textDirection, translate } from './translate.js';

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'catalog.size.cm', { width: 30, height: 30 })).toBe('30 × 30 cm');
    expect(translate('he', 'catalog.size.cm', { width: 30, height: 30 })).toBe('30 × 30 ס״מ');
  });

  it('throws when a placeholder has no value', () => {
    expect(() => translate('en', 'catalog.size.cm', { width: 30 })).toThrow(/\{height\}/);
  });

  it('uses the same placeholders in every locale', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(he[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('knows Hebrew is right to left', () => {
    expect(textDirection('he')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
  });

  it('recognises supported locales', () => {
    expect(isLocale('he')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});
