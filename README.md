# InboxKit

Open-source agent email infrastructure on Cloudflare. Self-hostable, edge-native, bring-your-own-SMTP.

Every AI agent eventually needs email. Traditional providers are hostile to programmatic use: OAuth complexity, per-inbox pricing, rate limits. InboxKit gives you a simple API for creating inboxes, sending and receiving email, all running on your own Cloudflare account.

## Status

Early development. Not yet usable.

## Architecture

InboxKit runs entirely on Cloudflare:

- **Email Workers** receive inbound email (catch-all rule)
- **D1** stores inbox and message metadata
- **R2** stores raw email bodies and attachments
- **Workers** serve the REST API
- **External SMTP relay** (Resend, SES, Postmark) handles outbound

You bring your own Cloudflare account and SMTP relay. Your data stays on your infrastructure.

## Development

```bash
pnpm install
pnpm dev          # Start wrangler dev server
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start worker in dev mode |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint check |
| `pnpm deploy` | Deploy worker to Cloudflare |

## Tests

Two test modes:

- **Unit tests** (`pnpm test`): Runs in Node.js. Fast, no workerd needed. Files: `*.unit.test.ts`.
- **Integration tests** (`pnpm test:integration`): Runs in workerd via `@cloudflare/vitest-pool-workers`.

## Deploy

```bash
cd apps/worker
wrangler deploy
```

Deploys to `inboxkit.<your-subdomain>.workers.dev`.

## NixOS

```bash
nix-shell
pnpm install
pnpm dev
```

The `shell.nix` patches the npm-installed workerd binary and sets up CA certificates for workerd's BoringSSL.

## License

MIT
