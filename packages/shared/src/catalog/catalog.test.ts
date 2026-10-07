import { describe, expect, it } from 'vitest';
import { CATALOG } from './definitions.js';
import type { CatalogProductDefinition, CatalogVariantDefinition } from './types.js';
import { catalogProblems } from './validate.js';

const variant = CATALOG[0]!.variants[0]!;

function productWith(overrides: Partial<CatalogVariantDefinition>): CatalogProductDefinition {
  return { ...CATALOG[0]!, variants: [{ ...variant, ...overrides }] };
}

describe('catalog definitions', () => {
  it('are valid', () => {
    expect(catalogProblems(CATALOG)).toEqual([]);
  });

  it('hold one small canvas for Milestone 1', () => {
    expect(CATALOG.map((p) => p.type)).toEqual(['canvas']);
    expect(CATALOG[0]!.variants).toHaveLength(1);
  });

  it('never hard-code a Gelato productUid', () => {
    expect(JSON.stringify(CATALOG)).not.toMatch(/productUid/i);
  });
});

describe('catalogProblems', () => {
  it('catches duplicate SKUs across products and variants', () => {
    expect(catalogProblems([CATALOG[0]!, CATALOG[0]!])).toContain('Duplicate SKU CANVAS');
  });

  it('catches fractional or non-positive prices', () => {
    const problems = catalogProblems([
      productWith({ retailPrices: [{ currency: 'ILS', amountMinor: 249.9, placeholder: true }] }),
    ]);
    expect(problems.join()).toMatch(/positive integer in minor units/);
  });

  it('catches two prices in one currency', () => {
    const price = { currency: 'ILS' as const, amountMinor: 100, placeholder: false };
    expect(catalogProblems([productWith({ retailPrices: [price, price] })]).join()).toMatch(
      /two ILS prices/,
    );
  });

  it('catches a variant without Gelato attributes', () => {
    const problems = catalogProblems([
      productWith({ gelato: { catalogUid: 'canvas', attributes: {} } }),
    ]);
    expect(problems.join()).toMatch(/no Gelato attributes/);
  });
});
