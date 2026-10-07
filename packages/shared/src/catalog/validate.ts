import type { CatalogProductDefinition } from './types.js';

/** Structural checks on catalog definitions. Returns a list of problems; empty means valid. */
export function catalogProblems(catalog: readonly CatalogProductDefinition[]): string[] {
  const problems: string[] = [];
  const skus = new Set<string>();
  const claimSku = (sku: string) => {
    if (skus.has(sku)) problems.push(`Duplicate SKU ${sku}`);
    skus.add(sku);
  };

  for (const product of catalog) {
    claimSku(product.sku);
    if (product.variants.length === 0) problems.push(`${product.sku} has no variants`);

    for (const variant of product.variants) {
      const at = `${product.sku}/${variant.sku}`;
      claimSku(variant.sku);
      if (!isPositiveInteger(variant.widthMm) || !isPositiveInteger(variant.heightMm)) {
        problems.push(`${at}: size must be positive whole millimetres`);
      }
      if (variant.printAreas.length === 0) problems.push(`${at}: no print areas`);
      if (variant.fileRequirements.minDpi > variant.fileRequirements.targetDpi) {
        problems.push(`${at}: minimum DPI is above the target`);
      }
      if (variant.gelato.catalogUid.trim() === '') problems.push(`${at}: no Gelato catalog`);
      if (Object.keys(variant.gelato.attributes).length === 0) {
        problems.push(`${at}: no Gelato attributes to search by`);
      }
      if (variant.retailPrices.length === 0) problems.push(`${at}: no retail price`);
      const currencies = new Set<string>();
      for (const price of variant.retailPrices) {
        if (currencies.has(price.currency)) problems.push(`${at}: two ${price.currency} prices`);
        currencies.add(price.currency);
        if (!isPositiveInteger(price.amountMinor)) {
          problems.push(`${at}: ${price.currency} price must be a positive integer in minor units`);
        }
      }
    }
  }
  return problems;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
