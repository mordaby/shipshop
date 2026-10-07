/**
 * User-facing strings. English is the reference; every other locale must
 * define the same keys (the type checker enforces it). Placeholders use
 * {name} and are filled by translate().
 */
export const en = {
  'catalog.canvas.name': 'Canvas',
  'catalog.size.cm': '{width} × {height} cm',
} as const;

export type MessageKey = keyof typeof en;

export const he: Record<MessageKey, string> = {
  'catalog.canvas.name': 'קנבס',
  'catalog.size.cm': '{width} × {height} ס״מ',
};
