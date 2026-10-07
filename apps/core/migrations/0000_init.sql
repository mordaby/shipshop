CREATE TYPE "public"."channel" AS ENUM('mcp', 'web');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('pending', 'pass', 'flag', 'reject');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ILS', 'USD', 'EUR');--> statement-breakpoint
CREATE TYPE "public"."design_source" AS ENUM('upload', 'assistant', 'generator');--> statement-breakpoint
CREATE TYPE "public"."event_verification" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fit_mode" AS ENUM('none', 'crop', 'fit', 'extend');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_provider" AS ENUM('gelato');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'paid', 'sent_to_provider', 'in_production', 'shipped', 'delivered', 'expired', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_processor" AS ENUM('paypal', 'fake');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('canvas', 'poster', 'book');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'shipped', 'in_transit', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "catalog_prices" (
	"variant_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_prices_variant_id_currency_pk" PRIMARY KEY("variant_id","currency"),
	CONSTRAINT "catalog_prices_amount_positive" CHECK ("catalog_prices"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"type" "product_type" NOT NULL,
	"name_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "catalog_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"color" text,
	"print_areas" jsonb NOT NULL,
	"file_requirements" jsonb NOT NULL,
	"gelato_product_uid" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "catalog_variants_size_positive" CHECK ("catalog_variants"."width_mm" > 0 AND "catalog_variants"."height_mm" > 0),
	CONSTRAINT "catalog_variants_gelato_product_uid_present" CHECK (length("catalog_variants"."gelato_product_uid") > 0)
);
--> statement-breakpoint
CREATE TABLE "design_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"effective_dpi" integer,
	"check_status" "check_status" DEFAULT 'pending' NOT NULL,
	"check_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"print_file_key" text,
	"print_width_px" integer,
	"print_height_px" integer,
	"upscale_factor" smallint,
	"fit_mode" "fit_mode",
	"prepared_at" timestamp with time zone,
	"mockup_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_preparations_print_file_key_unique" UNIQUE("print_file_key"),
	CONSTRAINT "design_preparations_upscale_positive" CHECK ("design_preparations"."upscale_factor" IS NULL OR "design_preparations"."upscale_factor" >= 1),
	CONSTRAINT "design_preparations_print_file_complete" CHECK (("design_preparations"."print_file_key" IS NULL) = ("design_preparations"."prepared_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "design_source" NOT NULL,
	"source_assistant" text,
	"prompt" text,
	"original_key" text NOT NULL,
	"original_content_type" text,
	"original_bytes" integer,
	"original_sha256" char(64),
	"width_px" integer,
	"height_px" integer,
	"uploaded_at" timestamp with time zone,
	"rights_attested_at" timestamp with time zone,
	"rights_attestation_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "designs_original_key_unique" UNIQUE("original_key"),
	CONSTRAINT "designs_pixels_positive" CHECK (("designs"."width_px" IS NULL OR "designs"."width_px" > 0) AND ("designs"."height_px" IS NULL OR "designs"."height_px" > 0)),
	CONSTRAINT "designs_bytes_positive" CHECK ("designs"."original_bytes" IS NULL OR "designs"."original_bytes" > 0),
	CONSTRAINT "designs_sha256_hex" CHECK ("designs"."original_sha256" IS NULL OR "designs"."original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "designs_attestation_complete" CHECK (("designs"."rights_attested_at" IS NULL) = ("designs"."rights_attestation_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"type" text,
	"external_id" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_body" text NOT NULL,
	"payload" jsonb,
	"verification" "event_verification" DEFAULT 'pending' NOT NULL,
	"verification_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_log_attempts_non_negative" CHECK ("event_log"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"print_file_key" text,
	"provider_item_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_non_negative" CHECK ("order_items"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"currency" "currency" NOT NULL,
	"product_price_minor" integer NOT NULL,
	"shipping_price_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"provider" "fulfillment_provider" DEFAULT 'gelato' NOT NULL,
	"provider_order_id" text,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	"checkout_token_hash" text,
	"checkout_expires_at" timestamp with time zone,
	"checkout_used_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "orders_checkout_token_hash_unique" UNIQUE("checkout_token_hash"),
	CONSTRAINT "orders_product_price_non_negative" CHECK ("orders"."product_price_minor" >= 0),
	CONSTRAINT "orders_shipping_price_non_negative" CHECK ("orders"."shipping_price_minor" >= 0),
	CONSTRAINT "orders_tax_non_negative" CHECK ("orders"."tax_minor" >= 0),
	CONSTRAINT "orders_total_non_negative" CHECK ("orders"."total_minor" >= 0),
	CONSTRAINT "orders_review_complete" CHECK (("orders"."review_status" = 'pending') = ("orders"."reviewed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"processor" "payment_processor" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"refunded_amount_minor" integer DEFAULT 0 NOT NULL,
	"processor_ref" text,
	"confirmed_by_event_id" uuid,
	"invoice_number" text,
	"invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_refund_within_amount" CHECK ("payments"."refunded_amount_minor" >= 0 AND "payments"."refunded_amount_minor" <= "payments"."amount_minor"),
	CONSTRAINT "payments_succeeded_needs_event" CHECK ("payments"."status" NOT IN ('succeeded', 'refunded') OR "payments"."confirmed_by_event_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	CONSTRAINT "quote_items_quantity_positive" CHECK ("quote_items"."quantity" > 0),
	CONSTRAINT "quote_items_unit_price_non_negative" CHECK ("quote_items"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"destination_country" char(2) NOT NULL,
	"currency" "currency" NOT NULL,
	"product_price_minor" integer NOT NULL,
	"shipping_price_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"provider" "fulfillment_provider" DEFAULT 'gelato' NOT NULL,
	"shipping_method_uid" text,
	"shipping_method_name" text,
	"delivery_min_date" date,
	"delivery_max_date" date,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_destination_country_iso" CHECK ("quotes"."destination_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "quotes_product_price_non_negative" CHECK ("quotes"."product_price_minor" >= 0),
	CONSTRAINT "quotes_shipping_price_non_negative" CHECK ("quotes"."shipping_price_minor" >= 0),
	CONSTRAINT "quotes_tax_non_negative" CHECK ("quotes"."tax_minor" >= 0),
	CONSTRAINT "quotes_total_non_negative" CHECK ("quotes"."total_minor" >= 0),
	CONSTRAINT "quotes_delivery_window_ordered" CHECK ("quotes"."delivery_min_date" IS NULL OR "quotes"."delivery_max_date" IS NULL OR "quotes"."delivery_min_date" <= "quotes"."delivery_max_date")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"delivery_min_date" date,
	"delivery_max_date" date,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_delivery_window_ordered" CHECK ("shipments"."delivery_min_date" IS NULL OR "shipments"."delivery_max_date" IS NULL OR "shipments"."delivery_min_date" <= "shipments"."delivery_max_date")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"message" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_message_not_blank" CHECK (length(trim("support_tickets"."message")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"email" text,
	"name" text,
	"saved_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generations_month" date,
	"generations_used" integer DEFAULT 0 NOT NULL,
	"bonus_generations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_generations_used_non_negative" CHECK ("users"."generations_used" >= 0),
	CONSTRAINT "users_bonus_generations_non_negative" CHECK ("users"."bonus_generations" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_prices" ADD CONSTRAINT "catalog_prices_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_preparations" ADD CONSTRAINT "design_preparations_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_preparations" ADD CONSTRAINT "design_preparations_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_event_id_event_log_id_fk" FOREIGN KEY ("confirmed_by_event_id") REFERENCES "public"."event_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_variants_product_id_idx" ON "catalog_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_preparations_design_variant_idx" ON "design_preparations" USING btree ("design_id","variant_id");--> statement-breakpoint
CREATE INDEX "designs_user_id_idx" ON "designs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_log_source_external_id_idx" ON "event_log" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "event_log_unprocessed_idx" ON "event_log" USING btree ("received_at") WHERE "event_log"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_order_id_idx" ON "orders" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_processor_ref_idx" ON "payments" USING btree ("processor","processor_ref");--> statement-breakpoint
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_user_id_idx" ON "quotes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shipments_order_id_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_order_tracking_idx" ON "shipments" USING btree ("order_id","tracking_number");--> statement-breakpoint
CREATE INDEX "support_tickets_order_id_idx" ON "support_tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");