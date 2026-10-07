import { describe, expect, it } from 'vitest';
import { mockFetch } from '../testing/fetch-mock.js';
import {
  FIXTURE_CANVAS_PRODUCT_UID,
  gelatoCanvasCatalog,
  gelatoCanvasDetails,
  gelatoCanvasSummary,
} from '../testing/gelato-fixtures.js';
import { GelatoApiError, GelatoError } from './http.js';
import { GELATO_PRODUCT_API_URL, GelatoProductApi } from './product-api.js';

const API_KEY = 'test-gelato-key';

describe('GelatoProductApi', () => {
  it('gets a catalog with the X-API-KEY header', async () => {
    const mock = mockFetch([
      {
        method: 'GET',
        url: `${GELATO_PRODUCT_API_URL}/catalogs/canvas`,
        body: gelatoCanvasCatalog(),
      },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });

    const catalog = await api.getCatalog('canvas');

    expect(catalog.catalogUid).toBe('canvas');
    expect(catalog.productAttributes.map((a) => a.productAttributeUid)).toContain('CanvasFormat');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.headers.get('x-api-key')).toBe(API_KEY);
    expect(mock.requests[0]!.headers.get('accept')).toBe('application/json');
  });

  it('posts a product search with attribute filters', async () => {
    const url = `${GELATO_PRODUCT_API_URL}/catalogs/canvas/products:search`;
    const mock = mockFetch([
      {
        method: 'POST',
        url,
        body: { products: [gelatoCanvasSummary()], hits: { attributeHits: {} } },
      },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });

    const result = await api.searchProducts('canvas', {
      attributeFilters: { CanvasFormat: ['300x300-mm-12x12-inch'] },
      limit: 10,
    });

    expect(result.products[0]!.productUid).toBe(FIXTURE_CANVAS_PRODUCT_UID);
    expect(mock.requests[0]!.body).toEqual({
      attributeFilters: { CanvasFormat: ['300x300-mm-12x12-inch'] },
      limit: 10,
    });
    expect(mock.requests[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('encodes the productUid in the path', async () => {
    const mock = mockFetch([
      {
        method: 'GET',
        url: `${GELATO_PRODUCT_API_URL}/products/a%2Fb`,
        body: gelatoCanvasDetails(),
      },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });
    await expect(api.getProduct('a/b')).resolves.toMatchObject({ isPrintable: true });
  });

  it('keeps fields Gelato adds later', async () => {
    const mock = mockFetch([
      {
        method: 'GET',
        url: `${GELATO_PRODUCT_API_URL}/products/x`,
        body: gelatoCanvasDetails({ productUid: 'x', newField: 1 }),
      },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });
    expect(await api.getProduct('x')).toHaveProperty('newField', 1);
  });

  it('turns an error response into GelatoApiError without the key', async () => {
    const mock = mockFetch([
      {
        method: 'GET',
        url: `${GELATO_PRODUCT_API_URL}/catalogs/nope`,
        status: 404,
        body: { code: 'not_found', message: 'Catalog not found', requestId: 'req-123' },
      },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });

    const error = await api.getCatalog('nope').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GelatoApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', requestId: 'req-123' });
    expect((error as Error).message).toContain('Catalog not found');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('rejects a body that does not match the documented shape', async () => {
    const mock = mockFetch([
      { method: 'GET', url: `${GELATO_PRODUCT_API_URL}/products/x`, body: { productUid: 'x' } },
    ]);
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: mock.fetch });
    await expect(api.getProduct('x')).rejects.toThrow(/unexpected body.*isPrintable/);
  });

  it('reports network failures as GelatoError', async () => {
    const failingFetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    const api = new GelatoProductApi({ apiKey: API_KEY, fetch: failingFetch });
    const error = await api.getCatalog('canvas').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GelatoError);
    expect((error as Error).message).toMatch(/did not complete: fetch failed/);
  });

  it('refuses an empty key', () => {
    expect(() => new GelatoProductApi({ apiKey: '' })).toThrow(/empty/);
  });
});
