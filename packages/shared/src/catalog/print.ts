/** Print-size arithmetic. Lengths are millimetres; resolution is dots per inch. */

export const MM_PER_INCH = 25.4;

/** Gelato's minimum and our target resolution at print size (SPEC.md, "Print preparation"). */
export const GELATO_MIN_DPI = 150;
export const TARGET_DPI = 300;

/** Pixels needed to print `mm` at `dpi`, rounded up so the result never falls short. */
export function pixelsForPrint(mm: number, dpi: number): number {
  assertPositive(mm, 'mm');
  assertPositive(dpi, 'dpi');
  // Round first to absorb floating-point noise such as 1771.6535433070866.
  return Math.ceil(Number(((mm / MM_PER_INCH) * dpi).toFixed(6)));
}

/** Effective resolution of `pixels` stretched over `mm`. */
export function effectiveDpi(pixels: number, mm: number): number {
  assertPositive(pixels, 'pixels');
  assertPositive(mm, 'mm');
  return pixels / (mm / MM_PER_INCH);
}

export interface AspectRatio {
  width: number;
  height: number;
}

/** Reduced aspect ratio of two integer lengths, for example 300 × 450 -> 2:3. */
export function aspectRatio(width: number, height: number): AspectRatio {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Aspect ratio needs positive integers, got ${width} × ${height}`);
  }
  const divisor = gcd(width, height);
  return { width: width / divisor, height: height / divisor };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}
