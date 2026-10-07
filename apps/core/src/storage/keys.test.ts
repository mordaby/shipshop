import { describe, expect, it } from 'vitest';
import { assertObjectKey, designMockupKey, designOriginalKey, designPrintFileKey } from './keys.js';

const DESIGN = '0b8f3c2e-4f7a-4c1e-9d2a-6b5e8f1a2c3d';
const VARIANT = '5d1c9a7e-2b3f-4e6a-8c0d-1f2e3a4b5c6d';
const PREPARATION = '9e8d7c6b-5a49-4382-a716-05f4e3d2c1b0';

describe('object keys', () => {
  it('are built from IDs only', () => {
    expect(designOriginalKey(DESIGN, 'image/png')).toBe(`designs/${DESIGN}/original.png`);
    expect(designOriginalKey(DESIGN, 'image/jpeg')).toBe(`designs/${DESIGN}/original.jpg`);
    expect(designPrintFileKey(DESIGN, VARIANT, PREPARATION, 'image/png')).toBe(
      `designs/${DESIGN}/print/${VARIANT}/${PREPARATION}.png`,
    );
    expect(designMockupKey(DESIGN, VARIANT, PREPARATION)).toBe(
      `designs/${DESIGN}/mockups/${VARIANT}/${PREPARATION}.jpg`,
    );
  });

  it('refuse anything that is not a UUID', () => {
    expect(() => designOriginalKey('../../secrets', 'image/png')).toThrow(/Expected a UUID/);
    expect(() => designOriginalKey('1', 'image/png')).toThrow(/Expected a UUID/);
  });

  it.each([
    '',
    '/designs/x',
    'designs/x/',
    'designs//x',
    'designs/../x',
    'designs/./x',
    'designs/x y',
    'designs/x?y',
    'designs/x\\y',
    `designs/${'a'.repeat(1100)}`,
  ])('rejects %j', (key) => {
    expect(() => {
      assertObjectKey(key);
    }).toThrow(/Invalid object key/);
  });

  it('accepts generated keys', () => {
    expect(() => {
      assertObjectKey(designOriginalKey(DESIGN, 'image/png'));
    }).not.toThrow();
  });
});
