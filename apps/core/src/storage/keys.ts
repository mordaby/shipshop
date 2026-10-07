import type { PrintFileContentType } from '@chatprint/shared';
import { StorageError } from './object-storage.js';

/**
 * Object keys are built here from our own random IDs, never from user input
 * such as file names.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const MAX_KEY_BYTES = 1024;

const EXTENSIONS: Record<PrintFileContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** The design file exactly as the person uploaded it. */
export function designOriginalKey(designId: string, contentType: PrintFileContentType): string {
  return `designs/${uuid(designId)}/original.${EXTENSIONS[contentType]}`;
}

/** The prepared print file sent to the provider for one product size. */
export function designPrintFileKey(
  designId: string,
  variantId: string,
  preparationId: string,
  contentType: PrintFileContentType,
): string {
  return `designs/${uuid(designId)}/print/${uuid(variantId)}/${uuid(preparationId)}.${EXTENSIONS[contentType]}`;
}

/** A mockup of the design on one product size. */
export function designMockupKey(designId: string, variantId: string, mockupId: string): string {
  return `designs/${uuid(designId)}/mockups/${uuid(variantId)}/${uuid(mockupId)}.jpg`;
}

/**
 * Rejects keys that could escape a prefix or confuse a store. Every segment
 * starts with a letter or digit, so `.`, `..`, `//` and a leading `/` can't occur.
 */
export function assertObjectKey(key: string): void {
  if (!SAFE_KEY.test(key) || Buffer.byteLength(key) > MAX_KEY_BYTES) {
    throw new StorageError(`Invalid object key: ${JSON.stringify(key)}`);
  }
}

function uuid(value: string): string {
  if (!UUID.test(value)) throw new StorageError(`Expected a UUID, got ${JSON.stringify(value)}`);
  return value;
}
