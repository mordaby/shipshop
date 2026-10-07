/**
 * Order states (SPEC.md, "Order lifecycle"). The Quote state lives in the
 * quotes table: an order row is created from a quote at awaiting_payment.
 */
export const ORDER_STATUSES = [
  'awaiting_payment',
  'paid',
  'sent_to_provider',
  'in_production',
  'shipped',
  'delivered',
  'expired',
  'cancelled',
  'failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order or ticket came from. */
export const CHANNELS = ['mcp', 'web'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postCode: string;
  state?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  email: string;
  phone?: string;
}
