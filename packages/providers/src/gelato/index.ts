export { GelatoApiError, GelatoError, GelatoHttpClient, type GelatoHttpOptions } from './http.js';
export {
  GELATO_PRODUCT_API_URL,
  GelatoProductApi,
  type GelatoCatalog,
  type GelatoProduct,
  type GelatoProductSearch,
  type GelatoProductSearchResult,
  type GelatoProductSummary,
} from './product-api.js';
export {
  GelatoProductLookupError,
  readSizeMm,
  resolveGelatoProduct,
  type ResolvedGelatoProduct,
  type ResolveGelatoProductInput,
} from './resolve-product.js';
