import { describe, expect, it } from 'vitest';
import { aspectRatio, effectiveDpi, GELATO_MIN_DPI, pixelsForPrint, TARGET_DPI } from './print.js';

describe('pixelsForPrint', () => {
  // SPEC.md: 30 × 30 cm needs about 1772 px at 150 DPI and 3543 px at 300 DPI.
  it('matches the spec example for a 30 cm side', () => {
    expect(pixelsForPrint(300, GELATO_MIN_DPI)).toBe(1772);
    expect(pixelsForPrint(300, TARGET_DPI)).toBe(3544);
  });

  it('does not round up exact results', () => {
    expect(pixelsForPrint(25.4, 300)).toBe(300);
    expect(pixelsForPrint(254, 150)).toBe(1500);
  });

  it('rejects non-positive input', () => {
    expect(() => pixelsForPrint(0, 300)).toThrow(RangeError);
    expect(() => pixelsForPrint(300, -1)).toThrow(RangeError);
  });
});

describe('effectiveDpi', () => {
  // SPEC.md: a 1024 px image on a 30 cm canvas is about 87 DPI; 2× is about 173, 4× about 347.
  it('matches the spec example', () => {
    expect(effectiveDpi(1024, 300)).toBeCloseTo(86.7, 1);
    expect(effectiveDpi(2048, 300)).toBeCloseTo(173.4, 1);
    expect(effectiveDpi(4096, 300)).toBeCloseTo(346.8, 1);
    expect(effectiveDpi(1024, 300)).toBeLessThan(GELATO_MIN_DPI);
  });

  it('agrees with pixelsForPrint at the threshold', () => {
    expect(effectiveDpi(pixelsForPrint(300, 150), 300)).toBeGreaterThanOrEqual(150);
    expect(effectiveDpi(pixelsForPrint(300, 150) - 1, 300)).toBeLessThan(150);
  });
});

describe('aspectRatio', () => {
  it('reduces to lowest terms', () => {
    expect(aspectRatio(300, 300)).toEqual({ width: 1, height: 1 });
    expect(aspectRatio(300, 450)).toEqual({ width: 2, height: 3 });
    expect(aspectRatio(1920, 1080)).toEqual({ width: 16, height: 9 });
  });

  it('rejects fractions and zero', () => {
    expect(() => aspectRatio(1.5, 2)).toThrow(RangeError);
    expect(() => aspectRatio(0, 2)).toThrow(RangeError);
  });
});
