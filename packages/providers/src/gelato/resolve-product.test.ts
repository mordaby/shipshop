import { CATALOG } from '@chatprint/shared';
import { describe, expect, it } from 'vitest';
import { mockFetch, type MockRoute } from '../testing/fetch-mock.js';
import {
  FIXTURE_CANVAS_PRODUCT_UID,
  gelatoCanvasCatalog,
  gelatoCanvasDetails,
  gelatoCanvasRoutes,
  gelatoCanvasSummary,
} from '../testing/gelato-fixtures.js';
import { GELATO_PRODUCT_API_URL, GelatoProductApi } from './product-api.js';
import {
  GelatoProductLookupError,
  readSizeMm,
  resolveGelatoProduct,
  type ResolveGelatoProductInput,
} from './resolve-product.js';

const variant = CATALOG[0]!.variants[0]!;

const input: ResolveGelatoProductInput = {
  sku: variant.sku,
  lookup: variant.gelato,
  sizeMm: { width: variant.widthMm, height: variant.heightMm },
  countries: ['IL'],
};

function apiFor(routes: MockRoute[]) {
  const mock = mockFetch(routes);
  return { api: new GelatoProductApi({ apiKey: 'k', fetch: mock.fetch }), mock };
}

async function lookupError(
  routes: MockRoute[],
  overrides: Partial<ResolveGelatoProductInput> = {},
) {
  const { api } = apiFor(routes);
  const error = await resolveGelatoProduct(api, { ...input, ...overrides }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GelatoProductLookupError);
  return (error as GelatoProductLookupError).message;
}

describe('resolveGelatoProduct', () => {
  it('finds the productUid for the canvas definition', async () => {
    const { api, mock } = apiFor(gelatoCanvasRoutes());

    const resolved = await resolveGelatoProduct(api, input);

    expect(resolved.productUid).toBe(FIXTURE_CANVAS_PRODUCT_UID);
    expect(resolved.warnings).toEqual([]);
    expect(mock.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${GELATO_PRODUCT_API_URL}/catalogs/canvas`,
      `POST ${GELATO_PRODUCT_API_URL}/catalogs/canvas/products:search`,
      `GET ${GELATO_PRODUCT_API_URL}/products/${encodeURIComponent(FIXTURE_CANVAS_PRODUCT_UID)}`,
    ]);
    expect(mock.requests[1]!.body).toEqual({
      attributeFilters: {
        CanvasFormat: ['300x300-mm-12x12-inch'],
        CanvasFrame: ['wood-fsc-slim'],
      },
      limit: 100,
    });
  });

  it('lists the real attributes when one does not exist', async () => {
    const message = await lookupError(gelatoCanvasRoutes(), {
      lookup: { catalogUid: 'canvas', attributes: { FrameType: 'slim' } },
    });
    expect(message).toContain('no attribute FrameType');
    expect(message).toContain('CanvasFormat, CanvasFrame, Orientation');
  });

  it('lists the real values when one does not exist', async () => {
    const message = await lookupError(gelatoCanvasRoutes(), {
      lookup: { catalogUid: 'canvas', attributes: { CanvasFormat: '30x30-cm' } },
    });
    expect(message).toContain('CanvasFormat has no value 30x30-cm');
    expect(message).toContain('300x300-mm-12x12-inch');
  });

  it('explains a missing catalog', async () => {
    const message = await lookupError([
      { method: 'GET', url: `${GELATO_PRODUCT_API_URL}/catalogs/canvas`, status: 404, body: {} },
    ]);
    expect(message).toContain('Gelato has no catalog canvas');
  });

  it('fails when nothing matches', async () => {
    const message = await lookupError(gelatoCanvasRoutes({ products: [] }));
    expect(message).toMatch(/No product in catalog canvas matches/);
  });

  it('refuses to pick between several matches and shows what differs', async () => {
    const horizontal = gelatoCanvasSummary({
      productUid: 'canvas_hor',
      attributes: { ...gelatoCanvasSummary().attributes, Orientation: 'hor' },
    });
    const message = await lookupError(
      gelatoCanvasRoutes({ products: [gelatoCanvasSummary(), horizontal] }),
    );
    expect(message).toContain('2 products match');
    expect(message).toContain(`${FIXTURE_CANVAS_PRODUCT_UID} (Orientation=ver)`);
    expect(message).toContain('canvas_hor (Orientation=hor)');
  });

  it('rejects a product of the wrong size', async () => {
    const wrongSize = gelatoCanvasSummary({
      dimensions: {
        Width: { value: 40, measureUnit: 'cm' },
        Height: { value: 40, measureUnit: 'cm' },
      },
    });
    const message = await lookupError(gelatoCanvasRoutes({ products: [wrongSize] }));
    expect(message).toContain('is 400 × 400 mm, but CANVAS-30X30-SLIM is 300 × 300 mm');
  });

  it('warns, rather than guessing, when dimensions are missing', async () => {
    const { api } = apiFor(
      gelatoCanvasRoutes({ products: [gelatoCanvasSummary({ dimensions: undefined })] }),
    );
    const resolved = await resolveGelatoProduct(api, input);
    expect(resolved.warnings.join()).toMatch(/size not cross-checked/);
  });

  it('rejects a product that is not printable', async () => {
    const message = await lookupError(
      gelatoCanvasRoutes({ details: gelatoCanvasDetails({ isPrintable: false }) }),
    );
    expect(message).toContain('is not printable');
  });

  it('rejects a product that does not ship to Israel', async () => {
    const excluded = gelatoCanvasDetails({ notSupportedCountries: ['IL'] });
    expect(await lookupError(gelatoCanvasRoutes({ details: excluded }))).toContain(
      'does not ship to IL',
    );
    const notListed = gelatoCanvasDetails({ supportedCountries: ['US'] });
    expect(await lookupError(gelatoCanvasRoutes({ details: notListed }))).toContain(
      'does not ship to IL',
    );
  });

  it('warns when Gelato lists no supported countries', async () => {
    const { api } = apiFor(
      gelatoCanvasRoutes({ details: gelatoCanvasDetails({ supportedCountries: [] }) }),
    );
    const resolved = await resolveGelatoProduct(api, input);
    expect(resolved.warnings.join()).toMatch(/availability not confirmed/);
  });

  it('lets other API errors through', async () => {
    const { api } = apiFor([
      { method: 'GET', url: `${GELATO_PRODUCT_API_URL}/catalogs/canvas`, status: 401, body: {} },
    ]);
    await expect(resolveGelatoProduct(api, input)).rejects.toMatchObject({ status: 401 });
  });

  it('uses the catalog fixture the definition expects', () => {
    const attributes = gelatoCanvasCatalog().productAttributes.map((a) => a.productAttributeUid);
    for (const key of Object.keys(variant.gelato.attributes)) expect(attributes).toContain(key);
  });
});

describe('readSizeMm', () => {
  it('converts documented measures to millimetres', () => {
    const size = readSizeMm({
      Width: { value: 12, measureUnit: 'inch' },
      Height: { value: 30, measureUnit: 'cm' },
    });
    expect(size?.width).toBeCloseTo(304.8, 6);
    expect(size?.height).toBe(300);
  });

  it('returns undefined for shapes it does not know', () => {
    expect(readSizeMm(undefined)).toBeUndefined();
    expect(readSizeMm([{ value: 1, measureUnit: 'mm' }])).toBeUndefined();
    expect(
      readSizeMm({
        Width: { value: 1, measureUnit: 'furlong' },
        Height: { value: 1, measureUnit: 'mm' },
      }),
    ).toBeUndefined();
  });
});
