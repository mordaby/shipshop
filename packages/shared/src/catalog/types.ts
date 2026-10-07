import type { MessageKey } from '../i18n/messages.js';
import type { CurrencyCode } from '../money.js';

export const PRODUCT_TYPES = ['canvas', 'poster', 'book'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRINT_FILE_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;
export type PrintFileContentType = (typeof PRINT_FILE_CONTENT_TYPES)[number];

/** A printable surface of a variant, in our own terms (not the provider's). */
export interface PrintArea {
  key: 'front';
  widthMm: number;
  heightMm: number;
}

export interface FileRequirements {
  minDpi: number;
  targetDpi: number;
  colorSpace: 'sRGB';
  contentTypes: readonly PrintFileContentType[];
}

/**
 * How to find the variant in Gelato's product catalog. The productUid itself
 * is never written by hand: the seed looks it up through the product API.
 */
export interface GelatoProductLookup {
  catalogUid: string;
  /** productAttributeUid -> productAttributeValueUid, from GET /v3/catalogs/{catalogUid}. */
  attributes: Readonly<Record<string, string>>;
}

export interface RetailPrice {
  currency: CurrencyCode;
  amountMinor: number;
  /** True until the price list is decided. The seed refuses placeholders in production. */
  placeholder: boolean;
}

export interface CatalogVariantDefinition {
  sku: string;
  widthMm: number;
  heightMm: number;
  color: string | null;
  printAreas: readonly PrintArea[];
  fileRequirements: FileRequirements;
  gelato: GelatoProductLookup;
  retailPrices: readonly RetailPrice[];
}

export interface CatalogProductDefinition {
  sku: string;
  type: ProductType;
  nameKey: MessageKey;
  variants: readonly CatalogVariantDefinition[];
}
