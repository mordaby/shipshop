import { en, he, type MessageKey } from './messages.js';

export const LOCALES = ['en', 'he'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, he };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Returns the message for a key in a locale, with {placeholders} filled in.
 * A placeholder without a value is a programming error and throws.
 */
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Message ${key} needs a value for {${name}}`);
    }
    return String(value);
  });
}
