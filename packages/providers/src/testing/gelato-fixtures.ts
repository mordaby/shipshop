import { GELATO_PRODUCT_API_URL } from '../gelato/product-api.js';
import type { MockRoute } from './fetch-mock.js';

/*
 * Response bodies shaped like Gelato's documented Product API v3
 * (catalogUid/productAttributes, products[] with attributes, weight,
 * dimensions and supportedCountries). Attribute names and the productUid are
 * illustrative test data, not looked up from the live catalog.
 */

export const FIXTURE_CANVAS_PRODUCT_UID =
  'canvas_300x300-mm-12x12-inch_canvas_wood-fsc-slim_4-0_ver';

export function gelatoCanvasCatalog() {
  return {
    catalogUid: 'canvas',
    title: 'Canvas',
    productAttributes: [
      {
        productAttributeUid: 'CanvasFormat',
        title: 'Canvas format',
        values: [
          { productAttributeValueUid: '200x200-mm-8x8-inch', title: '200x200 mm / 8x8 inch' },
          { productAttributeValueUid: '300x300-mm-12x12-inch', title: '300x300 mm / 12x12 inch' },
          { productAttributeValueUid: '300x400-mm-12x16-inch', title: '300x400 mm / 12x16 inch' },
        ],
      },
      {
        productAttributeUid: 'CanvasFrame',
        title: 'Canvas frame',
        values: [
          { productAttributeValueUid: 'wood-fsc-slim', title: 'Slim wood frame (FSC)' },
          { productAttributeValueUid: 'wood-fsc-thick', title: 'Thick wood frame (FSC)' },
        ],
      },
      {
        productAttributeUid: 'Orientation',
        title: 'Orientation',
        values: [
          { productAttributeValueUid: 'hor', title: 'Horizontal' },
          { productAttributeValueUid: 'ver', title: 'Vertical' },
        ],
      },
    ],
  };
}

export function gelatoCanvasSummary(overrides: Record<string, unknown> = {}) {
  return {
    productUid: FIXTURE_CANVAS_PRODUCT_UID,
    attributes: {
      CanvasFormat: '300x300-mm-12x12-inch',
      CanvasFrame: 'wood-fsc-slim',
      Orientation: 'ver',
    },
    weight: { value: 742, measureUnit: 'grams' },
    dimensions: {
      Width: { value: 300, measureUnit: 'mm' },
      Height: { value: 300, measureUnit: 'mm' },
      Thickness: { value: 20, measureUnit: 'mm' },
    },
    supportedCountries: ['IL', 'US', 'DE'],
    ...overrides,
  };
}

export function gelatoCanvasDetails(overrides: Record<string, unknown> = {}) {
  return {
    ...gelatoCanvasSummary(),
    notSupportedCountries: [],
    isStockable: false,
    isPrintable: true,
    validPageCounts: [],
    ...overrides,
  };
}

/** The three calls a successful canvas lookup makes, in order. */
export function gelatoCanvasRoutes(
  options: {
    catalog?: unknown;
    products?: unknown[];
    details?: unknown;
  } = {},
): MockRoute[] {
  const summary = gelatoCanvasSummary();
  return [
    {
      method: 'GET',
      url: `${GELATO_PRODUCT_API_URL}/catalogs/canvas`,
      body: options.catalog ?? gelatoCanvasCatalog(),
    },
    {
      method: 'POST',
      url: `${GELATO_PRODUCT_API_URL}/catalogs/canvas/products:search`,
      body: {
        products: options.products ?? [summary],
        hits: { attributeHits: {} },
      },
    },
    {
      method: 'GET',
      url: `${GELATO_PRODUCT_API_URL}/products/${encodeURIComponent(FIXTURE_CANVAS_PRODUCT_UID)}`,
      body: options.details ?? gelatoCanvasDetails(),
    },
  ];
}
