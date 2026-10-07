# chatprint

A print store you use from inside your AI assistant. Design, preview, order, pay and track prints from Claude or ChatGPT through our MCP connector; only the payment step opens a page. Gelato prints and ships.

"chatprint" is a placeholder codename until the product has a name.

## Status

Milestone 1 (a thin slice that orders one small canvas end to end from Claude) is under way: the monorepo, database schema and file storage are in place. Progress and setup commands are in `CLAUDE.md`.

## Files

- `SPEC.md`: the technical spec and the source of truth (architecture, data model, order lifecycle, API, MCP tools, payments, content rights, build order).
- `CLAUDE.md`: rules and the current task list for Claude Code.
- `.env.example`: the environment variables the services will need, without values.
- `apps/`, `packages/`: the code (Core API, MCP server, website, shared code, provider adapters).
- `docker-compose.yml`: Postgres and an S3-compatible store for local development.

The living version of the spec is at https://claude.ai/code/artifact/5643d4d6-99f5-4bed-bba4-68337682f58c.

## Getting started with Claude Code

1. Open a terminal in this folder and run `claude`.
2. Ask: "Read CLAUDE.md and SPEC.md, then start Milestone 1, task 1."
3. Copy `.env.example` to `.env` and fill in keys as each service is added. Never commit `.env`.
