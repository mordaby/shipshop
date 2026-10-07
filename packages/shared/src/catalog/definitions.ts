import { GELATO_MIN_DPI, TARGET_DPI } from './print.js';
import type { CatalogProductDefinition } from './types.js';

/**
 * Countries we ship to. Milestone 1 accepts on an Israeli address.
 * TODO(decision): the short list of launch countries (SPEC.md, "Markets at launch").
 */
export const DESTINATION_COUNTRIES = ['IL'] as const;

/**
 * The canonical catalog. The seed writes it to the database and resolves each
 * variant's Gelato productUid through the product API.
 *
 * Milestone 1 sells one product: a 30 × 30 cm canvas on a slim frame (the size
 * SPEC.md uses in its print-preparation examples).
 */
export const CATALOG: readonly CatalogProductDefinition[] = [
  {
    sku: 'CANVAS',
    type: 'canvas',
    nameKey: 'catalog.canvas.name',
    variants: [
      {
        sku: 'CANVAS-30X30-SLIM',
        widthMm: 300,
        heightMm: 300,
        color: null,
        // TODO(verify): whether Gelato wants the wrapped edges inside the print
        // file for canvas (SPEC.md, Open questions). If so, the print area grows.
        printAreas: [{ key: 'front', widthMm: 300, heightMm: 300 }],
        fileRequirements: {
          minDpi: GELATO_MIN_DPI,
          targetDpi: TARGET_DPI,
          colorSpace: 'sRGB',
          contentTypes: ['image/png', 'image/jpeg'],
        },
        // TODO(verify): attribute and value UIDs with a real key. The seed checks
        // them against GET /v3/catalogs/canvas and lists the valid ones if not.
        gelato: {
          catalogUid: 'canvas',
          attributes: {
            CanvasFormat: '300x300-mm-12x12-inch',
            CanvasFrame: 'wood-fsc-slim',
          },
        },
        // TODO(decision): the price list is an open question (SPEC.md, Business).
        retailPrices: [{ currency: 'ILS', amountMinor: 24900, placeholder: true }],
      },
    ],
  },
];
