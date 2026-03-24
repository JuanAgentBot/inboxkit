// Cloudflare Workers runtime types + project-specific env.
// Regenerate with: pnpm cf-typegen
/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;

  // Phase 3:
  // STORAGE: R2Bucket;
}
