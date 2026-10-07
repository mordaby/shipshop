/**
 * Database schema for the ten entities in SPEC.md, "Data model".
 *
 * Conventions:
 * - IDs are random UUIDs (gen_random_uuid()), never sequential.
 * - Money is an integer in minor units (`*_minor`) next to a currency code.
 * - Timestamps are timestamptz.
 *
 * Some entities span more than one table: CatalogProduct is catalog_products,
 * catalog_variants and catalog_prices; Design is designs plus one
 * design_preparations row per product size; Quote has quote_items.
 *
 * After editing this file run `pnpm db:generate` and commit the migration.
 */
import {
  CHANNELS,
  CHECK_STATUSES,
  DESIGN_SOURCES,
  FIT_MODES,
  ORDER_STATUSES,
  PRODUCT_TYPES,
  SUPPORTED_CURRENCIES,
  type DesignFinding,
  type FileRequirements,
  type PrintArea,
  type ShippingAddress,
} from '@chatprint/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums

export const currency = pgEnum('currency', SUPPORTED_CURRENCIES);
export const productType = pgEnum('product_type', PRODUCT_TYPES);
export const fulfillmentProvider = pgEnum('fulfillment_provider', ['gelato']);
export const channel = pgEnum('channel', CHANNELS);
export const designSource = pgEnum('design_source', DESIGN_SOURCES);
export const checkStatus = pgEnum('check_status', CHECK_STATUSES);
export const fitMode = pgEnum('fit_mode', FIT_MODES);
export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected']);
// TODO(decision): add the Israeli processor once chosen. `fake` is dev only.
export const paymentProcessor = pgEnum('payment_processor', ['paypal', 'fake']);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);
export const shipmentStatus = pgEnum('shipment_status', [
  'pending',
  'shipped',
  'in_transit',
  'delivered',
  'returned',
]);
export const ticketStatus = pgEnum('ticket_status', ['open', 'closed']);
export const eventVerification = pgEnum('event_verification', ['pending', 'verified', 'rejected']);

// ---------------------------------------------------------------------------
// Column helpers

const id = () => uuid('id').primaryKey().defaultRandom();
const tz = { withTimezone: true } as const;
const createdAt = () => timestamp('created_at', tz).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', tz)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const minor = (name: string) => integer(name).notNull();

const nonNegative = (column: AnyPgColumn): SQL => sql`${column} >= 0`;
const countryCode = (column: AnyPgColumn): SQL => sql`${column} ~ '^[A-Z]{2}$'`;

// ---------------------------------------------------------------------------
// User

export const users = pgTable(
  'users',
  {
    id: id(),
    /** E.164, verified by SMS code at sign-in. */
    phone: text('phone').notNull().unique(),
    phoneVerifiedAt: timestamp('phone_verified_at', tz),
    email: text('email'),
    name: text('name'),
    savedAddresses: jsonb('saved_addresses')
      .$type<ShippingAddress[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** First day of the month the generation counters below belong to. */
    generationsMonth: date('generations_month', { mode: 'string' }),
    generationsUsed: integer('generations_used').notNull().default(0),
    bonusGenerations: integer('bonus_generations').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_phone_e164', sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('users_generations_used_non_negative', nonNegative(t.generationsUsed)),
    check('users_bonus_generations_non_negative', nonNegative(t.bonusGenerations)),
  ],
);

// ---------------------------------------------------------------------------
// CatalogProduct

export const catalogProducts = pgTable('catalog_products', {
  id: id(),
  sku: text('sku').notNull().unique(),
  type: productType('type').notNull(),
  /** Translation key for the product name. */
  nameKey: text('name_key').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const catalogVariants = pgTable(
  'catalog_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => catalogProducts.id),
    sku: text('sku').notNull().unique(),
    widthMm: integer('width_mm').notNull(),
    heightMm: integer('height_mm').notNull(),
    color: text('color'),
    printAreas: jsonb('print_areas').$type<PrintArea[]>().notNull(),
    fileRequirements: jsonb('file_requirements').$type<FileRequirements>().notNull(),
    /** Looked up through Gelato's product API by the seed, never typed in. */
    gelatoProductUid: text('gelato_product_uid').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('catalog_variants_product_id_idx').on(t.productId),
    check('catalog_variants_size_positive', sql`${t.widthMm} > 0 AND ${t.heightMm} > 0`),
    check('catalog_variants_gelato_product_uid_present', sql`length(${t.gelatoProductUid}) > 0`),
  ],
);

/** Retail price per variant and currency. Prices are set only on the server. */
export const catalogPrices = pgTable(
  'catalog_prices',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => catalogVariants.id, { onDelete: 'cascade' }),
    currency: currency('currency').notNull(),
    amountMinor: minor('amount_minor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.currency] }),
    check('catalog_prices_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Design

export const designs = pgTable(
  'designs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Provenance: source, assistant, prompt, time (created_at) and user.
    source: designSource('source').notNull(),
    /** Which assistant made or passed the image, when known (for example "chatgpt"). */
    sourceAssistant: text('source_assistant'),
    prompt: text('prompt'),
    /** Private storage key of the original file, exactly as received. */
    originalKey: text('original_key').notNull().unique(),
    originalContentType: text('original_content_type'),
    originalBytes: integer('original_bytes'),
    originalSha256: char('original_sha256', { length: 64 }),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    uploadedAt: timestamp('uploaded_at', tz),
    /** Set on the checkout page, by the person, never by the agent. */
    rightsAttestedAt: timestamp('rights_attested_at', tz),
    rightsAttestationVersion: text('rights_attestation_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('designs_user_id_idx').on(t.userId),
    check(
      'designs_pixels_positive',
      sql`(${t.widthPx} IS NULL OR ${t.widthPx} > 0) AND (${t.heightPx} IS NULL OR ${t.heightPx} > 0)`,
    ),
    check('designs_bytes_positive', sql`${t.originalBytes} IS NULL OR ${t.originalBytes} > 0`),
    check(
      'designs_sha256_hex',
      sql`${t.originalSha256} IS NULL OR ${t.originalSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'designs_attestation_complete',
      sql`(${t.rightsAttestedAt} IS NULL) = (${t.rightsAttestationVersion} IS NULL)`,
    ),
  ],
);

/**
 * A design checked and prepared for one product size: effective DPI, check
 * result and findings, the print file sent to the provider, and mockups.
 * Upscaling runs once per size, so there is one row per design and variant.
 */
export const designPreparations = pgTable(
  'design_preparations',
  {
    id: id(),
    designId: uuid('design_id')
      .notNull()
      .references(() => designs.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => catalogVariants.id),
    /** Effective DPI of the original at this size, rounded down. */
    effectiveDpi: integer('effective_dpi'),
    checkStatus: checkStatus('check_status').notNull().default('pending'),
    checkFindings: jsonb('check_findings')
      .$type<DesignFinding[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    checkedAt: timestamp('checked_at', tz),
    printFileKey: text('print_file_key').unique(),
    printWidthPx: integer('print_width_px'),
    printHeightPx: integer('print_height_px'),
    upscaleFactor: smallint('upscale_factor'),
    fitMode: fitMode('fit_mode'),
    preparedAt: timestamp('prepared_at', tz),
    mockupKeys: jsonb('mockup_keys')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('design_preparations_design_variant_idx').on(t.designId, t.variantId),
    check(
      'design_preparations_upscale_positive',
      sql`${t.upscaleFactor} IS NULL OR ${t.upscaleFactor} >= 1`,
    ),
    check(
      'design_preparations_print_file_complete',
      sql`(${t.printFileKey} IS NULL) = (${t.preparedAt} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Quote

export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    destinationCountry: char('destination_country', { length: 2 }).notNull(),
    currency: currency('currency').notNull(),
    productPriceMinor: minor('product_price_minor'),
    shippingPriceMinor: minor('shipping_price_minor'),
    // TODO(decision): whether prices include VAT is for the accountant (SPEC.md, "Tax").
    taxMinor: minor('tax_minor'),
    totalMinor: minor('total_minor'),
    provider: fulfillmentProvider('provider').notNull().default('gelato'),
    shippingMethodUid: text('shipping_method_uid'),
    shippingMethodName: text('shipping_method_name'),
    deliveryMinDate: date('delivery_min_date', { mode: 'string' }),
    deliveryMaxDate: date('delivery_max_date', { mode: 'string' }),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('quotes_user_id_idx').on(t.userId),
    check('quotes_destination_country_iso', countryCode(t.destinationCountry)),
    check('quotes_product_price_non_negative', nonNegative(t.productPriceMinor)),
    check('quotes_shipping_price_non_negative', nonNegative(t.shippingPriceMinor)),
    check('quotes_tax_non_negative', nonNegative(t.taxMinor)),
    check('quotes_total_non_negative', nonNegative(t.totalMinor)),
    check(
      'quotes_delivery_window_ordered',
      sql`${t.deliveryMinDate} IS NULL OR ${t.deliveryMaxDate} IS NULL OR ${t.deliveryMinDate} <= ${t.deliveryMaxDate}`,
    ),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: id(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => catalogVariants.id),
    designId: uuid('design_id')
      .notNull()
      .references(() => designs.id),
    quantity: integer('quantity').notNull(),
    /** In the quote's currency. */
    unitPriceMinor: minor('unit_price_minor'),
  },
  (t) => [
    index('quote_items_quote_id_idx').on(t.quoteId),
    check('quote_items_quantity_positive', sql`${t.quantity} > 0`),
    check('quote_items_unit_price_non_negative', nonNegative(t.unitPriceMinor)),
  ],
);

// ---------------------------------------------------------------------------
// Order

export const orders = pgTable(
  'orders',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** One order per quote. */
    quoteId: uuid('quote_id')
      .notNull()
      .unique()
      .references(() => quotes.id),
    channel: channel('channel').notNull(),
    status: orderStatus('status').notNull().default('awaiting_payment'),
    statusChangedAt: timestamp('status_changed_at', tz).notNull().defaultNow(),
    shippingAddress: jsonb('shipping_address').$type<ShippingAddress>().notNull(),
    currency: currency('currency').notNull(),
    productPriceMinor: minor('product_price_minor'),
    shippingPriceMinor: minor('shipping_price_minor'),
    taxMinor: minor('tax_minor'),
    totalMinor: minor('total_minor'),
    provider: fulfillmentProvider('provider').notNull().default('gelato'),
    providerOrderId: text('provider_order_id'),
    // Manual review between Paid and Sent to provider (beta: every order).
    reviewStatus: reviewStatus('review_status').notNull().default('pending'),
    reviewedAt: timestamp('reviewed_at', tz),
    reviewedBy: text('reviewed_by'),
    reviewNote: text('review_note'),
    // Single-use, expiring checkout link. Only a hash of the token is stored.
    checkoutTokenHash: text('checkout_token_hash').unique(),
    checkoutExpiresAt: timestamp('checkout_expires_at', tz),
    checkoutUsedAt: timestamp('checkout_used_at', tz),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('orders_user_id_created_at_idx').on(t.userId, t.createdAt.desc()),
    index('orders_status_idx').on(t.status),
    uniqueIndex('orders_provider_order_id_idx').on(t.provider, t.providerOrderId),
    check('orders_product_price_non_negative', nonNegative(t.productPriceMinor)),
    check('orders_shipping_price_non_negative', nonNegative(t.shippingPriceMinor)),
    check('orders_tax_non_negative', nonNegative(t.taxMinor)),
    check('orders_total_non_negative', nonNegative(t.totalMinor)),
    check(
      'orders_review_complete',
      sql`(${t.reviewStatus} = 'pending') = (${t.reviewedAt} IS NULL)`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => catalogVariants.id),
    designId: uuid('design_id')
      .notNull()
      .references(() => designs.id),
    quantity: integer('quantity').notNull(),
    /** In the order's currency. */
    unitPriceMinor: minor('unit_price_minor'),
    /** The exact print file sent to the provider. */
    printFileKey: text('print_file_key'),
    providerItemRef: text('provider_item_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check('order_items_unit_price_non_negative', nonNegative(t.unitPriceMinor)),
  ],
);

// ---------------------------------------------------------------------------
// EventLog (declared before Payment, which references it)

/** Every inbound webhook, stored before anything else is done with it. */
export const eventLog = pgTable(
  'event_log',
  {
    id: id(),
    /** "gelato", "paypal", ... */
    source: text('source').notNull(),
    type: text('type'),
    /** The sender's event ID, used to drop duplicate deliveries. */
    externalId: text('external_id'),
    /** Only the headers needed for verification; never our own secret header. */
    headers: jsonb('headers')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The body exactly as received, for signature checks. */
    rawBody: text('raw_body').notNull(),
    payload: jsonb('payload'),
    verification: eventVerification('verification').notNull().default('pending'),
    verificationError: text('verification_error'),
    receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', tz),
    processedAt: timestamp('processed_at', tz),
    processingError: text('processing_error'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('event_log_source_external_id_idx').on(t.source, t.externalId),
    index('event_log_unprocessed_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
    check('event_log_attempts_non_negative', nonNegative(t.attempts)),
  ],
);

// ---------------------------------------------------------------------------
// Payment

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    processor: paymentProcessor('processor').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    amountMinor: minor('amount_minor'),
    currency: currency('currency').notNull(),
    refundedAmountMinor: integer('refunded_amount_minor').notNull().default(0),
    /** The processor's ID for this payment (for PayPal, the order ID). */
    processorRef: text('processor_ref'),
    /** The verified webhook that confirmed the payment. Paid means a verified webhook. */
    confirmedByEventId: uuid('confirmed_by_event_id').references(() => eventLog.id),
    // TODO(decision): invoicing service.
    invoiceNumber: text('invoice_number'),
    invoiceUrl: text('invoice_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payments_order_id_idx').on(t.orderId),
    uniqueIndex('payments_processor_ref_idx').on(t.processor, t.processorRef),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'payments_refund_within_amount',
      sql`${t.refundedAmountMinor} >= 0 AND ${t.refundedAmountMinor} <= ${t.amountMinor}`,
    ),
    check(
      'payments_succeeded_needs_event',
      sql`${t.status} NOT IN ('succeeded', 'refunded') OR ${t.confirmedByEventId} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Shipment

export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    deliveryMinDate: date('delivery_min_date', { mode: 'string' }),
    deliveryMaxDate: date('delivery_max_date', { mode: 'string' }),
    status: shipmentStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shipments_order_id_idx').on(t.orderId),
    uniqueIndex('shipments_order_tracking_idx').on(t.orderId, t.trackingNumber),
    check(
      'shipments_delivery_window_ordered',
      sql`${t.deliveryMinDate} IS NULL OR ${t.deliveryMaxDate} IS NULL OR ${t.deliveryMinDate} <= ${t.deliveryMaxDate}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// SupportTicket

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    /** Every ticket is tied to an order. */
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    channel: channel('channel').notNull(),
    message: text('message').notNull(),
    status: ticketStatus('status').notNull().default('open'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_tickets_order_id_idx').on(t.orderId),
    index('support_tickets_user_id_idx').on(t.userId),
    check('support_tickets_message_not_blank', sql`length(trim(${t.message})) > 0`),
  ],
);
