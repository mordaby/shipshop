/** Where a design came from (its provenance, with the prompt, time and user). */
export const DESIGN_SOURCES = ['upload', 'assistant', 'generator'] as const;
export type DesignSource = (typeof DESIGN_SOURCES)[number];

/** Result of check_design for one product size (SPEC.md: pass, flag or reject). */
export const CHECK_STATUSES = ['pending', 'pass', 'flag', 'reject'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const FIT_MODES = ['none', 'crop', 'fit', 'extend'] as const;
export type FitMode = (typeof FIT_MODES)[number];

/** One finding from a check, with a reason code the assistant can act on. */
export interface DesignFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  params?: Record<string, string | number>;
}
