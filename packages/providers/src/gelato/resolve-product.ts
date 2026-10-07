import type { GelatoProductLookup } from '@chatprint/shared';
import { GelatoApiError } from './http.js';
import type { GelatoCatalog, GelatoProductApi, GelatoProductSummary } from './product-api.js';

/** The catalog definition doesn't identify exactly one printable Gelato product. */
export class GelatoProductLookupError extends Error {
  override name = 'GelatoProductLookupError';
  constructor(
    readonly sku: string,
    readonly problems: readonly string[],
  ) {
    super(
      `Cannot resolve Gelato product for ${sku}:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

export interface ResolveGelatoProductInput {
  /** Our variant SKU, for messages. */
  sku: string;
  lookup: GelatoProductLookup;
  /** Cross-checked against the product's dimensions when Gelato returns them. */
  sizeMm: { width: number; height: number };
  /** ISO country codes the product must ship to. */
  countries: readonly string[];
}

export interface ResolvedGelatoProduct {
  productUid: string;
  attributes: Record<string, unknown>;
  /** Checks that could not run; the caller should print them. */
  warnings: string[];
}

const SIZE_TOLERANCE_MM = 2;
const SEARCH_LIMIT = 100;

/**
 * Finds the Gelato productUid for one of our variants through the product API:
 * checks the declared attributes against the live catalog, searches by them,
 * requires exactly one match, and confirms the product is printable, the right
 * size and available in the destination countries. Errors list the valid
 * choices so a wrong definition is a one-line fix.
 */
export async function resolveGelatoProduct(
  api: GelatoProductApi,
  input: ResolveGelatoProductInput,
): Promise<ResolvedGelatoProduct> {
  const { sku, lookup } = input;
  const fail = (...problems: string[]) => new GelatoProductLookupError(sku, problems);

  const catalog = await getCatalog(api, lookup.catalogUid, fail);
  const attributeProblems = checkAttributes(catalog, lookup.attributes);
  if (attributeProblems.length > 0) throw fail(...attributeProblems);

  const attributeFilters = Object.fromEntries(
    Object.entries(lookup.attributes).map(([attribute, value]) => [attribute, [value]]),
  );
  const { products } = await api.searchProducts(lookup.catalogUid, {
    attributeFilters,
    limit: SEARCH_LIMIT,
  });

  if (products.length === 0) {
    throw fail(
      `No product in catalog ${lookup.catalogUid} matches ${formatAttributes(lookup.attributes)}`,
    );
  }
  const [match, ...others] = products;
  if (match === undefined || others.length > 0) {
    throw fail(
      `${products.length} products match ${formatAttributes(lookup.attributes)}. ` +
        'Add attributes that tell them apart:',
      ...describeCandidates(products),
    );
  }

  const warnings: string[] = [];
  const size = readSizeMm(match.dimensions);
  if (size === undefined) {
    warnings.push(`${sku}: Gelato returned no readable Width and Height; size not cross-checked`);
  } else if (
    Math.abs(size.width - input.sizeMm.width) > SIZE_TOLERANCE_MM ||
    Math.abs(size.height - input.sizeMm.height) > SIZE_TOLERANCE_MM
  ) {
    throw fail(
      `${match.productUid} is ${round(size.width)} × ${round(size.height)} mm, ` +
        `but ${sku} is ${input.sizeMm.width} × ${input.sizeMm.height} mm`,
    );
  }

  const product = await api.getProduct(match.productUid);
  if (!product.isPrintable) {
    throw fail(`${match.productUid} is not printable`);
  }
  const supported = product.supportedCountries ?? [];
  const unavailable = input.countries.filter(
    (country) =>
      (product.notSupportedCountries ?? []).includes(country) ||
      (supported.length > 0 && !supported.includes(country)),
  );
  if (unavailable.length > 0) {
    throw fail(`${match.productUid} does not ship to ${unavailable.join(', ')}`);
  }
  if (supported.length === 0) {
    warnings.push(`${sku}: Gelato listed no supported countries; availability not confirmed`);
  }

  return { productUid: match.productUid, attributes: match.attributes, warnings };
}

async function getCatalog(
  api: GelatoProductApi,
  catalogUid: string,
  fail: (...problems: string[]) => GelatoProductLookupError,
): Promise<GelatoCatalog> {
  try {
    return await api.getCatalog(catalogUid);
  } catch (error) {
    if (error instanceof GelatoApiError && error.status === 404) {
      throw fail(`Gelato has no catalog ${catalogUid} (see GET /v3/catalogs)`);
    }
    throw error;
  }
}

function checkAttributes(
  catalog: GelatoCatalog,
  wanted: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const [attributeUid, valueUid] of Object.entries(wanted)) {
    const attribute = catalog.productAttributes.find((a) => a.productAttributeUid === attributeUid);
    if (attribute === undefined) {
      const known = catalog.productAttributes.map((a) => a.productAttributeUid).join(', ');
      problems.push(
        `Catalog ${catalog.catalogUid} has no attribute ${attributeUid}. It has: ${known}`,
      );
      continue;
    }
    if (!attribute.values.some((v) => v.productAttributeValueUid === valueUid)) {
      const known = attribute.values.map((v) => v.productAttributeValueUid).join(', ');
      problems.push(`${attributeUid} has no value ${valueUid}. Values: ${known}`);
    }
  }
  return problems;
}

function describeCandidates(products: readonly GelatoProductSummary[]): string[] {
  const keys = [...new Set(products.flatMap((p) => Object.keys(p.attributes)))];
  const differing = keys.filter(
    (key) => new Set(products.map((p) => JSON.stringify(p.attributes[key]))).size > 1,
  );
  return products.slice(0, 10).map((p) => {
    const distinct = differing.map((key) => `${key}=${String(p.attributes[key])}`).join(', ');
    return `${p.productUid}${distinct ? ` (${distinct})` : ''}`;
  });
}

const MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, in: 25.4, inch: 25.4, inches: 25.4 };

/** Reads { Width, Height } measures from a product's dimensions, in millimetres. */
export function readSizeMm(dimensions: unknown): { width: number; height: number } | undefined {
  if (typeof dimensions !== 'object' || dimensions === null) return undefined;
  const record = dimensions as Record<string, unknown>;
  const width = toMm(record.Width ?? record.width);
  const height = toMm(record.Height ?? record.height);
  return width === undefined || height === undefined ? undefined : { width, height };
}

function toMm(measure: unknown): number | undefined {
  if (typeof measure !== 'object' || measure === null) return undefined;
  const { value, measureUnit } = measure as { value?: unknown; measureUnit?: unknown };
  if (typeof value !== 'number' || typeof measureUnit !== 'string') return undefined;
  const factor = MM_PER_UNIT[measureUnit.toLowerCase()];
  return factor === undefined ? undefined : value * factor;
}

function formatAttributes(attributes: Readonly<Record<string, string>>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
