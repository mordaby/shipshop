# CLAUDE.md

Guidance for Claude Code working in this repository.

## What we are building

A chat-native print store. Customers design, preview, order, pay, track and contact support from inside their AI assistant (Claude and ChatGPT first) through our own remote MCP connector. Only the payment step leaves the chat: it opens our hosted checkout page. Gelato prints and ships worldwide for now, behind a provider interface that will later route Israeli orders to local print partners. A small website explains who we are and holds the account, order and legal pages.

Products, in order: a small canvas (Milestone 1), posters (Milestone 2), a short book in one fixed format (Milestone 3). T-shirts come later and only with designs made in our own generator.

**`SPEC.md` is the source of truth.** Read the relevant section before starting any task. If a decision changes, update `SPEC.md` in the same change and say so.

"chatprint" is a placeholder codename until the product has a name.

## Repository layout (planned)

The repo holds only docs so far. The first task is to scaffold this layout:

```
apps/
  core/         Core API: all business logic, prices, permissions, state machine, webhooks
  mcp-server/   Remote MCP server (Streamable HTTP); thin client of the Core
  web/          Website: landing, account, orders, checkout and legal pages; thin client of the Core
packages/
  shared/       Types, catalog definitions, money helpers, API client for the Core
  providers/    FulfillmentProvider (Gelato adapter) and PaymentProvider (processor, PayPal) implementations
```

Stack: TypeScript everywhere, Node (current LTS), pnpm workspaces, Postgres (also hosts the job queue at first), S3-compatible storage with signed URLs, `sharp` for mockups, Vitest for tests. MCP: `@modelcontextprotocol/server` (v2) and `@modelcontextprotocol/ext-apps` for mockup cards. Support MCP protocol versions 2026-07-28 and 2025-11-25.

## Commands

Fill this section in once the monorepo is scaffolded (install, dev, test, lint, typecheck, migrate) and keep it current.

## Hard rules

These are not up for trade-offs. If a task seems to need breaking one, stop and ask.

1. **Thin clients.** Prices, totals, quotas, permissions and order state live only in the Core. The MCP server and the website never compute a price and never trust an amount, ID or status that came from the agent or the browser.
2. **No tool charges money.** `create_order` returns a single-use, expiring link to our checkout page, where the person pays. Never ask for payment details in an elicitation form, a tool argument or an MCP App card.
3. **Paid means a verified webhook.** An order becomes Paid only from a verified payment webhook, never because a tool call or the agent says so.
4. **Webhooks.** Store every inbound event in `EventLog` before anything else, verify it (processor signature; for Gelato, our secret header plus re-fetching the order with GET), return 2xx quickly, and process it in the queue. Processing must be idempotent.
5. **Idempotency.** Every POST to the Core requires an `Idempotency-Key` header.
6. **Ownership.** Every call checks that the order, design or quote belongs to the authenticated user. IDs are random, never sequential; knowing an ID is not authorization.
7. **Money.** Integers in minor units (agorot, cents) plus an ISO currency code. No floating point for money.
8. **MCP tools.** Each tool has a `title` and `readOnlyHint` or `destructiveHint`, a name of at most 64 characters, and reads and writes live in separate tools. Every tool also returns plain-text `content` for clients that don't render cards. Descriptions are short and factual, cover only our tools, and never tell the assistant to override the user or other tools.
9. **Content rights.** Every design records provenance (source, prompt if any, time, user). `check_design` runs before a quote. The person, not the agent, attests to rights on the checkout page. During the beta every design passes manual review between Paid and Sent to provider; a rejected order is refunded in full.
10. **Print preparation.** Measure effective DPI at the chosen size (Gelato minimum 150, target 300), upscale once per chosen size (never per preview), fit or crop to the aspect ratio, convert to sRGB, and show the prepared preview back before the quote. Keep both the original and the print file sent to the provider.
11. **Files.** Private storage only. Providers get signed URLs valid for at least 7 days. No public buckets.
12. **Secrets.** Only in `.env` (gitignored) or a secret manager. Never commit them, never log tokens, card data or full addresses. `.env.example` lists keys with empty values.
13. **Development against real services.** Gelato orders use `orderType: "draft"` and payments use the processor's sandbox. Never create a real Gelato order or a live charge unless the user explicitly asks in this session.
14. **Gelato limits.** Cache catalog, prices and shipment methods (default limit is 5,000 calls a day). Validate and truncate shipping addresses before sending: first and last name up to 25 characters, address line up to 35, city up to 30; postcode, country code and email required.
15. **Generation quota** is enforced in the Core: X generations a month per phone-verified account, plus N per order. Previews are low resolution.

## Real code, configured from the environment

We build the production system from the first task. "Mock" applies only to tests, never to the application.

- **Real integrations.** Use the real libraries and SDKs and make real HTTP calls to the documented endpoints: Postgres, an S3 client, Gelato v4, PayPal Orders v2, the official MCP SDK. Never put a fake where a real integration belongs.
- **Configuration.** Every key and URL comes from environment variables through one typed config module, validated with a schema. Add each new key to `.env.example` with an empty value and a one-line comment.
- **Missing keys fail loudly.** A missing key raises a clear error naming the variable when the feature that needs it runs (and at startup in production). Never fall back silently to a fake.
- **Undecided vendors.** For the Israeli processor, SMS and email, and invoicing, write the interface, a dev-only provider selected explicitly by config (for example `PAYMENT_PROCESSOR=fake`, `SMS_PROVIDER=console`), and a `TODO(decision)` for the real adapter. Dev-only providers refuse to start when `NODE_ENV=production`. Gelato and PayPal are decided: write their real adapters.
- **Sessions without keys** (cloud sessions have none): write the real code anyway, cover it with tests against mocked HTTP responses shaped like the documented API, and list in Progress what still needs a live check with real keys. The live checks run later on the local machine with a filled `.env`.

## Current target: Milestone 1, thin slice

One product (a small canvas), upload only (the design comes from the user's own assistant or files), ordered from Claude through a custom connector. See SPEC.md, "Build order".

Tasks, roughly in order:

1. Scaffold the monorepo: pnpm workspaces, TypeScript project references, lint, typecheck, Vitest, a `docker-compose` with Postgres and an S3-compatible store for local dev.
2. Database schema and migrations for the ten entities in SPEC.md, "Data model". Seed the catalog with one small canvas size; look up its Gelato `productUid` through the product API rather than guessing.
3. Storage adapter with signed upload and download URLs.
4. Provider interfaces in `packages/providers`: `FulfillmentProvider` (`quote`, `createOrder`, `cancelOrder`, `getOrder`, webhook translation into Core events) with a real Gelato adapter; `PaymentProvider` (`createCheckout`, `getPayment`, `refund`, webhook verification) with a real PayPal adapter (sandbox in development, so M1 isn't blocked on the Israeli processor's onboarding) and the dev-only fake provider until the Israeli processor is chosen.
5. Core API endpoints for M1: `GET /v1/catalog`, `POST /v1/designs`, `POST /v1/designs/{id}/check` (resolution and aspect ratio), `POST /v1/designs/{id}/mockups`, `POST /v1/quotes`, `POST /v1/orders`, `GET /v1/orders`, `GET /v1/orders/{id}`.
6. Order state machine (SPEC.md, "Order lifecycle") with tests for every transition and exit.
7. Webhooks: `/hooks/payments/{processor}` and `/hooks/gelato` into `EventLog`, then the queue, then the state machine.
8. Manual review gate: a minimal admin action to approve or reject a paid order before it goes to Gelato.
9. Checkout page on the website: order summary, the exact print preview, rights attestation, hand-off to the processor's hosted page, and a return page on our domain.
10. Auth: OAuth 2.1 authorization server with PKCE (S256), Dynamic Client Registration and Client ID Metadata Documents, Protected Resource Metadata at `/.well-known/oauth-protected-resource`, sign-in with phone number and SMS code (stub the SMS provider in dev). Validate token audience; tokens never travel in URLs. Claude's redirect URI is `https://claude.ai/api/mcp/auth_callback`.
11. MCP server over Streamable HTTP with `Origin` validation and the M1 tools: `list_products`, `get_print_specs`, `create_upload_link`, `check_design`, `preview_product` (a plain mockup image is enough in M1), `get_quote`, `create_order`, `list_orders`, `get_order`.
12. Expose the MCP server on a temporary public HTTPS URL and add it to Claude as a custom connector for end-to-end testing.

**Accept M1 when** a real canvas, ordered entirely from inside Claude, arrives at an Israeli address and every state change was recorded from webhooks. Until that one real order, everything runs on Gelato drafts and the payment sandbox.

## Out of scope for now

Merchant apps for Shopify or Wix, Shopify as a backend, T-shirts, Israeli print partners, Stripe, a public developer API, in-connector AI generation (Milestone 2), books (Milestone 3).

## Open decisions

Do not pick these silently. Build behind an interface, leave a clear `TODO(decision)`, and ask:

- Israeli payment processor (Hyp, Grow, Tranzila, CardCom or PayPlus)
- Image generation, upscaling and vision vendors, including commercial-use terms of their output
- SMS and email provider (must support Israeli numbers)
- Invoicing service (Israeli, with an API that supports allocation numbers)
- Hosting and deployment
- Product name and domain

## Working style

- Small, reviewable changes, one milestone task at a time. Run lint, typecheck and tests before calling a task done.
- Test what moves money or state: pricing, the state machine, webhook verification, idempotency, ownership checks.
- Code, comments and docs in English. User-facing strings go through a translation layer from the start, since the site, checkout, emails and SMS will be in English and Hebrew (RTL).
- Commit only when asked. Never commit `.env` or anything in it.
- At the end of every session, update Progress below: what is done, what is left, and what needs a live check with real keys.

## Progress

Nothing built yet. Next: Milestone 1, task 1.
