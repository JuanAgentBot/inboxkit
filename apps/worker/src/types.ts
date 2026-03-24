/**
 * Cloudflare Worker environment bindings.
 *
 * Keep in sync with worker-configuration.d.ts.
 */
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  RESEND_API_KEY?: string;
  MAIL_DOMAIN?: string;
}
