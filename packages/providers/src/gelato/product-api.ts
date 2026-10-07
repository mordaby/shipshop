import { z } from 'zod';
import { GelatoHttpClient, type GelatoHttpOptions } from './http.js';

/** Gelato Product API v3 (catalogs, product search, product details). */
export const GELATO_PRODUCT_API_URL = 'https://product.gelatoapis.com/v3';

const measureSchema = z.looseObject({ value: z.number(), measureUnit: z.string() });
export type GelatoMeasure = z.infer<typeof measureSchema>;

const catalogSchema = z.looseObject({
  catalogUid: z.string(),
  title: z.string(),
  productAttributes: z.array(
    z.looseObject({
      productAttributeUid: z.string(),
      title: z.string(),
      values: z.array(z.looseObject({ productAttributeValueUid: z.string(), title: z.string() })),
    }),
  ),
});
export type GelatoCatalog = z.infer<typeof catalogSchema>;

const productSummarySchema = z.looseObject({
  productUid: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  weight: measureSchema.optional(),
  // Documented as { Width, Height, Thickness } measures; read defensively.
  dimensions: z.unknown().optional(),
  supportedCountries: z.array(z.string()).optional(),
});
export type GelatoProductSummary = z.infer<typeof productSummarySchema>;

const searchResultSchema = z.looseObject({
  products: z.array(productSummarySchema),
  hits: z.looseObject({ attributeHits: z.record(z.string(), z.unknown()) }).optional(),
});
export type GelatoProductSearchResult = z.infer<typeof searchResultSchema>;

const productSchema = productSummarySchema.extend({
  notSupportedCountries: z.array(z.string()).optional(),
  isStockable: z.boolean().optional(),
  isPrintable: z.boolean(),
  validPageCounts: z.array(z.number()).optional(),
});
export type GelatoProduct = z.infer<typeof productSchema>;

export interface GelatoProductSearch {
  /** productAttributeUid -> allowed productAttributeValueUids. */
  attributeFilters?: Record<string, string[]>;
  /** Up to 500. */
  limit?: number;
  offset?: number;
}

export class GelatoProductApi {
  readonly #http: GelatoHttpClient;

  constructor(options: GelatoHttpOptions) {
    this.#http = new GelatoHttpClient(options);
  }

  /** GET /v3/catalogs/{catalogUid}: the catalog and the attributes its products are defined by. */
  getCatalog(catalogUid: string): Promise<GelatoCatalog> {
    return this.#http.request('GET', this.#url(`/catalogs/${segment(catalogUid)}`), catalogSchema);
  }

  /** POST /v3/catalogs/{catalogUid}/products:search */
  searchProducts(
    catalogUid: string,
    search: GelatoProductSearch = {},
  ): Promise<GelatoProductSearchResult> {
    return this.#http.request(
      'POST',
      this.#url(`/catalogs/${segment(catalogUid)}/products:search`),
      searchResultSchema,
      search,
    );
  }

  /** GET /v3/products/{productUid} */
  getProduct(productUid: string): Promise<GelatoProduct> {
    return this.#http.request('GET', this.#url(`/products/${segment(productUid)}`), productSchema);
  }

  #url(path: string): string {
    return `${GELATO_PRODUCT_API_URL}${path}`;
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
